'use strict';

/**
 * Province-level account administration.
 *
 * WHY THIS EXISTS
 *   The hierarchy was one level short. An affiliation can already reset the
 *   password of a school in its own area (affiliationAdmin.service.js
 *   resetSchoolPassword) and a school can reset its own teacher sub-accounts,
 *   but nobody except the single admin could reset an affiliation or a
 *   transport account — backend/src/routes/province.routes.js had no write
 *   endpoint at all. So every forgotten password at that level became the
 *   admin's problem, which is exactly what the owner asked to stop
 *   (2026-09-07).
 *
 * WHAT IT DELIBERATELY CANNOT DO
 *   Only `affiliation` and `transport` accounts are reachable. A province may
 *   not reset an admin (that would be a privilege climb), another province
 *   (side-ways, no supervision relationship), a school (that belongs to the
 *   school's own affiliation, one level down) or a driver (belongs to the
 *   school). The role filter below is the whole of that rule, so it is stated
 *   once, in SQL, rather than assembled from conditionals.
 *
 * WHAT A RESET MUST NOT TOUCH
 *   role, scope_type, scope_id, grade_scope, driver_id, is_active — the
 *   columns listed as SCOPE_PRESERVED_COLUMNS in
 *   backend/src/config/accountRecoveryPolicy.js. A reset that widened a scope
 *   would be a privilege escalation dressed as a convenience. The UPDATE below
 *   writes only the password columns.
 */

const bcrypt = require('bcrypt');
const { pool } = require('../config/database');
const { validatePassword } = require('../utils/passwordPolicy');
const { logAudit } = require('../utils/audit');
const { releaseRecoveryBinding } = require('../utils/recoveryBinding');

const BCRYPT_COST = 12;

/** The only roles a province may administer. */
const MANAGED_ROLES = Object.freeze(['affiliation', 'transport']);

/**
 * Accounts a province may reset, with enough context to identify the holder.
 * No password material of any kind is selected.
 */
