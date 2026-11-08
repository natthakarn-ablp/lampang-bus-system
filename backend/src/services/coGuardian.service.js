'use strict';

// M2 co-guardians (parent audit 2026-11-08, owner-approved).
//
// The primary parent (the LINE account in line_bindings for a phone) invites
// up to MAX_CO_GUARDIANS more LINE accounts with a one-time code (24 h, hash
// only). A co-guardian sees and is notified about exactly what the primary
// is (every read path goes through lineBindingSource), but cannot invite.
// Removal: the primary removes a co-guardian; a co-guardian leaves; the
// primary unbinding or the school cutting the LINE link removes them all.

const { pool } = require('../config/database');
const claim = require('./parentClaimCode.service'); // same code alphabet/hash

const MAX_CO_GUARDIANS = 2;
const INVITE_HOURS = 24;

function fail(statusCode, message, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

async function primaryPhoneOf(lineUserId, conn = pool) {
  const [[row]] = await conn.query(
    'SELECT phone FROM line_bindings WHERE line_user_id = ? AND is_active = TRUE LIMIT 1',
    [lineUserId]
  );
  return row ? row.phone : null;
}

async function coGuardianRowOf(lineUserId, conn = pool) {
  const [[row]] = await conn.query(
    'SELECT id, phone FROM line_co_guardians WHERE line_user_id = ? AND is_active = TRUE LIMIT 1',
    [lineUserId]
  );
  return row || null;
}

// Role + (for the primary) the co-guardian list. Never returns LINE ids.
async function getGuardianInfo(lineUserId) {
  const phone = await primaryPhoneOf(lineUserId);
  if (phone) {
    const [rows] = await pool.query(
      `SELECT cg.id, cg.bound_at, lu.display_name
         FROM line_co_guardians cg
         LEFT JOIN line_users lu ON lu.line_user_id = cg.line_user_id
        WHERE cg.phone = ? AND cg.is_active = TRUE
        ORDER BY cg.id`,
      [phone]
    );
    const [[pending]] = await pool.query(
      `SELECT COUNT(*) AS n FROM line_guardian_invites
        WHERE phone = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()`,
      [phone]
    );
    return {
      role: 'primary',
      max: MAX_CO_GUARDIANS,
      co_guardians: rows.map(r => ({ id: r.id, display_name: r.display_name || null, bound_at: r.bound_at })),
      pending_invite: Number(pending?.n || 0) > 0,
    };
  }
  const co = await coGuardianRowOf(lineUserId);
  if (co) return { role: 'co', max: MAX_CO_GUARDIANS };
  return { role: 'none', max: MAX_CO_GUARDIANS };
}

// Primary only. One live invite per phone: a new one revokes the previous.
async function createInvite(lineUserId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const phone = await primaryPhoneOf(lineUserId, conn);
    if (!phone) throw fail(403, 'เฉพาะผู้ปกครองหลักที่ผูกบัญชีไว้เท่านั้นที่เชิญผู้ปกครองร่วมได้');
    const [[{ n }]] = await conn.query(
      'SELECT COUNT(*) AS n FROM line_co_guardians WHERE phone = ? AND is_active = TRUE FOR UPDATE',
      [phone]
    );
    if (Number(n) >= MAX_CO_GUARDIANS) {
      throw fail(409, `มีผู้ปกครองร่วมครบ ${MAX_CO_GUARDIANS} ท่านแล้ว กรุณานำออกก่อนเชิญเพิ่ม`, 'CO_GUARDIAN_LIMIT');
    }
    await conn.query(
      `UPDATE line_guardian_invites SET revoked_at = NOW()
        WHERE phone = ? AND used_at IS NULL AND revoked_at IS NULL`,
      [phone]
    );
    let code = null;
    for (let attempt = 0; attempt < 5 && !code; attempt++) {
      const candidate = claim.generateCode();
      try {
        await conn.query(
          `INSERT INTO line_guardian_invites (phone, code_hash, invited_by, expires_at)
           VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ${INVITE_HOURS} HOUR))`,
          [phone, claim.hashCode(candidate), lineUserId]
        );
        code = candidate;
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
      }
    }
    if (!code) throw new Error('could not generate a unique invite code');
    await conn.commit();
    return { code: claim.formatCode(code), valid_hours: INVITE_HOURS };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// The invited LINE account (not bound to anything) redeems the code.
async function acceptInvite(lineUserId, rawCode, displayName = null) {
  const code = claim.normalizeCode(rawCode);
  if (!code) throw fail(400, 'รหัสเชิญไม่ถูกต้อง (8 ตัวอักษร)');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (await primaryPhoneOf(lineUserId, conn) || await coGuardianRowOf(lineUserId, conn)) {
      throw fail(409, 'บัญชี LINE นี้ผูกกับข้อมูลผู้ปกครองอยู่แล้ว กรุณายกเลิกการผูกเดิมก่อน', 'ALREADY_BOUND');
    }
    const [[invite]] = await conn.query(
      `SELECT id, phone, invited_by FROM line_guardian_invites
        WHERE code_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
        FOR UPDATE`,
      [claim.hashCode(code)]
    );
    if (!invite) throw fail(404, 'ไม่พบรหัสเชิญ หรือรหัสหมดอายุ/ถูกใช้ไปแล้ว', 'INVITE_NOT_FOUND');
    if (invite.invited_by === lineUserId) throw fail(409, 'ใช้รหัสเชิญของตัวเองไม่ได้');
    // The primary must still hold the phone, and the phone must still have a parent.
    const [[primary]] = await conn.query(
      'SELECT line_user_id FROM line_bindings WHERE phone = ? AND is_active = TRUE AND line_user_id = ? LIMIT 1',
      [invite.phone, invite.invited_by]
    );
    const [[parent]] = await conn.query(
      'SELECT id FROM parents WHERE phone = ? AND is_deleted = FALSE ORDER BY id LIMIT 1',
      [invite.phone]
    );
    if (!primary || !parent) throw fail(404, 'ไม่พบรหัสเชิญ หรือรหัสหมดอายุ/ถูกใช้ไปแล้ว', 'INVITE_NOT_FOUND');
    const [[{ n }]] = await conn.query(
      'SELECT COUNT(*) AS n FROM line_co_guardians WHERE phone = ? AND is_active = TRUE FOR UPDATE',
      [invite.phone]
    );
    if (Number(n) >= MAX_CO_GUARDIANS) throw fail(409, `มีผู้ปกครองร่วมครบ ${MAX_CO_GUARDIANS} ท่านแล้ว`, 'CO_GUARDIAN_LIMIT');

    // A previous, removed co-guardian row for this LINE account is reused.
    await conn.query(
      `INSERT INTO line_co_guardians (line_user_id, phone, invited_by, is_active, bound_at)
       VALUES (?, ?, ?, TRUE, NOW())
       ON DUPLICATE KEY UPDATE phone = VALUES(phone), invited_by = VALUES(invited_by),
                               is_active = TRUE, bound_at = NOW()`,
      [lineUserId, invite.phone, invite.invited_by]
    );
    // line_users mirror: the notification resolver filters on a verified parent
    // row here, and notifications.target_line_user_id references it.
    await conn.query(
      `INSERT INTO line_users (line_user_id, user_type, parent_id, display_name, verified, linked_at, created_at)
       VALUES (?, 'parent', ?, ?, TRUE, NOW(), NOW())
       ON DUPLICATE KEY UPDATE user_type = 'parent', parent_id = VALUES(parent_id),
                               verified = TRUE, linked_at = NOW()`,
      [lineUserId, parent.id, displayName]
    );
    await conn.query(
      'UPDATE line_guardian_invites SET used_at = NOW(), used_by = ? WHERE id = ?',
      [lineUserId, invite.id]
    );
    await conn.commit();
    return { ok: true, invited_by: invite.invited_by };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Deactivate co-guardian rows (by id under a phone, or every row of a phone,
// or one LINE account) and drop their line_users verification. Returns the
// LINE ids removed so the caller can tell them.
async function deactivate(conn, whereSql, params) {
  const [rows] = await conn.query(
    `SELECT id, line_user_id FROM line_co_guardians WHERE is_active = TRUE AND ${whereSql} FOR UPDATE`,
    params
  );
  for (const r of rows) {
    await conn.query('UPDATE line_co_guardians SET is_active = FALSE WHERE id = ?', [r.id]);
    await conn.query(
      'UPDATE line_users SET parent_id = NULL, verified = FALSE, linked_at = NULL WHERE line_user_id = ?',
      [r.line_user_id]
    );
  }
  return rows.map(r => r.line_user_id);
}

async function withConn(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Primary removes one of their co-guardians (by the id from getGuardianInfo).
async function removeByPrimary(primaryLineUserId, coId) {
  return withConn(async (conn) => {
    const phone = await primaryPhoneOf(primaryLineUserId, conn);
    if (!phone) throw fail(403, 'เฉพาะผู้ปกครองหลักเท่านั้นที่นำผู้ปกครองร่วมออกได้');
    const removed = await deactivate(conn, 'id = ? AND phone = ?', [coId, phone]);
    if (!removed.length) throw fail(404, 'ไม่พบผู้ปกครองร่วม');
    return removed;
  });
}

// A co-guardian leaves (LIFF button or chat "ยกเลิกผูกบัญชี").
async function leave(lineUserId) {
  return withConn(conn => deactivate(conn, 'line_user_id = ?', [lineUserId]));
}

// Everyone on a phone, plus pending invites (primary unbound / school cut).
async function removeAllForPhone(phone) {
  return withConn(async (conn) => {
    await conn.query(
      'UPDATE line_guardian_invites SET revoked_at = NOW() WHERE phone = ? AND used_at IS NULL AND revoked_at IS NULL',
      [phone]
    );
    return deactivate(conn, 'phone = ?', [phone]);
  });
}

module.exports = {
  getGuardianInfo, createInvite, acceptInvite, removeByPrimary, leave, removeAllForPhone,
  MAX_CO_GUARDIANS, INVITE_HOURS,
};
