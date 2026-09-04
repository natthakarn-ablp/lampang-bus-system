'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const ExcelJS = require('exceljs');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { readIdParam } = require('../utils/pathParams');
const { pool } = require('../config/database');
const { logAudit } = require('../utils/audit');
const env     = require('../config/env');
const { getCurrentTermCachedSync } = require('../services/term.service');
const { importExportLimiter, exportFormatLimiter } = require('../middleware/rateLimiters');
const schoolSvc = require('../services/school.service');
const leaveSvc = require('../services/leave.service');
const { classifyStudentImport } = require('../utils/studentImport');
const { isOle2, isAllowedImport } = require('../utils/fileType');
const { decodeCsvBuffer } = require('../utils/readCsvWithEncoding');
const { parseCsvRecords } = require('../utils/csv');
const { readWorkbookSafely } = require('../utils/xlsxPreflight');
const rosterReqSvc = require('../services/rosterRequest.service');
const ppSvc = require('../services/pickupPoint.service');
const vllSvc = require('../services/vehicleLocation.service');
const checkinSvc = require('../services/checkin.service');

/**
 * Minimal RFC 4180 CSV parser — handles quoted fields with embedded commas
 * and escaped double-quotes ("" inside a quoted field). Replaces the old
 * split(',') which broke on any field containing a comma.
 * @param {string} text
 * @returns {string[][]} array of rows, each an array of field strings
 */
function parseCsv(text) {
  return parseCsvRecords(text);
}

/**
 * Resolve school scope: admin uses ?school_id query param, school role uses scopeId.
 * Returns null if admin doesn't specify (for list-all queries).
 */
function resolveSchoolId(req) {
  if (req.user.role === 'admin') return req.query.school_id || req.body?.school_id || null;
  return req.user.scopeId;
}

// Phase 7.11.5 — extracted into shared util so admin.routes.js can
// use the same whitelist.
const { VALID_GRADE_SCOPES, isValidGradeScope, gradeEquivalents } = require('../utils/gradeScope');
const { todayBangkok, toBangkokDate } = require('../utils/thaiTime');

/**
 * Resolve grade scope for a school-scoped request.
 *
 * Behaviour:
 *   • Teacher sub-account (role='school' + grade_scope set) → that
 *     grade (Thai canonical, e.g. 'ป.4'). The JWT carries the value.
 *   • School main account (role='school' + grade_scope null) → null
 *     (no grade filter; see full school).
 *   • Admin → ?grade= or ?grade_scope= query param if it matches the
 *     canonical whitelist; otherwise null. Used for support / probes.
 *   • Any other role → null.
 *
 * Phase 7.11.2 only exposes the helper. Endpoint-level filtering
 * lands in Phase 7.11.3.
 */
function resolveGradeScope(req) {
  if (req.user.role === 'admin') {
    const q = req.query.grade || req.query.grade_scope || null;
    return VALID_GRADE_SCOPES.includes(q) ? q : null;
  }
  return req.user.gradeScope || null;
}

/**
 * Phase 7.11.3 — write-side safety net. Blocks any school-role
 * teacher (grade_scope != null) from a route. Used on every write
 * + on read endpoints that are inherently full-school (audit log,
 * unscoped vehicle dropdown, bulk import).
 *
 * Cleanly 403s with a Thai-language reason so a teacher tapping a
 * stale frontend button sees a meaningful toast — but no data leaks.
 * Full school accounts (grade_scope=null) and admin pass through
 * untouched; their existing behaviour is preserved.
 */
function requireFullSchoolScope(req, res, next) {
  if (req.user?.role === 'school' && req.user?.gradeScope) {
    return sendError(
      res,
      'บัญชีครูประจำสายชั้นเข้าถึงได้เฉพาะข้อมูลในการดูเท่านั้น',
      [],
      403
    );
  }
  next();
}

