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
const { pool } = require('../config/database');
const { logAudit } = require('../utils/audit');
const env     = require('../config/env');
const schoolSvc = require('../services/school.service');
const leaveSvc = require('../services/leave.service');
const rosterReqSvc = require('../services/rosterRequest.service');
const ppSvc = require('../services/pickupPoint.service');
const vllSvc = require('../services/vehicleLocation.service');

/**
 * Resolve school scope: admin uses ?school_id query param, school role uses scopeId.
 * Returns null if admin doesn't specify (for list-all queries).
 */
function resolveSchoolId(req) {
  if (req.user.role === 'admin') return req.query.school_id || req.body?.school_id || null;
  return req.user.scopeId;
}

/**
 * Phase 7.11.2 — canonical Thai grades accepted as `users.grade_scope`.
 * Mirrors the CHECK constraint defined in migration 018; keeping the
 * list duplicated here means the route layer can fast-reject before
 * the DB ever sees a bad value (and gives admin's ?grade= override a
 * whitelist to validate against).
 */
const VALID_GRADE_SCOPES = [
  'อ.1','อ.2','อ.3',
  'ป.1','ป.2','ป.3','ป.4','ป.5','ป.6',
  'ม.1','ม.2','ม.3','ม.4','ม.5','ม.6',
];

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

