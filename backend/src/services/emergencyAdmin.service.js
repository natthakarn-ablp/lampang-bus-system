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

// ─── Scoped close (owner decision 2026-11-13) ────────────────────────────────
// Who may close an emergency: the school(s) whose pupils ride the vehicle, the
// affiliation of those schools, province (any), the driver of that vehicle
// ("แก้ไขแล้ว"), and admin. emergency_logs has no status column and no
// migration is allowed, so a close is stored as:
//   - result = RESOLVED | FALSE_ALARM (the driver may only send RESOLVED)
//   - one line appended to `note` (the driver's original note is kept):
//       "[ปิดเหตุ <date time> · <role> · <name>] <note>"
//   - an audit_logs row with actor id, role, scope, note and old/new values
// so the full history (who, role, when, note) survives.
const CLOSED_RESULTS = ['RESOLVED', 'FALSE_ALARM', 'CLOSED'];
const CLOSE_RESULTS_BY_ROLE = {
  driver: ['RESOLVED'],
  school: ['RESOLVED', 'FALSE_ALARM'],
  affiliation: ['RESOLVED', 'FALSE_ALARM'],
  province: ['RESOLVED', 'FALSE_ALARM'],
  admin: ['RESOLVED', 'FALSE_ALARM', 'CLOSED'],
};
const ROLE_LABEL_TH = {
  driver: 'คนขับ', school: 'โรงเรียน', affiliation: 'สังกัด', province: 'จังหวัด', admin: 'ผู้ดูแลระบบ',
};
const NOTE_MAX = 500;

function isClosedResult(result) {
  return CLOSED_RESULTS.includes(String(result || '').toUpperCase());
}

// Scope predicate for one emergency row (already locked by the caller).
async function emergencyInScope(conn, em, scope) {
  if (scope.all === true) return true;
  if (scope.driverUserId) {
    if (Number(em.reported_by) === Number(scope.driverUserId)) return true;
    return !!(scope.vehicleId && em.vehicle_id && em.vehicle_id === scope.vehicleId);
  }
  if (!em.vehicle_id) return false;
  if (scope.schoolId) {
    const [[row]] = await conn.query(
      'SELECT 1 AS ok FROM students WHERE vehicle_id = ? AND school_id = ? AND is_deleted = FALSE LIMIT 1',
      [em.vehicle_id, scope.schoolId]
    );
    return !!row;
  }
  if (scope.affiliationId) {
    const [[row]] = await conn.query(
      `SELECT 1 AS ok FROM students s JOIN schools sc ON sc.id = s.school_id
        WHERE s.vehicle_id = ? AND sc.affiliation_id = ? AND s.is_deleted = FALSE LIMIT 1`,
      [em.vehicle_id, scope.affiliationId]
    );
    return !!row;
  }
  return false; // fail closed on an empty scope
}

function bangkokStamp(d = new Date()) {
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function scopeForAudit(scope) {
  if (!scope) return null;
  if (scope.schoolId) return { school_id: scope.schoolId };
  if (scope.affiliationId) return { affiliation_id: scope.affiliationId };
  if (scope.driverUserId) return { driver_user_id: scope.driverUserId, vehicle_id: scope.vehicleId || null };
  return scope.all === true ? 'all' : null;
}

/**
 * Close an emergency from a scoped role. `actor` = { id, role, name, ip, userAgent };
 * `scope` = { all } | { schoolId } | { affiliationId } | { driverUserId, vehicleId }.
 * Out-of-scope answers 404 so ids of other schools' emergencies cannot be probed.
 */
async function closeEmergencyScoped(pool, { id, result = 'RESOLVED', note, actor, scope }) {
  const role = actor && actor.role;
  const allowed = CLOSE_RESULTS_BY_ROLE[role];
  if (!allowed) throw err('ไม่มีสิทธิ์ปิดเหตุฉุกเฉิน', 403);
  const res = String(result || 'RESOLVED').toUpperCase();
  if (!allowed.includes(res)) {
    const e = err(`ผลการปิดเหตุต้องเป็นค่าใดค่าหนึ่งใน: ${allowed.join(', ')}`, 400);
    e.errors = [{ field: 'result', message: 'ค่าไม่ถูกต้อง' }];
    throw e;
  }
  const cleanNote = String(note == null ? '' : note).trim();
  if (!cleanNote) {
    const e = err('กรุณาระบุบันทึกการแก้ไขเหตุ', 400);
    e.errors = [{ field: 'note', message: 'จำเป็นต้องระบุ' }];
    throw e;
  }
  if (cleanNote.length > NOTE_MAX) throw err(`บันทึกยาวได้ไม่เกิน ${NOTE_MAX} ตัวอักษร`, 400);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[em]] = await conn.query(
      'SELECT id, vehicle_id, plate_no, reported_by, result, note, is_deleted FROM emergency_logs WHERE id = ? FOR UPDATE',
      [id]
    );
    if (!em || em.is_deleted || !(await emergencyInScope(conn, em, scope || {}))) {
      throw err('ไม่พบเหตุฉุกเฉินนี้ในขอบเขตของท่าน', 404);
    }
    if (isClosedResult(em.result)) {
      const e = err('เหตุฉุกเฉินนี้ถูกปิดไปแล้ว', 409);
      e.errors = [{ code: 'EMERGENCY_ALREADY_CLOSED', result: em.result }];
      throw e;
    }

    const closedAt = new Date();
    const who = [ROLE_LABEL_TH[role] || role, actor.name].filter(Boolean).join(' · ');
    const line = `[ปิดเหตุ ${bangkokStamp(closedAt)} · ${who}] ${cleanNote}`;
    const newNote = em.note ? `${em.note}\n${line}` : line;
    await conn.query('UPDATE emergency_logs SET result = ?, note = ? WHERE id = ?', [res, newNote, id]);

    await logAudit({
      userId: actor.id, action: 'UPDATE', entityType: 'emergency', entityId: id, conn, required: true,
      oldValue: { result: em.result, note: em.note },
      newValue: {
        action: 'close_emergency', result: res, close_note: cleanNote,
        closed_by_role: role, closed_by_name: actor.name || null, closed_at: closedAt.toISOString(),
        vehicle_id: em.vehicle_id, scope: scopeForAudit(scope),
      },
      ipAddress: actor.ip || null, userAgent: actor.userAgent || null,
    });

    await conn.commit();
    return { status: 'CLOSED', id, result: res, note: newNote, closed_by_role: role, closed_at: closedAt.toISOString() };
  } catch (e) {
    try { await conn.rollback(); } catch { /* keep the original error */ }
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = {
  resolveEmergency, softDeleteEmergency, closeEmergencyScoped, isClosedResult, CLOSE_RESULTS_BY_ROLE,
};