// Multer for student import uploads
const importUploadDir = path.join(__dirname, '../../uploads/imports');
if (!fs.existsSync(importUploadDir)) fs.mkdirSync(importUploadDir, { recursive: true });
const importUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, importUploadDir),
    filename: (req, file, cb) => cb(null, `import-${req.user.id}-${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ['.xlsx', '.xls', '.csv'].includes(ext));
  },
});

// multer/busboy decodes the multipart Content-Disposition filename as latin1, so
// a Thai filename arrives as mojibake ("à¹à¸…"). Re-decode latin1→utf8 to recover
// the real UTF-8 name before it is stored/shown. Safe for ASCII (identity). The
// on-disk name uses path.extname (ASCII) only, so it is unaffected.
function decodeUploadFilename(name) {
  try { return Buffer.from(String(name || ''), 'latin1').toString('utf8'); }
  catch { return String(name || ''); }
}

// Normalize phone: strip dashes, pad leading zero if Excel stripped it
function normalizePhone(raw) {
  if (!raw) return raw;
  let stripped = String(raw).replace(/-/g, '').trim();
  // Thai mobile numbers: if 9 digits starting with 8 or 9, Excel likely stripped leading 0
  if (/^\d{9}$/.test(stripped) && (stripped[0] === '8' || stripped[0] === '9')) {
    stripped = '0' + stripped;
  }
  return stripped;
}

const { csvCell, redactAuditValue } = require('../utils/exportSecurity');
const { rejectOverLongFields } = require('../utils/fieldLength');

// Shared CSV helper for audit export
function auditRowsToCsv(rows) {
  const ACTION_TH = { CREATE: 'สร้าง', UPDATE: 'แก้ไข', DELETE: 'ลบ', EXPORT: 'ส่งออก', LOGIN: 'เข้าสู่ระบบ', IMPORT: 'นำเข้า', APPROVE: 'อนุมัติ' };
  const ENTITY_TH = { student: 'นักเรียน', vehicle: 'รถรับส่ง', user: 'บัญชีผู้ใช้', roster_request: 'คำขอรายชื่อ', leave: 'การลา', checkin: 'เช็กอิน', checkin_override: 'ยืนยันแทนคนขับ' };
  // Phase 10.12G — neutralise every cell + redact PII from audit values.
  const esc = csvCell;
  const header = 'วันเวลา,ผู้ดำเนินการ,บทบาท,การกระทำ,ประเภท,รหัส,ค่าเดิม,ค่าใหม่';
  const lines = rows.map(r => [
    esc(new Date(r.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })),
    esc(r.actor_name || '-'),
    esc(r.actor_role || '-'),
    esc(ACTION_TH[r.action] || r.action),
    esc(ENTITY_TH[r.entity_type] || r.entity_type || '-'),
    esc(r.entity_id || '-'),
    esc(r.old_value ? redactAuditValue(r.old_value) : '-'),
    esc(r.new_value ? redactAuditValue(r.new_value) : '-'),
  ].join(','));
  return [header, ...lines].join('\n');
}

// All school routes require authentication + role 'school' or 'admin'
router.use(authenticate, requireRole('school', 'admin'));

/**
 * GET /api/school/dashboard
 * Dashboard summary for the school user's own school.
 */
router.get('/dashboard', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียนที่ผูกกับบัญชีนี้', [], req.user.role === 'admin' ? 400 : 403);
    const gradeFilter = resolveGradeScope(req);
    const data = await schoolSvc.getDashboard(schoolId, { gradeFilter });
    return sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/school/students
 * Search/list students for the school with optional filters.
 * Query params: search, grade, vehicle_id, morning_enabled, evening_enabled, page, per_page, sort, order
 */
// ─── GET /no-show ─── students who should have boarded but did not (no CHECKED_IN),
// excluding those on leave. Reliable (CHECKED_IN ~90%+), unlike checkout. ?session=morning|evening&date=YYYY-MM-DD
router.get('/no-show', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const session = req.query.session === 'evening' ? 'evening' : 'morning';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
    // AUD-004 — this was the one read on the router that consulted neither
    // resolveGradeScope nor requireFullSchoolScope, so a teacher pinned to one
    // grade could name every child school-wide who missed the bus, on any date.
    const gradeFilter = resolveGradeScope(req);
    const students = await checkinSvc.getNoShowStudents(pool, { schoolId, session, date, gradeFilter });
    return sendSuccess(res, { session, date: date || 'today', count: students.length, students, grade_scope: gradeFilter || null });
  } catch (err) { next(err); }
});

router.get('/students', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);

    const { search, grade, vehicle_id, has_vehicle, morning_enabled, evening_enabled, sort, order } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));
    const include_deleted = req.query.include_deleted === '1' || req.query.include_deleted === 'true';
    const only_deleted = req.query.only_deleted === '1' || req.query.only_deleted === 'true';

    const gradeFilter = resolveGradeScope(req);
    const result = await schoolSvc.getStudents(schoolId, {
      search, grade, vehicle_id, has_vehicle, morning_enabled, evening_enabled,
      page, per_page, sort, order, gradeFilter, include_deleted, only_deleted,
    });

    return sendSuccess(res, result.students, 'OK', result.meta);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/school/vehicles
 * Vehicles serving this school with driver info and student count.
 */
router.get('/vehicles', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const gradeFilter = resolveGradeScope(req);
    const vehicles = await schoolSvc.getVehicles(schoolId, { gradeFilter });
    return sendSuccess(res, vehicles);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/school/status-today
 * Today's checkin/checkout status for all students, grouped by vehicle.
 */
router.get('/status-today', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const gradeFilter = resolveGradeScope(req);
    const data = await schoolSvc.getStatusToday(schoolId, { gradeFilter });
    return sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/school/pickup-points
 * Phase 6: read-only list of pickup points serving this school's roster,
 * with the assigned students embedded per point. Cross-school students
 * at the same physical point are NOT exposed (filtered defensively in
 * the inner SQL by school_id).
 *
 * Optional ?session=morning|evening narrows to that session.
 */
router.get('/pickup-points', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);

    const session = req.query.session;
    if (session && !['morning', 'evening'].includes(session)) {
      return sendError(res, "session must be 'morning' or 'evening'", [], 400);
    }

    const gradeFilter = resolveGradeScope(req);
    const points = await ppSvc.getPickupPointsForSchool(schoolId, { session, gradeFilter });
    return sendSuccess(res, points);
  } catch (err) { next(err); }
});

/**
 * GET /api/school/pickup-vehicles
 * Phase 6.1: lightweight list of vehicles that serve this school's
 * roster — populates the create-pickup modal's vehicle dropdown.
 * Returns only id + plate_no + student_count (no PII).
 */
router.get('/pickup-vehicles', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);

    const gradeFilter = resolveGradeScope(req);
    const vehicles = await ppSvc.getVehiclesForSchool(schoolId, { gradeFilter });
    return sendSuccess(res, vehicles);
  } catch (err) { next(err); }
});

/**
 * GET /api/school/pickup-students?vehicle_id=...
 * Phase 6.1: lightweight student roster filtered by school + vehicle —
 * populates the create-pickup modal's student checklist after the
 * school user picks a vehicle. Cross-school students are NOT exposed
 * (the SQL filters by school_id AND vehicle_id together).
 */
router.get('/pickup-students', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);

    const vehicleId = req.query.vehicle_id;
    if (!vehicleId) return sendError(res, 'vehicle_id required', [], 400);

    // Phase 6.1 hotfix-4: optional ?session filter excludes students
    // already assigned on this vehicle with a conflicting session.
    const session = req.query.session;
    if (session && !['morning', 'evening', 'both'].includes(session)) {
      return sendError(res, "session must be 'morning', 'evening', or 'both'", [], 400);
    }

    const gradeFilter = resolveGradeScope(req);
    const students = await ppSvc.getStudentsForSchoolAndVehicle(schoolId, vehicleId, { session, gradeFilter });
    return sendSuccess(res, students);
  } catch (err) { next(err); }
});

/**
 * POST /api/school/pickup-points
 * Phase 6.1: school creates a pickup point for a vehicle that serves
 * its roster, optionally assigning students in one atomic transaction.
 *
 * Scope enforcement:
 *  - vehicle_id must serve at least one student in this school
 *    (validateVehicleServesSchool)
 *  - every student_id must belong to this school AND this vehicle
 *    (validateStudentsBelongToSchoolAndVehicle)
 */
router.post('/pickup-points', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);

    // Input validation
    const errors = [];
    if (!req.body.vehicle_id) errors.push({ field: 'vehicle_id', message: 'vehicle_id required' });
    if (!req.body.label || String(req.body.label).trim().length === 0) {
      errors.push({ field: 'label', message: 'label required' });
    } else if (String(req.body.label).length > 100) {
      errors.push({ field: 'label', message: 'label must be ≤ 100 chars' });
    }
    const lat = parseFloat(req.body.latitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      errors.push({ field: 'latitude', message: 'latitude must be a number in [-90, 90]' });
    }
    const lng = parseFloat(req.body.longitude);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      errors.push({ field: 'longitude', message: 'longitude must be a number in [-180, 180]' });
    }
    if (req.body.session && !['morning', 'evening', 'both'].includes(req.body.session)) {
      errors.push({ field: 'session', message: "session must be 'morning', 'evening', or 'both'" });
    }
    if (errors.length > 0) return sendError(res, 'ข้อมูลไม่ถูกต้อง', errors, 400);

    // Scope: vehicle must serve this school
    const ok = await ppSvc.validateVehicleServesSchool(req.body.vehicle_id, schoolId);
    if (!ok) return sendError(res, 'รถคันนี้ไม่ได้ให้บริการโรงเรียนนี้', [], 400);

    const studentIds = Array.isArray(req.body.student_ids)
      ? req.body.student_ids.map(Number).filter(Number.isInteger)
      : [];

    if (studentIds.length > 0) {
      const studentsOk = await ppSvc.validateStudentsBelongToSchoolAndVehicle(
        studentIds, schoolId, req.body.vehicle_id
      );
      if (!studentsOk) return sendError(res, 'นักเรียนบางรายไม่ใช่ของโรงเรียนหรือรถคันนี้', [], 400);

      // Phase 6.1 hotfix-4: server-side duplicate-assignment guard.
      // Same vehicle/session conflict logic as the driver POST flow.
      const noDup = await ppSvc.validateNoDuplicateAssignmentsForVehicle(
        studentIds, req.body.vehicle_id, req.body.session || 'both'
      );
      if (!noDup) return sendError(res, 'นักเรียนบางรายมีจุดรับส่งในรอบนี้แล้ว', [], 400);
    }

    const id = await ppSvc.createPickupPointWithStudents(req.body, studentIds, {
      actorId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, { id }, 'สร้างจุดรับส่งสำเร็จ', null, 201);
  } catch (err) { next(err); }
});

// ─── DELETE /pickup-points/:id — ลบจุดรับส่งของรถที่ให้บริการโรงเรียนนี้ ──────────
// School self-service cleanup of an obsolete pickup point (soft-delete).
router.delete('/pickup-points/:id', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const id = readIdParam(req, res, 'id');
    if (id === null) return;

    const point = await ppSvc.getPickupPointById(id);
    if (!point) return sendError(res, 'ไม่พบจุดรับส่ง', [], 404);
    // Scope: the point's vehicle must serve this school
    const serves = await ppSvc.validateVehicleServesSchool(point.vehicle_id, schoolId);
    if (!serves) return sendError(res, 'จุดรับส่งนี้ไม่ได้อยู่ในขอบเขตโรงเรียนของท่าน', [], 403);

    await ppSvc.softDeletePickupPoint(id);
    await logAudit({
      userId: req.user.id, action: 'DELETE', entityType: 'pickup_point', entityId: id,
      oldValue: { vehicle_id: point.vehicle_id, label: point.label, latitude: point.latitude, longitude: point.longitude },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, null, 'ลบจุดรับส่งสำเร็จ');
  } catch (err) { next(err); }
});

/**
 * GET /api/school/pickup-points/:id/assignable-students
 * Phase 6.1 hotfix-7: edit-students modal feed. Returns the school's
 * roster on this point's vehicle, filtered to students that can be
 * checked into THIS point. Students currently on this point are
 * included with currently_assigned=true so the modal pre-checks them;
 * students locked to OTHER conflicting points are excluded.
 */
router.get('/pickup-points/:id/assignable-students', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);

    const pointId = readIdParam(req, res, 'id');
    if (pointId === null) return;

    const point = await ppSvc.getPickupPointById(pointId);
    if (!point) return sendError(res, 'ไม่พบจุดรับส่ง', [], 404);

    const vehicleOk = await ppSvc.validateVehicleServesSchool(point.vehicle_id, schoolId);
    if (!vehicleOk) return sendError(res, 'จุดรับส่งนี้ไม่ใช่ของโรงเรียนคุณ', [], 403);

    const gradeFilter = resolveGradeScope(req);
    const students = await ppSvc.getAssignableStudentsForPickupPoint(point, { schoolId, gradeFilter });
    return sendSuccess(res, { point, students });
  } catch (err) { next(err); }
});

/**
 * PUT /api/school/pickup-points/:id/students
 * Phase 6.1 hotfix-7: replace the student list of a pickup point.
 * Validations:
 *   - point must belong to a vehicle serving this school
 *   - every student_id must belong to this school AND that vehicle
 *   - no conflicts with OTHER pickup points (excludes self-point)
 */
router.put('/pickup-points/:id/students', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);

    const pointId = readIdParam(req, res, 'id');
    if (pointId === null) return;

    if (!Array.isArray(req.body.student_ids)) {
      return sendError(res, 'student_ids must be an array', [], 400);
    }
    const studentIds = req.body.student_ids.map(Number).filter(Number.isInteger);

    const point = await ppSvc.getPickupPointById(pointId);
    if (!point) return sendError(res, 'ไม่พบจุดรับส่ง', [], 404);

    const vehicleOk = await ppSvc.validateVehicleServesSchool(point.vehicle_id, schoolId);
    if (!vehicleOk) return sendError(res, 'จุดรับส่งนี้ไม่ใช่ของโรงเรียนคุณ', [], 403);

    if (studentIds.length > 0) {
      const studentsOk = await ppSvc.validateStudentsBelongToSchoolAndVehicle(
        studentIds, schoolId, point.vehicle_id
      );
      if (!studentsOk) return sendError(res, 'นักเรียนบางรายไม่ใช่ของโรงเรียนหรือรถคันนี้', [], 400);

      const noDup = await ppSvc.validateNoDuplicateAssignmentsForVehicle(
        studentIds, point.vehicle_id, point.session, { excludePointId: pointId }
      );
      if (!noDup) return sendError(res, 'นักเรียนบางรายมีจุดรับส่งในรอบนี้แล้ว', [], 400);
    }

    const result = await ppSvc.replacePickupPointStudents(pointId, studentIds, {
      actorId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      // Audit 2026-06-18 (authz-scope): only this school's students may be
      // removed from a shared point — other schools' rows are preserved.
      restrictToSchoolId: schoolId,
    });

    return sendSuccess(res, result, 'อัปเดตรายชื่อนักเรียนสำเร็จ');
  } catch (err) { next(err); }
});

/**
 * GET /api/school/emergencies
 * Emergency logs for vehicles serving this school.
 * Query params: page, per_page
 */
router.get('/emergencies', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));

    const gradeFilter = resolveGradeScope(req);
    const result = await schoolSvc.getEmergencies(schoolId, { page, per_page, gradeFilter });
    return sendSuccess(res, result.emergencies, 'OK', result.meta);
  } catch (err) {
    next(err);
  }
});

// ─── GET /missing ────────────────────────────────────────────────────────────

router.get('/missing', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const session = req.query.session; // optional: morning | evening
    const gradeFilter = resolveGradeScope(req);
    // Tolerant match, like every other grade filter in the school module. An
    // exact `= ?` here hides a teacher's own pupils whenever their grade is
    // stored in a variant spelling — the divergence gradeScopeCounts.test.js
    // exists to catch, and the direction that fails silently.
    const eqGrades = gradeFilter ? gradeEquivalents(gradeFilter) : null;
    const gradeAnd  = eqGrades ? ` AND s.grade IN (${eqGrades.map(() => '?').join(',')})` : '';
    const baseParams = [today, today, session || 'morning', schoolId];
    if (eqGrades) baseParams.push(...eqGrades);
    baseParams.push(session, session, session);

    const [rows] = await pool.query(
      `SELECT s.id, CONCAT(IFNULL(s.prefix,''), s.first_name, ' ', s.last_name) AS student_name,
              s.grade, s.classroom, s.vehicle_id, v.plate_no,
              s.morning_enabled, s.evening_enabled,
              ds.morning_done, ds.evening_done
       FROM students s
       LEFT JOIN vehicles v ON v.id = s.vehicle_id
       LEFT JOIN daily_status ds ON ds.student_id = s.id AND ds.check_date = ?
       LEFT JOIN student_leaves sl ON sl.student_id = s.id AND sl.leave_date = ? AND sl.cancelled = FALSE
         AND (sl.session = 'both' OR sl.session = ?)
       WHERE s.school_id = ? AND s.is_deleted = FALSE AND sl.id IS NULL${gradeAnd}
         AND ((? = 'morning' AND s.morning_enabled = TRUE AND (ds.morning_done IS NULL OR ds.morning_done = FALSE))
           OR (? = 'evening' AND s.evening_enabled = TRUE AND (ds.evening_done IS NULL OR ds.evening_done = FALSE))
           OR (? IS NULL AND (
             (s.morning_enabled = TRUE AND (ds.morning_done IS NULL OR ds.morning_done = FALSE))
             OR (s.evening_enabled = TRUE AND (ds.evening_done IS NULL OR ds.evening_done = FALSE))
           )))
       ORDER BY v.plate_no, s.first_name`,
      baseParams
    );
    return sendSuccess(res, { date: today, session: session || 'all', students: rows });
  } catch (err) { next(err); }
});

// ─── GET /leaves ─────────────────────────────────────────────────────────────

router.get('/leaves', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const date = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const gradeFilter = resolveGradeScope(req);
    const leaves = await leaveSvc.getLeavesForSchool(schoolId, date, { gradeFilter });
    return sendSuccess(res, leaves);
  } catch (err) { next(err); }
});

// ─── POST /leave ─────────────────────────────────────────────────────────────

router.post('/leave', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const { student_id, vehicle_id, leave_date, session, reason } = req.body;
    if (!student_id || !session) return sendError(res, 'student_id and session are required', [], 400);

    // Verify student belongs to this school
    const [[st]] = await pool.query(
      `SELECT vehicle_id FROM students WHERE id = ? AND school_id = ? AND is_deleted = FALSE`, [student_id, schoolId]
    );
    if (!st) return sendError(res, 'ไม่พบนักเรียนในโรงเรียนนี้', [], 404);

    const date = leave_date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const result = await leaveSvc.createLeave({
      studentId: student_id, vehicleId: vehicle_id || st.vehicle_id,
      leaveDate: date, session, reason, userId: req.user.id, userRole: 'school',
    });
    return sendSuccess(res, result, 'บันทึกการลาสำเร็จ', null, 201);
  } catch (err) { next(err); }
});

// ─── DELETE /leaves/:id — ยกเลิกการลาที่บันทึกผิด (ในขอบเขตโรงเรียน) ─────────────
router.delete('/leaves/:id', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const id = readIdParam(req, res, 'id');
    if (id === null) return;
    const result = await leaveSvc.cancelLeaveBySchool(id, req.user.id, schoolId);
    return sendSuccess(res, result, 'ยกเลิกการลาสำเร็จ');
  } catch (err) { next(err); }
});

// ─── POST /checkin-override ──────────────────────────────────────────────────
// Phase 10.8B — school confirms attendance on behalf of the driver.
// Reuses driver checkin transaction + appends an extra audit row
// (entity_type='checkin_override'). Grade-scoped teachers are blocked.

router.post('/checkin-override', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) {
      return sendError(
        res,
        req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียนที่ผูกกับบัญชีนี้',
        [],
        req.user.role === 'admin' ? 400 : 403
      );
    }

    const { student_id, session, status, reason } = req.body || {};
    const errors = [];
    const sid = Number.parseInt(student_id, 10);
    if (!Number.isInteger(sid) || sid <= 0) {
      errors.push({ field: 'student_id', message: 'student_id จำเป็นต้องระบุ' });
    }
    if (!['morning', 'evening'].includes(session)) {
      errors.push({ field: 'session', message: "session ต้องเป็น 'morning' หรือ 'evening'" });
    }
    const finalStatus = status || 'CHECKED_IN';
    if (!['CHECKED_IN', 'CHECKED_OUT'].includes(finalStatus)) {
      errors.push({ field: 'status', message: "status ต้องเป็น 'CHECKED_IN' หรือ 'CHECKED_OUT'" });
    }
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmedReason) {
      errors.push({ field: 'reason', message: 'กรุณาระบุเหตุผลการยืนยันแทน' });
    } else if (trimmedReason.length > 500) {
      errors.push({ field: 'reason', message: 'เหตุผลต้องไม่เกิน 500 ตัวอักษร' });
    }
    if (errors.length) {
      return sendError(res, 'ข้อมูลไม่ครบถ้วน', errors, 400);
    }

    const result = await checkinSvc.processSchoolOverride(pool, {
      userId:          req.user.id,
      userRole:        req.user.role,
      userDisplayName: req.user.displayName || req.user.username || null,
      ipAddress:       req.ip,
      userAgent:       req.headers['user-agent'],
      schoolId,
      studentId:       sid,
      session,
      status:          finalStatus,
      reason:          trimmedReason,
    });

    return sendSuccess(res, result, 'ยืนยันการรับ-ส่งสำเร็จ', null, 201);
  } catch (err) { next(err); }
});

// ─── POST /checkin-override/all ──────────────────────────────────────────────
// School confirms a whole session on behalf of the driver, ticking only the
// pupils who did NOT board. Everyone else eligible is confirmed present.
// Same guard as the single-student path: grade-scoped teachers are blocked.

router.post('/checkin-override/all', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) {
      return sendError(
        res,
        req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียนที่ผูกกับบัญชีนี้',
        [],
        req.user.role === 'admin' ? 400 : 403
      );
    }

    const { session, status, reason, absent_student_ids } = req.body || {};
    const errors = [];
    if (!['morning', 'evening'].includes(session)) {
      errors.push({ field: 'session', message: "session ต้องเป็น 'morning' หรือ 'evening'" });
    }
    const finalStatus = status || 'CHECKED_IN';
    if (!['CHECKED_IN', 'CHECKED_OUT'].includes(finalStatus)) {
      errors.push({ field: 'status', message: "status ต้องเป็น 'CHECKED_IN' หรือ 'CHECKED_OUT'" });
    }
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmedReason) {
      errors.push({ field: 'reason', message: 'กรุณาระบุเหตุผลการยืนยันแทน' });
    } else if (trimmedReason.length > 500) {
      errors.push({ field: 'reason', message: 'เหตุผลต้องไม่เกิน 500 ตัวอักษร' });
    }
    // Cap the exception list. It names pupils who will NOT be confirmed, so an
    // unbounded array is a way to make the request do nothing while looking
    // like it worked; a school roster never legitimately needs more than this.
    if (absent_student_ids !== undefined) {
      if (!Array.isArray(absent_student_ids)) {
        errors.push({ field: 'absent_student_ids', message: 'absent_student_ids ต้องเป็น array' });
      } else if (absent_student_ids.length > 2000) {
        errors.push({ field: 'absent_student_ids', message: 'รายชื่อที่ไม่ยืนยันยาวเกินกำหนด' });
      }
    }
    if (errors.length) return sendError(res, 'ข้อมูลไม่ครบถ้วน', errors, 400);

    const result = await checkinSvc.processSchoolOverrideAll(pool, {
      userId:          req.user.id,
      userRole:        req.user.role,
      userDisplayName: req.user.displayName || req.user.username || null,
      ipAddress:       req.ip,
      userAgent:       req.headers['user-agent'],
      schoolId,
      session,
      status:            finalStatus,
      reason:            trimmedReason,
      absentStudentIds:  absent_student_ids || [],
    });

    return sendSuccess(
      res,
      result,
      `ยืนยันการรับ-ส่งแล้ว ${result.confirmed_count} คน · ไม่ยืนยัน ${result.absent_marked_count} คน`,
      null,
      201
    );
  } catch (err) { next(err); }
});

// ─── GET /roster-requests ────────────────────────────────────────────────────

router.get('/roster-requests', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const gradeFilter = resolveGradeScope(req);
    const result = await rosterReqSvc.getRequestsForSchool(schoolId, {
      status: req.query.status, page, per_page: 20, gradeFilter,
    });
    return sendSuccess(res, result.requests, 'OK', result.meta);
  } catch (err) { next(err); }
});

// ─── PUT /roster-requests/:id ────────────────────────────────────────────────

router.put('/roster-requests/:id', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const requestId = readIdParam(req, res, 'id');
    if (requestId === null) return;
    const { status, review_note } = req.body;
    if (!['approved', 'rejected'].includes(status)) return sendError(res, "status ต้องเป็น 'approved' หรือ 'rejected'", [], 400);

    const result = await rosterReqSvc.reviewRequest({
      requestId,
      schoolId, status, reviewNote: review_note, userId: req.user.id,
    });
    return sendSuccess(res, result, status === 'approved' ? 'อนุมัติสำเร็จ' : 'ปฏิเสธสำเร็จ');
  } catch (err) { next(err); }
});

// ─── PUT /students/:id (update student profile + parent) ────────────────────

router.put('/students/:id', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const studentId = readIdParam(req, res, 'id');
    if (studentId === null) return;

    // Verify student belongs to this school + fetch old values for audit
    const [[st]] = await pool.query(
      `SELECT s.id, s.prefix, s.first_name, s.last_name, s.grade, s.classroom,
              s.morning_enabled, s.evening_enabled, s.dropoff_address,
              p.name AS parent_name, p.phone AS parent_phone
       FROM students s
       LEFT JOIN parent_student ps ON ps.student_id = s.id
       LEFT JOIN parents p ON p.id = ps.parent_id AND p.is_deleted = FALSE
       WHERE s.id = ? AND s.school_id = ? AND s.is_deleted = FALSE
       LIMIT 1`,
      [studentId, schoolId]
    );
    if (!st) return sendError(res, 'ไม่พบนักเรียนในโรงเรียนนี้', [], 404);

    const { prefix, first_name, last_name, grade, classroom, morning_enabled, evening_enabled, dropoff_address, parent_name, parent_phone } = req.body;

    // Validate required fields
    if (first_name !== undefined && !first_name.trim()) return sendError(res, 'กรุณากรอกชื่อนักเรียน', [], 400);
    if (last_name !== undefined && !last_name.trim()) return sendError(res, 'กรุณากรอกนามสกุลนักเรียน', [], 400);
    // Normalize phone (strip dashes) before validation
    const normalizedParentPhone = parent_phone !== undefined ? normalizePhone(parent_phone) : undefined;
    if (normalizedParentPhone && !/^\d{9,10}$/.test(normalizedParentPhone)) {
      return sendError(res, 'เบอร์โทรผู้ปกครองต้องเป็นตัวเลข 9-10 หลัก (รองรับรูปแบบ 0XX-XXXXXXX)', [], 400);
    }
    // Audit 2026-06-18 (limitations): reject over-length values with a clean 400
    // instead of letting MySQL raise a 500 on column overflow. parent_name is in
    // the list because this handler inserts it into parents.name (varchar 100)
    // further down — a different table from the rest.
    if (rejectOverLongFields(res, req.body, {
      prefix: 20, first_name: 100, last_name: 100, grade: 20, classroom: 20, parent_name: 100,
    })) return;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1. Update student fields
      const updates = [];
      const params = [];
      if (prefix !== undefined) { updates.push('prefix = ?'); params.push(prefix || null); }
      if (first_name !== undefined) { updates.push('first_name = ?'); params.push(first_name); }
      if (last_name !== undefined) { updates.push('last_name = ?'); params.push(last_name); }
      if (grade !== undefined) { updates.push('grade = ?'); params.push(grade || null); }
      if (classroom !== undefined) { updates.push('classroom = ?'); params.push(classroom || null); }
      if (morning_enabled !== undefined) { updates.push('morning_enabled = ?'); params.push(morning_enabled ? 1 : 0); }
      if (evening_enabled !== undefined) { updates.push('evening_enabled = ?'); params.push(evening_enabled ? 1 : 0); }
      if (dropoff_address !== undefined) { updates.push('dropoff_address = ?'); params.push(dropoff_address || null); }

      if (updates.length > 0) {
        params.push(studentId);
        await conn.query(`UPDATE students SET ${updates.join(', ')} WHERE id = ?`, params);
      }

      // 2. Parent reassignment (Phase 10.3E final rule).
      //
      // Business rule: a student-parent link is defined by
      //   (student_id, parent_phone)  — and indirectly parent_name.
      // ANY change to the submitted name or phone is treated as a per-student
      // parent reassignment: detach this student only, create a NEW parent
      // row, and link. The shared parent master is NEVER UPDATEd from the
      // student-edit flow — that prevented the household-cascade bug where
      // editing one student silently changed every sibling that shared the
      // same parent record.
      //
      // QA invariants (Phase 10.3E hardening):
      //   • Old parent row is preserved (other students keep their link)
      //   • line_user_id is NOT carried to the new parent row
      //   • New parent row is created fresh — no phone-based reuse that
      //     would merge this student into an unrelated household
      let parentReassigned = false;
      if (parent_name !== undefined || normalizedParentPhone !== undefined) {
        const [[currentLink]] = await conn.query(
          `SELECT ps.parent_id, p.name AS current_name, p.phone AS current_phone
           FROM   parent_student ps
           JOIN   parents p ON p.id = ps.parent_id AND p.is_deleted = FALSE
           WHERE  ps.student_id = ?
           LIMIT  1`,
          [studentId]
        );

        // Resolve effective new identity (submitted fields override current
        // for what's actually sent; missing fields fall through unchanged).
        const newName  = parent_name !== undefined
          ? (parent_name ? String(parent_name).trim() : null)
          : (currentLink?.current_name || null);
        const newPhone = normalizedParentPhone !== undefined
          ? (normalizedParentPhone || null)
          : (currentLink?.current_phone || null);

        const noChange = currentLink
          && (newName  || '') === (currentLink.current_name  || '')
          && (newPhone || '') === (currentLink.current_phone || '');

        if (!noChange && (newName || newPhone)) {
          // Detach this student from current parent (preserve old parent row
          // and any sibling links that point to it).
          if (currentLink) {
            await conn.query(
              `DELETE FROM parent_student WHERE student_id = ?`,
              [studentId]
            );
          }
          // ALWAYS INSERT a fresh parent row — never look up by phone.
          const [r] = await conn.query(
            `INSERT INTO parents (name, phone) VALUES (?, ?)`,
            [newName, newPhone]
          );
          const newParentId = r.insertId;
          await conn.query(
            `INSERT INTO parent_student (parent_id, student_id, approved, approved_by, approved_at)
             VALUES (?, ?, TRUE, ?, NOW())
             ON DUPLICATE KEY UPDATE approved = TRUE`,
            [newParentId, studentId, req.user.id]
          );
          parentReassigned = true;
        }
      }

      // 3. Build changed-fields audit (only log fields that actually changed)
      const auditFields = { prefix, first_name, last_name, grade, classroom, morning_enabled, evening_enabled, parent_name, parent_phone: normalizedParentPhone };
      const oldMap = {
        prefix: st.prefix, first_name: st.first_name, last_name: st.last_name,
        grade: st.grade, classroom: st.classroom,
        morning_enabled: !!st.morning_enabled, evening_enabled: !!st.evening_enabled,
        parent_name: st.parent_name, parent_phone: st.parent_phone,
      };
      const oldValue = {};
      const newValue = {};
      for (const [k, v] of Object.entries(auditFields)) {
        if (v === undefined) continue; // field not sent in request
        const oldV = oldMap[k];
        const newV = (typeof v === 'boolean') ? v : (v || null);
        if (String(oldV ?? '') !== String(newV ?? '')) {
          oldValue[k] = oldV ?? null;
          newValue[k] = newV;
        }
      }

      if (Object.keys(newValue).length > 0) {
        await logAudit({
          userId: req.user.id, action: 'UPDATE', entityType: 'student', entityId: studentId,
          oldValue, newValue,
          ipAddress: req.ip, userAgent: req.headers['user-agent'], conn,
        });
      }

      await conn.commit();
      // parent_reassigned tells the UI to surface a "ผู้ปกครองใหม่ยังไม่ได้
      // ผูกบัญชี LINE" notice — a freshly-created parent row never carries
      // a line_user_id, so the message is unconditional when this flag is true.
      return sendSuccess(res, {
        student_id: studentId,
        parent_reassigned: parentReassigned,
      }, 'บันทึกข้อมูลนักเรียนเรียบร้อยแล้ว');
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) { next(err); }
});

// ─── POST /students/move ─────────────────────────────────────────────────────

router.post('/students/move', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const { student_id, vehicle_id } = req.body;
    if (!student_id) return sendError(res, 'student_id is required', [], 400);

    const [[st]] = await pool.query(
      `SELECT s.id, s.vehicle_id, s.grade, s.classroom, v.plate_no
       FROM students s LEFT JOIN vehicles v ON v.id = s.vehicle_id
       WHERE s.id = ? AND s.school_id = ? AND s.is_deleted = FALSE`, [student_id, schoolId]
    );
    if (!st) return sendError(res, 'ไม่พบนักเรียนในโรงเรียนนี้', [], 404);

    if (vehicle_id) {
      const [[veh]] = await pool.query('SELECT id FROM vehicles WHERE id = ? AND is_deleted = FALSE', [vehicle_id]);
      if (!veh) return sendError(res, 'ไม่พบรถที่ระบุ', [], 404);
    }

    await pool.query(`UPDATE students SET vehicle_id = ? WHERE id = ?`, [vehicle_id || null, student_id]);

    await logAudit({
      userId: req.user.id, action: 'UPDATE', entityType: 'student', entityId: student_id,
      oldValue: { vehicle_id: st.vehicle_id, plate_no: st.plate_no, grade: st.grade, classroom: st.classroom },
      newValue: { vehicle_id: vehicle_id || null, action: 'move_vehicle' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, { student_id, vehicle_id: vehicle_id || null }, 'ย้ายรถสำเร็จ');
  } catch (err) { next(err); }
});

// ─── DELETE /students/:id (soft delete — ลาออก) ─────────────────────────────

router.delete('/students/:id', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const studentId = readIdParam(req, res, 'id');
    if (studentId === null) return;

    const [[st]] = await pool.query(
      `SELECT s.id, s.prefix, s.first_name, s.last_name, s.grade, s.classroom,
              s.vehicle_id, v.plate_no
       FROM students s
       LEFT JOIN vehicles v ON v.id = s.vehicle_id
       WHERE s.id = ? AND s.school_id = ? AND s.is_deleted = FALSE`,
      [studentId, schoolId]
    );
    if (!st) return sendError(res, 'ไม่พบนักเรียนในโรงเรียนนี้', [], 404);

    await pool.query(
      `UPDATE students SET is_deleted = TRUE, deleted_at = NOW(), vehicle_id = NULL WHERE id = ?`,
      [studentId]
    );

    await logAudit({
      userId: req.user.id, action: 'DELETE', entityType: 'student', entityId: studentId,
      oldValue: {
        student_name: `${st.prefix || ''}${st.first_name} ${st.last_name}`,
        grade: st.grade, classroom: st.classroom,
        vehicle_id: st.vehicle_id, plate_no: st.plate_no,
      },
      newValue: { action: 'withdraw', is_deleted: true },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, { student_id: studentId }, 'ลบนักเรียนออกจากระบบเรียบร้อยแล้ว');
  } catch (err) { next(err); }
});

// ─── POST /students/:id/restore — กู้คืนนักเรียนที่ถูกลบ (ในขอบเขตโรงเรียน) ─────
// Reverses DELETE /students/:id (withdraw). Operators previously had to hand-run
// UPDATE students SET is_deleted=FALSE for a mis-deleted student.
router.post('/students/:id/restore', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const studentId = readIdParam(req, res, 'id');
    if (studentId === null) return;

    const result = await schoolSvc.restoreStudent(pool, {
      schoolId, studentId, actorId: req.user.id,
      ip: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, result, result.status === 'RESTORED' ? 'กู้คืนนักเรียนสำเร็จ' : 'นักเรียนรายนี้ใช้งานอยู่แล้ว');
  } catch (err) { next(err); }
});

// ─── GET /vehicles/all (for vehicle dropdown) ───────────────────────────────

router.get('/vehicles/all', requireFullSchoolScope, async (req, res, next) => {
  try {
    // Phase 10.13A-22A — include active_students so province-variant duplicates
    // (0 students, with a canonical sibling) can be marked for the UI to hide.
    const [rows] = await pool.query(
      // owner_name (a person's name) is intentionally NOT selected here: this is
      // the cross-school assignment dropdown (province-shared fleet). Plate +
      // type identify the vehicle; the owner name stays on the owning school's
      // GET /school/vehicles only (PDPA data minimization).
      `SELECT v.id, v.plate_no, v.vehicle_type,
              (SELECT COUNT(*) FROM students s
                WHERE s.vehicle_id = v.id AND COALESCE(s.is_deleted, FALSE) = FALSE) AS active_students
       FROM vehicles v WHERE v.is_deleted = FALSE ORDER BY v.plate_no`
    );
    const { annotateVehicleList } = require('../services/vehicleDedup.service');
    return sendSuccess(res, annotateVehicleList(rows));
  } catch (err) { next(err); }
});

// ─── GET /vehicles/check-plate (Phase 10.13A-15) ────────────────────────────
// Read-only duplicate preflight: warns the UI about existing exact/normalized/
// province-variant vehicles BEFORE the operator saves. Never writes.
router.get('/vehicles/check-plate', requireFullSchoolScope, async (req, res, next) => {
  try {
    const { findPlateMatches, classifyPlateAgainstDb } = require('../services/vehicleDedup.service');
    const { buildDisplayPlate } = require('../utils/plateIdentity');
    const { plate_no, plate_prefix, plate_number, province } = req.query;
    const schoolId = resolveSchoolId(req);
    // Structured fields take precedence; fall back to legacy plate_no.
    const structured = (plate_prefix != null || plate_number != null || province != null);
    const plateInput = structured ? { plate_prefix, plate_number, province } : plate_no;
    const plateStr = structured ? buildDisplayPlate(plateInput) : plate_no;

    // Phase 10.13A-25B — status comes from the deterministic, province-alias-aware
    // classification (so กทม↔กรุงเทพมหานคร dups are flagged); findPlateMatches only
    // contributes its normalized/variant candidate list.
    const classification = await classifyPlateAgainstDb(pool, plateInput, { schoolId });
    let candidates = [];
    try { candidates = (await findPlateMatches(plateStr)).candidates || []; } catch { /* invalid/ambiguous */ }
    if (classification.vehicle_id && classification.display_plate
        && !candidates.some((c) => c.plate_no === classification.display_plate)) {
      candidates = [{ plate_no: classification.display_plate, duplicate_type: classification.code }, ...candidates];
    }
    const status = classification.code === 'VALID_NEW_VEHICLE' ? 'CLEAR' : 'DUPLICATE_OR_SIMILAR';
    // Phase 10.13A-27 — don't reveal WHICH other school owns a conflicting plate
    // to a school user (the message + display_plate are enough). Admins keep it.
    if (req.user.role !== 'admin' && classification) { delete classification.school_id; delete classification.school_name; }
    return sendSuccess(res, { status, candidates, classification });
  } catch (err) { return next(err); }
});

// ─── POST /vehicles ──────────────────────────────────────────────────────────

router.post('/vehicles', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const { plate_no, plate_prefix, plate_number, plate_province, vehicle_type, driver_name, driver_phone, owner_name } = req.body;

    // Phase 10.13A-22 — prefer structured plate fields (หมวดอักษร / เลขทะเบียน /
    // จังหวัด); the backend builds the canonical display plate_no so operators
    // cannot free-type spacing/province variants. Legacy free-text plate_no is
    // still accepted for compatibility.
    const { validatePlateNo, isProvinceVariant, buildStructuredPlate } = require('../utils/vehiclePlate');
    let effectivePlateNo = plate_no;
    if (plate_prefix != null || plate_number != null || plate_province != null) {
      const built = buildStructuredPlate({ prefix: plate_prefix, number: plate_number, province: plate_province });
      if (!built.valid) return sendError(res, built.error, [{ code: built.code }], 400);
      effectivePlateNo = built.plateNo;
    }

    // Phase 10.6B — whitespace/dash-agnostic plate validation. The duplicate
    // check below uses normalized_plate, so users entering "นข 2210 ลำปาง" /
    // "นข2210ลำปาง" / "นข-2210-ลำปาง" all reuse the same vehicle row.
    const validation = validatePlateNo(effectivePlateNo);
    if (!validation.valid) return sendError(res, validation.error, [], 400);
    const { trimmed: trimmedPlate, normalized: normalizedPlate } = validation;

    const crypto = require('crypto');
    const vehicleId = 'V-' + crypto.createHash('sha256').update(trimmedPlate).digest('hex').substring(0, 12);

    const conn = await pool.getConnection();
    let driverAccountCreated = false;

    try {
      await conn.beginTransaction();

      // 1. Create or reuse vehicle (dedup by normalized_plate, not raw plate)
      const [[existingVehicle]] = await conn.query(
        `SELECT id FROM vehicles WHERE normalized_plate = ?`,
        [normalizedPlate]
      );
      const vId = existingVehicle ? existingVehicle.id : vehicleId;
      if (!existingVehicle) {
        // Phase 10.13A-25B — alias-aware conflict classification. Exact-normalized
        // reuse is handled above; here any remaining conflict is blocked, including
        // province aliases (กทม↔กรุงเทพมหานคร), soft-deleted vehicles, and
        // province-omitted/ambiguous plates — superseding the 10.13A-13 guard.
        const { classifyPlateAgainstDb } = require('../services/vehicleDedup.service');
        const conflict = await classifyPlateAgainstDb(conn, trimmedPlate, { schoolId });
        if (conflict.code !== 'VALID_NEW_VEHICLE') {
          const softOrFormat = conflict.code === 'AMBIGUOUS_PLATE_NEEDS_PROVINCE' || conflict.code === 'PLATE_FORMAT_INVALID';
          const e = new Error(conflict.message || 'พบทะเบียนรถนี้ในระบบแล้ว กรุณาตรวจสอบทะเบียนและจังหวัด');
          e.statusCode = softOrFormat ? 400 : 409;
          e.errors = [{
            code: conflict.code,
            vehicle_id: conflict.vehicle_id || null,
            existing_plate: conflict.display_plate || null,
            is_deleted: conflict.is_deleted || false,
            school_id: req.user.role === 'admin' ? (conflict.school_id || null) : null,  // 10.13A-27: hide other-school id from school users
          }];
          throw e;
        }
        // Phase 10.13B-3 — store canonical_plate so the DB unique
        // (uq_vehicles_active_canonical) enforces alias-aware identity.
        const { canonicalPlateForStorage } = require('../utils/plateIdentity');
        await conn.query(
          `INSERT INTO vehicles (id, plate_no, normalized_plate, canonical_plate, vehicle_type, owner_name) VALUES (?, ?, ?, ?, ?, ?)`,
          [vehicleId, trimmedPlate, normalizedPlate, canonicalPlateForStorage(trimmedPlate), vehicle_type || 'รถตู้', (owner_name && String(owner_name).trim().slice(0, 100)) || null]
        );
      } else if (owner_name && String(owner_name).trim()) {
        // Reusing an existing active vehicle (e.g. selectExisting): fill a BLANK
        // owner only — never clobber an owner another school may have set, since
        // the fleet is shared province-wide. slice(0,100) matches VARCHAR(100).
        await conn.query(
          `UPDATE vehicles SET owner_name = ? WHERE id = ? AND (owner_name IS NULL OR owner_name = '')`,
          [String(owner_name).trim().slice(0, 100), vId]
        );
      }

      // 2. Create/reuse driver profile + login user + assignment, with the user
      //    linked to the profile via users.driver_id (Phase 10.13A-18). Dedups
      //    the drivers profile (by phone/name) and the user (by normalized
      //    username); throws 409 DRIVER_USER_PROFILE_CONFLICT if the user is
      //    already linked to a different driver profile.
      if (driver_name) {
        const { linkOrCreateDriverForVehicle } = require('../services/driverProfile.service');
        const { userCreated } = await linkOrCreateDriverForVehicle(conn, {
          driverName: driver_name,
          driverPhone: driver_phone,
          normalizedPlate,
          plateNo: trimmedPlate,
          vehicleId: vId,
        });
        driverAccountCreated = userCreated;
      }

      await logAudit({
        userId: req.user.id, action: 'CREATE', entityType: 'vehicle', entityId: vId,
        newValue: { plate_no: trimmedPlate, normalized_plate: normalizedPlate, vehicle_type, driver_name, driverAccountCreated },
        ipAddress: req.ip, userAgent: req.headers['user-agent'], conn,
      });

      await conn.commit();

      const responseData = { vehicle_id: vId, plate_no: trimmedPlate };
      if (driverAccountCreated) {
        responseData.driver_credentials = {
          username: trimmedPlate,
          temporary_password: trimmedPlate,
          message: 'คนขับใช้ทะเบียนรถเป็นชื่อผู้ใช้และรหัสผ่านเริ่มต้น ต้องเปลี่ยนรหัสผ่านหลัง login ครั้งแรก',
        };
      }

      return sendSuccess(res, responseData,
        driverAccountCreated ? 'เพิ่มรถและสร้างบัญชีคนขับสำเร็จ' : 'เพิ่มรถสำเร็จ',
        null, 201);
    } catch (err) {
      await conn.rollback();
      // Phase 10.13B-3 — a concurrent add that raced past the code-level guard
      // hits the DB unique; map it to the same clear Thai duplicate message.
      if (err && err.code === 'ER_DUP_ENTRY' && /uq_vehicles_active_canonical/.test(err.sqlMessage || err.message || '')) {
        const e = new Error('ทะเบียนรถนี้มีอยู่ในระบบแล้ว กรุณาตรวจสอบรถเดิมก่อนเพิ่มใหม่');
        e.statusCode = 409;
        e.errors = [{ code: 'DUPLICATE_ACTIVE_VEHICLE' }];
        throw e;
      }
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) { next(err); }
});

// CS5-02 — normalise a client-supplied value into a Bangkok calendar date
// before it reaches a DATE column.
//
// The two shapes are NOT interchangeable and must not be collapsed by
// slicing. A bare 'YYYY-MM-DD' is already a calendar date, and re-parsing it
// would reinterpret it as UTC midnight and shift it back a day. Anything else
// is an instant — including the '2026-08-04T17:00:00.000Z' that a stale
// frontend bundle still sends for 2026-08-05 — and the Bangkok date of that
// instant is what belongs in the column. `toBangkokDate` is not enough on its
// own here: its date-prefix rule slices an instant string rather than
// converting it, which is the very off-by-one this route is fixing.
// Returns undefined for input that is neither, so the caller can answer 400
// rather than silently storing a wrong or NULL date.
function toCalendarDate(value) {
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return toBangkokDate(parsed);
}

// ─── PUT /vehicles/:id — แก้ไขข้อมูลรถในขอบเขตโรงเรียน (ลดการพึ่งแอดมิน) ─────────
// School self-service: edit vehicle type / owner / insurance for a vehicle that
// serves this school. Does NOT touch plate identity or driver assignment (Tier 3).
router.put('/vehicles/:id', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const vehicleId = req.params.id;

    // Scope: the vehicle must serve this school
    const serves = await ppSvc.validateVehicleServesSchool(vehicleId, schoolId);
    if (!serves) return sendError(res, 'ไม่พบรถคันนี้ในโรงเรียนของท่าน', [], 404);

    const [[old]] = await pool.query(
      `SELECT id, vehicle_type, owner_name, owner_phone, insurance_status, insurance_type, insurance_expiry
         FROM vehicles WHERE id = ? AND is_deleted = FALSE`,
      [vehicleId]
    );
    if (!old) return sendError(res, 'ไม่พบรถในระบบ', [], 404);

    const b = req.body || {};
    const sets = [], params = [], newVal = {};
    // whitelist of editable columns (column names are hardcoded → safe to interpolate)
    const strField = (key, max) => {
      if (b[key] === undefined) return;
      const v = (b[key] === null || String(b[key]).trim() === '') ? null : String(b[key]).trim().slice(0, max);
      sets.push(`${key} = ?`); params.push(v); newVal[key] = v;
    };
    strField('vehicle_type', 50);
    strField('owner_name', 100);
    strField('owner_phone', 20);
    strField('insurance_status', 50);
    strField('insurance_type', 50);
    if (b.insurance_expiry !== undefined) {
      // CS5-02 — pin the write boundary to a Bangkok calendar date so the
      // round trip through the edit form cannot walk the date backwards.
      const v = b.insurance_expiry ? toCalendarDate(b.insurance_expiry) : null;
      if (v === undefined) return sendError(res, 'รูปแบบวันหมดอายุประกันไม่ถูกต้อง', [{ field: 'insurance_expiry', message: 'ต้องเป็นวันที่ในรูปแบบ YYYY-MM-DD' }], 400);
      sets.push('insurance_expiry = ?'); params.push(v); newVal.insurance_expiry = v;
    }
    if (!sets.length) return sendError(res, 'ไม่มีข้อมูลที่ต้องแก้ไข', [], 400);

    params.push(vehicleId);
    await pool.query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = ?`, params);

    await logAudit({
      userId: req.user.id, action: 'UPDATE', entityType: 'vehicle', entityId: vehicleId,
      oldValue: {
        vehicle_type: old.vehicle_type, owner_name: old.owner_name, owner_phone: old.owner_phone,
        // CS5-02 — the audit row is the record of what the value HAD been;
        // storing the instant made it read one day early.
        insurance_status: old.insurance_status, insurance_type: old.insurance_type,
        insurance_expiry: toBangkokDate(old.insurance_expiry),
      },
      newValue: newVal, ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, { vehicle_id: vehicleId }, 'แก้ไขข้อมูลรถสำเร็จ');
  } catch (err) { next(err); }
});

