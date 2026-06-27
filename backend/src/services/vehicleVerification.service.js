'use strict';

const crypto = require('crypto');
const env = require('../config/env');
const { logAudit } = require('../utils/audit');

const ACTIVE_APPLICATION_STATUSES = [
  'DRAFT', 'READY_TO_PRINT', 'SUBMITTED', 'INSPECTION_PENDING', 'NEEDS_FIX',
];
const FINAL_RESULTS = ['PASSED', 'FAILED', 'NEEDS_FIX', 'PENDING'];
const CHECK_RESULTS = ['PASS', 'FAIL', 'NOT_APPLICABLE'];
const REQUIRED_DOCUMENT_FIELDS = [
  'insurance_expiry',
  'registration_expiry',
  'compulsory_insurance_expiry',
  'tax_expiry',
];

function appError(message, statusCode = 400, code = null, extra = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.errors = [{ code, ...(extra || {}) }];
  return error;
}

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function daysBetween(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.floor((end - start) / 86400000);
}

function computeEligibility({
  inspection = null,
  documents = {},
  capacity = null,
  peakRiders = 0,
  validDriverCount = 0,
  suspended = false,
  today = new Date().toISOString().slice(0, 10),
} = {}) {
  const reasons = [];
  let expiring = false;

  if (suspended) reasons.push('VEHICLE_SUSPENDED');

  if (!inspection || inspection.result !== 'PASSED') {
    reasons.push(inspection && inspection.result ? `INSPECTION_${inspection.result}` : 'INSPECTION_MISSING');
  } else {
    const expiry = isoDate(inspection.expiry_date);
    if (!expiry) reasons.push('INSPECTION_EXPIRY_MISSING');
    else if (expiry < today) reasons.push('INSPECTION_EXPIRED');
    else {
      const remaining = daysBetween(today, expiry);
      if (remaining !== null && remaining <= 30) expiring = true;
    }
  }

  for (const field of REQUIRED_DOCUMENT_FIELDS) {
    const expiry = isoDate(documents[field]);
    const code = field.replace(/_expiry$/, '').toUpperCase();
    if (!expiry) reasons.push(`${code}_MISSING`);
    else if (expiry < today) reasons.push(`${code}_EXPIRED`);
    else {
      const remaining = daysBetween(today, expiry);
      if (remaining !== null && remaining <= 30) expiring = true;
    }
  }

  const numericCapacity = Number(capacity);
  const numericPeak = Number(peakRiders) || 0;
  if (!Number.isFinite(numericCapacity) || numericCapacity <= 0) reasons.push('CAPACITY_UNKNOWN');
  else if (numericPeak > numericCapacity) reasons.push('CAPACITY_EXCEEDED');

  if ((Number(validDriverCount) || 0) < 1) reasons.push('NO_VALID_DRIVER');

  if (reasons.length) return { status: 'INELIGIBLE', reasons };
  return { status: expiring ? 'EXPIRING' : 'ELIGIBLE', reasons: [] };
}

function buildTransportSnapshot({ vehicle = {}, schools = [], drivers = [], routes = [] } = {}) {
  const safeSchools = schools.map((school) => ({
    school_id: school.school_id || school.id,
    school_name: school.school_name || school.name,
    morning_rider_count: Number(school.morning_rider_count) || 0,
    evening_rider_count: Number(school.evening_rider_count) || 0,
    peak_rider_count: Math.max(
      Number(school.morning_rider_count) || 0,
      Number(school.evening_rider_count) || 0
    ),
  }));
  const morning = safeSchools.reduce((sum, school) => sum + school.morning_rider_count, 0);
  const evening = safeSchools.reduce((sum, school) => sum + school.evening_rider_count, 0);

  return {
    vehicle: {
      id: vehicle.id || null,
      plate_no: vehicle.plate_no || null,
      vehicle_type: vehicle.vehicle_type || null,
      certified_capacity: vehicle.certified_capacity == null ? null : Number(vehicle.certified_capacity),
      insurance_expiry: isoDate(vehicle.insurance_expiry),
      registration_expiry: isoDate(vehicle.registration_expiry),
      compulsory_insurance_expiry: isoDate(vehicle.compulsory_insurance_expiry),
      tax_expiry: isoDate(vehicle.tax_expiry),
    },
    schools: safeSchools,
    drivers: drivers.map((driver) => ({
      driver_id: driver.driver_id || driver.id,
      driver_name: driver.driver_name || driver.name,
      assignment_role: driver.assignment_role || 'PRIMARY',
      qualification_status: driver.qualification_status || null,
    })),
    routes: routes.map((route) => ({
      pickup_area: route.pickup_area || route.name || null,
      session: route.session || null,
    })),
    morning_rider_count: morning,
    evening_rider_count: evening,
    peak_rider_count: Math.max(morning, evening),
    total_schools: safeSchools.length,
  };
}