async function listManagedAccounts() {
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.role, u.display_name, u.scope_id, u.is_active,
            u.must_change_password, u.last_login,
            a.name AS affiliation_name
       FROM users u
       LEFT JOIN affiliations a
              ON a.id = u.scope_id AND u.role = 'affiliation' AND a.is_deleted = FALSE
      WHERE u.role IN (?) AND u.is_deleted = FALSE
      ORDER BY u.role, u.username`,
    [MANAGED_ROLES]
  );
  return rows;
}

/**
 * Set a new password on one affiliation or transport account.
 *
 * Mirrors affiliationAdmin.resetSchoolPassword: the same password policy, the
 * same forced change at next login, and password_changed_at set so that every
 * access and refresh token issued before the reset stops working immediately
 * rather than lingering for the rest of its lifetime.
 */
async function resetUnitAccountPassword({ accountId, newPassword, userId, ip = null, userAgent = null }) {
  const [[account]] = await pool.query(
    `SELECT id, username, role FROM users
      WHERE id = ? AND role IN (?) AND is_deleted = FALSE`,
    [accountId, MANAGED_ROLES]
  );
  if (!account) {
    const err = new Error('ไม่พบบัญชีนี้ หรือเป็นบัญชีที่จังหวัดไม่มีสิทธิ์รีเซ็ต (รีเซ็ตได้เฉพาะบัญชีสังกัดและขนส่ง)');
    err.statusCode = 404;
    throw err;
  }

  const pwCheck = validatePassword(newPassword, { username: account.username });
  if (!pwCheck.ok) {
    const err = new Error(pwCheck.message);
    err.statusCode = 400;
    throw err;
  }

  const hash = await bcrypt.hash(String(newPassword), BCRYPT_COST);
  // The province resetting an affiliation or transport account is how that
  // account changes hands (owner decision 2026-11-13), so the reset also
  // releases the previous holder's LINE recovery binding, in one transaction.
  const conn = await pool.getConnection();
  let released = 0;
  try {
    await conn.beginTransaction();
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [accountId]);
    await conn.query(
      `UPDATE users
          SET password_hash = ?, must_change_password = TRUE, password_changed_at = NOW()
        WHERE id = ?`,
      [hash, accountId]
    );
    released = await releaseRecoveryBinding(conn, accountId);
    // `username` is the key the other audit writers already use for the
    // account acted on (admin's create path and the school teacher reset both
    // write it), so a search for "what happened to this account" finds this
    // row too. The four reset paths still disagree on the action key itself —
    // admin writes action: 'reset_password', the school path writes
    // action_detail — and that is not resolved here, because changing a value
    // already in production rewrites the meaning of historical rows and is a
    // decision of its own.
    await logAudit({
      userId, action: 'UPDATE', entityType: 'user', entityId: accountId,
      newValue: {
        action: 'password_reset',
        username: account.username,
        by_role: 'province',
        target_role: account.role,
        recovery_channels_released: released,
      },
      ipAddress: ip, userAgent, conn,
    });
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch { /* keep the original error */ }
    throw err;
  } finally {
    conn.release();
  }

  return { id: account.id, username: account.username, role: account.role, recovery_channels_released: released };
}

// ─── Full account management (2026-11-13) ────────────────────────────────────
// Reset alone still left the admin creating, renaming and closing every
// affiliation and transport account. These mirror the affiliation's school
// user page (affiliationUsers.service.js, PR #169): same soft delete that
// releases the recovery LINE binding, restore comes back DEACTIVATED, every
// write audited. The MANAGED_ROLES filter is applied in every query below.

const USERNAME_RE = /^[A-Za-z0-9._@-]{3,100}$/;
const DISPLAY_NAME_MAX = 200;

function httpError(message, statusCode) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

/** Soft-deleted affiliation/transport accounts (restorable). */
async function listDeletedManagedAccounts(db = pool) {
  const [rows] = await db.query(
    `SELECT u.id, u.username, u.role, u.display_name, u.scope_id, u.is_active,
            u.deleted_at, a.name AS affiliation_name
       FROM users u
       LEFT JOIN affiliations a ON a.id = u.scope_id AND u.role = 'affiliation'
      WHERE u.role IN (?) AND u.is_deleted = TRUE
      ORDER BY u.deleted_at DESC, u.username
      LIMIT 500`,
    [MANAGED_ROLES]
  );
  return rows;
}

async function findManaged(conn, accountId, { deleted = false, lock = false } = {}) {
  const [[row]] = await conn.query(
    `SELECT id, username, role, display_name, scope_id, is_active
       FROM users
      WHERE id = ? AND role IN (?) AND is_deleted = ?
      ${lock ? 'FOR UPDATE' : ''}`,
    [accountId, MANAGED_ROLES, deleted]
  );
  return row || null;
}

/**
 * Create an affiliation or transport account. The server generates the
 * temporary password, returns it ONCE (never stored in clear, never audited)
 * and forces a change at first login.
 */
async function createUnitAccount(db, { role, username, displayName, scopeId, actorId, ip = null, userAgent = null }) {
  const { generateTemporaryPassword } = require('./driverProfile.service');
  if (!MANAGED_ROLES.includes(role)) {
    throw httpError('จังหวัดสร้างได้เฉพาะบัญชีสังกัดและบัญชีขนส่ง', 400);
  }
  const uname = String(username || '').trim();
  if (!USERNAME_RE.test(uname)) {
    throw httpError('ชื่อผู้ใช้ต้องเป็นอักษรอังกฤษ ตัวเลข หรือ . _ @ - ยาว 3–100 ตัวอักษร', 400);
  }
  const name = String(displayName || '').trim();
  if (name.length > DISPLAY_NAME_MAX) throw httpError(`ชื่อที่แสดงยาวได้ไม่เกิน ${DISPLAY_NAME_MAX} ตัวอักษร`, 400);

  let scopeType = null;
  let scope = null;
  let affName = null;
  if (role === 'affiliation') {
    if (!scopeId) throw httpError('กรุณาเลือกสังกัดของบัญชีนี้', 400);
    const [[aff]] = await db.query(
      'SELECT id, name FROM affiliations WHERE id = ? AND is_deleted = FALSE', [String(scopeId)]
    );
    if (!aff) throw httpError('ไม่พบสังกัดที่เลือก หรือสังกัดถูกปิดใช้งานแล้ว', 400);
    scopeType = 'AFFILIATION';
    scope = aff.id;
    affName = aff.name;
  }

  // uq_users_username also covers soft-deleted rows.
  const [[existing]] = await db.query('SELECT id, is_deleted FROM users WHERE username = ?', [uname]);
  if (existing) {
    throw httpError(existing.is_deleted
      ? `ชื่อผู้ใช้ ${uname} เคยถูกใช้โดยบัญชีที่ถูกลบไปแล้ว กรุณาใช้ชื่ออื่น หรือกู้คืนบัญชีเดิมที่แท็บ "บัญชีที่ลบแล้ว"`
      : `ชื่อผู้ใช้ ${uname} มีอยู่ในระบบแล้ว กรุณาใช้ชื่ออื่น`, 409);
  }

  const temporaryPassword = generateTemporaryPassword();
  const hash = await bcrypt.hash(temporaryPassword, BCRYPT_COST);
  const [result] = await db.query(
    `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
    [uname, hash, role, scopeType, scope, name || affName || uname]
  );
  await logAudit({
    userId: actorId, action: 'CREATE', entityType: 'user', entityId: result.insertId,
    newValue: { username: uname, role, scope_type: scopeType, scope_id: scope, by_role: 'province' },
    ipAddress: ip, userAgent, conn: db,
  });
  return { id: result.insertId, username: uname, role, scope_id: scope, temporary_password: temporaryPassword };
}