// ─── GET /audit-logs ─────────────────────────────────────────────────────────
// Audit trail for school actions

router.get('/audit-logs', requireFullSchoolScope, exportFormatLimiter, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 30));
    const offset = (page - 1) * per_page;
    const { action, date_from, date_to } = req.query;
    const isValidDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);

    // Match each entity_type against its OWN id space: 'student' ids live in
    // students, 'roster_request' ids live in roster_change_requests (a separate
    // BIGINT sequence). A merged IN(...) leaked another school's roster_request
    // audit row whenever its rcr.id numerically collided with one of this
    // school's student ids.
    let scopeWhere = `((u.scope_id = ? AND u.scope_type = 'SCHOOL')
       OR (al.entity_type = 'student' AND al.entity_id IN (
         SELECT CAST(s.id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci FROM students s WHERE s.school_id = ?
       ))
       OR (al.entity_type = 'roster_request' AND al.entity_id IN (
         SELECT CAST(rcr.id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci FROM roster_change_requests rcr WHERE rcr.school_id = ?
       )))`;
    const params = [schoolId, schoolId, schoolId];

    if (action) { scopeWhere += ' AND al.action = ?'; params.push(action); }
    if (date_from && isValidDate(date_from)) { scopeWhere += ' AND al.created_at >= ?'; params.push(`${date_from} 00:00:00`); }
    if (date_to && isValidDate(date_to)) { scopeWhere += ' AND al.created_at <= ?'; params.push(`${date_to} 23:59:59`); }

    // CSV export mode
    if (req.query.format === 'csv') {
      // Audit 2026-06-18 (limitations): +1 row to detect truncation.
      const [rows] = await pool.query(
        `SELECT al.id, al.action, al.entity_type, al.entity_id,
                al.old_value, al.new_value, al.created_at,
                u.display_name AS actor_name, u.role AS actor_role
         FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
         WHERE ${scopeWhere} ORDER BY al.created_at DESC LIMIT 5001`,
        params
      );
      const truncated = rows.length > 5000;
      const csv = auditRowsToCsv(rows.slice(0, 5000));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=audit_school_${todayBangkok()}.csv`);
      if (truncated) res.setHeader('X-Truncated', 'true');
      return res.send('\uFEFF' + csv +
        (truncated ? '\n"# \u0E41\u0E2A\u0E14\u0E07 5000 \u0E41\u0E16\u0E27\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14 \u2014 \u0E23\u0E30\u0E1A\u0E38\u0E0A\u0E48\u0E27\u0E07\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E14\u0E39\u0E17\u0E31\u0E49\u0E07\u0E2B\u0E21\u0E14"' : ''));
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id WHERE ${scopeWhere}`, params
    );

    const [rows] = await pool.query(
      `SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id,
              al.old_value, al.new_value, al.created_at,
              u.display_name AS actor_name, u.role AS actor_role
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE ${scopeWhere}
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, per_page, offset]
    );

    // Redact PII in old_value/new_value before returning JSON, matching the CSV
    // branch above and the province, affiliation and admin handlers — school was
    // the only one of the four still returning them raw. Verified against the
    // sandbox: an audit row carrying parent_phone and line_user_id came back as
    // "0812345678" and "U1234567890abcdef" here, and as "081****678" and
    // "U1234567…[redacted]" everywhere else.
    //
    // A school does see its own students' guardian phones through
    // /api/school/students, so the phone is not new exposure there — but
    // line_user_id is not surfaced to this role anywhere else, and the scope
    // filter admits transfer and roster rows whose values describe another
    // school's record.
    //
    // redactAuditValue is imported at module scope. Do NOT re-declare it inside
    // this handler: a function-scoped const shadows it for the whole function and
    // puts the CSV branch above into a temporal dead zone, which is how the same
    // change turned ?format=csv into a 500 in admin.routes.js.
    const redactVal = (v) => {
      if (v === null || v === undefined) return v;
      const t = redactAuditValue(v);
      try { return JSON.parse(t); } catch { return t; }
    };
    const safeRows = rows.map((r) => ({
      ...r, old_value: redactVal(r.old_value), new_value: redactVal(r.new_value),
    }));

    return sendSuccess(res, safeRows, 'OK', { page, per_page, total });
  } catch (err) { next(err); }
});

// ─── GET /students/template ──────────────────────────────────────────────────
// Download Excel template for student import

router.get('/students/template', importExportLimiter, async (req, res, next) => {
  try {
    const wb = new ExcelJS.Workbook();

    // Sheet 1: Data entry
    const ws = wb.addWorksheet('ข้อมูลนักเรียน');
    ws.columns = [
      { header: 'รหัสนักเรียน*', key: 'id', width: 16 },
      { header: 'คำนำหน้า', key: 'prefix', width: 14 },
      { header: 'ชื่อ*', key: 'first_name', width: 18 },
      { header: 'นามสกุล*', key: 'last_name', width: 18 },
      { header: 'ระดับชั้น', key: 'grade', width: 12 },
      { header: 'ห้อง', key: 'classroom', width: 10 },
      { header: 'ทะเบียนรถ', key: 'plate_no', width: 22 },
      { header: 'ใช้บริการเช้า', key: 'morning', width: 14 },
      { header: 'ใช้บริการเย็น', key: 'evening', width: 14 },
      { header: 'ชื่อผู้ปกครอง', key: 'parent_name', width: 20 },
      { header: 'เบอร์โทรผู้ปกครอง', key: 'parent_phone', width: 18 },
    ];

    // Style header row
    ws.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
      cell.alignment = { horizontal: 'center' };
    });

    // Example row
    ws.addRow({
      id: 22001, prefix: 'เด็กชาย', first_name: 'สมชาย', last_name: 'ใจดี',
      grade: 'ป.3', classroom: '1', plate_no: 'นข 2210 ลำปาง',
      morning: 'Y', evening: 'Y', parent_name: 'นายสมศักดิ์ ใจดี', parent_phone: '0812345678',
    });

    // Sheet 2: Instructions
    const guide = wb.addWorksheet('คู่มือการใช้งาน');
    guide.getColumn('A').width = 60;
    const instructions = [
      'คู่มือการนำเข้าข้อมูลนักเรียน',
      '',
      'ขั้นตอน:',
      '1. กรอกข้อมูลในชีต "ข้อมูลนักเรียน"',
      '2. คอลัมน์ที่มีเครื่องหมาย * เป็นข้อมูลบังคับ',
      '3. บันทึกไฟล์เป็น .xlsx แล้วอัปโหลดเข้าระบบ',
      '',
      'รายละเอียดคอลัมน์:',
      '• รหัสนักเรียน* — ตัวเลข ต้องไม่ซ้ำกับที่มีในระบบ',
      '• คำนำหน้า — เด็กชาย, เด็กหญิง, นาย, นางสาว, นาง',
      '• ชื่อ* — ชื่อจริงของนักเรียน',
      '• นามสกุล* — นามสกุลของนักเรียน',
      '• ระดับชั้น — เช่น ป.1, ป.2, ม.1, ม.3',
      '• ห้อง — เช่น 1, 2, 1/1',
      '• ทะเบียนรถ — ทะเบียนรถรับส่งที่ใช้ ถ้าไม่มีให้เว้นว่าง',
      '• ใช้บริการเช้า — Y = ใช้, N = ไม่ใช้ (ค่าเริ่มต้น Y)',
      '• ใช้บริการเย็น — Y = ใช้, N = ไม่ใช้ (ค่าเริ่มต้น Y)',
      '• ชื่อผู้ปกครอง — ชื่อผู้ปกครองหรือผู้ดูแล',
      '• เบอร์โทรผู้ปกครอง — ตัวเลข 10 หลัก เช่น 0812345678',
      '',
      'หมายเหตุ:',
      '• ลบแถวตัวอย่าง (แถวที่ 2) ก่อนกรอกข้อมูลจริง',
      '• ระบบจะเพิ่มเฉพาะนักเรียนในโรงเรียนของท่านเท่านั้น',
      '• ถ้ารหัสนักเรียนซ้ำ ระบบจะข้ามแถวนั้นและแจ้งผลให้ทราบ',
    ];
    instructions.forEach((text, i) => {
      const row = guide.getRow(i + 1);
      row.getCell(1).value = text;
      if (i === 0) row.getCell(1).font = { bold: true, size: 14 };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=student_import_template.xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// ─── POST /students/import ──────────────────────────────────────────────────
// Import students from Excel file

router.post('/students/import', importExportLimiter, requireFullSchoolScope, importUpload.single('file'), async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    if (!req.file) return sendError(res, 'กรุณาเลือกไฟล์ (.xlsx หรือ .csv)', [], 400);

    // Audit 2026-06-18 (fileupload-import): validate the real bytes, not just the
    // extension. Reject legacy .xls (OLE2) up front with a clear message — ExcelJS
    // cannot parse it and previously threw an unhandled 500. The orphaned upload
    // is removed by the finally block at the end of the handler.
    let head;
    try { head = fs.readFileSync(req.file.path).subarray(0, 16); } catch { head = Buffer.alloc(0); }
    if (isOle2(head)) {
      return sendError(res, 'ไฟล์ .xls (รุ่นเก่า) ไม่รองรับ กรุณาบันทึกเป็น .xlsx หรือ .csv', [], 400);
    }
    if (!isAllowedImport(head)) {
      return sendError(res, 'ไฟล์ไม่ถูกต้อง รองรับเฉพาะ .xlsx หรือ .csv', [], 400);
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const rows = [];

    if (ext === '.csv') {
      // Parse CSV (UTF-8 with BOM support)
      // Medium fix: use a proper RFC 4180 CSV parser that handles quoted
      // fields (e.g. parent names containing commas like "สมชาย, สมหญิง")
      // instead of split(',') which would shift columns silently.
      const raw = decodeCsvBuffer(fs.readFileSync(req.file.path)).replace(/^\uFEFF/, '');
      const csvRows = parseCsv(raw);
      if (csvRows.length < 2) return sendError(res, 'ไม่พบข้อมูลในไฟล์ (ไม่มีแถวข้อมูล)', [], 400);

      // Detect column order from header
      const headers = csvRows[0].map(h => h.trim().replace(/\*/g, ''));
      const colMap = {};
      headers.forEach((h, i) => {
        if (h.includes('รหัสนักเรียน')) colMap.id = i;
        else if (h.includes('คำนำหน้า')) colMap.prefix = i;
        else if (h === 'ชื่อ') colMap.first_name = i;
        else if (h.includes('นามสกุล')) colMap.last_name = i;
        else if (h === 'ชั้น') colMap.grade = i;
        else if (h === 'ห้อง') colMap.classroom = i;
        else if (h.includes('ทะเบียนรถ')) colMap.plate_no = i;
        else if (h.includes('ผู้ปกครอง') && !h.includes('เบอร์')) colMap.parent_name = i;
        else if (h.includes('เบอร์โทร')) colMap.parent_phone = i;
      });

      for (let i = 1; i < csvRows.length; i++) {
        const cols = csvRows[i];
        const get = (key) => (cols[colMap[key]] || '').trim();
        rows.push({
          rowNum: i + 1,
          id: get('id'), prefix: get('prefix'),
          first_name: get('first_name'), last_name: get('last_name'),
          grade: get('grade'), classroom: get('classroom'),
          plate_no: get('plate_no'),
          morning: '', evening: '',
          parent_name: get('parent_name'), parent_phone: get('parent_phone'),
        });
      }
    } else {
      // Parse Excel
      const wb = new ExcelJS.Workbook();
      await readWorkbookSafely(wb, req.file.path);
      const ws = wb.getWorksheet(1) || wb.worksheets[0];
      if (!ws) return sendError(res, 'ไม่พบข้อมูลในไฟล์', [], 400);

      const headerValues = (ws.getRow(1).values || []).slice(1).map((v) => (v == null ? '' : String(v).replace(/\*/g, '').trim()));
      const colMap = {};
      headerValues.forEach((h, i) => {
        if (h.includes('รหัสนักเรียน')) colMap.id = i + 1;
        else if (h.includes('คำนำหน้า')) colMap.prefix = i + 1;
        else if (h === 'ชื่อ') colMap.first_name = i + 1;
        else if (h.includes('นามสกุล')) colMap.last_name = i + 1;
        else if (h === 'ชั้น' || h.includes('ระดับชั้น') || h.includes('ระดับ')) colMap.grade = i + 1;
        else if (h === 'ห้อง') colMap.classroom = i + 1;
        else if (h.includes('ทะเบียนรถ')) colMap.plate_no = i + 1;
        else if (h.includes('ใช้บริการเช้า')) colMap.morning = i + 1;
        else if (h.includes('ใช้บริการเย็น')) colMap.evening = i + 1;
        else if (h.includes('ผู้ปกครอง') && !h.includes('เบอร์')) colMap.parent_name = i + 1;
        else if (h.includes('เบอร์')) colMap.parent_phone = i + 1;
      });

      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const get = (key) => {
          const col = colMap[key];
          if (!col) return '';
          const cell = row.getCell(col);
          return cell.value !== null && cell.value !== undefined ? String(cell.value).trim() : '';
        };
        const item = {
          rowNum,
          id: get('id'), prefix: get('prefix'),
          first_name: get('first_name'), last_name: get('last_name'),
          grade: get('grade'), classroom: get('classroom'),
          plate_no: get('plate_no'),
          morning: get('morning'), evening: get('evening'),
          parent_name: get('parent_name'), parent_phone: get('parent_phone'),
        };
        if (item.id || item.first_name || item.last_name || item.plate_no || item.parent_name || item.parent_phone) rows.push(item);
      });
    }

    if (rows.length === 0) return sendError(res, 'ไม่พบข้อมูลในไฟล์ (ไม่มีแถวข้อมูล)', [], 400);
    // Audit 2026-06-18 (fileupload-import): bound the work a single upload can
    // trigger so a (possibly decompression-bombed) file can't exhaust memory/CPU.
    if (rows.length > 5000) return sendError(res, 'ไฟล์มีจำนวนแถวมากเกินไป (เกิน 5000 แถว) กรุณาแบ่งไฟล์', [], 400);

    // Pre-load vehicles for plate lookup. Phase 10.13A-25B — match by CANONICAL
    // plate identity (province-alias + spacing/dash insensitive) so a file plate
    // like "ออ 7332 กรุงเทพมหานคร" resolves to an existing "ออ 7332 กทม".
    const plateId = require('../utils/plateIdentity');
    const [allVehicles] = await pool.query(`SELECT id, plate_no FROM vehicles WHERE is_deleted = FALSE`);
    const [allVehiclesInclDeleted] = await pool.query(`SELECT id, plate_no, is_deleted FROM vehicles`);
    const canonOf = (plate) => {
      const parts = plateId.parseLegacyPlateText(plate);
      return parts ? plateId.buildCanonicalPlate(parts) : '';
    };
    const canonicalMap = {};         // canonical → vehicle id (active only)
    for (const v of allVehicles) { const c = canonOf(v.plate_no); if (c) canonicalMap[c] = v.id; }

    const crypto = require('crypto');
    const results = { success: 0, vehicle_linked: 0, errors: [] };

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const r of rows) {
        // Validate required fields. Phase 10.13A-24B — student identity is now
        // school-scoped: `student_code` is the VISIBLE code from the file;
        // students.id is an internal surrogate (auto-increment). Two schools may
        // legitimately use the same code.
        const studentCode = String(r.id == null ? '' : r.id).trim();
        if (!studentCode) {
          results.errors.push({ row: r.rowNum, message: 'รหัสนักเรียนไม่ถูกต้อง' });
          continue;
        }
        if (!r.first_name) {
          results.errors.push({ row: r.rowNum, message: 'ไม่มีชื่อนักเรียน' });
          continue;
        }
        if (!r.last_name) {
          results.errors.push({ row: r.rowNum, message: 'ไม่มีนามสกุลนักเรียน' });
          continue;
        }

        // Duplicate check scoped to THIS school (10.13A-24B). The same code at a
        // different school is allowed; only a duplicate within the same school is
        // blocked. Soft-deleted matches in this school are reactivated below.
        const [[existing]] = await conn.query(
          `SELECT id, is_deleted FROM students WHERE school_id = ? AND student_code = ? LIMIT 1`,
          [schoolId, studentCode]
        );
        if (classifyStudentImport(existing) === 'SKIP') {
          results.errors.push({ row: r.rowNum, message: `รหัสนักเรียน ${studentCode} มีอยู่แล้วในโรงเรียนนี้` });
          continue;
        }

        // Normalize + validate parent phone (Phase 11A audit fix M8: accept
        // 9-10 digits after normalization, matching the student edit endpoint)
        r.parent_phone = normalizePhone(r.parent_phone);
        if (r.parent_phone && !/^\d{9,10}$/.test(r.parent_phone)) {
          results.errors.push({ row: r.rowNum, message: 'เบอร์โทรผู้ปกครองต้องเป็นตัวเลข 9-10 หลัก' });
          continue;
        }

        // Resolve vehicle by CANONICAL identity (10.13A-25B) — alias/spacing
        // insensitive. On a miss, classify the likely reason for the operator
        // (do NOT auto-create the vehicle).
        let vehicleId = null;
        if (r.plate_no) {
          vehicleId = canonicalMap[canonOf(r.plate_no)] || null;
          if (!vehicleId) {
            const cls = plateId.classifyVehiclePlateConflict(r.plate_no, allVehiclesInclDeleted);
            let why = 'ไม่พบรถทะเบียนนี้ในระบบ (ยังไม่ได้ลงทะเบียนรถ)';
            if (cls.code === 'AMBIGUOUS_PLATE_NEEDS_PROVINCE') why = 'ทะเบียนรถในไฟล์ไม่มีจังหวัด ทำให้จับคู่ไม่ได้ กรุณาระบุจังหวัด';
            else if (cls.code === 'SOFT_DELETED_VEHICLE_EXISTS') why = `ทะเบียนรถตรงกับรถที่ถูกปิดใช้งานแล้ว (${cls.display_plate || ''}) กรุณากู้คืนรถก่อน`;
            else if (cls.code === 'PROVINCE_ALIAS_DUPLICATE') why = `ทะเบียนรถตรงกับรถที่มีอยู่ในระบบ (${cls.display_plate || ''}) แต่ชื่อจังหวัดเขียนต่างกัน`;
            results.errors.push({ row: r.rowNum, message: `ไม่พบรถทะเบียน "${r.plate_no}" — ${why}` });
            continue;
          }
        }

        // Generate a synthetic cid_hash marker (unique per row, not a national-ID hash).
        // Audit 2026-06-18 (HIGH, fileupload-import): this used an undefined
        // `studentId` (it lives only in the PUT/DELETE handlers), throwing a
        // ReferenceError that rolled back the whole import → 500 every time. Use
        // the in-scope school + student_code, which is unique per row here.
        const cidHash = crypto.createHash('sha256').update(`import-${schoolId}-${studentCode}-${Date.now()}-${r.rowNum}`).digest('hex');

        const morningEnabled = (r.morning || '').toUpperCase() === 'N' ? 0 : 1;
        const eveningEnabled = (r.evening || '').toUpperCase() === 'N' ? 0 : 1;

        // Insert or reactivate student. `effectiveStudentId` is the internal
        // students.id used for the parent link below (existing id on reactivate,
        // new surrogate id on insert).
        let effectiveStudentId;
        try {
          if (existing && existing.is_deleted) {
            // Reactivate the soft-deleted student in THIS school with new data.
            await conn.query(
              `UPDATE students SET cid_hash = ?, prefix = ?, first_name = ?, last_name = ?,
               grade = ?, classroom = ?, vehicle_id = ?,
               morning_enabled = ?, evening_enabled = ?, term_id = ?,
               is_deleted = FALSE, deleted_at = NULL
               WHERE id = ?`,
              [cidHash, r.prefix || null, r.first_name, r.last_name,
               r.grade || null, r.classroom || null, vehicleId,
               morningEnabled, eveningEnabled, getCurrentTermCachedSync(), existing.id]
            );
            effectiveStudentId = existing.id;
          } else {
            // New student: surrogate id = MAX(id)+1 (10.13A-24B fallback — id is
            // an FK-referenced PK so it can't be AUTO_INCREMENT). Computed inside
            // this transaction, so successive inserts in the same import advance
            // correctly. student_code keeps the visible code so the same code can
            // exist at another school. Phase 10.13B-2 — atomic allocator (was
            // MAX(id)+1) so concurrent imports cannot race on the surrogate id.
            const { allocateStudentId } = require('../services/idAllocator.service');
            const newStudentId = await allocateStudentId(conn);
            await conn.query(
              `INSERT INTO students (id, student_code, cid_hash, prefix, first_name, last_name, grade, classroom, school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [newStudentId, studentCode, cidHash, r.prefix || null, r.first_name, r.last_name,
               r.grade || null, r.classroom || null, schoolId, vehicleId,
               morningEnabled, eveningEnabled, getCurrentTermCachedSync()]
            );
            effectiveStudentId = newStudentId;
          }
        } catch (insertErr) {
          results.errors.push({ row: r.rowNum, message: `บันทึกรหัส ${studentCode} ไม่สำเร็จ: ${insertErr.code || insertErr.message}` });
          continue;
        }

        // Create parent if provided (dedupe by phone)
        if (r.parent_name || r.parent_phone) {
          let parentId;
          if (r.parent_phone) {
            const [[ep]] = await conn.query(
              `SELECT id FROM parents WHERE phone = ? AND is_deleted = FALSE LIMIT 1`, [r.parent_phone]
            );
            parentId = ep?.id;
          }
          if (!parentId) {
            const [parentResult] = await conn.query(
              `INSERT INTO parents (name, phone) VALUES (?, ?)`,
              [r.parent_name || null, r.parent_phone || null]
            );
            parentId = parentResult.insertId;
          }
          await conn.query(
            `INSERT INTO parent_student (parent_id, student_id, approved, approved_by, approved_at) VALUES (?, ?, TRUE, ?, NOW())
             ON DUPLICATE KEY UPDATE approved = TRUE`,
            [parentId, effectiveStudentId, req.user.id]
          );
        }

        results.success++;
        if (vehicleId) results.vehicle_linked++;
      }

      await logAudit({
        userId: req.user.id, action: 'IMPORT', entityType: 'student', entityId: null,
        newValue: { total_rows: rows.length, success: results.success, errors: results.errors.length, schoolId },
        ipAddress: req.ip, userAgent: req.headers['user-agent'], conn,
      });

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    const message = `นำเข้าสำเร็จ ${results.success} รายการ` +
      (results.vehicle_linked > 0 ? ` (ผูกรถ ${results.vehicle_linked} คน)` : '') +
      (results.errors.length > 0 ? ` · ไม่สำเร็จ ${results.errors.length} รายการ` : '');

    return sendSuccess(res, results, message, null, results.success > 0 ? 201 : 200);
  } catch (err) { next(err); }
  finally {
    // Audit 2026-06-18 (fileupload-import): always delete the uploaded PII file —
    // previously early validation returns / errors left it orphaned under uploads/.
    if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
  }
});

