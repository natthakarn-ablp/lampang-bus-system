'use strict';

// Phase QR-1 — append-only PDPA consent ledger. A grant or withdrawal always
// INSERTs a new row (never UPDATE/DELETE); the effective status is the latest
// row per (subject, consent_type). Subjects are either a users.id (driver/staff)
// or a LINE-verified line_user_id (parents have no users.id). Withdrawing a
// REQUIRED driver consent atomically suspends that driver's public display.

const { pool } = require('../config/database');
const { logAudit } = require('../utils/audit');
const { getConsentText, isValidConsentType, REQUIRED_DRIVER_CONSENTS } = require('../config/consentText');

function badReq(msg) { const e = new Error(msg); e.statusCode = 400; return e; }

// Insert a ledger row. subject = { userId?, lineUserId?, userRole? }. Optional conn.
async function recordConsent({ userId = null, lineUserId = null, userRole = null, consentType, status = 'granted', ipAddress = null, userAgent = null, conn = null }) {
  if (!isValidConsentType(consentType)) throw badReq('ประเภทความยินยอมไม่ถูกต้อง');
  const text = getConsentText(consentType);
  const db = conn || pool;
  const grantedAt = status === 'granted' ? new Date() : null;
  const withdrawnAt = status === 'withdrawn' ? new Date() : null;
  const [r] = await db.query(
    `INSERT INTO consent_records
       (user_id, line_user_id, user_role, consent_type, consent_version, consent_status, consent_text_snapshot, granted_at, withdrawn_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, lineUserId, userRole, consentType, text.version, status, text.body, grantedAt, withdrawnAt, ipAddress, String(userAgent || '').slice(0, 255)]
  );
  return r.insertId;
}

// Current effective status across a subject's consent types (by users.id OR line_user_id).
async function getMyConsents({ userId = null, lineUserId = null }) {
  const col = userId ? 'user_id' : 'line_user_id';
  const val = userId || lineUserId;
  if (!val) return [];
  const [rows] = await pool.query(
    `SELECT cr.consent_type, cr.consent_status, cr.consent_version, cr.created_at
       FROM consent_records cr
       JOIN (SELECT consent_type, MAX(id) AS max_id FROM consent_records WHERE ${col} = ? GROUP BY consent_type) latest
         ON latest.consent_type = cr.consent_type AND latest.max_id = cr.id`,
    [val]
  );
  return rows.map((r) => ({ type: r.consent_type, status: r.consent_status, version: r.consent_version, at: r.created_at }));
}

// Grant (opt-in). Audited.
async function grantConsent({ userId = null, lineUserId = null, userRole, consentType, ipAddress, userAgent }) {
  const id = await recordConsent({ userId, lineUserId, userRole, consentType, status: 'granted', ipAddress, userAgent });
  await logAudit({ userId, action: 'CREATE', entityType: 'consent_record', entityId: String(id),
    newValue: { consent_type: consentType, status: 'granted', line_user_id: lineUserId }, ipAddress, userAgent });
  return { id, consent_type: consentType, status: 'granted' };
}

// Withdraw. If a required driver consent is withdrawn, suspend that driver's
// public display in the same transaction. Audited.
async function withdrawConsent({ userId = null, lineUserId = null, userRole, consentType, ipAddress, userAgent }) {
  if (!isValidConsentType(consentType)) throw badReq('ประเภทความยินยอมไม่ถูกต้อง');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = await recordConsent({ userId, lineUserId, userRole, consentType, status: 'withdrawn', ipAddress, userAgent, conn });

    let suspendedDriverId = null;
    if (userId && REQUIRED_DRIVER_CONSENTS.includes(consentType)) {
      const [[u]] = await conn.query('SELECT driver_id FROM users WHERE id = ? LIMIT 1', [userId]);
      if (u && u.driver_id) {
        await conn.query(
          `INSERT INTO driver_display_status (driver_id, display_status, reason, changed_by)
             VALUES (?, 'suspended', 'consent_withdrawn', ?)
           ON DUPLICATE KEY UPDATE display_status = 'suspended', reason = 'consent_withdrawn', changed_by = VALUES(changed_by)`,
          [u.driver_id, userId]
        );
        suspendedDriverId = u.driver_id;
      }
    }
    await logAudit({ userId, action: 'UPDATE', entityType: 'consent_record', entityId: String(id), conn,
      newValue: { consent_type: consentType, status: 'withdrawn', suspended_driver_id: suspendedDriverId, line_user_id: lineUserId }, ipAddress, userAgent });
    await conn.commit();
    return { id, consent_type: consentType, status: 'withdrawn', suspended_driver_id: suspendedDriverId };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { recordConsent, getMyConsents, grantConsent, withdrawConsent };
