'use strict';

/**
 * vehicleRegistration.service.js — Phase 10.14
 *
 * Driver-initiated vehicle registration roster, layered on the existing
 * shared-verification tables (migration 038):
 *   - vehicle_inspection_applications  (one active application per vehicle/term)
 *   - inspection_application_schools   (per-school link + NEW approval columns)
 *   - registration_roster_students     (NEW: driver-typed roster → reconcile)
 *
 * The driver reports who rides + which school; each school reconciles the raw
 * entries to real student ids and approves its own slice. A vehicle is eligible
 * when every school approved AND the shared inspection passed
 * (vehicles.verification_status), reusing the existing eligibility signal — no
 * parallel eligibility store.
 *
 * Gated at the router layer behind FEATURE_DRIVER_REGISTRATION (dark by default).
 */

const crypto = require('crypto');
const env = require('../config/env');
const { logAudit } = require('../utils/audit');
const { suggestMatch, evaluateEligibility, normalizePickup } = require('../utils/registrationMatch');

function appError(message, statusCode = 400, code = null, extra = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.errors = [{ code, ...(extra || {}) }];
  return error;
}

function makeRequestNo(now = new Date()) {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `VIA-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

const ACTIVE_SQL = "status NOT IN ('CANCELLED','SUPERSEDED','EXPIRED')";

/**
 * Find the active application for a vehicle/term, or create a minimal DRAFT one.
 * Reuses the same active_request_key as the verification flow, so a vehicle has
 * exactly one active application shared by both flows.
 */
async function ensureApplicationForVehicle(conn, { vehicleId, issuingSchoolId, userId, currentTerm }) {
  const activeKey = `${vehicleId}|${currentTerm}`;
  const [[existing]] = await conn.query(
    'SELECT id FROM vehicle_inspection_applications WHERE active_request_key = ? LIMIT 1 FOR UPDATE',
    [activeKey]
  );
  if (existing) return existing.id;

  const [[vehicle]] = await conn.query(
    'SELECT id, plate_no, vehicle_type FROM vehicles WHERE id = ? AND is_deleted = FALSE FOR UPDATE',
    [vehicleId]
  );
  if (!vehicle) throw appError('ไม่พบรถของคนขับ', 404, 'VEHICLE_NOT_FOUND');

  const requestNo = makeRequestNo();
  const qrToken = crypto.randomBytes(16).toString('hex');
  const [ins] = await conn.query(
    `INSERT INTO vehicle_inspection_applications
       (request_no, vehicle_id, issuing_school_id, requested_by, current_term,
        status, version_no, provider_type, qr_token, active_request_key,
        vehicle_snapshot_json, rider_summary_json)
     VALUES (?, ?, ?, ?, ?, 'DRAFT', 1, 'DLT_OFFICER', ?, ?, ?, ?)`,
    [
      requestNo, vehicleId, issuingSchoolId, userId, currentTerm, qrToken, activeKey,
      JSON.stringify({ id: vehicle.id, plate_no: vehicle.plate_no, vehicle_type: vehicle.vehicle_type }),
      JSON.stringify({ schools: [], source: 'driver_registration' }),
    ]
  );
  return ins.insertId;
}

/**
 * Recompute the per-school rider counts for a registration from its roster and
 * upsert the inspection_application_schools row. Never resets an existing
 * approval_status (an already-approved school stays approved).
 */
async function upsertSchoolCounts(conn, applicationId, schoolId, driverUserId) {
  const [[c]] = await conn.query(
    `SELECT
        SUM(CASE WHEN pickup_type IN ('MORNING','BOTH') THEN 1 ELSE 0 END) AS morning,
        SUM(CASE WHEN pickup_type IN ('EVENING','BOTH') THEN 1 ELSE 0 END) AS evening
       FROM registration_roster_students
      WHERE application_id = ? AND school_id = ?`,
    [applicationId, schoolId]
  );
  const morning = Number(c && c.morning) || 0;
  const evening = Number(c && c.evening) || 0;
  const peak = Math.max(morning, evening);
  await conn.query(
    `INSERT INTO inspection_application_schools
       (application_id, school_id, morning_rider_count, evening_rider_count,
        peak_rider_count, submitted_by_driver, approval_status)
     VALUES (?, ?, ?, ?, ?, ?, 'PENDING_SCHOOL_REVIEW')
     ON DUPLICATE KEY UPDATE
       morning_rider_count = VALUES(morning_rider_count),
       evening_rider_count = VALUES(evening_rider_count),
       peak_rider_count    = VALUES(peak_rider_count),
       submitted_by_driver = COALESCE(inspection_application_schools.submitted_by_driver, VALUES(submitted_by_driver))`,
    [applicationId, schoolId, morning, evening, peak, driverUserId]
  );
}

// ─── Driver actions ──────────────────────────────────────────────────────────

async function addRosterStudent(pool, {
  vehicleId, driverUserId, raw_student_name, raw_grade, raw_student_code,
  school_id, pickup_type, currentTerm = env.app.currentTerm,
}) {
  if (!vehicleId) throw appError('ไม่พบรถที่ผูกกับบัญชีคนขับ', 400, 'VEHICLE_REQUIRED');
  if (!raw_student_name || !String(raw_student_name).trim()) {
    throw appError('กรุณาระบุชื่อนักเรียน', 400, 'NAME_REQUIRED');
  }
  if (!school_id) throw appError('กรุณาเลือกโรงเรียน', 400, 'SCHOOL_REQUIRED');
  const pickup = normalizePickup(pickup_type);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[school]] = await conn.query(
      'SELECT id FROM schools WHERE id = ? AND is_deleted = FALSE',
      [school_id]
    );
    if (!school) throw appError('ไม่พบโรงเรียนที่เลือก', 404, 'SCHOOL_NOT_FOUND');

    const applicationId = await ensureApplicationForVehicle(conn, {
      vehicleId, issuingSchoolId: school_id, userId: driverUserId, currentTerm,
    });

    const [ins] = await conn.query(
      `INSERT INTO registration_roster_students
         (application_id, school_id, raw_student_name, raw_grade, raw_student_code, pickup_type, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        applicationId, school_id, String(raw_student_name).trim().slice(0, 200),
        raw_grade ? String(raw_grade).trim().slice(0, 20) : null,
        raw_student_code ? String(raw_student_code).trim().slice(0, 50) : null,
        pickup, driverUserId,
      ]
    );

    await upsertSchoolCounts(conn, applicationId, school_id, driverUserId);

    // If this school had already APPROVED, a newly-added (UNMATCHED) student
    // reopens its review — otherwise the vehicle could stay eligible with an
    // unreviewed rider. No-op when the row is still pending. (WHERE guards it.)
    await conn.query(
      `UPDATE inspection_application_schools
          SET approval_status = 'PENDING_SCHOOL_REVIEW', reviewed_by = NULL, reviewed_at = NULL
        WHERE application_id = ? AND school_id = ? AND approval_status = 'APPROVED'`,
      [applicationId, school_id]
    );

    await logAudit({
      userId: driverUserId,
      action: 'CREATE',
      entityType: 'registration_roster_student',
      entityId: String(ins.insertId),
      newValue: { application_id: applicationId, school_id, raw_student_name: '[redacted]', pickup_type: pickup },
      conn,
    });

    await conn.commit();
    return { id: ins.insertId, application_id: applicationId, school_id, match_status: 'UNMATCHED' };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function listDriverRegistrations(pool, { vehicleId }) {
  if (!vehicleId) return { vehicle_id: null, eligible: false, schools: [] };
  const [rows] = await pool.query(
    `SELECT a.id AS application_id, a.request_no, a.status AS application_status,
            aps.school_id, sc.name AS school_name, aps.approval_status, aps.school_note,
            aps.morning_rider_count, aps.evening_rider_count, aps.peak_rider_count,
            (SELECT COUNT(*) FROM registration_roster_students r
              WHERE r.application_id = a.id AND r.school_id = aps.school_id) AS roster_count
       FROM vehicle_inspection_applications a
       JOIN inspection_application_schools aps ON aps.application_id = a.id
       JOIN schools sc ON sc.id = aps.school_id
      WHERE a.vehicle_id = ? AND a.${ACTIVE_SQL}
      ORDER BY sc.name`,
    [vehicleId]
  );
  const [students] = await pool.query(
    `SELECT r.id, r.school_id, sc.name AS school_name, r.raw_student_name, r.raw_grade,
            r.raw_student_code, r.pickup_type, r.match_status, aps.approval_status
       FROM registration_roster_students r
       JOIN vehicle_inspection_applications a ON a.id = r.application_id
       JOIN schools sc ON sc.id = r.school_id
       LEFT JOIN inspection_application_schools aps
         ON aps.application_id = r.application_id AND aps.school_id = r.school_id
      WHERE a.vehicle_id = ? AND a.${ACTIVE_SQL}
      ORDER BY sc.name, r.id`,
    [vehicleId]
  );
  const eligible = await isVehicleEligible(pool, vehicleId);
  return { vehicle_id: vehicleId, eligible, schools: rows, students };
}

