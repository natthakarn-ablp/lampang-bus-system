'use strict';

// emergencyAdmin.service.js — admin emergency-alert triage.
// emergency_logs has only result/note/is_deleted (no status/closed column), so
// "resolve/close" writes a structured result + note; "delete" is a soft-delete
// that all read paths already filter (is_deleted=FALSE). All mutations audited.
// (Named distinctly from operationsAlert.service.js, which sanitizes/sends the
// outbound operational alert webhook.)

const { logAudit } = require('../utils/audit');

const err = (msg, code) => { const e = new Error(msg); e.statusCode = code; return e; };

// Resolve/acknowledge/close an alert by writing result + note (existing columns).
async function resolveEmergency(pool, { id, result = null, note = null, actorId, ip = null, userAgent = null }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[em]] = await conn.query(
      'SELECT id, result, note, is_deleted FROM emergency_logs WHERE id = ? FOR UPDATE',
      [id]
    );
    if (!em) throw err('ไม่พบเหตุฉุกเฉิน', 404);
    if (em.is_deleted) throw err('เหตุฉุกเฉินนี้ถูกลบไปแล้ว', 409);

    // Partial update: only overwrite the fields the caller sent.
    const newResult = result !== null ? result : em.result;
    const newNote   = note   !== null ? note   : em.note;
    await conn.query(
      'UPDATE emergency_logs SET result = ?, note = ? WHERE id = ?',
      [newResult, newNote, id]
    );

    await logAudit({
      userId: actorId, action: 'UPDATE', entityType: 'emergency', entityId: id, conn,
      oldValue: { result: em.result, note: em.note },
      newValue: { result: newResult, note: newNote },
      ipAddress: ip, userAgent,
    });

    await conn.commit();
    return { status: 'UPDATED', id, result: newResult };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// Soft-delete a test / misfiled alert. Reversible (is_deleted flag).
async function softDeleteEmergency(pool, { id, reason = null, actorId, ip = null, userAgent = null }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[em]] = await conn.query(
      'SELECT id, plate_no, detail, result, is_deleted FROM emergency_logs WHERE id = ? FOR UPDATE',
      [id]
    );
    if (!em) throw err('ไม่พบเหตุฉุกเฉิน', 404);
    if (em.is_deleted) { await conn.commit(); return { status: 'ALREADY_DELETED', id }; }

    await conn.query(
      'UPDATE emergency_logs SET is_deleted = TRUE, deleted_at = NOW() WHERE id = ?',
      [id]
    );

    await logAudit({
      userId: actorId, action: 'DELETE', entityType: 'emergency', entityId: id, conn,
      oldValue: { plate_no: em.plate_no, detail: em.detail, result: em.result, is_deleted: false },
      newValue: { is_deleted: true, reason: reason ? String(reason).slice(0, 200) : null },
      ipAddress: ip, userAgent,
    });

    await conn.commit();
    return { status: 'DELETED', id };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { resolveEmergency, softDeleteEmergency };