// ─── Phase 10.13B-5 — Import History / Correction Center ────────────────────
// GET /students/import/batches — school-scoped list of past imports. Registered
// BEFORE the /:batchId routes so 'batches' is not captured as a batch id.
router.get('/students/import/batches', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    const importPreview = require('../services/studentImportPreview.service');
    const out = await importPreview.listBatches(pool, { schoolId, page: parseInt(req.query.page, 10) || 1, perPage: parseInt(req.query.per_page, 10) || 30 });
    return sendSuccess(res, out.batches, 'OK', out.meta);
  } catch (err) { next(err); }
});

// GET /students/import/:batchId — batch detail + row-level results (reopenable).
router.get('/students/import/:batchId', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    const batchId = readIdParam(req, res, 'batchId');
    if (batchId === null) return;
    const importPreview = require('../services/studentImportPreview.service');
    const out = await importPreview.getBatchDetail(pool, { batchId, schoolId });
    return sendSuccess(res, out);
  } catch (err) { next(err); }
});

// ─── Phase 10.13A-26A — Import Preview / Apply / Report ─────────────────────
// Transparent, re-checkable, auditable imports. The legacy POST /students/import
// above is untouched. Preview RETAINS the uploaded file (no fs.unlink).

// POST /students/import/preview — analyse rows row-by-row, persist batch + rows,
// return summary + classifications. Writes NO student/vehicle/parent data.
router.post('/students/import/preview', importExportLimiter, requireFullSchoolScope, importUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return sendError(res, 'ไม่พบไฟล์ที่อัปโหลด', [], 400);
    // Phase 10.13B-1 — retained preview files may contain guardian PII; keep them
    // owner-only (600) so they are not world/group-readable on the host.
    try { fs.chmodSync(req.file.path, 0o600); } catch { /* best-effort */ }
    const schoolId = resolveSchoolId(req);
    const importPreview = require('../services/studentImportPreview.service');
    // Phase 10.15A — schools can opt in to auto-create missing vehicles during import.
    const autoCreateVehicle = req.body && (req.body.auto_create_vehicle === 'true' || req.body.auto_create_vehicle === true);
    const out = await importPreview.runPreview(pool, {
      schoolId, importedBy: req.user.id, filePath: req.file.path, originalName: decodeUploadFilename(req.file.originalname),
      autoCreateVehicle,
    });
    await logAudit({
      userId: req.user.id, action: 'IMPORT', entityType: 'import_batch', entityId: String(out.batch_id),
      newValue: { mode: 'preview', school_id: schoolId, ...out.summary },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, out, 'วิเคราะห์ไฟล์นำเข้าสำเร็จ (ยังไม่บันทึกข้อมูลนักเรียน)');
  } catch (err) { next(err); }
});