// Shared CSV helper for audit export
function auditRowsToCsv(rows) {
  const ACTION_TH = { CREATE: 'สร้าง', UPDATE: 'แก้ไข', DELETE: 'ลบ', EXPORT: 'ส่งออก', LOGIN: 'เข้าสู่ระบบ', IMPORT: 'นำเข้า', APPROVE: 'อนุมัติ' };
  const ENTITY_TH = { student: 'นักเรียน', vehicle: 'รถรับส่ง', user: 'บัญชีผู้ใช้', roster_request: 'คำขอรายชื่อ', leave: 'การลา', checkin: 'เช็กอิน' };
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = 'วันเวลา,ผู้ดำเนินการ,บทบาท,การกระทำ,ประเภท,รหัส,ค่าเดิม,ค่าใหม่';
  const lines = rows.map(r => [
    esc(new Date(r.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })),
    esc(r.actor_name || '-'),
    esc(r.actor_role || '-'),
    esc(ACTION_TH[r.action] || r.action),
    esc(ENTITY_TH[r.entity_type] || r.entity_type || '-'),
    esc(r.entity_id || '-'),
    esc(r.old_value ? JSON.stringify(r.old_value) : '-'),
    esc(r.new_value ? JSON.stringify(r.new_value) : '-'),
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

    const data = await schoolSvc.getDashboard(schoolId);
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
router.get('/students', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);

    const { search, grade, vehicle_id, morning_enabled, evening_enabled, sort, order } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));

    const result = await schoolSvc.getStudents(schoolId, {
      search, grade, vehicle_id, morning_enabled, evening_enabled,
      page, per_page, sort, order,
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

    const vehicles = await schoolSvc.getVehicles(schoolId);
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

    const data = await schoolSvc.getStatusToday(schoolId);
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

    const points = await ppSvc.getPickupPointsForSchool(schoolId, { session });
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

    const vehicles = await ppSvc.getVehiclesForSchool(schoolId);
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

    const students = await ppSvc.getStudentsForSchoolAndVehicle(schoolId, vehicleId, { session });
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
router.post('/pickup-points', async (req, res, next) => {
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

    const pointId = parseInt(req.params.id, 10);
    if (!Number.isInteger(pointId) || pointId <= 0) return sendError(res, 'invalid id', [], 400);

    const point = await ppSvc.getPickupPointById(pointId);
    if (!point) return sendError(res, 'ไม่พบจุดรับส่ง', [], 404);

    const vehicleOk = await ppSvc.validateVehicleServesSchool(point.vehicle_id, schoolId);
    if (!vehicleOk) return sendError(res, 'จุดรับส่งนี้ไม่ใช่ของโรงเรียนคุณ', [], 403);

    const students = await ppSvc.getAssignableStudentsForPickupPoint(point, { schoolId });
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
router.put('/pickup-points/:id/students', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);

    const pointId = parseInt(req.params.id, 10);
    if (!Number.isInteger(pointId) || pointId <= 0) return sendError(res, 'invalid id', [], 400);

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

    const result = await schoolSvc.getEmergencies(schoolId, { page, per_page });
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
       WHERE s.school_id = ? AND s.is_deleted = FALSE AND sl.id IS NULL
         AND ((? = 'morning' AND s.morning_enabled = TRUE AND (ds.morning_done IS NULL OR ds.morning_done = FALSE))
           OR (? = 'evening' AND s.evening_enabled = TRUE AND (ds.evening_done IS NULL OR ds.evening_done = FALSE))
           OR (? IS NULL AND (
             (s.morning_enabled = TRUE AND (ds.morning_done IS NULL OR ds.morning_done = FALSE))
             OR (s.evening_enabled = TRUE AND (ds.evening_done IS NULL OR ds.evening_done = FALSE))
           )))
       ORDER BY v.plate_no, s.first_name`,
      [today, today, session || 'morning', schoolId, session, session, session]
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
    const leaves = await leaveSvc.getLeavesForSchool(schoolId, date);
    return sendSuccess(res, leaves);
  } catch (err) { next(err); }
});

// ─── POST /leave ─────────────────────────────────────────────────────────────

router.post('/leave', async (req, res, next) => {
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

// ─── GET /roster-requests ────────────────────────────────────────────────────

router.get('/roster-requests', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const result = await rosterReqSvc.getRequestsForSchool(schoolId, {
      status: req.query.status, page, per_page: 20,
    });
    return sendSuccess(res, result.requests, 'OK', result.meta);
  } catch (err) { next(err); }
});

// ─── PUT /roster-requests/:id ────────────────────────────────────────────────

router.put('/roster-requests/:id', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const { status, review_note } = req.body;
    if (!['approved', 'rejected'].includes(status)) return sendError(res, "status ต้องเป็น 'approved' หรือ 'rejected'", [], 400);

    const result = await rosterReqSvc.reviewRequest({
      requestId: parseInt(req.params.id, 10),
      schoolId, status, reviewNote: review_note, userId: req.user.id,
    });
    return sendSuccess(res, result, status === 'approved' ? 'อนุมัติสำเร็จ' : 'ปฏิเสธสำเร็จ');
  } catch (err) { next(err); }
});

// ─── PUT /students/:id (update student profile + parent) ────────────────────

router.put('/students/:id', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const studentId = parseInt(req.params.id, 10);

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

      // 2. Update parent info (upsert first approved parent)
      if (parent_name !== undefined || normalizedParentPhone !== undefined) {
        const [[existingLink]] = await conn.query(
          `SELECT ps.parent_id FROM parent_student ps WHERE ps.student_id = ? LIMIT 1`,
          [studentId]
        );

        if (existingLink) {
          const pUpdates = [];
          const pParams = [];
          if (parent_name !== undefined) { pUpdates.push('name = ?'); pParams.push(parent_name || null); }
          if (normalizedParentPhone !== undefined) { pUpdates.push('phone = ?'); pParams.push(normalizedParentPhone || null); }
          if (pUpdates.length > 0) {
            pParams.push(existingLink.parent_id);
            await conn.query(`UPDATE parents SET ${pUpdates.join(', ')} WHERE id = ?`, pParams);
          }
        } else if (parent_name || normalizedParentPhone) {
          // Check for existing parent by phone to avoid duplicates
          let parentId;
          if (normalizedParentPhone) {
            const [[ep]] = await conn.query(
              `SELECT id FROM parents WHERE phone = ? AND is_deleted = FALSE LIMIT 1`,
              [normalizedParentPhone]
            );
            parentId = ep?.id;
          }
          if (!parentId) {
            const [parentResult] = await conn.query(
              `INSERT INTO parents (name, phone) VALUES (?, ?)`,
              [parent_name || null, normalizedParentPhone || null]
            );
            parentId = parentResult.insertId;
          }
          await conn.query(
            `INSERT INTO parent_student (parent_id, student_id, approved, approved_by, approved_at)
             VALUES (?, ?, TRUE, ?, NOW())
             ON DUPLICATE KEY UPDATE approved = TRUE`,
            [parentId, studentId, req.user.id]
          );
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
      return sendSuccess(res, { student_id: studentId }, 'บันทึกข้อมูลนักเรียนเรียบร้อยแล้ว');
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) { next(err); }
});

// ─── POST /students/move ─────────────────────────────────────────────────────

router.post('/students/move', async (req, res, next) => {
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

router.delete('/students/:id', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const studentId = parseInt(req.params.id, 10);

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

// ─── GET /vehicles/all (for vehicle dropdown) ───────────────────────────────

router.get('/vehicles/all', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, plate_no, vehicle_type FROM vehicles WHERE is_deleted = FALSE ORDER BY plate_no`
    );
    return sendSuccess(res, rows);
  } catch (err) { next(err); }
});

