'use strict';

/**
 * affiliationUsers.service.js — the affiliation's "จัดการผู้ใช้งาน" page
 * (owner decision 2026-11-12: an affiliation manages the MAIN accounts of the
 * schools in its own affiliation — list, create, rename, reset password,
 * deactivate/activate, delete, restore).
 *
 * Scope, enforced in every query here (never trusted from the client):
 *   users.role = 'school' AND scope_type = 'SCHOOL'
 *   AND the account is a school MAIN account (no grade_scope — grade-teacher
 *       sub-accounts stay with the school's own "บัญชีครูประจำสายชั้น" page)
 *   AND schools.affiliation_id = the caller's affiliation (from the JWT).
 * Anything outside that answers 404, so ids in other affiliations cannot be
 * probed.
 *
 * Mirrors the admin user routes (admin.routes.js PUT/DELETE/restore): delete is
 * a soft delete that also releases the account-recovery LINE binding; restore
 * brings the account back DEACTIVATED; a password reset forces a change at next
 * login and ends existing sessions (password_changed_at = NOW()).
 */

const bcrypt = require('bcrypt');
const { pool } = require('../config/database');
const { logAudit } = require('../utils/audit');
const { validatePassword } = require('../utils/passwordPolicy');

const BCRYPT_COST = 12;
const DISPLAY_NAME_MAX = 200;

const MAIN_ACCOUNT_SQL = `u.role = 'school' AND u.scope_type = 'SCHOOL'
  AND (u.grade_scope IS NULL OR u.grade_scope = '')`;

function httpError(message, statusCode) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

/**
 * Main school accounts of one affiliation. `status`: 'active' (not deleted,
 * default) or 'deleted' (soft-deleted, restorable).
 */
async function listMainAccounts(db, affiliationId, { status = 'active' } = {}) {
  const deleted = status === 'deleted';
  const [rows] = await db.query(
    `SELECT u.id, u.username, u.display_name, u.is_active, u.must_change_password,
            u.last_login, u.created_at, u.deleted_at,
            sc.id AS school_id, sc.name AS school_name
       FROM users u
       JOIN schools sc ON sc.id = u.scope_id AND sc.affiliation_id = ?
      WHERE ${MAIN_ACCOUNT_SQL}
        AND u.is_deleted = ?
      ORDER BY sc.name, u.username
      LIMIT 2000`,
    [affiliationId, deleted],
  );
  return rows;
}

async function findMainAccount(conn, affiliationId, accountId, { deleted = false, lock = false } = {}) {
  const [[row]] = await conn.query(
    `SELECT u.id, u.username, u.display_name, u.is_active, u.is_deleted, sc.id AS school_id
       FROM users u
       JOIN schools sc ON sc.id = u.scope_id
      WHERE u.id = ? AND sc.affiliation_id = ? AND ${MAIN_ACCOUNT_SQL}
        AND u.is_deleted = ?
      ${lock ? 'FOR UPDATE' : ''}`,
    [accountId, affiliationId, deleted],
  );
  return row || null;
}

/** Rename and/or activate/deactivate. */
async function updateMainAccount(db, { affiliationId, accountId, displayName, isActive, actorId, ip = null, userAgent = null }) {
  const updates = [];
  const params = [];
  if (displayName !== undefined) {
    const name = String(displayName ?? '').trim();
    if (!name) throw httpError('กรุณากรอกชื่อที่แสดง', 400);
    if (name.length > DISPLAY_NAME_MAX) throw httpError(`ชื่อที่แสดงยาวได้ไม่เกิน ${DISPLAY_NAME_MAX} ตัวอักษร`, 400);
    updates.push('display_name = ?');
    params.push(name);
  }
  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') throw httpError('is_active ต้องเป็น true หรือ false', 400);
    updates.push('is_active = ?');
    params.push(isActive);
  }
  if (!updates.length) throw httpError('ไม่มีข้อมูลที่ต้องแก้ไข', 400);

  const account = await findMainAccount(db, affiliationId, accountId);
  if (!account) throw httpError('ไม่พบบัญชีนี้ในสังกัด', 404);

  await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, [...params, accountId]);
  await logAudit({
    userId: actorId, action: 'UPDATE', entityType: 'user', entityId: accountId,
    oldValue: { display_name: account.display_name, is_active: Boolean(account.is_active) },
    newValue: {
      ...(displayName !== undefined ? { display_name: params[0] } : {}),
      ...(isActive !== undefined ? { is_active: isActive } : {}),
      by: 'affiliation',
    },
    ipAddress: ip, userAgent, conn: db,
  });
  return { id: accountId, username: account.username };
}