// POST /students/import/:batchId/apply — apply can_apply (INSERT) rows, idempotent.
router.post('/students/import/:batchId/apply', importExportLimiter, requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    const batchId = readIdParam(req, res, 'batchId');
    if (batchId === null) return;
    // Phase 10.13B-4 — explicit apply modes; risky modes act only on selected rows.
    const { mode = 'insert_ready', selected_row_ids, confirm_guardian_update, confirm_reactivate, auto_create_vehicle } = req.body || {};
    const VALID_MODES = ['insert_ready', 'update_guardian_confirmed', 'reactivate_student_confirmed', 'mixed_confirmed'];
    if (!VALID_MODES.includes(mode)) return sendError(res, 'โหมดการนำเข้าไม่ถูกต้อง', [], 400);
    const importPreview = require('../services/studentImportPreview.service');
    const out = await importPreview.applyBatch(pool, {
      batchId, schoolId, userId: req.user.id, mode,
      selectedRowIds: Array.isArray(selected_row_ids) ? selected_row_ids : [],
      confirmGuardianUpdate: !!confirm_guardian_update,
      confirmReactivate: !!confirm_reactivate,
      autoCreateVehicle: !!auto_create_vehicle,
    });
    await logAudit({
      userId: req.user.id, action: 'IMPORT', entityType: 'import_batch', entityId: String(batchId),
      newValue: { phase: 'apply', school_id: schoolId, ...out },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    const parts = [];
    if (out.applied) parts.push(`เพิ่มใหม่ ${out.applied}`);
    if (out.guardian_updated) parts.push(`อัปเดตผู้ปกครอง ${out.guardian_updated}`);
    if (out.reactivated) parts.push(`กู้คืน ${out.reactivated}`);
    if (out.already_applied) parts.push(`มีอยู่แล้ว ${out.already_applied}`);
    if (out.vehicle_blocked) parts.push(`ติดปัญหารถ ${out.vehicle_blocked}`);
    if (out.stale) parts.push(`ต้องพรีวิวใหม่ ${out.stale}`);
    if (out.failed) parts.push(`ไม่สำเร็จ ${out.failed}`);
    return sendSuccess(res, out, parts.length ? 'ดำเนินการสำเร็จ · ' + parts.join(' · ') : 'ไม่มีรายการที่ต้องดำเนินการ');
  } catch (err) { next(err); }
});