// ─── POST /vehicles ──────────────────────────────────────────────────────────

router.post('/vehicles', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    const { plate_no, vehicle_type, driver_name, driver_phone } = req.body;
    if (!plate_no) return sendError(res, 'กรุณากรอกทะเบียนรถ', [], 400);

    const crypto = require('crypto');
    const bcrypt = require('bcrypt');
    const trimmedPlate = plate_no.trim();
    const vehicleId = 'V-' + crypto.createHash('sha256').update(trimmedPlate).digest('hex').substring(0, 12);

    const conn = await pool.getConnection();
    let driverAccountCreated = false;

    try {
      await conn.beginTransaction();

      // 1. Create or reuse vehicle
      const [[existingVehicle]] = await conn.query(`SELECT id FROM vehicles WHERE plate_no = ?`, [trimmedPlate]);
      const vId = existingVehicle ? existingVehicle.id : vehicleId;
      if (!existingVehicle) {
        await conn.query(
          `INSERT INTO vehicles (id, plate_no, vehicle_type) VALUES (?, ?, ?)`,
          [vehicleId, trimmedPlate, vehicle_type || 'รถตู้']
        );
      }

      // 2. Create driver + assignment + user account if driver info provided
      if (driver_name) {
        // Check if a driver user account already exists for this plate
        const [[existingUser]] = await conn.query(
          `SELECT id FROM users WHERE username = ? AND role = 'driver' AND is_deleted = FALSE`, [trimmedPlate]
        );

        if (!existingUser) {
          // Create driver record
          const [dResult] = await conn.query(
            `INSERT INTO drivers (name, phone) VALUES (?, ?)`,
            [driver_name.trim(), driver_phone?.trim() || null]
          );

          // Create assignment
          await conn.query(
            `INSERT INTO driver_vehicle_assignments (driver_id, vehicle_id, start_date, is_active) VALUES (?, ?, CURDATE(), TRUE)`,
            [dResult.insertId, vId]
          );

          // Create user account: username = plate_no, password = plate_no, must change on first login
          const hash = await bcrypt.hash(trimmedPlate, 12);
          await conn.query(
            `INSERT INTO users (username, password_hash, role, display_name, must_change_password)
             VALUES (?, ?, 'driver', ?, TRUE)`,
            [trimmedPlate, hash, driver_name.trim()]
          );
          driverAccountCreated = true;
        } else {
          // User exists — just ensure assignment exists for this vehicle
          const [[existingAssignment]] = await conn.query(
            `SELECT dva.id FROM driver_vehicle_assignments dva
             JOIN users u ON u.role = 'driver' AND u.username = ?
             JOIN drivers d ON d.id = dva.driver_id
             WHERE dva.vehicle_id = ? AND dva.is_active = TRUE LIMIT 1`,
            [trimmedPlate, vId]
          );
          if (!existingAssignment) {
            // Find driver_id from existing assignments for this plate
            const [[driverRow]] = await conn.query(
              `SELECT dva.driver_id FROM driver_vehicle_assignments dva
               JOIN vehicles v ON v.id = dva.vehicle_id AND v.plate_no = ?
               WHERE dva.is_active = TRUE LIMIT 1`,
              [trimmedPlate]
            );
            if (driverRow) {
              await conn.query(
                `INSERT INTO driver_vehicle_assignments (driver_id, vehicle_id, start_date, is_active) VALUES (?, ?, CURDATE(), TRUE)`,
                [driverRow.driver_id, vId]
              );
            }
          }
        }
      }

      await logAudit({
        userId: req.user.id, action: 'CREATE', entityType: 'vehicle', entityId: vId,
        newValue: { plate_no: trimmedPlate, vehicle_type, driver_name, driverAccountCreated },
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
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) { next(err); }
});

// ─── GET /audit-logs ─────────────────────────────────────────────────────────
// Audit trail for school actions

router.get('/audit-logs', async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 30));
    const offset = (page - 1) * per_page;
    const { action, date_from, date_to } = req.query;
    const isValidDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);

    let scopeWhere = `((u.scope_id = ? AND u.scope_type = 'SCHOOL')
       OR (al.entity_type IN ('student','roster_request') AND al.entity_id IN (
         SELECT CAST(s.id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci FROM students s WHERE s.school_id = ?
       )))`;
    const params = [schoolId, schoolId];

    if (action) { scopeWhere += ' AND al.action = ?'; params.push(action); }
    if (date_from && isValidDate(date_from)) { scopeWhere += ' AND al.created_at >= ?'; params.push(`${date_from} 00:00:00`); }
    if (date_to && isValidDate(date_to)) { scopeWhere += ' AND al.created_at <= ?'; params.push(`${date_to} 23:59:59`); }

    // CSV export mode
    if (req.query.format === 'csv') {
      const [rows] = await pool.query(
        `SELECT al.id, al.action, al.entity_type, al.entity_id,
                al.old_value, al.new_value, al.created_at,
                u.display_name AS actor_name, u.role AS actor_role
         FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
         WHERE ${scopeWhere} ORDER BY al.created_at DESC LIMIT 5000`,
        params
      );
      const csv = auditRowsToCsv(rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=audit_school_${new Date().toISOString().split('T')[0]}.csv`);
      return res.send('\uFEFF' + csv);
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

    return sendSuccess(res, rows, 'OK', { page, per_page, total });
  } catch (err) { next(err); }
});

// ─── GET /students/template ──────────────────────────────────────────────────
// Download Excel template for student import

router.get('/students/template', async (req, res, next) => {
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

router.post('/students/import', importUpload.single('file'), async (req, res, next) => {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return sendError(res, req.user.role === 'admin' ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], req.user.role === 'admin' ? 400 : 403);
    if (!req.file) return sendError(res, 'กรุณาเลือกไฟล์ (.xlsx หรือ .csv)', [], 400);

    const ext = path.extname(req.file.originalname).toLowerCase();
    const rows = [];

    if (ext === '.csv') {
      // Parse CSV (UTF-8 with BOM support)
      const raw = fs.readFileSync(req.file.path, 'utf-8').replace(/^\uFEFF/, '');
      const lines = raw.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return sendError(res, 'ไม่พบข้อมูลในไฟล์ (ไม่มีแถวข้อมูล)', [], 400);

      // Detect column order from header
      const headers = lines[0].split(',').map(h => h.trim().replace(/\*/g, ''));
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

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim());
        const get = (key) => cols[colMap[key]] || '';
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
      await wb.xlsx.readFile(req.file.path);
      const ws = wb.getWorksheet(1) || wb.worksheets[0];
      if (!ws) return sendError(res, 'ไม่พบข้อมูลในไฟล์', [], 400);

      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const get = (col) => {
          const cell = row.getCell(col);
          return cell.value !== null && cell.value !== undefined ? String(cell.value).trim() : '';
        };
        // Columns: 1=รหัส 2=คำนำหน้า 3=ชื่อ 4=นามสกุล 5=ชั้น 6=ห้อง 7=ผู้ปกครอง 8=เบอร์โทร 9=ทะเบียนรถ
        rows.push({
          rowNum,
          id: get(1), prefix: get(2),
          first_name: get(3), last_name: get(4),
          grade: get(5), classroom: get(6),
          parent_name: get(7), parent_phone: get(8),
          plate_no: get(9),
          morning: '', evening: '',
        });
      });
    }

    if (rows.length === 0) return sendError(res, 'ไม่พบข้อมูลในไฟล์ (ไม่มีแถวข้อมูล)', [], 400);

    // Pre-load vehicles for plate lookup
    const [allVehicles] = await pool.query(`SELECT id, plate_no FROM vehicles WHERE is_deleted = FALSE`);
    const plateMap = {};
    for (const v of allVehicles) plateMap[v.plate_no.toLowerCase()] = v.id;

    const crypto = require('crypto');
    const results = { success: 0, vehicle_linked: 0, errors: [] };

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const r of rows) {
        // Validate required fields
        const studentId = parseInt(r.id, 10);
        if (!studentId || isNaN(studentId)) {
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

        // Check duplicate (including soft-deleted — use INSERT ... ON DUPLICATE for reactivation)
        const [[existing]] = await conn.query(`SELECT id, is_deleted FROM students WHERE id = ?`, [studentId]);
        if (existing && !existing.is_deleted) {
          results.errors.push({ row: r.rowNum, message: `รหัสนักเรียน ${studentId} มีอยู่ในระบบแล้ว` });
          continue;
        }

        // Normalize + validate parent phone
        r.parent_phone = normalizePhone(r.parent_phone);
        if (r.parent_phone && !/^\d{10}$/.test(r.parent_phone)) {
          results.errors.push({ row: r.rowNum, message: 'เบอร์โทรผู้ปกครองต้องเป็นตัวเลข 10 หลัก (รองรับ 0XX-XXXXXXX)' });
          continue;
        }

        // Resolve vehicle
        let vehicleId = null;
        if (r.plate_no) {
          vehicleId = plateMap[r.plate_no.toLowerCase()] || null;
          if (!vehicleId) {
            results.errors.push({ row: r.rowNum, message: `ไม่พบรถทะเบียน "${r.plate_no}"` });
            continue;
          }
        }

        // Generate cid_hash placeholder (unique per row)
        const cidHash = crypto.createHash('sha256').update(`import-${studentId}-${Date.now()}-${r.rowNum}`).digest('hex');

        const morningEnabled = (r.morning || '').toUpperCase() === 'N' ? 0 : 1;
        const eveningEnabled = (r.evening || '').toUpperCase() === 'N' ? 0 : 1;

        // Insert or reactivate student
        try {
          if (existing && existing.is_deleted) {
            // Reactivate soft-deleted student with new data
            await conn.query(
              `UPDATE students SET cid_hash = ?, prefix = ?, first_name = ?, last_name = ?,
               grade = ?, classroom = ?, school_id = ?, vehicle_id = ?,
               morning_enabled = ?, evening_enabled = ?, term_id = ?,
               is_deleted = FALSE, deleted_at = NULL
               WHERE id = ?`,
              [cidHash, r.prefix || null, r.first_name, r.last_name,
               r.grade || null, r.classroom || null, schoolId, vehicleId,
               morningEnabled, eveningEnabled, env.app.currentTerm, studentId]
            );
          } else {
            await conn.query(
              `INSERT INTO students (id, cid_hash, prefix, first_name, last_name, grade, classroom, school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [studentId, cidHash, r.prefix || null, r.first_name, r.last_name,
               r.grade || null, r.classroom || null, schoolId, vehicleId,
               morningEnabled, eveningEnabled, env.app.currentTerm]
            );
          }
        } catch (insertErr) {
          results.errors.push({ row: r.rowNum, message: `บันทึกรหัส ${studentId} ไม่สำเร็จ: ${insertErr.code || insertErr.message}` });
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
            [parentId, studentId, req.user.id]
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

    // Cleanup uploaded file
    fs.unlink(req.file.path, () => {});

    const message = `นำเข้าสำเร็จ ${results.success} รายการ` +
      (results.vehicle_linked > 0 ? ` (ผูกรถ ${results.vehicle_linked} คน)` : '') +
      (results.errors.length > 0 ? ` · ไม่สำเร็จ ${results.errors.length} รายการ` : '');

    return sendSuccess(res, results, message, null, results.success > 0 ? 201 : 200);
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
    const vehicles = await vllSvc.listForSchool(schoolId);
    return sendSuccess(res, { vehicles, generated_at: new Date().toISOString() });
  } catch (err) { next(err); }
});

module.exports = router;