/** Rename and/or activate/deactivate. Role and scope are never editable here. */
async function updateUnitAccount(db, { accountId, displayName, isActive, actorId, ip = null, userAgent = null }) {
  const updates = [];
  const params = [];
  const after = {};
  if (displayName !== undefined) {
    const name = String(displayName ?? '').trim();
    if (!name) throw httpError('กรุณากรอกชื่อที่แสดง', 400);
    if (name.length > DISPLAY_NAME_MAX) throw httpError(`ชื่อที่แสดงยาวได้ไม่เกิน ${DISPLAY_NAME_MAX} ตัวอักษร`, 400);
    updates.push('display_name = ?');
    params.push(name);
    after.display_name = name;
  }
  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') throw httpError('is_active ต้องเป็น true หรือ false', 400);
    updates.push('is_active = ?');
    params.push(isActive);
    after.is_active = isActive;
  }
  if (!updates.length) throw httpError('ไม่มีข้อมูลที่ต้องแก้ไข', 400);

  const account = await findManaged(db, accountId);
  if (!account) throw httpError('ไม่พบบัญชีนี้ หรือไม่ใช่บัญชีสังกัด/ขนส่ง', 404);
  // A closed สังกัด keeps its accounts off (orgEntities.deactivateAffiliation);
  // reopening one would sign someone in to an affiliation that is no longer in
  // the tree. Restore the affiliation first.
  if (isActive === true && account.role === 'affiliation') {
    const [[aff]] = await db.query(
      'SELECT id FROM affiliations WHERE id = ? AND is_deleted = FALSE', [account.scope_id]
    );
    if (!aff) throw httpError('สังกัดของบัญชีนี้ถูกปิดใช้งานแล้ว กรุณากู้คืนสังกัดก่อนเปิดบัญชี', 409);
  }

  // Deactivating also releases the LINE recovery binding (owner decision
  // 2026-11-13), in the same transaction: an office account that is closed
  // and later reopened for a new holder must not still answer to the former
  // holder's LINE.
  const deactivating = isActive === false && Boolean(account.is_active);
  const conn = await db.getConnection();
  let released = 0;
  try {
    await conn.beginTransaction();
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [accountId]);
    await conn.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ? AND role IN (?)`,
      [...params, accountId, MANAGED_ROLES]
    );
    if (deactivating) released = await releaseRecoveryBinding(conn, accountId);
    await logAudit({
      userId: actorId, action: 'UPDATE', entityType: 'user', entityId: accountId,
      oldValue: { display_name: account.display_name, is_active: Boolean(account.is_active) },
      newValue: {
        ...after, username: account.username, target_role: account.role, by_role: 'province',
        ...(deactivating ? { recovery_channels_released: released } : {}),
      },
      ipAddress: ip, userAgent, conn,
    });
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch { /* keep the original error */ }
    throw err;
  } finally {
    conn.release();
  }
  return {
    id: accountId, username: account.username, ...after,
    ...(deactivating ? { recovery_channels_released: released } : {}),
  };
}

/** Soft delete; releases the account-recovery LINE binding like the admin delete. */
async function deleteUnitAccount(db, { accountId, actorId, ip = null, userAgent = null }) {
  if (accountId === actorId) throw httpError('ไม่สามารถลบบัญชีของตัวเองได้', 400);
  const conn = await db.getConnection();
  let account;
  let released = 0;
  try {
    await conn.beginTransaction();
    account = await findManaged(conn, accountId, { lock: true });
    if (!account) throw httpError('ไม่พบบัญชีนี้ หรือไม่ใช่บัญชีสังกัด/ขนส่ง', 404);
    released = await releaseRecoveryBinding(conn, accountId);
    await conn.query('UPDATE users SET is_deleted = TRUE, deleted_at = NOW() WHERE id = ?', [accountId]);
    await logAudit({
      userId: actorId, action: 'DELETE', entityType: 'user', entityId: accountId,
      oldValue: { username: account.username, role: account.role, scope_id: account.scope_id },
      newValue: { recovery_channels_released: released, by_role: 'province' },
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

/** Undo a soft delete; the account comes back DEACTIVATED. */
async function restoreUnitAccount(db, { accountId, actorId, ip = null, userAgent = null }) {
  const conn = await db.getConnection();
  let account;
  try {
    await conn.beginTransaction();
    account = await findManaged(conn, accountId, { deleted: true, lock: true });
    if (!account) throw httpError('ไม่พบบัญชีที่ถูกลบนี้ หรือไม่ใช่บัญชีสังกัด/ขนส่ง', 404);
    if (account.role === 'affiliation') {
      const [[aff]] = await conn.query(
        'SELECT id FROM affiliations WHERE id = ? AND is_deleted = FALSE', [account.scope_id]
      );
      if (!aff) throw httpError('สังกัดของบัญชีนี้ถูกปิดใช้งานแล้ว กู้คืนบัญชีไม่ได้', 409);
    }
    await conn.query(
      'UPDATE users SET is_deleted = FALSE, deleted_at = NULL, is_active = FALSE WHERE id = ?', [accountId]
    );
    await logAudit({
      userId: actorId, action: 'UPDATE', entityType: 'user', entityId: accountId,
      oldValue: { is_deleted: true },
      newValue: { action: 'restore', is_deleted: false, is_active: false, username: account.username, by_role: 'province' },
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
  MANAGED_ROLES,
  listManagedAccounts,
  resetUnitAccountPassword,
  listDeletedManagedAccounts,
  createUnitAccount,
  updateUnitAccount,
  deleteUnitAccount,
  restoreUnitAccount,
};
