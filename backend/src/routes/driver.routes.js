'use strict';

/**
 * driver.routes.js
 *
 * All routes require:  authenticate  +  requireRole('driver')
 *
 * GET  /api/driver/roster               — roster for driver's active vehicle (today)
 * GET  /api/driver/roster?session=X     — filtered by morning | evening
 * POST /api/driver/checkin              — check-in one student
 * POST /api/driver/checkout             — check-out one student
 * POST /api/driver/checkin-all          — check-in all pending students in vehicle
 * POST /api/driver/emergency            — report an emergency
 * GET  /api/driver/status-today         — daily summary for the vehicle
 */

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { pool }          = require('../config/database');
const { authenticate }  = require('../middleware/auth');
const { requireRole }   = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { logAudit }      = require('../utils/audit');
const checkinSvc        = require('../services/checkin.service');
const leaveSvc          = require('../services/leave.service');
const rosterReqSvc      = require('../services/rosterRequest.service');

// Photo upload config
const uploadDir = path.join(__dirname, '../../uploads/drivers');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${req.user.id}-${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

const router = express.Router();

// Apply auth + role guard to every route in this file
router.use(authenticate, requireRole('driver'));

// ─── GET /roster ─────────────────────────────────────────────────────────────

router.get('/roster', async (req, res, next) => {
  try {
    const session = req.query.session; // 'morning' | 'evening' | undefined

    if (session && !['morning', 'evening'].includes(session)) {
      return sendError(res, "session must be 'morning' or 'evening'", [], 400);
    }

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);
    const students = await checkinSvc.getRoster(pool, vehicle.vehicle_id, session);

    return sendSuccess(res, {
      vehicle: {
        id:       vehicle.vehicle_id,
        plate_no: vehicle.plate_no,
      },
      session:  session || 'all',
      date:     new Date().toISOString().split('T')[0],
      students,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /checkin ────────────────────────────────────────────────────────────

router.post('/checkin', async (req, res, next) => {
  try {
    const { student_id, session } = req.body;

    if (!student_id || !session) {
      return sendError(res, 'student_id and session are required', [
        ...(!student_id ? [{ field: 'student_id', message: 'จำเป็นต้องระบุรหัสนักเรียน' }] : []),
        ...(!session ? [{ field: 'session', message: 'จำเป็นต้องระบุรอบ (morning/evening)' }] : []),
      ], 400);
    }
    if (!['morning', 'evening'].includes(session)) {
      return sendError(res, "session must be 'morning' or 'evening'", [{ field: 'session', message: "ต้องเป็น 'morning' หรือ 'evening'" }], 400);
    }

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);

    const result = await checkinSvc.processCheckin(pool, {
      userId:    req.user.id,
      vehicleId: vehicle.vehicle_id,
      plateNo:   vehicle.plate_no,
      studentId: parseInt(student_id, 10),
      session,
      source:    'web',
    });

    return sendSuccess(res, result, 'Student checked in successfully', null, 201);
  } catch (err) {
    return next(err);
  }
});

// ─── POST /checkout ───────────────────────────────────────────────────────────

router.post('/checkout', async (req, res, next) => {
  try {
    const { student_id, session } = req.body;

    if (!student_id || !session) {
      return sendError(res, 'student_id and session are required', [
        ...(!student_id ? [{ field: 'student_id', message: 'จำเป็นต้องระบุรหัสนักเรียน' }] : []),
        ...(!session ? [{ field: 'session', message: 'จำเป็นต้องระบุรอบ (morning/evening)' }] : []),
      ], 400);
    }
    if (!['morning', 'evening'].includes(session)) {
      return sendError(res, "session must be 'morning' or 'evening'", [{ field: 'session', message: "ต้องเป็น 'morning' หรือ 'evening'" }], 400);
    }

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);

    const result = await checkinSvc.processCheckout(pool, {
      userId:    req.user.id,
      vehicleId: vehicle.vehicle_id,
      plateNo:   vehicle.plate_no,
      studentId: parseInt(student_id, 10),
      session,
      source:    'web',
    });

    return sendSuccess(res, result, 'Student checked out successfully', null, 201);
  } catch (err) {
    return next(err);
  }
});

// ─── POST /checkin-all ────────────────────────────────────────────────────────

router.post('/checkin-all', async (req, res, next) => {
  try {
    const { session } = req.body;

    if (!session) {
      return sendError(res, 'session is required', [{ field: 'session', message: 'จำเป็นต้องระบุรอบ (morning/evening)' }], 400);
    }
    if (!['morning', 'evening'].includes(session)) {
      return sendError(res, "session must be 'morning' or 'evening'", [{ field: 'session', message: "ต้องเป็น 'morning' หรือ 'evening'" }], 400);
    }

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);

    const result = await checkinSvc.processCheckinAll(pool, {
      userId:    req.user.id,
      vehicleId: vehicle.vehicle_id,
      plateNo:   vehicle.plate_no,
      session,
      source:    'web',
    });

    const message = `Checked in ${result.succeeded.length} student(s)` +
      (result.failed.length > 0 ? `, ${result.failed.length} failed` : '');

    return sendSuccess(res, result, message, null, 201);
  } catch (err) {
    return next(err);
  }
});

// ─── POST /emergency ──────────────────────────────────────────────────────────

router.post('/emergency', async (req, res, next) => {
  try {
    const { detail, note } = req.body;

    if (!detail) {
      return sendError(res, 'detail is required', [], 400);
    }

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);

    const [result] = await pool.query(
      `INSERT INTO emergency_logs
         (reported_by, channel, vehicle_id, plate_no, detail, note)
       VALUES (?, 'web', ?, ?, ?, ?)`,
      [req.user.id, vehicle.vehicle_id, vehicle.plate_no, detail, note || null]
    );

    await logAudit({
      userId:     req.user.id,
      action:     'CREATE',
      entityType: 'emergency',
      entityId:   result.insertId,
      newValue:   { vehicleId: vehicle.vehicle_id, plateNo: vehicle.plate_no, detail },
      ipAddress:  req.ip,
      userAgent:  req.headers['user-agent'],
    });

    return sendSuccess(
      res,
      { id: result.insertId, vehicle_id: vehicle.vehicle_id, plate_no: vehicle.plate_no },
      'Emergency reported',
      null,
      201
    );
  } catch (err) {
    return next(err);
  }
});

// ─── GET /status-today ────────────────────────────────────────────────────────

router.get('/status-today', async (req, res, next) => {
  try {
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);
    const status  = await checkinSvc.getStatusToday(pool, vehicle.vehicle_id);

    return sendSuccess(res, {
      vehicle: {
        id:       vehicle.vehicle_id,
        plate_no: vehicle.plate_no,
      },
      date: new Date().toISOString().split('T')[0],
      ...status,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /profile ────────────────────────────────────────────────────────────

router.get('/profile', async (req, res, next) => {
  try {
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);
    const [[driver]] = await pool.query(
      `SELECT d.id, d.name, d.phone, d.photo_url,
              v.plate_no, v.vehicle_type, v.owner_name, v.owner_phone,
              va.name AS attendant_name, va.phone AS attendant_phone
       FROM drivers d
       JOIN driver_vehicle_assignments dva ON dva.driver_id = d.id AND dva.is_active = TRUE
       JOIN vehicles v ON v.id = dva.vehicle_id
       LEFT JOIN vehicle_attendants va ON va.vehicle_id = v.id
       WHERE v.id = ?
       LIMIT 1`,
      [vehicle.vehicle_id]
    );
    return sendSuccess(res, { ...driver, vehicle_id: vehicle.vehicle_id });
  } catch (err) { return next(err); }
});

// ─── PUT /profile ────────────────────────────────────────────────────────────

router.put('/profile', async (req, res, next) => {
  try {
    const { name, phone } = req.body;
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);

    // Find driver id
    const [[dva]] = await pool.query(
      `SELECT driver_id FROM driver_vehicle_assignments WHERE vehicle_id = ? AND is_active = TRUE LIMIT 1`,
      [vehicle.vehicle_id]
    );
    if (!dva) return sendError(res, 'ไม่พบข้อมูลคนขับ', [], 404);

    const updates = [];
    const params = [];
    if (name) { updates.push('name = ?'); params.push(name); }
    if (phone) { updates.push('phone = ?'); params.push(phone); }
    if (updates.length === 0) return sendError(res, 'ไม่มีข้อมูลที่ต้องการแก้ไข', [], 400);

    params.push(dva.driver_id);
    await pool.query(`UPDATE drivers SET ${updates.join(', ')} WHERE id = ?`, params);

    await logAudit({
      userId: req.user.id, action: 'UPDATE', entityType: 'driver', entityId: dva.driver_id,
      newValue: { name, phone }, ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, { driver_id: dva.driver_id }, 'อัปเดตข้อมูลสำเร็จ');
  } catch (err) { return next(err); }
});

// ─── POST /profile/photo ─────────────────────────────────────────────────────

router.post('/profile/photo', upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return sendError(res, 'กรุณาเลือกไฟล์รูปภาพ (.jpg, .png, .webp ขนาดไม่เกิน 2MB)', [], 400);

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);
    const [[dva]] = await pool.query(
      `SELECT driver_id FROM driver_vehicle_assignments WHERE vehicle_id = ? AND is_active = TRUE LIMIT 1`,
      [vehicle.vehicle_id]
    );
    if (!dva) return sendError(res, 'ไม่พบข้อมูลคนขับ', [], 404);

    const photoUrl = `/uploads/drivers/${req.file.filename}`;
    await pool.query(`UPDATE drivers SET photo_url = ? WHERE id = ?`, [photoUrl, dva.driver_id]);

    await logAudit({
      userId: req.user.id, action: 'UPDATE', entityType: 'driver', entityId: dva.driver_id,
      newValue: { photo_url: photoUrl }, ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, { photo_url: photoUrl }, 'อัปโหลดรูปสำเร็จ');
  } catch (err) { return next(err); }
});

// ─── POST /change-password ───────────────────────────────────────────────────

router.post('/change-password', async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return sendError(res, 'กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่', [], 400);
    if (String(new_password).length < 4) return sendError(res, 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร', [], 400);

    const bcrypt = require('bcrypt');
    const [[user]] = await pool.query(`SELECT password_hash FROM users WHERE id = ? AND is_deleted = FALSE`, [req.user.id]);
    if (!user) return sendError(res, 'ไม่พบผู้ใช้', [], 404);

    const match = await bcrypt.compare(String(current_password), user.password_hash);
    if (!match) return sendError(res, 'รหัสผ่านเดิมไม่ถูกต้อง', [], 400);

    const newHash = await bcrypt.hash(String(new_password), 12);
    await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [newHash, req.user.id]);

    await logAudit({
      userId: req.user.id, action: 'UPDATE', entityType: 'user', entityId: req.user.id,
      newValue: { action: 'password_changed' }, ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, null, 'เปลี่ยนรหัสผ่านสำเร็จ');
  } catch (err) { return next(err); }
});

// ─── POST /leave ─────────────────────────────────────────────────────────────

router.post('/leave', async (req, res, next) => {
  try {
    const { student_id, leave_date, session, reason } = req.body;
    if (!student_id || !session) return sendError(res, 'student_id and session are required', [], 400);
    if (!['morning', 'evening', 'both'].includes(session)) return sendError(res, "session ต้องเป็น 'morning', 'evening' หรือ 'both'", [], 400);

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);
    const date = leave_date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

    const result = await leaveSvc.createLeave({
      studentId: student_id, vehicleId: vehicle.vehicle_id,
      leaveDate: date, session, reason, userId: req.user.id, userRole: 'driver',
    });
    return sendSuccess(res, result, 'บันทึกการลาสำเร็จ', null, 201);
  } catch (err) { return next(err); }
});