async function refreshVehicleEligibility(executor, vehicleId, {
  today = new Date().toISOString().slice(0, 10), currentTerm = env.app.currentTerm,
} = {}) {
  const [[vehicle]] = await executor.query(
    `SELECT id, certified_capacity, insurance_expiry, registration_expiry,
            compulsory_insurance_expiry, tax_expiry, verification_status
       FROM vehicles
      WHERE id = ? AND is_deleted = FALSE`,
    [vehicleId]
  );
  if (!vehicle) throw appError('ไม่พบรถสำหรับคำนวณสถานะ', 404, 'VEHICLE_NOT_FOUND');
  const [[sharedInspection]] = await executor.query(
    `SELECT ia.result, ia.expiry_date
       FROM inspection_attempts ia
       JOIN vehicle_inspection_applications a ON a.id = ia.application_id
      WHERE a.vehicle_id = ? AND ia.result <> 'IN_PROGRESS' AND ia.finalized_at IS NOT NULL
      ORDER BY ia.inspection_date DESC, ia.finalized_at DESC LIMIT 1`,
    [vehicleId]
  );
  let inspection = sharedInspection || null;
  if (!inspection) {
    const [[legacy]] = await executor.query(
      `SELECT result, expiry_date FROM vehicle_inspections
        WHERE vehicle_id = ? ORDER BY inspection_date DESC, id DESC LIMIT 1`,
      [vehicleId]
    );
    inspection = legacy || null;
  }
  const [[riders]] = await executor.query(
    `SELECT SUM(CASE WHEN morning_enabled = TRUE THEN 1 ELSE 0 END) AS morning_rider_count,
            SUM(CASE WHEN evening_enabled = TRUE THEN 1 ELSE 0 END) AS evening_rider_count
       FROM students
      WHERE vehicle_id = ? AND is_deleted = FALSE
        AND (term_id = ? OR term_id IS NULL)`,
    [vehicleId, currentTerm]
  );
  const [[drivers]] = await executor.query(
    `SELECT COUNT(*) AS valid_driver_count
       FROM driver_vehicle_assignments dva
       JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
       JOIN driver_qualifications dq ON dq.driver_id = d.id AND dq.is_current = TRUE
      WHERE dva.vehicle_id = ? AND dva.is_active = TRUE
        AND dva.authorization_status = 'AUTHORIZED'
        AND (dva.valid_from IS NULL OR dva.valid_from <= ?)
        AND (dva.valid_until IS NULL OR dva.valid_until >= ?)
        AND dq.qualification_status = 'VERIFIED' AND dq.license_expiry >= ?`,
    [vehicleId, today, today, today]
  );
  const peak = Math.max(Number(riders?.morning_rider_count) || 0, Number(riders?.evening_rider_count) || 0);
  const eligibility = vehicle.verification_status === 'SUSPENDED'
    ? { status: 'SUSPENDED', reasons: ['VEHICLE_SUSPENDED'] }
    : computeEligibility({
      inspection,
      documents: vehicle,
      capacity: vehicle.certified_capacity,
      peakRiders: peak,
      validDriverCount: drivers?.valid_driver_count,
      today,
    });
  await executor.query(
    `UPDATE vehicles
        SET verification_status = ?, verification_reasons_json = ?,
            verification_updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [eligibility.status, JSON.stringify(eligibility.reasons), vehicleId]
  );
  return eligibility;
}

function makeRequestNo(now = new Date()) {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `VIA-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapApplication(row) {
  if (!row) return null;
  const vehicle = parseJson(row.vehicle_snapshot_json, {});
  const rider = parseJson(row.rider_summary_json, {});
  const route = parseJson(row.route_summary_json, {});
  const result = { ...row };
  delete result.vehicle_snapshot_json;
  delete result.rider_summary_json;
  delete result.route_summary_json;
  return {
    ...result,
    plate_no: row.plate_no || vehicle.plate_no || null,
    vehicle_type: row.vehicle_type || vehicle.vehicle_type || null,
    certified_capacity: row.certified_capacity ?? vehicle.certified_capacity ?? null,
    vehicle,
    schools: rider.schools || [],
    morning_rider_count: Number(row.morning_rider_count ?? rider.morning_rider_count) || 0,
    evening_rider_count: Number(row.evening_rider_count ?? rider.evening_rider_count) || 0,
    peak_rider_count: Number(row.peak_rider_count ?? rider.peak_rider_count) || 0,
    total_schools: Number(row.total_schools ?? rider.total_schools) || 0,
    routes: route.routes || [],
  };
}

async function createApplication(pool, {
  vehicleId,
  issuingSchoolId,
  userId,
  currentTerm = env.app.currentTerm,
}) {
  if (!vehicleId || !issuingSchoolId || !userId) {
    throw appError('vehicleId, issuingSchoolId และ userId จำเป็นต้องระบุ', 400, 'MISSING_REQUIRED_FIELDS');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[vehicle]] = await conn.query(
      `SELECT v.id, v.plate_no, v.vehicle_type, v.certified_capacity,
              v.insurance_expiry, v.registration_expiry,
              v.compulsory_insurance_expiry, v.tax_expiry
         FROM vehicles v
        WHERE v.id = ? AND v.is_deleted = FALSE
        FOR UPDATE`,
      [vehicleId]
    );
    if (!vehicle) throw appError('ไม่พบรถที่ต้องการส่งตรวจ', 404, 'VEHICLE_NOT_FOUND');

    const [[relation]] = await conn.query(
      `SELECT COUNT(*) AS related
         FROM students
        WHERE vehicle_id = ? AND school_id = ?
          AND is_deleted = FALSE
          AND (term_id = ? OR term_id IS NULL)`,
      [vehicleId, issuingSchoolId, currentTerm]
    );
    if (!relation || !Number(relation.related)) {
      throw appError('โรงเรียนนี้ไม่มีนักเรียนที่ใช้รถคันดังกล่าว', 403, 'SCHOOL_NOT_RELATED_TO_VEHICLE');
    }

    const activeKey = `${vehicleId}|${currentTerm}`;
    const [[existing]] = await conn.query(
      `SELECT id, request_no, status
         FROM vehicle_inspection_applications
        WHERE active_request_key = ?
        LIMIT 1
        FOR UPDATE`,
      [activeKey]
    );
    if (existing) {
      throw appError('รถคันนี้มีคำขอส่งตรวจที่ยังดำเนินการอยู่', 409, 'ACTIVE_APPLICATION_EXISTS', {
        application_id: existing.id,
        request_no: existing.request_no,
        status: existing.status,
      });
    }

    const [schools] = await conn.query(
      `SELECT s.school_id, sc.name AS school_name,
              SUM(CASE WHEN s.morning_enabled = TRUE THEN 1 ELSE 0 END) AS morning_rider_count,
              SUM(CASE WHEN s.evening_enabled = TRUE THEN 1 ELSE 0 END) AS evening_rider_count,
              MAX(s.updated_at) AS source_updated_at
         FROM students s
         JOIN schools sc ON sc.id = s.school_id AND sc.is_deleted = FALSE
        WHERE s.vehicle_id = ? AND s.is_deleted = FALSE
          AND (s.term_id = ? OR s.term_id IS NULL)
        GROUP BY s.school_id, sc.name
        ORDER BY sc.name`,
      [vehicleId, currentTerm]
    );
    if (!schools.length) throw appError('รถคันนี้ยังไม่มีข้อมูลผู้โดยสารในภาคเรียนปัจจุบัน', 400, 'NO_CURRENT_RIDERS');

    const [drivers] = await conn.query(
      `SELECT d.id AS driver_id, d.name AS driver_name,
              dva.assignment_role, dq.qualification_status
         FROM driver_vehicle_assignments dva
         JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
         LEFT JOIN driver_qualifications dq ON dq.driver_id = d.id AND dq.is_current = TRUE
        WHERE dva.vehicle_id = ? AND dva.is_active = TRUE
          AND dva.authorization_status = 'AUTHORIZED'
        ORDER BY FIELD(dva.assignment_role, 'PRIMARY', 'BACKUP'), d.name`,
      [vehicleId]
    );

    const [routes] = await conn.query(
      `SELECT pp.label AS pickup_area, pp.session
         FROM pickup_points pp
        WHERE pp.vehicle_id = ? AND pp.is_deleted = FALSE
        ORDER BY pp.sequence, pp.id`,
      [vehicleId]
    );

    const transportSnapshot = buildTransportSnapshot({ vehicle, schools, drivers, routes });
    const requestNo = makeRequestNo();
    const qrToken = crypto.randomBytes(16).toString('hex');
    const [insert] = await conn.query(
      `INSERT INTO vehicle_inspection_applications
        (request_no, vehicle_id, issuing_school_id, requested_by, current_term,
         status, version_no, provider_type, qr_token, active_request_key,
         vehicle_snapshot_json, rider_summary_json, route_summary_json)
       VALUES (?, ?, ?, ?, ?, 'DRAFT', 1, 'DLT_OFFICER', ?, ?, ?, ?, ?)`,
      [
        requestNo, vehicleId, issuingSchoolId, userId, currentTerm, qrToken, activeKey,
        JSON.stringify(transportSnapshot.vehicle),
        JSON.stringify({
          schools: transportSnapshot.schools,
          morning_rider_count: transportSnapshot.morning_rider_count,
          evening_rider_count: transportSnapshot.evening_rider_count,
          peak_rider_count: transportSnapshot.peak_rider_count,
          total_schools: transportSnapshot.total_schools,
        }),
        JSON.stringify({ routes: transportSnapshot.routes }),
      ]
    );

    for (const school of transportSnapshot.schools) {
      const source = schools.find((row) => String(row.school_id) === String(school.school_id));
      await conn.query(
        `INSERT INTO inspection_application_schools
          (application_id, school_id, morning_rider_count, evening_rider_count,
           peak_rider_count, source_updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [insert.insertId, school.school_id, school.morning_rider_count,
          school.evening_rider_count, school.peak_rider_count,
          source && source.source_updated_at ? source.source_updated_at : null]
      );
    }

    await logAudit({
      userId,
      action: 'CREATE',
      entityType: 'vehicle_inspection_application',
      entityId: String(insert.insertId),
      newValue: {
        request_no: requestNo,
        vehicle_id: vehicleId,
        issuing_school_id: issuingSchoolId,
        total_schools: transportSnapshot.total_schools,
        peak_rider_count: transportSnapshot.peak_rider_count,
      },
      conn,
    });
    await conn.commit();

    return {
      id: insert.insertId,
      request_no: requestNo,
      status: 'DRAFT',
      vehicle_id: vehicleId,
      issuing_school_id: issuingSchoolId,
      qr_token: qrToken,
      total_schools: transportSnapshot.total_schools,
      morning_rider_count: transportSnapshot.morning_rider_count,
      evening_rider_count: transportSnapshot.evening_rider_count,
      peak_rider_count: transportSnapshot.peak_rider_count,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function listSchoolApplications(pool, { schoolId, status = null } = {}) {
  if (!schoolId) throw appError('ไม่พบขอบเขตโรงเรียน', 403, 'SCHOOL_SCOPE_REQUIRED');
  const params = [schoolId];
  let statusSql = '';
  if (status) {
    statusSql = ' AND a.status = ?';
    params.push(status);
  }
  const [rows] = await pool.query(
    `SELECT a.*, v.plate_no, v.vehicle_type, sc.name AS issuing_school_name
       FROM vehicle_inspection_applications a
       JOIN inspection_application_schools access_school
         ON access_school.application_id = a.id AND access_school.school_id = ?
       JOIN vehicles v ON v.id = a.vehicle_id
       JOIN schools sc ON sc.id = a.issuing_school_id
      WHERE 1 = 1${statusSql}
      ORDER BY a.created_at DESC`,
    params
  );
  return rows.map(mapApplication);
}

async function getApplication(pool, { applicationId, viewer } = {}) {
  if (!applicationId || !viewer || !viewer.role) {
    throw appError('ข้อมูลผู้ดูหรือคำขอไม่ครบถ้วน', 400, 'INVALID_VIEWER');
  }
  const isSchool = viewer.role === 'school';
  const isDriver = viewer.role === 'driver';
  if (isSchool && !viewer.schoolId) throw appError('ไม่พบขอบเขตโรงเรียน', 403, 'SCHOOL_SCOPE_REQUIRED');
  // A driver may only read an application they themselves submitted — mirror the
  // scope of listDriverApplications (WHERE a.requested_by = ?). Without this the
  // detail getter ran `WHERE a.id = ?` with no ownership filter, so any
  // authenticated driver could read every application by sequential id (IDOR).
  if (isDriver && !viewer.userId) throw appError('ไม่พบขอบเขตผู้ใช้', 403, 'DRIVER_SCOPE_REQUIRED');
  const accessJoin = isSchool
    ? 'JOIN inspection_application_schools access_school ON access_school.application_id = a.id AND access_school.school_id = ?'
    : '';
  const driverScopeSql = isDriver ? ' AND a.requested_by = ?' : '';
  const params = isSchool
    ? [viewer.schoolId, applicationId]
    : isDriver
      ? [applicationId, viewer.userId]
      : [applicationId];
  const [rows] = await pool.query(
    `SELECT a.*, v.plate_no, v.vehicle_type, v.verification_status,
            sc.name AS issuing_school_name
       FROM vehicle_inspection_applications a
       JOIN vehicles v ON v.id = a.vehicle_id
       JOIN schools sc ON sc.id = a.issuing_school_id
       ${accessJoin}
      WHERE a.id = ?${driverScopeSql}
      LIMIT 1`,
    params
  );
  if (!rows.length) throw appError('ไม่พบคำขอ หรือคุณไม่มีสิทธิ์ดูคำขอนี้', 404, 'APPLICATION_NOT_FOUND');

  const [schools] = await pool.query(
    `SELECT aps.school_id, sc.name AS school_name,
            aps.morning_rider_count, aps.evening_rider_count,
            aps.peak_rider_count, aps.pickup_area_summary
       FROM inspection_application_schools aps
       JOIN schools sc ON sc.id = aps.school_id
      WHERE aps.application_id = ?
      ORDER BY sc.name`,
    [applicationId]
  );
  const [attempts] = await pool.query(
    `SELECT ia.id, ia.result, ia.provider_type, ia.provider_reference,
            ia.inspection_date, ia.expiry_date, ia.notes, ia.finalized_at,
            u.display_name AS inspector_name
       FROM inspection_attempts ia
       JOIN users u ON u.id = ia.inspected_by
      WHERE ia.application_id = ?
      ORDER BY ia.created_at DESC`,
    [applicationId]
  );
  const [drivers] = await pool.query(
    `SELECT d.id AS driver_id, d.name AS driver_name, dva.assignment_role,
            dq.qualification_status, dq.license_expiry
       FROM driver_vehicle_assignments dva
       JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
       LEFT JOIN driver_qualifications dq ON dq.driver_id = d.id AND dq.is_current = TRUE
      WHERE dva.vehicle_id = ? AND dva.is_active = TRUE
        AND dva.authorization_status = 'AUTHORIZED'
      ORDER BY FIELD(dva.assignment_role, 'PRIMARY', 'BACKUP'), d.name`,
    [rows[0].vehicle_id]
  );
  return { ...mapApplication(rows[0]), schools, attempts, drivers };
}

async function listTransportQueue(pool, { status = null, search = null } = {}) {
  const where = [];
  const params = [];
  if (status) {
    where.push('a.status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(v.plate_no LIKE ? OR a.request_no LIKE ? OR sc.name LIKE ?)');
    const term = `%${String(search).trim()}%`;
    params.push(term, term, term);
  }
  const [rows] = await pool.query(
    `SELECT a.*, v.plate_no, v.vehicle_type, v.verification_status,
            sc.name AS issuing_school_name
       FROM vehicle_inspection_applications a
       JOIN vehicles v ON v.id = a.vehicle_id
       JOIN schools sc ON sc.id = a.issuing_school_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY FIELD(a.status, 'READY_TO_PRINT', 'SUBMITTED', 'INSPECTION_PENDING',
                     'NEEDS_FIX', 'DRAFT', 'PASSED', 'FAILED', 'CANCELLED'),
               a.created_at ASC`,
    params
  );
  return rows.map(mapApplication);
}

async function transitionSchoolApplication(pool, {
  applicationId, schoolId, userId, nextStatus, allowedStatuses, reason = null,
  isAdmin = false,
}) {
  // schoolId is the scope guard for non-admin callers. Admin overrides bypass it
  // and may pass schoolId = null, so it is no longer part of the required set.
  if (!applicationId || !userId || (!isAdmin && !schoolId)) {
    throw appError('ข้อมูลคำขอ โรงเรียน หรือผู้ใช้ไม่ครบถ้วน', 400, 'MISSING_REQUIRED_FIELDS');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[application]] = await conn.query(
      `SELECT id, request_no, status, issuing_school_id, active_request_key
         FROM vehicle_inspection_applications
        WHERE id = ?
        FOR UPDATE`,
      [applicationId]
    );
    if (!application) throw appError('ไม่พบคำขอ', 404, 'APPLICATION_NOT_FOUND');
    // Admin override bypasses the issuing-school scope check; non-admin callers
    // may only act on applications their own school issued.
    if (!isAdmin && String(application.issuing_school_id) !== String(schoolId)) {
      throw appError('เฉพาะโรงเรียนผู้ออกเอกสารเท่านั้นที่เปลี่ยนสถานะได้', 403, 'ISSUING_SCHOOL_REQUIRED');
    }
    if (!allowedStatuses.includes(application.status)) {
      throw appError('สถานะคำขอปัจจุบันไม่อนุญาตให้ทำรายการนี้', 409, 'INVALID_APPLICATION_STATUS', {
        current_status: application.status,
      });
    }
    const isCancelled = nextStatus === 'CANCELLED';
    // When cancelling an application that is mid-inspection, any IN_PROGRESS
    // attempt must be closed in the same transaction — otherwise the attempt is
    // orphaned IN_PROGRESS and refreshVehicleEligibility / a future startInspection
    // see inconsistent state. The attempt was never finalized, so no checklist
    // results or certification exist; a hard-delete is safe (children removed
    // first to satisfy the FKs from inspection_evidence / inspection_checklist_results).
    let abortedAttempts = [];
    if (isCancelled) {
      const [openAttempts] = await conn.query(
        `SELECT id, inspected_by, inspection_date, started_at
           FROM inspection_attempts
          WHERE application_id = ? AND result = 'IN_PROGRESS'
          FOR UPDATE`,
        [applicationId]
      );
      for (const attempt of openAttempts) {
        await conn.query('DELETE FROM inspection_evidence WHERE attempt_id = ?', [attempt.id]);
        await conn.query('DELETE FROM inspection_checklist_results WHERE attempt_id = ?', [attempt.id]);
        await conn.query(
          `DELETE FROM inspection_attempts WHERE id = ? AND result = 'IN_PROGRESS'`,
          [attempt.id]
        );
        abortedAttempts.push({
          attempt_id: attempt.id,
          inspected_by: attempt.inspected_by,
          inspection_date: isoDate(attempt.inspection_date),
        });
      }
    }
    await conn.query(
      `UPDATE vehicle_inspection_applications
          SET status = ?,
              ready_at = CASE WHEN ? = 'READY_TO_PRINT' THEN CURRENT_TIMESTAMP ELSE ready_at END,
              cancelled_by = CASE WHEN ? = 'CANCELLED' THEN ? ELSE cancelled_by END,
              cancel_reason = CASE WHEN ? = 'CANCELLED' THEN ? ELSE cancel_reason END,
              active_request_key = CASE WHEN ? = 'CANCELLED' THEN NULL ELSE active_request_key END
        WHERE id = ?`,
      [nextStatus, nextStatus, nextStatus, userId, nextStatus, isCancelled ? reason : null,
        nextStatus, applicationId]
    );
    await logAudit({
      userId,
      action: 'UPDATE',
      entityType: 'vehicle_inspection_application',
      entityId: String(applicationId),
      oldValue: { status: application.status },
      newValue: {
        status: nextStatus,
        ...(isCancelled ? { reason: reason || null } : {}),
        ...(isAdmin ? { admin_override: true } : {}),
        ...(abortedAttempts.length ? { aborted_attempts: abortedAttempts } : {}),
      },
      conn,
    });
    await conn.commit();
    return {
      id: Number(applicationId),
      request_no: application.request_no,
      status: nextStatus,
      ...(abortedAttempts.length ? { aborted_attempts: abortedAttempts } : {}),
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

function markReadyToPrint(pool, { applicationId, schoolId, userId }) {
  return transitionSchoolApplication(pool, {
    applicationId, schoolId, userId,
    nextStatus: 'READY_TO_PRINT', allowedStatuses: ['DRAFT'],
  });
}

function cancelApplication(pool, { applicationId, schoolId, userId, reason = null, isAdmin = false }) {
  return transitionSchoolApplication(pool, {
    applicationId, schoolId, userId, reason, isAdmin,
    // Cancel must rescue stuck applications too: an app mid-inspection
    // (INSPECTION_PENDING), bounced back to the school (NEEDS_FIX), or a
    // driver-initiated app awaiting review (PENDING_SCHOOL_REVIEW). The
    // IN_PROGRESS-attempt abort is handled inside transitionSchoolApplication.
    nextStatus: 'CANCELLED',
    allowedStatuses: [
      'DRAFT', 'READY_TO_PRINT', 'SUBMITTED',
      'INSPECTION_PENDING', 'NEEDS_FIX', 'PENDING_SCHOOL_REVIEW',
    ],
  });
}

function validateChecklistResults(templateItems, submittedItems, overallResult = null) {
  if (!Array.isArray(submittedItems)) {
    throw appError('ต้องระบุผลตรวจรายหัวข้อ', 400, 'CHECKLIST_REQUIRED');
  }
  const templateByCode = new Map(templateItems.map((item) => [item.item_code, item]));
  const seen = new Set();
  const normalized = [];
  for (const input of submittedItems) {
    const item = templateByCode.get(input.item_code);
    if (!item) throw appError('พบหัวข้อตรวจที่ไม่อยู่ในแบบตรวจ', 400, 'UNKNOWN_CHECKLIST_ITEM', { item_code: input.item_code });
    if (seen.has(input.item_code)) throw appError('ส่งผลตรวจหัวข้อเดิมซ้ำ', 400, 'DUPLICATE_CHECKLIST_ITEM', { item_code: input.item_code });
    if (!CHECK_RESULTS.includes(input.result)) {
      throw appError('ผลตรวจรายหัวข้อไม่ถูกต้อง', 400, 'INVALID_CHECK_RESULT', { item_code: input.item_code });
    }
    if (input.result === 'NOT_APPLICABLE' && !item.allows_na) {
      throw appError('หัวข้อนี้ไม่อนุญาตให้เลือกไม่เกี่ยวข้อง', 400, 'NA_NOT_ALLOWED', { item_code: input.item_code });
    }
    if (input.result === 'FAIL' && !String(input.notes || '').trim()) {
      throw appError('หัวข้อที่ไม่ผ่านต้องระบุรายละเอียด', 400, 'FAIL_NOTE_REQUIRED', { item_code: input.item_code });
    }
    seen.add(input.item_code);
    normalized.push({
      checklist_item_id: item.id,
      item_code: item.item_code,
      result: input.result,
      severity: input.result === 'FAIL' ? (input.severity || item.fail_severity) : null,
      notes: String(input.notes || '').trim() || null,
    });
  }
  const missing = templateItems.filter((item) => item.is_required && !seen.has(item.item_code));
  if (missing.length) {
    throw appError('กรอกหัวข้อตรวจบังคับไม่ครบ', 400, 'REQUIRED_CHECKLIST_ITEMS_MISSING', {
      item_codes: missing.map((item) => item.item_code),
    });
  }
  if (overallResult === 'PASSED' && normalized.some((item) => item.result === 'FAIL')) {
    throw appError('ไม่สามารถรับรองว่าผ่านเมื่อมีหัวข้อตรวจไม่ผ่าน', 400, 'PASS_WITH_FAILED_CHECK');
  }
  return normalized;
}

async function listChecklistTemplates(pool) {
  const [templates] = await pool.query(
    `SELECT id, template_code, template_name, version_no
       FROM inspection_checklist_templates
      WHERE is_active = TRUE
      ORDER BY template_code, version_no DESC`
  );
  if (!templates.length) return [];
  const [items] = await pool.query(
    `SELECT id, template_id, item_code, category, label_th,
            is_required, allows_na, fail_severity, sort_order
       FROM inspection_checklist_items
      WHERE template_id IN (?)
      ORDER BY template_id, sort_order, id`,
    [templates.map((template) => template.id)]
  );
  return templates.map((template) => ({
    ...template,
    items: items.filter((item) => String(item.template_id) === String(template.id)),
  }));
}

async function startInspection(pool, {
  applicationId, inspectorUserId, inspectionDate = new Date().toISOString().slice(0, 10),
  providerType = 'DLT_OFFICER', providerReference = null,
}) {
  if (!applicationId || !inspectorUserId) {
    throw appError('ข้อมูลคำขอหรือเจ้าหน้าที่ไม่ครบถ้วน', 400, 'MISSING_REQUIRED_FIELDS');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[application]] = await conn.query(
      `SELECT id, status
         FROM vehicle_inspection_applications
        WHERE id = ?
        FOR UPDATE`,
      [applicationId]
    );
    if (!application) throw appError('ไม่พบคำขอส่งตรวจ', 404, 'APPLICATION_NOT_FOUND');
    if (!['READY_TO_PRINT', 'SUBMITTED', 'NEEDS_FIX', 'INSPECTION_PENDING'].includes(application.status)) {
      throw appError('สถานะคำขอไม่พร้อมเริ่มตรวจ', 409, 'INVALID_APPLICATION_STATUS', { current_status: application.status });
    }
    const [[template]] = await conn.query(
      `SELECT id, version_no
         FROM inspection_checklist_templates
        WHERE template_code = 'LAMPANG_SCHOOLBUS' AND is_active = TRUE
        ORDER BY version_no DESC
        LIMIT 1`
    );
    if (!template) throw appError('ไม่พบแบบตรวจที่เปิดใช้งาน', 503, 'ACTIVE_CHECKLIST_NOT_FOUND');
    const [insert] = await conn.query(
      `INSERT INTO inspection_attempts
        (application_id, checklist_template_id, inspected_by, provider_type,
         provider_reference, result, inspection_date)
       VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', ?)`,
      [applicationId, template.id, inspectorUserId, providerType, providerReference, inspectionDate]
    );
    await conn.query(
      `UPDATE vehicle_inspection_applications
          SET status = 'INSPECTION_PENDING',
              submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP)
        WHERE id = ?`,
      [applicationId]
    );
    await logAudit({
      userId: inspectorUserId, action: 'CREATE', entityType: 'inspection_attempt',
      entityId: String(insert.insertId), newValue: { application_id: applicationId, checklist_version: template.version_no }, conn,
    });
    await conn.commit();
    return {
      attempt_id: insert.insertId,
      application_id: Number(applicationId),
      checklist_version: Number(template.version_no),
      status: 'IN_PROGRESS',
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function finalizeInspection(pool, {
  attemptId, inspectorUserId, result, inspectionDate = null, expiryDate = null,
  notes = null, items = [], providerReference = null,
}) {
  if (!attemptId || !inspectorUserId || !FINAL_RESULTS.includes(result)) {
    throw appError('ข้อมูลการสรุปผลตรวจไม่ถูกต้อง', 400, 'INVALID_FINALIZATION_INPUT');
  }
  if (result === 'PASSED' && !expiryDate) {
    throw appError('ผลผ่านต้องระบุวันหมดอายุการรับรอง', 400, 'EXPIRY_DATE_REQUIRED');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[attempt]] = await conn.query(
      `SELECT ia.id, ia.application_id, ia.checklist_template_id, ia.inspected_by,
              ia.result, ia.inspection_date, a.vehicle_id, a.rider_summary_json
         FROM inspection_attempts ia
         JOIN vehicle_inspection_applications a ON a.id = ia.application_id
        WHERE ia.id = ?
        FOR UPDATE`,
      [attemptId]
    );
    if (!attempt) throw appError('ไม่พบครั้งการตรวจ', 404, 'INSPECTION_ATTEMPT_NOT_FOUND');
    if (attempt.result !== 'IN_PROGRESS') throw appError('ครั้งการตรวจนี้ถูกสรุปผลแล้ว', 409, 'ATTEMPT_ALREADY_FINALIZED');
    if (String(attempt.inspected_by) !== String(inspectorUserId)) {
      throw appError('เฉพาะเจ้าหน้าที่ผู้เริ่มตรวจเท่านั้นที่สรุปผลได้', 403, 'INSPECTOR_MISMATCH');
    }
    const [templateItems] = await conn.query(
      `SELECT id, item_code, is_required, allows_na, fail_severity
         FROM inspection_checklist_items
        WHERE template_id = ?
        ORDER BY sort_order, id`,
      [attempt.checklist_template_id]
    );
    const normalizedItems = validateChecklistResults(templateItems, items, result);
    for (const item of normalizedItems) {
      await conn.query(
        `INSERT INTO inspection_checklist_results
          (attempt_id, checklist_item_id, result, severity, notes)
         VALUES (?, ?, ?, ?, ?)`,
        [attemptId, item.checklist_item_id, item.result, item.severity, item.notes]
      );
    }
    const effectiveInspectionDate = inspectionDate || isoDate(attempt.inspection_date);
    await conn.query(
      `UPDATE inspection_attempts
          SET result = ?, inspection_date = ?, expiry_date = ?, notes = ?,
              provider_reference = COALESCE(?, provider_reference), finalized_at = CURRENT_TIMESTAMP
        WHERE id = ? AND result = 'IN_PROGRESS'`,
      [result, effectiveInspectionDate, expiryDate || null, notes || null, providerReference, attemptId]
    );
    const applicationStatus = result === 'PENDING' ? 'INSPECTION_PENDING' : result;
    const releaseActiveKey = ['PASSED', 'FAILED'].includes(result);
    await conn.query(
      `UPDATE vehicle_inspection_applications
          SET status = ?,
              completed_at = CASE WHEN ? IN ('PASSED','FAILED') THEN CURRENT_TIMESTAMP ELSE completed_at END,
              active_request_key = CASE WHEN ? = TRUE THEN NULL ELSE active_request_key END
        WHERE id = ?`,
      [applicationStatus, result, releaseActiveKey, attempt.application_id]
    );
    const [legacy] = await conn.query(
      `INSERT INTO vehicle_inspections
        (vehicle_id, inspected_by, inspection_date, expiry_date, result, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [attempt.vehicle_id, inspectorUserId, effectiveInspectionDate, expiryDate || null, result, notes || null]
    );

    const [[vehicle]] = await conn.query(
      `SELECT id, certified_capacity, insurance_expiry, registration_expiry,
              compulsory_insurance_expiry, tax_expiry
         FROM vehicles
        WHERE id = ?
        FOR UPDATE`,
      [attempt.vehicle_id]
    );
    const [[driverCount]] = await conn.query(
      `SELECT COUNT(*) AS valid_driver_count
         FROM driver_vehicle_assignments dva
         JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
         JOIN driver_qualifications dq ON dq.driver_id = d.id AND dq.is_current = TRUE
        WHERE dva.vehicle_id = ? AND dva.is_active = TRUE
          AND dva.authorization_status = 'AUTHORIZED'
          AND (dva.valid_from IS NULL OR dva.valid_from <= CURRENT_DATE)
          AND (dva.valid_until IS NULL OR dva.valid_until >= CURRENT_DATE)
          AND dq.qualification_status = 'VERIFIED'
          AND dq.license_expiry >= CURRENT_DATE`,
      [attempt.vehicle_id]
    );
    const rider = parseJson(attempt.rider_summary_json, {});
    const eligibility = computeEligibility({
      inspection: { result, expiry_date: expiryDate },
      documents: vehicle || {},
      capacity: vehicle && vehicle.certified_capacity,
      peakRiders: rider.peak_rider_count,
      validDriverCount: driverCount && driverCount.valid_driver_count,
    });
    await conn.query(
      `UPDATE vehicles
          SET verification_status = ?, verification_reasons_json = ?,
              verification_updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [eligibility.status, JSON.stringify(eligibility.reasons), attempt.vehicle_id]
    );
    await logAudit({
      userId: inspectorUserId, action: 'UPDATE', entityType: 'inspection_attempt',
      entityId: String(attemptId), oldValue: { result: 'IN_PROGRESS' },
      newValue: { result, legacy_inspection_id: legacy.insertId, eligibility }, conn,
    });
    await conn.commit();
    return { attempt_id: Number(attemptId), application_status: applicationStatus, eligibility };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function abortInspectionAttempt(pool, {
  attemptId, actorUserId, isAdmin = false, reason = null,
}) {
  if (!attemptId || !actorUserId) {
    throw appError('ข้อมูลครั้งการตรวจหรือผู้ใช้ไม่ครบถ้วน', 400, 'MISSING_REQUIRED_FIELDS');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[attempt]] = await conn.query(
      `SELECT ia.id, ia.application_id, ia.inspected_by, ia.result,
              ia.inspection_date, ia.started_at, a.vehicle_id, a.status AS application_status
         FROM inspection_attempts ia
         JOIN vehicle_inspection_applications a ON a.id = ia.application_id
        WHERE ia.id = ?
        FOR UPDATE`,
      [attemptId]
    );
    if (!attempt) throw appError('ไม่พบครั้งการตรวจ', 404, 'INSPECTION_ATTEMPT_NOT_FOUND');
    if (attempt.result !== 'IN_PROGRESS') {
      throw appError('ครั้งการตรวจนี้ถูกสรุปผลแล้ว ไม่สามารถยกเลิกได้', 409, 'ATTEMPT_ALREADY_FINALIZED', {
        current_result: attempt.result,
      });
    }
    // Non-admin transport users may only abort an attempt they themselves started
    // (mirrors finalizeInspection's INSPECTOR_MISMATCH guard). Admin overrides it.
    if (!isAdmin && String(attempt.inspected_by) !== String(actorUserId)) {
      throw appError('เฉพาะเจ้าหน้าที่ผู้เริ่มตรวจเท่านั้นที่ยกเลิกการตรวจได้', 403, 'INSPECTOR_MISMATCH');
    }

    // Hard-delete the un-finalized attempt (no certification was issued). Remove
    // FK children first; an IN_PROGRESS attempt normally has no checklist results
    // (those are only written at finalize) but evidence may exist, so both are
    // cleared before the attempt row.
    await conn.query('DELETE FROM inspection_evidence WHERE attempt_id = ?', [attemptId]);
    await conn.query('DELETE FROM inspection_checklist_results WHERE attempt_id = ?', [attemptId]);
    await conn.query(
      `DELETE FROM inspection_attempts WHERE id = ? AND result = 'IN_PROGRESS'`,
      [attemptId]
    );

    // Revert the application to its pre-inspection state. startInspection drives
    // the app to INSPECTION_PENDING from {READY_TO_PRINT, SUBMITTED, NEEDS_FIX,
    // INSPECTION_PENDING}; the canonical "ready to be inspected" resting state in
    // the transport queue is READY_TO_PRINT, so revert there. If the application
    // is no longer INSPECTION_PENDING (e.g. another attempt already moved it on)
    // leave it untouched to avoid clobbering newer state.
    let revertedStatus = attempt.application_status;
    if (attempt.application_status === 'INSPECTION_PENDING') {
      revertedStatus = 'READY_TO_PRINT';
      await conn.query(
        `UPDATE vehicle_inspection_applications
            SET status = 'READY_TO_PRINT',
                ready_at = COALESCE(ready_at, CURRENT_TIMESTAMP)
          WHERE id = ? AND status = 'INSPECTION_PENDING'`,
        [attempt.application_id]
      );
    }

    // Deleting the open attempt does not by itself change a vehicle's standing
    // (only finalized attempts feed refreshVehicleEligibility), but recompute so
    // verification_status/reasons reflect the current finalized-attempt set.
    const eligibility = await refreshVehicleEligibility(conn, attempt.vehicle_id);

    await logAudit({
      userId: actorUserId,
      action: 'DELETE',
      entityType: 'inspection_attempt',
      entityId: String(attemptId),
      oldValue: {
        result: 'IN_PROGRESS',
        application_id: attempt.application_id,
        application_status: attempt.application_status,
        inspected_by: attempt.inspected_by,
        inspection_date: isoDate(attempt.inspection_date),
        started_at: attempt.started_at,
      },
      newValue: {
        aborted: true,
        application_status: revertedStatus,
        ...(isAdmin ? { admin_override: true } : {}),
        ...(reason ? { reason } : {}),
        eligibility,
      },
      conn,
    });
    await conn.commit();
    return {
      attempt_id: Number(attemptId),
      application_id: Number(attempt.application_id),
      application_status: revertedStatus,
      eligibility,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}


// ─── Role Inversion: Driver-initiated applications ──────────────────────────

async function createDriverApplication(pool, {
  vehicleId,
  driverUserId,
  currentTerm = env.app.currentTerm,
}) {
  if (!vehicleId || !driverUserId) {
    throw appError('vehicleId และ driverUserId จำเป็นต้องระบุ', 400, 'MISSING_REQUIRED_FIELDS');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Verify the driver is authorized for this vehicle
    const [[vehicle]] = await conn.query(
      `SELECT v.id, v.plate_no, v.vehicle_type, v.certified_capacity,
              v.insurance_expiry, v.registration_expiry,
              v.compulsory_insurance_expiry, v.tax_expiry
         FROM vehicles v
        WHERE v.id = ? AND v.is_deleted = FALSE
        FOR UPDATE`,
      [vehicleId]
    );
    if (!vehicle) throw appError('ไม่พบรถที่ต้องการส่งตรวจ', 404, 'VEHICLE_NOT_FOUND');

    // Check driver is authorized for this vehicle
    const [[assignment]] = await conn.query(
      `SELECT dva.id, dva.assignment_role, dva.authorization_status
         FROM driver_vehicle_assignments dva
        WHERE dva.vehicle_id = ? AND dva.is_active = TRUE
          AND dva.authorization_status = 'AUTHORIZED'
          AND dva.driver_id = (
            SELECT d.id FROM drivers d
            JOIN users u ON u.driver_id = d.id
            WHERE u.id = ? AND d.is_deleted = FALSE
          )
        LIMIT 1`,
      [vehicleId, driverUserId]
    );
    if (!assignment) {
      throw appError('คุณไม่ใช่คนขับที่ได้รับอนุญาตของรถคันนี้', 403, 'DRIVER_NOT_AUTHORIZED_FOR_VEHICLE');
    }

    // Find all schools that have students riding this vehicle
    const [schools] = await conn.query(
      `SELECT s.school_id, sc.name AS school_name,
              SUM(CASE WHEN s.morning_enabled = TRUE THEN 1 ELSE 0 END) AS morning_rider_count,
              SUM(CASE WHEN s.evening_enabled = TRUE THEN 1 ELSE 0 END) AS evening_rider_count,
              MAX(s.updated_at) AS source_updated_at
         FROM students s
         JOIN schools sc ON sc.id = s.school_id AND sc.is_deleted = FALSE
        WHERE s.vehicle_id = ? AND s.is_deleted = FALSE
          AND (s.term_id = ? OR s.term_id IS NULL)
        GROUP BY s.school_id, sc.name
        ORDER BY sc.name`,
      [vehicleId, currentTerm]
    );
    if (!schools.length) throw appError('รถคันนี้ยังไม่มีข้อมูลผู้โดยสารในภาคเรียนปัจจุบัน', 400, 'NO_CURRENT_RIDERS');

    // Use the first school as issuing school (primary school)
    const issuingSchoolId = schools[0].school_id;

    // Check for active application
    const activeKey = `${vehicleId}|${currentTerm}`;
    const [[existing]] = await conn.query(
      `SELECT id, request_no, status
         FROM vehicle_inspection_applications
        WHERE active_request_key = ?
        LIMIT 1
        FOR UPDATE`,
      [activeKey]
    );
    if (existing) {
      throw appError('รถคันนี้มีคำขอส่งตรวจที่ยังดำเนินการอยู่', 409, 'ACTIVE_APPLICATION_EXISTS', {
        application_id: existing.id,
        request_no: existing.request_no,
        status: existing.status,
      });
    }

    const [drivers] = await conn.query(
      `SELECT d.id AS driver_id, d.name AS driver_name,
              dva.assignment_role, dq.qualification_status
         FROM driver_vehicle_assignments dva
         JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
         LEFT JOIN driver_qualifications dq ON dq.driver_id = d.id AND dq.is_current = TRUE
        WHERE dva.vehicle_id = ? AND dva.is_active = TRUE
          AND dva.authorization_status = 'AUTHORIZED'
        ORDER BY FIELD(dva.assignment_role, 'PRIMARY', 'BACKUP'), d.name`,
      [vehicleId]
    );

    const [routes] = await conn.query(
      `SELECT pp.label AS pickup_area, pp.session
         FROM pickup_points pp
        WHERE pp.vehicle_id = ? AND pp.is_deleted = FALSE
        ORDER BY pp.sequence, pp.id`,
      [vehicleId]
    );

    const transportSnapshot = buildTransportSnapshot({ vehicle, schools, drivers, routes });
    const requestNo = makeRequestNo();
    const qrToken = crypto.randomBytes(16).toString('hex');
    const [insert] = await conn.query(
      `INSERT INTO vehicle_inspection_applications
        (request_no, vehicle_id, issuing_school_id, requested_by, current_term,
         status, version_no, provider_type, qr_token, active_request_key,
         vehicle_snapshot_json, rider_summary_json, route_summary_json)
       VALUES (?, ?, ?, ?, ?, 'PENDING_SCHOOL_REVIEW', 1, 'DLT_OFFICER', ?, ?, ?, ?, ?)`,
      [
        requestNo, vehicleId, issuingSchoolId, driverUserId, currentTerm,
        qrToken, activeKey,
        JSON.stringify(transportSnapshot.vehicle),
        JSON.stringify({
          schools: transportSnapshot.schools,
          morning_rider_count: transportSnapshot.morning_rider_count,
          evening_rider_count: transportSnapshot.evening_rider_count,
          peak_rider_count: transportSnapshot.peak_rider_count,
          total_schools: transportSnapshot.total_schools,
        }),
        JSON.stringify({ routes: transportSnapshot.routes }),
      ]
    );

    for (const school of transportSnapshot.schools) {
      const source = schools.find((row) => String(row.school_id) === String(school.school_id));
      await conn.query(
        `INSERT INTO inspection_application_schools
          (application_id, school_id, morning_rider_count, evening_rider_count,
           peak_rider_count, source_updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [insert.insertId, school.school_id, school.morning_rider_count,
          school.evening_rider_count, school.peak_rider_count,
          source && source.source_updated_at ? source.source_updated_at : null]
      );
    }

    await logAudit({
      userId: driverUserId,
      action: 'CREATE',
      entityType: 'vehicle_inspection_application',
      entityId: String(insert.insertId),
      newValue: {
        request_no: requestNo,
        vehicle_id: vehicleId,
        issuing_school_id: issuingSchoolId,
        initiated_by: 'driver',
        total_schools: transportSnapshot.total_schools,
        peak_rider_count: transportSnapshot.peak_rider_count,
      },
      conn,
    });
    await conn.commit();

    return {
      id: insert.insertId,
      request_no: requestNo,
      status: 'PENDING_SCHOOL_REVIEW',
      vehicle_id: vehicleId,
      issuing_school_id: issuingSchoolId,
      qr_token: qrToken,
      total_schools: transportSnapshot.total_schools,
      morning_rider_count: transportSnapshot.morning_rider_count,
      evening_rider_count: transportSnapshot.evening_rider_count,
      peak_rider_count: transportSnapshot.peak_rider_count,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function listDriverApplications(pool, { driverUserId, status = null } = {}) {
  if (!driverUserId) {
    throw appError('driverUserId จำเป็นต้องระบุ', 400, 'MISSING_REQUIRED_FIELDS');
  }
  const statusSql = status ? ' AND a.status = ?' : '';
  const params = [driverUserId, ...(status ? [status] : [])];
  const [rows] = await pool.query(
    `SELECT a.*, v.plate_no, v.vehicle_type, v.verification_status,
            sc.name AS issuing_school_name
       FROM vehicle_inspection_applications a
       JOIN vehicles v ON v.id = a.vehicle_id
       JOIN schools sc ON sc.id = a.issuing_school_id
      WHERE a.requested_by = ?${statusSql}
      ORDER BY a.created_at DESC`,
    params
  );
  return rows.map(mapApplication);
}

async function reviewApplication(pool, {
  applicationId, schoolId, userId, approved, notes = null,
}) {
  if (!applicationId || !schoolId || !userId) {
    throw appError('ข้อมูลคำขอ โรงเรียน หรือผู้ใช้ไม่ครบถ้วน', 400, 'MISSING_REQUIRED_FIELDS');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[application]] = await conn.query(
      `SELECT id, request_no, status, issuing_school_id, active_request_key
         FROM vehicle_inspection_applications
        WHERE id = ?
        FOR UPDATE`,
      [applicationId]
    );
    if (!application) throw appError('ไม่พบคำขอ', 404, 'APPLICATION_NOT_FOUND');
    if (String(application.issuing_school_id) !== String(schoolId)) {
      throw appError('เฉพาะโรงเรียนผู้ออกเอกสารเท่านั้นที่ตรวจสอบได้', 403, 'ISSUING_SCHOOL_REQUIRED');
    }
    if (!['PENDING_SCHOOL_REVIEW', 'DRAFT'].includes(application.status)) {
      throw appError('สถานะคำขอปัจจุบันไม่อนุญาตให้ตรวจสอบ', 409, 'INVALID_APPLICATION_STATUS', {
        current_status: application.status,
      });
    }
    const nextStatus = approved ? 'READY_TO_PRINT' : 'REJECTED';
    await conn.query(
      `UPDATE vehicle_inspection_applications
          SET status = ?,
              ready_at = CASE WHEN ? = 'READY_TO_PRINT' THEN CURRENT_TIMESTAMP ELSE ready_at END,
              cancelled_by = CASE WHEN ? = 'REJECTED' THEN ? ELSE cancelled_by END,
              cancel_reason = CASE WHEN ? = 'REJECTED' THEN ? ELSE cancel_reason END,
              active_request_key = CASE WHEN ? = 'REJECTED' THEN NULL ELSE active_request_key END
        WHERE id = ?`,
      [nextStatus, nextStatus, nextStatus, userId, nextStatus, notes, nextStatus, applicationId]
    );
    await logAudit({
      userId,
      action: 'UPDATE',
      entityType: 'vehicle_inspection_application',
      entityId: String(applicationId),
      oldValue: { status: application.status },
      newValue: { status: nextStatus, approved, ...(notes ? { review_notes: notes } : {}) },
      conn,
    });
    await conn.commit();
    return { id: Number(applicationId), request_no: application.request_no, status: nextStatus };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}


module.exports = {
  ACTIVE_APPLICATION_STATUSES,
  FINAL_RESULTS,
  CHECK_RESULTS,
  appError,
  computeEligibility,
  buildTransportSnapshot,
  refreshVehicleEligibility,
  createApplication,
  createDriverApplication,
  listDriverApplications,
  listSchoolApplications,
  getApplication,
  listTransportQueue,
  markReadyToPrint,
  cancelApplication,
  reviewApplication,
  validateChecklistResults,
  listChecklistTemplates,
  startInspection,
  finalizeInspection,
  abortInspectionAttempt,
};