// GET /students/import/:batchId/report — row-level results (PII-safe).
router.get('/students/import/:batchId/report', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    const batchId = readIdParam(req, res, 'batchId');
    if (batchId === null) return;
    const importPreview = require('../services/studentImportPreview.service');
    const out = await importPreview.getReport(pool, { batchId, schoolId });
    return sendSuccess(res, out);
  } catch (err) { next(err); }
});

// POST /students/import/:batchId/rollback — soft-delete ONLY the students this
// batch inserted (Phase 10.13B-5). Selected rows only; idempotent; audited.
router.post('/students/import/:batchId/rollback', importExportLimiter, requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    const batchId = readIdParam(req, res, 'batchId');
    if (batchId === null) return;
    const { selected_row_ids, reason } = req.body || {};
    const importPreview = require('../services/studentImportPreview.service');
    const out = await importPreview.rollbackBatch(pool, {
      batchId, schoolId, userId: req.user.id,
      selectedRowIds: Array.isArray(selected_row_ids) ? selected_row_ids : [], reason,
    });
    await logAudit({
      userId: req.user.id, action: 'DELETE', entityType: 'import_batch', entityId: String(batchId),
      newValue: { phase: 'rollback', school_id: schoolId, reason: String(reason || '').slice(0, 200), ...out, details: undefined },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    const parts = [];
    if (out.rolled_back) parts.push(`ย้อนกลับ ${out.rolled_back}`);
    if (out.already_rolled_back) parts.push(`ย้อนกลับแล้ว ${out.already_rolled_back}`);
    if (out.skipped) parts.push(`ข้าม ${out.skipped}`);
    if (out.failed) parts.push(`ไม่สำเร็จ ${out.failed}`);
    return sendSuccess(res, out, parts.length ? 'ย้อนกลับสำเร็จ · ' + parts.join(' · ') : 'ไม่มีรายการที่ย้อนกลับได้');
  } catch (err) { next(err); }
});

