'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { pool } = require('../config/database');
const schoolSvc = require('../services/school.service');
const leaveSvc = require('../services/leave.service');
const rosterReqSvc = require('../services/rosterRequest.service');

// All school routes require authentication + role 'school'
router.use(authenticate, requireRole('school'));

/**
 * GET /api/school/dashboard
 * Dashboard summary for the school user's own school.
 */
router.get('/dashboard', async (req, res, next) => {
  try {
    const schoolId = req.user.scopeId;
    if (!schoolId) return sendError(res, 'ไม่พบข้อมูลโรงเรียนที่ผูกกับบัญชีนี้', [], 403);

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
    const schoolId = req.user.scopeId;
    if (!schoolId) return sendError(res, 'ไม่พบข้อมูลโรงเรียนที่ผูกกับบัญชีนี้', [], 403);

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
    const schoolId = req.user.scopeId;
    if (!schoolId) return sendError(res, 'ไม่พบข้อมูลโรงเรียนที่ผูกกับบัญชีนี้', [], 403);

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
    const schoolId = req.user.scopeId;
    if (!schoolId) return sendError(res, 'ไม่พบข้อมูลโรงเรียนที่ผูกกับบัญชีนี้', [], 403);

    const data = await schoolSvc.getStatusToday(schoolId);
    return sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/school/emergencies
 * Emergency logs for vehicles serving this school.
 * Query params: page, per_page
 */
router.get('/emergencies', async (req, res, next) => {
  try {
    const schoolId = req.user.scopeId;
    if (!schoolId) return sendError(res, 'ไม่พบข้อมูลโรงเรียนที่ผูกกับบัญชีนี้', [], 403);

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
    const schoolId = req.user.scopeId;
    if (!schoolId) return sendError(res, 'ไม่พบข้อมูลโรงเรียน', [], 403);
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
    const schoolId = req.user.scopeId;
    if (!schoolId) return sendError(res, 'ไม่พบข้อมูลโรงเรียน', [], 403);
    const date = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const leaves = await leaveSvc.getLeavesForSchool(schoolId, date);
    return sendSuccess(res, leaves);
  } catch (err) { next(err); }
});

// ─── POST /leave ─────────────────────────────────────────────────────────────

router.post('/leave', async (req, res, next) => {
  try {
    const schoolId = req.user.scopeId;
    if (!schoolId) return sendError(res, 'ไม่พบข้อมูลโรงเรียน', [], 403);
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
    const schoolId = req.user.scopeId;
    if (!schoolId) return sendError(res, 'ไม่พบข้อมูลโรงเรียน', [], 403);
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
    const schoolId = req.user.scopeId;
    if (!schoolId) return sendError(res, 'ไม่พบข้อมูลโรงเรียน', [], 403);
    const { status, review_note } = req.body;
    if (!['approved', 'rejected'].includes(status)) return sendError(res, "status ต้องเป็น 'approved' หรือ 'rejected'", [], 400);

    const result = await rosterReqSvc.reviewRequest({
      requestId: parseInt(req.params.id, 10),
      schoolId, status, reviewNote: review_note, userId: req.user.id,
    });
    return sendSuccess(res, result, status === 'approved' ? 'อนุมัติสำเร็จ' : 'ปฏิเสธสำเร็จ');
  } catch (err) { next(err); }
});

// ─── POST /students/move ─────────────────────────────────────────────────────

router.post('/students/move', async (req, res, next) => {
  try {
    const schoolId = req.user.scopeId;
    if (!schoolId) return sendError(res, 'ไม่พบข้อมูลโรงเรียน', [], 403);
    const { student_id, vehicle_id } = req.body;
    if (!student_id) return sendError(res, 'student_id is required', [], 400);

    const [[st]] = await pool.query(
      `SELECT id FROM students WHERE id = ? AND school_id = ? AND is_deleted = FALSE`, [student_id, schoolId]
    );
    if (!st) return sendError(res, 'ไม่พบนักเรียนในโรงเรียนนี้', [], 404);

    await pool.query(`UPDATE students SET vehicle_id = ? WHERE id = ?`, [vehicle_id || null, student_id]);
    return sendSuccess(res, { student_id, vehicle_id: vehicle_id || null }, 'ย้ายรถสำเร็จ');
  } catch (err) { next(err); }
});

// ─── POST /vehicles ──────────────────────────────────────────────────────────

router.post('/vehicles', async (req, res, next) => {
  try {
    const schoolId = req.user.scopeId;
    if (!schoolId) return sendError(res, 'ไม่พบข้อมูลโรงเรียน', [], 403);
    const { plate_no, vehicle_type, driver_name, driver_phone } = req.body;
    if (!plate_no) return sendError(res, 'กรุณากรอกทะเบียนรถ', [], 400);

    const crypto = require('crypto');
    const vehicleId = 'V-' + crypto.createHash('sha256').update(plate_no).digest('hex').substring(0, 12);

    // Check if vehicle exists
    const [[existing]] = await pool.query(`SELECT id FROM vehicles WHERE plate_no = ?`, [plate_no.trim()]);
    if (!existing) {
      await pool.query(
        `INSERT INTO vehicles (id, plate_no, vehicle_type) VALUES (?, ?, ?)`,
        [vehicleId, plate_no.trim(), vehicle_type || 'รถตู้']
      );
    }
    const vId = existing ? existing.id : vehicleId;

    // Create driver + assignment if driver name provided
    if (driver_name) {
      const [dResult] = await pool.query(
        `INSERT INTO drivers (name, phone) VALUES (?, ?)`,
        [driver_name.trim(), driver_phone?.trim() || null]
      );
      await pool.query(
        `INSERT INTO driver_vehicle_assignments (driver_id, vehicle_id, start_date, is_active) VALUES (?, ?, CURDATE(), TRUE)`,
        [dResult.insertId, vId]
      );

      // Create driver user account: username = plate_no, password = 1234
      const bcrypt = require('bcrypt');
      const hash = await bcrypt.hash('1234', 12);
      await pool.query(
        `INSERT INTO users (username, password_hash, role, display_name)
         VALUES (?, ?, 'driver', ?) ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
        [plate_no.trim(), hash, driver_name.trim()]
      ).catch(() => {}); // ignore if username already exists
    }

    const { logAudit } = require('../utils/audit');
    await logAudit({
      userId: req.user.id, action: 'CREATE', entityType: 'vehicle', entityId: vId,
      newValue: { plate_no, vehicle_type, driver_name }, ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, { vehicle_id: vId, plate_no: plate_no.trim() }, 'เพิ่มรถสำเร็จ', null, 201);
  } catch (err) { next(err); }
});

module.exports = router;