async function deleteRosterStudent(pool, { rosterId, driverUserId, vehicleId }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(
      `SELECT r.id, r.application_id, r.school_id, a.vehicle_id
         FROM registration_roster_students r
         JOIN vehicle_inspection_applications a ON a.id = r.application_id
        WHERE r.id = ?
        FOR UPDATE`,
      [rosterId]
    );
    if (!row) throw appError('ไม่พบรายการ', 404, 'ROSTER_NOT_FOUND');
    if (String(row.vehicle_id) !== String(vehicleId)) {
      throw appError('ไม่ใช่รถของคุณ', 403, 'NOT_YOUR_VEHICLE');
    }
    const [[aps]] = await conn.query(
      'SELECT approval_status FROM inspection_application_schools WHERE application_id = ? AND school_id = ?',
      [row.application_id, row.school_id]
    );
    if (aps && aps.approval_status === 'APPROVED') {
      throw appError('โรงเรียนอนุมัติแล้ว ลบรายการไม่ได้', 409, 'ALREADY_APPROVED');
    }
    await conn.query('DELETE FROM registration_roster_students WHERE id = ?', [rosterId]);
    await upsertSchoolCounts(conn, row.application_id, row.school_id, driverUserId);
    await logAudit({
      userId: driverUserId, action: 'DELETE', entityType: 'registration_roster_student',
      entityId: String(rosterId), conn,
    });
    await conn.commit();
    return { id: Number(rosterId), deleted: true };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// ─── School actions ──────────────────────────────────────────────────────────

async function listSchoolRegistrations(pool, { schoolId, status = null }) {
  if (!schoolId) throw appError('ไม่พบขอบเขตโรงเรียน', 403, 'SCHOOL_SCOPE_REQUIRED');
  const params = [schoolId];
  let statusSql = '';
  if (status) { statusSql = ' AND aps.approval_status = ?'; params.push(status); }
  const [rows] = await pool.query(
    `SELECT a.id AS application_id, a.request_no, v.plate_no, v.vehicle_type,
            aps.approval_status, aps.morning_rider_count, aps.evening_rider_count, aps.peak_rider_count,
            (SELECT COUNT(*) FROM registration_roster_students r
              WHERE r.application_id = a.id AND r.school_id = aps.school_id) AS roster_count,
            (SELECT COUNT(*) FROM registration_roster_students r
              WHERE r.application_id = a.id AND r.school_id = aps.school_id AND r.match_status = 'UNMATCHED') AS unmatched_count
       FROM inspection_application_schools aps
       JOIN vehicle_inspection_applications a ON a.id = aps.application_id
       JOIN vehicles v ON v.id = a.vehicle_id
      WHERE aps.school_id = ? AND a.${ACTIVE_SQL}${statusSql}
      ORDER BY a.created_at DESC`,
    params
  );
  return rows;
}

async function getSchoolRegistrationDetail(pool, { applicationId, schoolId }) {
  if (!schoolId) throw appError('ไม่พบขอบเขตโรงเรียน', 403, 'SCHOOL_SCOPE_REQUIRED');
  const [[aps]] = await pool.query(
    'SELECT approval_status, school_note FROM inspection_application_schools WHERE application_id = ? AND school_id = ?',
    [applicationId, schoolId]
  );
  if (!aps) throw appError('ไม่ใช่คำขอของโรงเรียนนี้', 403, 'NOT_THIS_SCHOOL');

  // Vehicle + its active driver — the keys the school document-review endpoints
  // (`/documents/vehicle/:vehicleId`, `/documents/driver/:driverId`) are addressed
  // by. Surfaced here so the review UI can load the attached evidence directly.
  const [[appRow]] = await pool.query(
    `SELECT a.vehicle_id, v.plate_no,
            (SELECT dva.driver_id FROM driver_vehicle_assignments dva
              WHERE dva.vehicle_id = a.vehicle_id AND dva.is_active = TRUE LIMIT 1) AS driver_id
       FROM vehicle_inspection_applications a
       JOIN vehicles v ON v.id = a.vehicle_id
      WHERE a.id = ?`,
    [applicationId]
  );

  const [roster] = await pool.query(
    `SELECT id, raw_student_name, raw_grade, raw_student_code,
            matched_student_id, match_status, pickup_type
       FROM registration_roster_students
      WHERE application_id = ? AND school_id = ?
      ORDER BY id`,
    [applicationId, schoolId]
  );
  const [students] = await pool.query(
    `SELECT id, student_code, TRIM(CONCAT_WS(' ', prefix, first_name, last_name)) AS full_name, grade
       FROM students
      WHERE school_id = ? AND is_deleted = FALSE`,
    [schoolId]
  );

  const withSuggestions = roster.map((r) => ({
    ...r,
    suggestion: r.match_status === 'UNMATCHED'
      ? suggestMatch({ raw_student_code: r.raw_student_code, raw_student_name: r.raw_student_name }, students)
      : null,
  }));

  return {
    application_id: Number(applicationId),
    school_id: schoolId,
    approval_status: aps.approval_status,
    school_note: aps.school_note,
    vehicle_id: appRow ? appRow.vehicle_id : null,
    plate_no: appRow ? appRow.plate_no : null,
    driver_id: appRow ? appRow.driver_id : null,
    roster: withSuggestions,
  };
}

async function matchRosterStudent(pool, { applicationId, schoolId, rosterId, matchedStudentId, userId }) {
  if (!matchedStudentId) throw appError('กรุณาระบุนักเรียนที่ต้องการจับคู่', 400, 'MATCH_TARGET_REQUIRED');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[r]] = await conn.query(
      'SELECT id, application_id, school_id FROM registration_roster_students WHERE id = ? FOR UPDATE',
      [rosterId]
    );
    if (!r || String(r.application_id) !== String(applicationId) || String(r.school_id) !== String(schoolId)) {
      throw appError('ไม่พบรายการในคำขอนี้', 404, 'ROSTER_NOT_FOUND');
    }
    const [[stu]] = await conn.query(
      'SELECT id FROM students WHERE id = ? AND school_id = ? AND is_deleted = FALSE',
      [matchedStudentId, schoolId]
    );
    if (!stu) throw appError('นักเรียนไม่อยู่ในโรงเรียนนี้', 400, 'STUDENT_NOT_IN_SCHOOL');

    await conn.query(
      "UPDATE registration_roster_students SET matched_student_id = ?, match_status = 'MATCHED' WHERE id = ?",
      [matchedStudentId, rosterId]
    );
    await logAudit({
      userId, action: 'UPDATE', entityType: 'registration_roster_student', entityId: String(rosterId),
      newValue: { match_status: 'MATCHED', matched_student_id: Number(matchedStudentId) }, conn,
    });
    await conn.commit();
    return { id: Number(rosterId), match_status: 'MATCHED', matched_student_id: Number(matchedStudentId) };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function patchRosterStudent(pool, { applicationId, schoolId, rosterId, fields = {}, userId }) {
  const allowed = {};
  if (fields.raw_student_name != null) allowed.raw_student_name = String(fields.raw_student_name).trim().slice(0, 200);
  if (fields.raw_grade != null) allowed.raw_grade = String(fields.raw_grade).trim().slice(0, 20) || null;
  if (fields.raw_student_code != null) allowed.raw_student_code = String(fields.raw_student_code).trim().slice(0, 50) || null;
  if (fields.match_status != null) {
    if (!['UNMATCHED', 'MATCHED', 'NOT_FOUND'].includes(fields.match_status)) {
      throw appError('สถานะการจับคู่ไม่ถูกต้อง', 400, 'INVALID_MATCH_STATUS');
    }
    allowed.match_status = fields.match_status;
    if (fields.match_status !== 'MATCHED') allowed.matched_student_id = null;
  }
  if (!Object.keys(allowed).length) throw appError('ไม่มีข้อมูลที่จะแก้ไข', 400, 'NOTHING_TO_UPDATE');

  const [[r]] = await pool.query(
    'SELECT id FROM registration_roster_students WHERE id = ? AND application_id = ? AND school_id = ?',
    [rosterId, applicationId, schoolId]
  );
  if (!r) throw appError('ไม่พบรายการในคำขอนี้', 404, 'ROSTER_NOT_FOUND');

  // keys come from a fixed allow-list above (never user input) → safe to inline
  const sets = Object.keys(allowed).map((k) => `${k} = ?`).join(', ');
  const vals = Object.values(allowed);
  await pool.query(`UPDATE registration_roster_students SET ${sets} WHERE id = ?`, [...vals, rosterId]);

  await logAudit({
    userId, action: 'UPDATE', entityType: 'registration_roster_student', entityId: String(rosterId),
    newValue: { ...allowed, raw_student_name: allowed.raw_student_name ? '[redacted]' : undefined },
  });
  return { id: Number(rosterId), ...allowed };
}

async function approveRegistration(pool, { applicationId, schoolId, userId }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[aps]] = await conn.query(
      'SELECT approval_status FROM inspection_application_schools WHERE application_id = ? AND school_id = ? FOR UPDATE',
      [applicationId, schoolId]
    );
    if (!aps) throw appError('ไม่ใช่คำขอของโรงเรียนนี้', 403, 'NOT_THIS_SCHOOL');

    const [[u]] = await conn.query(
      `SELECT COUNT(*) AS unresolved FROM registration_roster_students
        WHERE application_id = ? AND school_id = ? AND match_status = 'UNMATCHED'`,
      [applicationId, schoolId]
    );
    if (Number(u.unresolved) > 0) {
      throw appError(`ยังมีเด็ก ${u.unresolved} คนที่ยังไม่ตรวจสอบ`, 400, 'UNRESOLVED_ROSTER', { unresolved: Number(u.unresolved) });
    }

    await conn.query(
      `UPDATE inspection_application_schools
          SET approval_status = 'APPROVED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, school_note = NULL
        WHERE application_id = ? AND school_id = ?`,
      [userId, applicationId, schoolId]
    );
    await logAudit({
      userId, action: 'APPROVE', entityType: 'vehicle_school_registration',
      entityId: `${applicationId}:${schoolId}`,
      newValue: { step: 'school_approve', application_id: Number(applicationId), school_id: schoolId }, conn,
    });
    await conn.commit();
    await notifyAfterDecision(pool, { applicationId, schoolId, kind: 'APPROVED' }).catch(() => {});
    return { application_id: Number(applicationId), school_id: schoolId, approval_status: 'APPROVED' };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function rejectRegistration(pool, { applicationId, schoolId, userId, reason }) {
  if (!reason || !String(reason).trim()) throw appError('กรุณาระบุเหตุผลที่ส่งกลับ', 400, 'REASON_REQUIRED');
  const note = String(reason).trim().slice(0, 500);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[aps]] = await conn.query(
      'SELECT approval_status FROM inspection_application_schools WHERE application_id = ? AND school_id = ? FOR UPDATE',
      [applicationId, schoolId]
    );
    if (!aps) throw appError('ไม่ใช่คำขอของโรงเรียนนี้', 403, 'NOT_THIS_SCHOOL');
    await conn.query(
      `UPDATE inspection_application_schools
          SET approval_status = 'NEEDS_REVISION', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, school_note = ?
        WHERE application_id = ? AND school_id = ?`,
      [userId, note, applicationId, schoolId]
    );
    await logAudit({
      userId, action: 'UPDATE', entityType: 'vehicle_school_registration',
      entityId: `${applicationId}:${schoolId}`,
      newValue: { step: 'school_reject', reason: note }, conn,
    });
    await conn.commit();
    await notifyAfterDecision(pool, { applicationId, schoolId, kind: 'NEEDS_REVISION', reason: note }).catch(() => {});
    return { application_id: Number(applicationId), school_id: schoolId, approval_status: 'NEEDS_REVISION' };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// ─── Driver LINE notification (best-effort; never throws) ────────────────────

async function notifyDriverUser(pool, driverUserId, text) {
  if (!driverUserId) return;
  const [[u]] = await pool.query(
    'SELECT driver_id FROM users WHERE id = ? AND is_deleted = FALSE',
    [driverUserId]
  );
  if (!u || !u.driver_id) return;
  const [[lu]] = await pool.query(
    `SELECT line_user_id FROM line_users
      WHERE driver_id = ? AND user_type = 'driver' AND verified = TRUE AND line_user_id IS NOT NULL
      LIMIT 1`,
    [u.driver_id]
  );
  if (!lu || !lu.line_user_id) return;
  // Lazy require avoids a circular service dependency at module load.
  const lineSvc = require('./line.service'); // eslint-disable-line global-require
  await lineSvc.sendTextMessage(lu.line_user_id, text);
}

/**
 * Notify the driver who submitted this school's roster after a school decision.
 * All reads + the push are best-effort: callers wrap this in .catch(() => {}) so
 * a notification failure never affects the approval/rejection result.
 */
async function notifyAfterDecision(pool, { applicationId, schoolId, kind, reason = null }) {
  const [[aps]] = await pool.query(
    'SELECT submitted_by_driver FROM inspection_application_schools WHERE application_id = ? AND school_id = ?',
    [applicationId, schoolId]
  );
  const driverUserId = aps ? aps.submitted_by_driver : null;
  if (!driverUserId) return;

  const [[app]] = await pool.query(
    `SELECT a.vehicle_id, v.plate_no
       FROM vehicle_inspection_applications a
       JOIN vehicles v ON v.id = a.vehicle_id
      WHERE a.id = ?`,
    [applicationId]
  );
  const plate = app ? app.plate_no : '';
  const [[sc]] = await pool.query('SELECT name FROM schools WHERE id = ?', [schoolId]);
  const schoolName = sc ? sc.name : schoolId;

  let text;
  if (kind === 'APPROVED') {
    const [[c]] = await pool.query(
      `SELECT SUM(approval_status = 'APPROVED') AS approved, COUNT(*) AS total
         FROM inspection_application_schools WHERE application_id = ?`,
      [applicationId]
    );
    const approved = Number(c.approved) || 0;
    const total = Number(c.total) || 0;
    text = `โรงเรียน ${schoolName} อนุมัติคำขอขึ้นทะเบียนรถ ${plate} แล้ว (${approved}/${total} โรงเรียน)`;
    if (app && (await isVehicleEligible(pool, app.vehicle_id))) {
      text += `\nรถ ${plate} พร้อมใช้งานแล้ว — ครบทุกโรงเรียนและผ่านการตรวจสภาพ`;
    }
  } else {
    text = `โรงเรียน ${schoolName} ส่งกลับคำขอขึ้นทะเบียนรถ ${plate} เพื่อแก้ไข: ${reason || '-'}`;
  }
  await notifyDriverUser(pool, driverUserId, text);
}

// ─── Eligibility (reuses vehicles.verification_status from the 038 inspection) ──

async function isVehicleEligible(pool, vehicleId) {
  const [apps] = await pool.query(
    `SELECT id FROM vehicle_inspection_applications
      WHERE vehicle_id = ? AND ${ACTIVE_SQL}
      ORDER BY created_at DESC LIMIT 1`,
    [vehicleId]
  );
  if (!apps.length) return false;
  const [schools] = await pool.query(
    'SELECT approval_status FROM inspection_application_schools WHERE application_id = ?',
    [apps[0].id]
  );
  const [[v]] = await pool.query('SELECT verification_status FROM vehicles WHERE id = ?', [vehicleId]);
  return evaluateEligibility({
    approvals: schools.map((s) => s.approval_status),
    verificationStatus: v ? v.verification_status : null,
  });
}

module.exports = {
  appError,
  addRosterStudent,
  listDriverRegistrations,
  deleteRosterStudent,
  listSchoolRegistrations,
  getSchoolRegistrationDetail,
  matchRosterStudent,
  patchRosterStudent,
  approveRegistration,
  rejectRegistration,
  isVehicleEligible,
};