// ─── Phase 10.13B-6 — Student Transfer / Wrong-School Workflow ──────────────
// A request changes NO student data; the move happens only on admin approval.
// GET /students/transfer-requests registered before the :studentId POST so the
// literal path is not captured as a student id.
router.get('/students/transfer-requests', requireFullSchoolScope, async (req, res, next) => {
  try {
    const transfer = require('../services/studentTransfer.service');
    const out = await transfer.listForSchool(pool, { schoolId: resolveSchoolId(req) });
    return sendSuccess(res, out);
  } catch (err) { next(err); }
});

router.post('/students/transfer-requests/:id/cancel', requireFullSchoolScope, async (req, res, next) => {
  try {
    const requestId = readIdParam(req, res, 'id');
    if (requestId === null) return;
    const transfer = require('../services/studentTransfer.service');
    const out = await transfer.cancelRequest(pool, { requestId, schoolId: resolveSchoolId(req), userId: req.user.id });
    return sendSuccess(res, out, 'ยกเลิกคำขอแล้ว');
  } catch (err) { next(err); }
});

router.post('/students/:studentId/transfer-request', requireFullSchoolScope, async (req, res, next) => {
  try {
    const studentId = readIdParam(req, res, 'studentId');
    if (studentId === null) return;
    const transfer = require('../services/studentTransfer.service');
    const { destination_school_id, reason, evidence_note, request_type } = req.body || {};
    const out = await transfer.createRequest(pool, {
      studentId, schoolId: resolveSchoolId(req), userId: req.user.id,
      destinationSchoolId: destination_school_id, reason, evidenceNote: evidence_note, requestType: request_type || 'TRANSFER_TO_SCHOOL',
    });
    return sendSuccess(res, out, 'ส่งคำขอโอนย้ายแล้ว · รอผู้ดูแลระบบตรวจสอบ', null, 201);
  } catch (err) { next(err); }
});