// ─── DELETE /leave/:id ───────────────────────────────────────────────────────

router.delete('/leave/:id', async (req, res, next) => {
  try {
    const result = await leaveSvc.cancelLeave(parseInt(req.params.id, 10), req.user.id);
    return sendSuccess(res, result, 'ยกเลิกการลาสำเร็จ');
  } catch (err) { return next(err); }
});

// ─── GET /leaves ─────────────────────────────────────────────────────────────

router.get('/leaves', async (req, res, next) => {
  try {
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);
    const date = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const leaves = await leaveSvc.getLeavesForVehicle(vehicle.vehicle_id, date);
    return sendSuccess(res, leaves);
  } catch (err) { return next(err); }
});

// ─── POST /roster-request ────────────────────────────────────────────────────

router.post('/roster-request', async (req, res, next) => {
  try {
    const { student_id, request_type, reason } = req.body;
    if (!student_id || !request_type) return sendError(res, 'student_id and request_type are required', [], 400);
    if (!['add', 'remove'].includes(request_type)) return sendError(res, "request_type ต้องเป็น 'add' หรือ 'remove'", [], 400);

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);

    const result = await rosterReqSvc.createRequest({
      vehicleId: vehicle.vehicle_id, studentId: student_id,
      requestType: request_type, reason, userId: req.user.id,
    });
    return sendSuccess(res, result, 'ส่งคำขอสำเร็จ', null, 201);
  } catch (err) { return next(err); }
});

// ─── GET /roster-requests ────────────────────────────────────────────────────

router.get('/roster-requests', async (req, res, next) => {
  try {
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const result = await rosterReqSvc.getRequestsForDriver(vehicle.vehicle_id, {
      status: req.query.status, page, per_page: 20,
    });
    return sendSuccess(res, result.requests, 'OK', result.meta);
  } catch (err) { return next(err); }
});

module.exports = router;
