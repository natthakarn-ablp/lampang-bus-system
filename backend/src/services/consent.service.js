'use strict';

// Phase QR-1 — append-only PDPA consent ledger. A grant or withdrawal always
// INSERTs a new row (never UPDATE/DELETE); the effective status is the latest
// row per (subject, consent_type). Subjects are either a users.id (driver/staff)
// or a LINE-verified line_user_id (parents have no users.id). Withdrawing a
// REQUIRED driver consent atomically suspends that driver's public display, and
// re-granting ALL required consents lifts that suspension.

const { pool } = require('../config/database');
const { logAudit } = require('../utils/audit');
const { getConsentText, isValidConsentType, REQUIRED_DRIVER_CONSENTS } = require('../config/consentText');

function badReq(msg) { const e = new Error(msg); e.statusCode = 400; return e; }

// Resolve the drivers.id that a driver-USER maps to. Prefers users.driver_id,
// then falls back to the plate → active-assignment path the QR display itself
// uses (qrAccess.getActiveDriver), so a legacy/YELLOW driver whose users.driver_id
// is NULL is still suspended correctly. Returns null when no display driver exists
// (e.g. no active assignment) — in which case there is nothing being shown to
// suspend, so the withdrawal is consistently a no-op for the display.
async function resolveDriverIdForUser(db, userId) {
  if (!userId) return null;
  const [[u]] = await db.query('SELECT driver_id, username, role FROM users WHERE id = ? LIMIT 1', [userId]);
  if (!u) return null;
  if (u.driver_id) return u.driver_id;
  if (u.role !== 'driver' || !u.username) return null;
  const { normalizePlate } = require('../utils/vehiclePlate');
  const norm = normalizePlate(u.username);
  if (!norm) return null;
  const [[row]] = await db.query(
    `SELECT dva.driver_id
       FROM vehicles v
       JOIN driver_vehicle_assignments dva ON dva.vehicle_id = v.id AND dva.is_active = TRUE
      WHERE (v.plate_no = ? OR v.normalized_plate = ?) AND COALESCE(v.is_deleted, 0) = 0
      LIMIT 1`,
    [u.username, norm]
  );
  return row ? row.driver_id : null;
}

// Are ALL required driver consents currently (latest row) granted for this user?
async function allRequiredConsentsGranted(db, userId) {
  for (const t of REQUIRED_DRIVER_CONSENTS) {
    const [[row]] = await db.query(
      'SELECT consent_status FROM consent_records WHERE user_id = ? AND consent_type = ? ORDER BY id DESC LIMIT 1',
      [userId, t]
    );
    if (!row || row.consent_status !== 'granted') return false;
  }
  return true;
}

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

// Grant (opt-in). Audited. Re-granting ALL required driver consents lifts a
// consent-driven display suspension (the inverse of the withdrawal cascade).
async function grantConsent({ userId = null, lineUserId = null, userRole, consentType, ipAddress, userAgent }) {
  const isRequiredDriver = !!userId && REQUIRED_DRIVER_CONSENTS.includes(consentType);
  if (!isRequiredDriver) {
    const id = await recordConsent({ userId, lineUserId, userRole, consentType, status: 'granted', ipAddress, userAgent });
    await logAudit({ userId, action: 'CREATE', entityType: 'consent_record', entityId: String(id),
      newValue: { consent_type: consentType, status: 'granted', line_user_id: lineUserId }, ipAddress, userAgent });
    return { id, consent_type: consentType, status: 'granted' };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = await recordConsent({ userId, userRole, consentType, status: 'granted', ipAddress, userAgent, conn });
    let restoredDriverId = null;
    const driverId = await resolveDriverIdForUser(conn, userId);
    if (driverId && await allRequiredConsentsGranted(conn, userId)) {
      // Only lift a suspension that consent caused — never override an admin/manual
      // suspension (reason != 'consent_withdrawn').
      const [r] = await conn.query(
        `UPDATE driver_display_status
            SET display_status = 'normal', reason = 'consent_restored', changed_by = ?
          WHERE driver_id = ? AND display_status = 'suspended' AND reason = 'consent_withdrawn'`,
        [userId, driverId]
      );
      if (r.affectedRows > 0) restoredDriverId = driverId;
    }
    await logAudit({ userId, action: 'CREATE', entityType: 'consent_record', entityId: String(id), conn,
      newValue: { consent_type: consentType, status: 'granted', restored_driver_id: restoredDriverId }, ipAddress, userAgent });
    await conn.commit();
    return { id, consent_type: consentType, status: 'granted', restored_driver_id: restoredDriverId };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// Withdraw. If a required driver consent is withdrawn, suspend that driver's
// public display in the same transaction. The driver is resolved the SAME way the
// QR display resolves it (users.driver_id, else plate→active-assignment), so the
// suspension can never silently miss a legacy/YELLOW (driver_id NULL) driver.
async function withdrawConsent({ userId = null, lineUserId = null, userRole, consentType, ipAddress, userAgent }) {
  if (!isValidConsentType(consentType)) throw badReq('ประเภทความยินยอมไม่ถูกต้อง');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = await recordConsent({ userId, lineUserId, userRole, consentType, status: 'withdrawn', ipAddress, userAgent, conn });

    let suspendedDriverId = null;
    if (userId && REQUIRED_DRIVER_CONSENTS.includes(consentType)) {
      const driverId = await resolveDriverIdForUser(conn, userId);
      if (driverId) {
        await conn.query(
          `INSERT INTO driver_display_status (driver_id, display_status, reason, changed_by)
             VALUES (?, 'suspended', 'consent_withdrawn', ?)
           ON DUPLICATE KEY UPDATE display_status = 'suspended', reason = 'consent_withdrawn', changed_by = VALUES(changed_by)`,
          [driverId, userId]
        );
        suspendedDriverId = driverId;
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

module.exports = { recordConsent, getMyConsents, grantConsent, withdrawConsent, resolveDriverIdForUser, allRequiredConsentsGranted };