// ─── Phase 10.13B-7 — Vehicle restore / shared-fleet request ────────────────
// A request changes NO vehicle data; restore happens only on admin approval.
router.get('/vehicles/requests', requireFullSchoolScope, async (req, res, next) => {
  try {
    const vr = require('../services/vehicleRequest.service');
    return sendSuccess(res, await vr.listSchoolVehicleRequests(pool, { schoolId: resolveSchoolId(req) }));
  } catch (err) { next(err); }
});
router.get('/vehicles/requests/:id', requireFullSchoolScope, async (req, res, next) => {
  try {
    const requestId = readIdParam(req, res, 'id');
    if (requestId === null) return;
    const vr = require('../services/vehicleRequest.service');
    return sendSuccess(res, await vr.getSchoolVehicleRequest(pool, { requestId, schoolId: resolveSchoolId(req) }));
  } catch (err) { next(err); }
});
router.post('/vehicles/requests/:id/cancel', requireFullSchoolScope, async (req, res, next) => {
  try {
    const requestId = readIdParam(req, res, 'id');
    if (requestId === null) return;
    const vr = require('../services/vehicleRequest.service');
    return sendSuccess(res, await vr.cancelVehicleRequest(pool, { requestId, schoolId: resolveSchoolId(req), userId: req.user.id }), 'ยกเลิกคำขอแล้ว');
  } catch (err) { next(err); }
});
router.post('/vehicles/requests', requireFullSchoolScope, async (req, res, next) => {
  try {
    const vr = require('../services/vehicleRequest.service');
    const b = req.body || {};
    const out = await vr.createVehicleRequest(pool, {
      schoolId: resolveSchoolId(req), userId: req.user.id, requestType: b.request_type, vehicleId: b.vehicle_id,
      platePrefix: b.plate_prefix, plateNumber: b.plate_number, province: b.province, inputPlate: b.input_plate,
      reason: b.reason, importBatchId: b.import_batch_id, importRowId: b.import_row_id,
    });
    return sendSuccess(res, out, 'ส่งคำขอแล้ว · รอผู้ดูแลระบบตรวจสอบ', null, 201);
  } catch (err) { next(err); }
});

// ─── Phase 7.2 — GET /api/school/live-vehicles ──────────────────────────────
// Vehicles serving this school. No audit (single-scope, not aggregate).
router.get('/live-vehicles', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) {
      return sendError(res,
        req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน',
        [], req.user.role === 'admin' ? 400 : 403);
    }
    const gradeFilter = resolveGradeScope(req);
    const vehicles = await vllSvc.listForSchool(schoolId, gradeFilter);
    return sendSuccess(res, { vehicles, generated_at: new Date().toISOString() });
  } catch (err) { next(err); }
});

/* ── Phase 7.11.5 — Grade teacher account management ──────────────────────
 *
 * 4 endpoints under /api/school/teacher-accounts let a FULL school account
 * create / list / reset / soft-delete grade-level teacher sub-accounts for
 * its OWN school. Teacher accounts themselves cannot reach any of these —
 * `requireFullSchoolScope` middleware (already defined for write routes)
 * returns 403 when req.user.gradeScope is set.
 *
 * Server-trusted scope: school_id is resolved from req.user.scopeId (or
 * admin's ?school_id=); a client-supplied school_id is IGNORED.
 *
 * Hard rules enforced here:
 *   • role hard-coded to 'school', scope_type to 'SCHOOL'
 *   • grade_scope mandatory + canonical-whitelist validated
 *   • password_hash never returned in any response
 *   • must_change_password = 1 on create + reset
 *   • all four ops audit-logged (CREATE, UPDATE for reset, DELETE)
 *   • soft-delete only — historical audit chain stays intact
 *   • cannot target a non-teacher row (defensive WHERE on every UPDATE)
 *   • cannot target another school's teacher (school_id check on every row)
 */

const bcrypt = require('bcrypt');
const BCRYPT_COST_TEACHER = 12;
const { validatePassword } = require('../utils/passwordPolicy');

router.get('/teacher-accounts', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);

    const [rows] = await pool.query(
      `SELECT id, username, display_name, grade_scope, is_active,
              must_change_password, last_login, created_at, updated_at
       FROM users
       WHERE role = 'school'
         AND scope_type = 'SCHOOL'
         AND scope_id = ?
         AND grade_scope IS NOT NULL
         AND is_deleted = FALSE
       ORDER BY grade_scope, username`,
      [schoolId]
    );
    return sendSuccess(res, rows);
  } catch (err) { next(err); }
});

router.post('/teacher-accounts', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);

    const { username, password, display_name, grade_scope } = req.body || {};
    // users.username is varchar(100), users.display_name varchar(200).
    if (rejectOverLongFields(res, req.body, { username: 100, display_name: 200 })) return;
    const errors = [];
    if (!username || !String(username).trim()) errors.push({ field: 'username', message: 'จำเป็นต้องระบุชื่อผู้ใช้' });
    if (!password) errors.push({ field: 'password', message: 'จำเป็นต้องระบุรหัสผ่าน' });
    else {
      const pwCheck = validatePassword(password, { username: String(username || '').trim() });
      if (!pwCheck.ok) errors.push({ field: 'password', message: pwCheck.message });
    }
    if (!isValidGradeScope(grade_scope)) {
      errors.push({ field: 'grade_scope', message: `ระดับชั้นต้องเป็นค่าใดค่าหนึ่งใน: ${VALID_GRADE_SCOPES.join(', ')}` });
    }
    if (errors.length) return sendError(res, 'ข้อมูลไม่ถูกต้อง', errors, 400);

    const uname = String(username).trim();

    // Duplicate username check (active users only)
    const [[existing]] = await pool.query('SELECT id FROM users WHERE username = ? AND is_deleted = FALSE', [uname]);
    if (existing) return sendError(res, 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว', [], 409);

    const hash = await bcrypt.hash(String(password), BCRYPT_COST_TEACHER);
    const [result] = await pool.query(
      `INSERT INTO users (username, password_hash, role, scope_type, scope_id, grade_scope,
                          display_name, must_change_password, is_active)
       VALUES (?, ?, 'school', 'SCHOOL', ?, ?, ?, TRUE, TRUE)`,
      [uname, hash, schoolId, String(grade_scope).trim(), display_name || uname]
    );

    await logAudit({
      userId: req.user.id, action: 'CREATE', entityType: 'user', entityId: result.insertId,
      newValue: { username: uname, role: 'school', scope_type: 'SCHOOL', scope_id: schoolId,
                  grade_scope: String(grade_scope).trim(), display_name: display_name || uname,
                  account_type: 'grade_teacher' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res,
      { id: result.insertId, username: uname, display_name: display_name || uname,
        grade_scope: String(grade_scope).trim(), is_active: true, must_change_password: true },
      'สร้างบัญชีครูประจำสายชั้นสำเร็จ', null, 201);
  } catch (err) { next(err); }
});

router.post('/teacher-accounts/:id/reset-password', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);

    const userId = readIdParam(req, res, 'id');
    if (userId === null) return;

    const { password } = req.body || {};
    if (!password) {
      return sendError(res, 'จำเป็นต้องระบุรหัสผ่าน', [], 400);
    }

    // Verify the target is a teacher of THIS school
    const [[target]] = await pool.query(
      `SELECT id, username FROM users
       WHERE id = ? AND role = 'school' AND scope_id = ?
         AND grade_scope IS NOT NULL AND is_deleted = FALSE
       LIMIT 1`,
      [userId, schoolId]
    );
    if (!target) return sendError(res, 'ไม่พบบัญชีครูในโรงเรียนนี้', [], 404);

    // Strength check after the lookup so the username-equality rule sees the
    // target teacher's username.
    const pwCheck = validatePassword(password, { username: target.username });
    if (!pwCheck.ok) {
      return sendError(res, pwCheck.message, [], 400);
    }

    const hash = await bcrypt.hash(String(password), BCRYPT_COST_TEACHER);
    await pool.query(
      // Phase 10.12D — set password_changed_at = NOW() so any refresh token
      // issued before the reset is rejected (H3 — invalidate old sessions).
      `UPDATE users SET password_hash = ?, must_change_password = TRUE, password_changed_at = NOW()
       WHERE id = ?`,
      [hash, userId]
    );

    await logAudit({
      userId: req.user.id, action: 'UPDATE', entityType: 'user', entityId: userId,
      newValue: { username: target.username, action_detail: 'reset_password', must_change_password: true,
                  account_type: 'grade_teacher' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, null, 'รีเซ็ตรหัสผ่านสำเร็จ');
  } catch (err) { next(err); }
});

router.delete('/teacher-accounts/:id', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);

    const userId = readIdParam(req, res, 'id');
    if (userId === null) return;

    const [[target]] = await pool.query(
      `SELECT id, username, grade_scope FROM users
       WHERE id = ? AND role = 'school' AND scope_id = ?
         AND grade_scope IS NOT NULL AND is_deleted = FALSE
       LIMIT 1`,
      [userId, schoolId]
    );
    if (!target) return sendError(res, 'ไม่พบบัญชีครูในโรงเรียนนี้', [], 404);

    await pool.query(
      `UPDATE users SET is_deleted = TRUE, deleted_at = NOW(), is_active = FALSE
       WHERE id = ?`,
      [userId]
    );

    await logAudit({
      userId: req.user.id, action: 'DELETE', entityType: 'user', entityId: userId,
      oldValue: { username: target.username, grade_scope: target.grade_scope, account_type: 'grade_teacher' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, null, 'ลบบัญชีครูประจำสายชั้นสำเร็จ');
  } catch (err) { next(err); }
});

// ─── POST /api/school/checkin/:logId/void ────────────────────────────────────
// School reverses a wrong check-in / check-out for a student in its OWN school
// (mirror of /checkin-override). Writes a CANCELLED compensating checkin_logs
// row + resets daily_status, in one transaction. Reason required; original log
// kept. Grade-scoped teachers are blocked (requireFullSchoolScope). The service
// asserts the log's student belongs to that school.
router.post('/checkin/:logId/void', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) {
      return sendError(
        res,
        req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียนที่ผูกกับบัญชีนี้',
        [],
        req.user.role === 'admin' ? 400 : 403
      );
    }

    const logId = readIdParam(req, res, 'logId');
    if (logId === null) return;

    const reason = (req.body || {}).reason;
    if (!String(reason || '').trim()) {
      return sendError(res, 'กรุณาระบุเหตุผล', [{ field: 'reason', message: 'จำเป็นต้องระบุเหตุผล' }], 400);
    }

    const result = await checkinSvc.voidCheckin(pool, {
      userId:          req.user.id,
      userRole:        req.user.role,
      userDisplayName: req.user.displayName || req.user.username || null,
      ipAddress:       req.ip,
      userAgent:       req.headers['user-agent'],
      logId,
      reason,
      scope:           { kind: 'school', schoolId },
    });

    return sendSuccess(res, result, 'ยกเลิกรายการเช็กอินสำเร็จ', null, 201);
  } catch (err) { next(err); }
});

module.exports = router;

// Exposed for unit testing only. These are PURE request-scope resolvers and the
// linchpin of cross-school / grade isolation; attaching them to the router
// object does not affect `app.use('/api/school', router)`.
module.exports.resolveSchoolId = resolveSchoolId;
module.exports.resolveGradeScope = resolveGradeScope;