/** Operator-chosen temporary password; forces a change at next login and ends sessions. */
async function resetMainPassword(db, { affiliationId, accountId, newPassword, actorId, ip = null, userAgent = null }) {
  const account = await findMainAccount(db, affiliationId, accountId);
  if (!account) throw httpError('ไม่พบบัญชีนี้ในสังกัด', 404);
  const pw = validatePassword(newPassword, { username: account.username });
  if (!pw.ok) throw httpError(pw.message, 400);

  const hash = await bcrypt.hash(String(newPassword), BCRYPT_COST);
  await db.query(
    'UPDATE users SET password_hash = ?, must_change_password = TRUE, password_changed_at = NOW() WHERE id = ?',
    [hash, accountId],
  );
  await logAudit({
    userId: actorId, action: 'UPDATE', entityType: 'user', entityId: accountId,
    newValue: { action: 'reset_password', target_username: account.username, by: 'affiliation' },
    ipAddress: ip, userAgent, conn: db,
  });
  return { id: accountId, username: account.username };
}

/**
 * Soft delete. Like the admin delete, also releases the account's recovery
 * LINE binding (UNIQUE provider_subject — otherwise that LINE identity could
 * never be bound to another account) and any unused recovery codes/requests.
 */
async function deleteMainAccount(db, { affiliationId, accountId, actorId, ip = null, userAgent = null }) {
  if (accountId === actorId) throw httpError('ไม่สามารถลบบัญชีของตัวเองได้', 400);
  const conn = await db.getConnection();
  let account;
  let released = 0;
  try {
    await conn.beginTransaction();
    account = await findMainAccount(conn, affiliationId, accountId, { lock: true });
    if (!account) throw httpError('ไม่พบบัญชีนี้ในสังกัด', 404);
    await conn.query('DELETE FROM password_reset_requests WHERE user_id = ? AND used_at IS NULL', [accountId]);
    await conn.query('DELETE FROM user_recovery_codes WHERE user_id = ?', [accountId]);
    const [chan] = await conn.query('DELETE FROM user_recovery_channels WHERE user_id = ?', [accountId]);
    released = (chan && chan.affectedRows) || 0;
    await conn.query('UPDATE users SET is_deleted = TRUE, deleted_at = NOW() WHERE id = ?', [accountId]);
    await logAudit({
      userId: actorId, action: 'DELETE', entityType: 'user', entityId: accountId,
      oldValue: { username: account.username, school_id: account.school_id },
      newValue: { recovery_channels_released: released, by: 'affiliation' },
      ipAddress: ip, userAgent, conn, required: true,
    });
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch { /* keep the original error */ }
    throw err;
  } finally {
    conn.release();
  }
  return { id: accountId, username: account.username, recovery_channels_released: released };
}

/** Undo a soft delete. The account comes back DEACTIVATED; enabling it is a separate, deliberate step. */
async function restoreMainAccount(db, { affiliationId, accountId, actorId, ip = null, userAgent = null }) {
  const conn = await db.getConnection();
  let account;
  try {
    await conn.beginTransaction();
    account = await findMainAccount(conn, affiliationId, accountId, { deleted: true, lock: true });
    if (!account) throw httpError('ไม่พบบัญชีที่ถูกลบนี้ในสังกัด', 404);
    await conn.query(
      'UPDATE users SET is_deleted = FALSE, deleted_at = NULL, is_active = FALSE WHERE id = ?',
      [accountId],
    );
    await logAudit({
      userId: actorId, action: 'UPDATE', entityType: 'user', entityId: accountId,
      oldValue: { is_deleted: true },
      newValue: { action: 'restore', is_deleted: false, is_active: false, username: account.username, by: 'affiliation' },
      ipAddress: ip, userAgent, conn, required: true,
    });
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch { /* keep the original error */ }
    throw err;
  } finally {
    conn.release();
  }
  return { id: accountId, username: account.username, is_active: false };
}

module.exports = {
  listMainAccounts,
  updateMainAccount,
  resetMainPassword,
  deleteMainAccount,
  restoreMainAccount,
  _MAIN_ACCOUNT_SQL: MAIN_ACCOUNT_SQL,
  defaultPool: pool,
};
