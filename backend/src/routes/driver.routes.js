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
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { pool }          = require('../config/database');
const { authenticate }  = require('../middleware/auth');
const { requireRole }   = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { logAudit }      = require('../utils/audit');
const checkinSvc        = require('../services/checkin.service');
const ppSvc             = require('../services/pickupPoint.service');
const leaveSvc          = require('../services/leave.service');
const rosterReqSvc      = require('../services/rosterRequest.service');
const vllSvc            = require('../services/vehicleLocation.service');

// Phase 7.2 — per-driver rate limit on the location-write endpoint.
// Keyed on req.user.id (NOT IP) so multiple drivers behind one NAT
// don't share quota. 6 writes per 60s = one every ~10s allowed
// (frontend will only send every 15s + 30m-moved; this gives headroom
// for retries after a transient network hiccup).
const driverLocationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `drv-loc:${req.user?.id || ipKeyGenerator(req.ip)}`,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, message: 'ส่งตำแหน่งถี่เกินไป กรุณารอสักครู่', errors: [], data: null },
});

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

// ─── GET /api/driver/pickup-points ──────────────────────────────────────────
// Phase 6: read-only list of pickup points + assigned students for the
// driver's currently-assigned vehicle. Optional ?session=morning|evening
// narrows to points serving that session (or 'both').
router.get('/pickup-points', async (req, res, next) => {
  try {
    const session = req.query.session;
    if (session && !['morning', 'evening'].includes(session)) {
      return sendError(res, "session must be 'morning' or 'evening'", [], 400);
    }

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);
    if (!vehicle) return sendError(res, 'ไม่พบรถที่ลงทะเบียน', [], 404);

    const points = await ppSvc.getPickupPointsForVehicle(vehicle.vehicle_id, { session });
    return sendSuccess(res, {
      vehicle: { id: vehicle.vehicle_id, plate_no: vehicle.plate_no },
      session: session || 'all',
      points,
    });
  } catch (err) { return next(err); }
});

// ─── GET /api/driver/pickup-students ────────────────────────────────────────
// Phase 6.1: pre-loaded student checklist for the create-pickup modal.
// Lightweight roster of the driver's vehicle (no PII — no phone, no cid).
//
// Phase 6.1 hotfix-4: optional ?session=morning|evening|both filters out
// students who are already assigned to another pickup point with a
// conflicting session on the same vehicle. Frontend re-fetches when the
// session radio changes. Without the param, returns the full roster
// (backward compatible).
router.get('/pickup-students', async (req, res, next) => {
  try {
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);
    if (!vehicle) return sendError(res, 'ไม่พบรถที่ลงทะเบียน', [], 404);

    const session = req.query.session;
    if (session && !['morning', 'evening', 'both'].includes(session)) {
      return sendError(res, "session must be 'morning', 'evening', or 'both'", [], 400);
    }

    const students = await ppSvc.getStudentsForVehicle(vehicle.vehicle_id, { session });
    return sendSuccess(res, students);
  } catch (err) { return next(err); }
});

// ─── POST /api/driver/pickup-points ─────────────────────────────────────────
// Phase 6.1: driver creates a pickup point for THEIR OWN vehicle and
// (optionally) assigns selected students in one atomic transaction.
//
// Scope is enforced server-side: vehicle_id is overwritten from the JWT
// (any client-supplied value is ignored), and every student_id in the
// payload is validated to belong to that vehicle.
router.post('/pickup-points', async (req, res, next) => {
  try {
    // Input validation
    const errors = [];
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

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);
    if (!vehicle) return sendError(res, 'ไม่พบรถที่ลงทะเบียน', [], 404);

    // Driver can only create points for OWN vehicle — overwrite vehicle_id
    // from JWT scope, ignoring any client-supplied value.
    const input = { ...req.body, vehicle_id: vehicle.vehicle_id };

    const studentIds = Array.isArray(req.body.student_ids)
      ? req.body.student_ids.map(Number).filter(Number.isInteger)
      : [];

    if (studentIds.length > 0) {
      const ok = await ppSvc.validateStudentsBelongToVehicle(studentIds, vehicle.vehicle_id);
      if (!ok) return sendError(res, 'นักเรียนบางรายไม่ใช่ของรถคันนี้', [], 400);

      // Phase 6.1 hotfix-4: server-side duplicate-assignment guard.
      // Prevents the same student from being assigned to multiple pickup
      // points with conflicting sessions on the same vehicle, even if
      // the frontend filter was bypassed.
      const noDup = await ppSvc.validateNoDuplicateAssignmentsForVehicle(
        studentIds, vehicle.vehicle_id, input.session || 'both'
      );
      if (!noDup) return sendError(res, 'นักเรียนบางรายมีจุดรับส่งในรอบนี้แล้ว', [], 400);
    }

    const id = await ppSvc.createPickupPointWithStudents(input, studentIds, {
      actorId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, { id }, 'สร้างจุดรับส่งสำเร็จ', null, 201);
  } catch (err) { return next(err); }
});

// ─── GET /api/driver/pickup-points/:id/assignable-students ──────────────────
// Phase 6.1 hotfix-7: feeds the edit-students modal. Returns the
// driver-vehicle's roster filtered to students that can be ON this
// point — i.e. either currently assigned (so they pre-check) OR not
// in conflict with another point's session.
router.get('/pickup-points/:id/assignable-students', async (req, res, next) => {
  try {
    const pointId = parseInt(req.params.id, 10);
    if (!Number.isInteger(pointId) || pointId <= 0) return sendError(res, 'invalid id', [], 400);

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);
    if (!vehicle) return sendError(res, 'ไม่พบรถที่ลงทะเบียน', [], 404);

    const point = await ppSvc.getPickupPointById(pointId);
    if (!point) return sendError(res, 'ไม่พบจุดรับส่ง', [], 404);
    if (point.vehicle_id !== vehicle.vehicle_id) {
      return sendError(res, 'จุดรับส่งนี้ไม่ใช่ของรถคุณ', [], 403);
    }

    const students = await ppSvc.getAssignableStudentsForPickupPoint(point);
    return sendSuccess(res, { point, students });
  } catch (err) { return next(err); }
});

// ─── PUT /api/driver/pickup-points/:id/students ─────────────────────────────
// Phase 6.1 hotfix-7: replace the student list of an existing pickup
// point. Driver can only edit points belonging to their own vehicle;
// every student_id must belong to that vehicle; no conflicts with
// OTHER points (this point is excluded from the conflict check).
router.put('/pickup-points/:id/students', async (req, res, next) => {
  try {
    const pointId = parseInt(req.params.id, 10);
    if (!Number.isInteger(pointId) || pointId <= 0) return sendError(res, 'invalid id', [], 400);

    if (!Array.isArray(req.body.student_ids)) {
      return sendError(res, 'student_ids must be an array', [], 400);
    }
    const studentIds = req.body.student_ids.map(Number).filter(Number.isInteger);

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);
    if (!vehicle) return sendError(res, 'ไม่พบรถที่ลงทะเบียน', [], 404);

    const point = await ppSvc.getPickupPointById(pointId);
    if (!point) return sendError(res, 'ไม่พบจุดรับส่ง', [], 404);
    if (point.vehicle_id !== vehicle.vehicle_id) {
      return sendError(res, 'จุดรับส่งนี้ไม่ใช่ของรถคุณ', [], 403);
    }

    if (studentIds.length > 0) {
      const ok = await ppSvc.validateStudentsBelongToVehicle(studentIds, vehicle.vehicle_id);
      if (!ok) return sendError(res, 'นักเรียนบางรายไม่ใช่ของรถคันนี้', [], 400);

      const noDup = await ppSvc.validateNoDuplicateAssignmentsForVehicle(
        studentIds, vehicle.vehicle_id, point.session, { excludePointId: pointId }
      );
      if (!noDup) return sendError(res, 'นักเรียนบางรายมีจุดรับส่งในรอบนี้แล้ว', [], 400);
    }

    const result = await ppSvc.replacePickupPointStudents(pointId, studentIds, {
      actorId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, result, 'อัปเดตรายชื่อนักเรียนสำเร็จ');
  } catch (err) { return next(err); }
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
              v.insurance_status, v.insurance_type, v.insurance_expiry,
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
    const {
      name, phone,
      vehicle_type, owner_name, owner_phone,
      insurance_type, insurance_status, insurance_expiry,
      attendant_name, attendant_phone,
    } = req.body;

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);

    // Find driver id
    const [[dva]] = await pool.query(
      `SELECT driver_id FROM driver_vehicle_assignments WHERE vehicle_id = ? AND is_active = TRUE LIMIT 1`,
      [vehicle.vehicle_id]
    );
    if (!dva) return sendError(res, 'ไม่พบข้อมูลคนขับ', [], 404);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1. Update driver fields
      const driverUpdates = [];
      const driverParams = [];
      if (name !== undefined) { driverUpdates.push('name = ?'); driverParams.push(name); }
      if (phone !== undefined) { driverUpdates.push('phone = ?'); driverParams.push(phone); }
      if (driverUpdates.length > 0) {
        driverParams.push(dva.driver_id);
        await conn.query(`UPDATE drivers SET ${driverUpdates.join(', ')} WHERE id = ?`, driverParams);
      }

      // 2. Update vehicle fields
      const vehUpdates = [];
      const vehParams = [];
      if (vehicle_type !== undefined) { vehUpdates.push('vehicle_type = ?'); vehParams.push(vehicle_type); }
      if (owner_name !== undefined) { vehUpdates.push('owner_name = ?'); vehParams.push(owner_name); }
      if (owner_phone !== undefined) { vehUpdates.push('owner_phone = ?'); vehParams.push(owner_phone); }
      if (insurance_type !== undefined) { vehUpdates.push('insurance_type = ?'); vehParams.push(insurance_type); }
      if (insurance_status !== undefined) { vehUpdates.push('insurance_status = ?'); vehParams.push(insurance_status); }
      if (insurance_expiry !== undefined) { vehUpdates.push('insurance_expiry = ?'); vehParams.push(insurance_expiry || null); }
      if (vehUpdates.length > 0) {
        vehParams.push(vehicle.vehicle_id);
        await conn.query(`UPDATE vehicles SET ${vehUpdates.join(', ')} WHERE id = ?`, vehParams);
      }

      // 3. Update/insert vehicle attendant
      if (attendant_name !== undefined || attendant_phone !== undefined) {
        const [[existingAtt]] = await conn.query(
          `SELECT id FROM vehicle_attendants WHERE vehicle_id = ? LIMIT 1`, [vehicle.vehicle_id]
        );
        if (existingAtt) {
          const attUpdates = [];
          const attParams = [];
          if (attendant_name !== undefined) { attUpdates.push('name = ?'); attParams.push(attendant_name); }
          if (attendant_phone !== undefined) { attUpdates.push('phone = ?'); attParams.push(attendant_phone); }
          attParams.push(existingAtt.id);
          await conn.query(`UPDATE vehicle_attendants SET ${attUpdates.join(', ')} WHERE id = ?`, attParams);
        } else {
          await conn.query(
            `INSERT INTO vehicle_attendants (vehicle_id, name, phone) VALUES (?, ?, ?)`,
            [vehicle.vehicle_id, attendant_name || null, attendant_phone || null]
          );
        }
      }

      if (driverUpdates.length === 0 && vehUpdates.length === 0 && attendant_name === undefined && attendant_phone === undefined) {
        await conn.rollback();
        return sendError(res, 'ไม่มีข้อมูลที่ต้องการแก้ไข', [], 400);
      }

      await logAudit({
        userId: req.user.id, action: 'UPDATE', entityType: 'driver_profile', entityId: dva.driver_id,
        newValue: { name, phone, vehicle_type, owner_name, owner_phone, insurance_type, insurance_status, insurance_expiry, attendant_name, attendant_phone },
        ipAddress: req.ip, userAgent: req.headers['user-agent'], conn,
      });

      await conn.commit();
      return sendSuccess(res, { driver_id: dva.driver_id }, 'อัปเดตข้อมูลสำเร็จ');
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
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

// ─── GET /search-students ───────────────────────────────────────────────────
// Search students NOT already on this driver's vehicle (for "add" requests)

router.get('/search-students', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return sendSuccess(res, []);

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);
    const like = `%${q}%`;

    const [rows] = await pool.query(
      `SELECT s.id, s.prefix, s.first_name, s.last_name, s.grade, s.classroom,
              sc.name AS school_name, v.plate_no AS current_plate
       FROM students s
       LEFT JOIN schools sc ON sc.id = s.school_id
       LEFT JOIN vehicles v ON v.id = s.vehicle_id
       WHERE s.is_deleted = FALSE
         AND (s.vehicle_id IS NULL OR s.vehicle_id != ?)
         AND (
           CAST(s.id AS CHAR) LIKE ?
           OR s.first_name LIKE ?
           OR s.last_name LIKE ?
           OR CONCAT(s.first_name, ' ', s.last_name) LIKE ?
           OR s.grade LIKE ?
         )
       ORDER BY s.first_name
       LIMIT 20`,
      [vehicle.vehicle_id, like, like, like, like, like]
    );

    return sendSuccess(res, rows);
  } catch (err) { return next(err); }
});

// ─── GET /schools ───────────────────────────────────────────────────────────
// Schools dropdown for add-student request form

router.get('/schools', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name FROM schools WHERE is_deleted = FALSE ORDER BY name`
    );
    return sendSuccess(res, rows);
  } catch (err) { return next(err); }
});

// ─── POST /roster-request ────────────────────────────────────────────────────

router.post('/roster-request', async (req, res, next) => {
  try {
    const { student_id, request_type, reason, new_student_data } = req.body;
    if (!request_type) return sendError(res, 'request_type is required', [], 400);
    if (!['add', 'remove'].includes(request_type)) return sendError(res, "request_type ต้องเป็น 'add' หรือ 'remove'", [], 400);

    // For remove: student_id is required
    if (request_type === 'remove' && !student_id) return sendError(res, 'กรุณาเลือกนักเรียนที่ต้องการถอน', [], 400);
    // For add: either student_id (existing) or new_student_data (new) is required
    if (request_type === 'add' && !student_id && !new_student_data) return sendError(res, 'กรุณากรอกข้อมูลนักเรียน', [], 400);

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);

    const result = await rosterReqSvc.createRequest({
      vehicleId: vehicle.vehicle_id, studentId: student_id || null,
      requestType: request_type, reason, userId: req.user.id,
      newStudentData: new_student_data || null,
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

// ─── GET /pretrip-status — Check if today's pretrip is done ─────────────────
router.get('/pretrip-status', async (req, res, next) => {
  try {
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const entityId = `${vehicle.vehicle_id}_${today}`;

    const [[row]] = await pool.query(
      `SELECT id, new_value, created_at FROM audit_logs
       WHERE entity_type = 'pretrip_checklist' AND entity_id = ? AND user_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [entityId, req.user.id]
    );

    if (row) {
      let parsed = null;
      try { parsed = typeof row.new_value === 'string' ? JSON.parse(row.new_value) : row.new_value; } catch {}
      return sendSuccess(res, {
        done: true,
        date: today,
        all_pass: parsed?.all_pass ?? true,
        checked_at: row.created_at,
      });
    }

    return sendSuccess(res, { done: false, date: today });
  } catch (err) { next(err); }
});

// ─── POST /pretrip — Log pre-trip checklist result ──────────────────────────
const PRETRIP_ITEMS = [
  'ยางรถ / ลมยาง',
  'ไฟหน้า-ไฟท้าย',
  'กระจก / กระจกมองข้าง',
  'เบรก',
  'เข็มขัดนิรภัย / ที่นั่ง',
  'ความสะอาดภายในรถ',
];

router.post('/pretrip', async (req, res, next) => {
  try {
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);
    const { items, all_pass, note } = req.body;

    if (typeof all_pass !== 'boolean') {
      return sendError(res, 'กรุณาระบุผลตรวจ (all_pass)', [], 400);
    }

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

    await logAudit({
      userId: req.user.id,
      action: 'CREATE',
      entityType: 'pretrip_checklist',
      entityId: `${vehicle.vehicle_id}_${today}`,
      newValue: {
        vehicle_id: vehicle.vehicle_id,
        plate_no: vehicle.plate_no,
        date: today,
        all_pass,
        items: items || PRETRIP_ITEMS.map(label => ({ label, ok: all_pass })),
        note: note || null,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // If not all pass, also create an emergency log for follow-up
    if (!all_pass && note) {
      await pool.query(
        `INSERT INTO emergency_logs (reported_by, channel, vehicle_id, plate_no, detail, note)
         VALUES (?, 'web', ?, ?, ?, ?)`,
        [req.user.id, vehicle.vehicle_id, vehicle.plate_no,
         `ตรวจรถก่อนออก: พบรายการผิดปกติ`, note]
      );
    }

    return sendSuccess(res, { date: today, all_pass }, 'บันทึกผลตรวจรถก่อนออกสำเร็จ', null, 201);
  } catch (err) { return next(err); }
});

// ─── Phase 7.2 — Live Vehicle Location (sender) ─────────────────────────────
//
// POST   /api/driver/vehicle-location  → UPSERT this driver's vehicle
// DELETE /api/driver/vehicle-location  → flip to PAUSED (driver hit Stop)
//
// Server-trusted scope: vehicle_id is resolved from the JWT (via the
// driver's username = plate_no), NEVER from request body. No audit
// log on writes — would balloon audit_logs to thousands per day.

router.post('/vehicle-location', driverLocationLimiter, async (req, res, next) => {
  try {
    const { latitude, longitude, accuracy_meters, speed_mps, heading_deg, recorded_at } = req.body || {};

    // Validate body
    const errors = [];
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      errors.push({ field: 'latitude', message: 'latitude must be a number in [-90, 90]' });
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      errors.push({ field: 'longitude', message: 'longitude must be a number in [-180, 180]' });
    }
    if (recorded_at && Number.isNaN(Date.parse(recorded_at))) {
      errors.push({ field: 'recorded_at', message: 'recorded_at must be ISO 8601' });
    }
    if (errors.length) return sendError(res, 'ข้อมูลตำแหน่งไม่ถูกต้อง', errors, 400);

    // Resolve vehicle from JWT scope — server-trusted
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);
    if (!vehicle) return sendError(res, 'ไม่พบรถที่ลงทะเบียน', [], 404);

    const driverId = await vllSvc.getActiveDriverIdForVehicle(vehicle.vehicle_id);
    if (!driverId) return sendError(res, 'ไม่พบการมอบหมายคนขับสำหรับรถคันนี้', [], 400);

    const recordedAtSql = recorded_at
      ? new Date(recorded_at).toISOString().slice(0, 23).replace('T', ' ')
      : new Date().toISOString().slice(0, 23).replace('T', ' ');

    await vllSvc.upsertLocation({
      vehicleId: vehicle.vehicle_id,
      driverId,
      latitude: lat,
      longitude: lng,
      accuracyMeters: Number.isFinite(Number(accuracy_meters)) ? Math.round(Number(accuracy_meters)) : null,
      speedMps:       Number.isFinite(Number(speed_mps))       ? Number(speed_mps)                  : null,
      headingDeg:     Number.isFinite(Number(heading_deg))     ? Number(heading_deg)                : null,
      recordedAt: recordedAtSql,
      source: 'web',
    });

    return sendSuccess(res, { received_at: new Date().toISOString() }, 'OK');
  } catch (err) { return next(err); }
});

router.delete('/vehicle-location', async (req, res, next) => {
  try {
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user.username);
    if (!vehicle) return sendError(res, 'ไม่พบรถที่ลงทะเบียน', [], 404);

    await vllSvc.pauseLocation(vehicle.vehicle_id);
    return sendSuccess(res, null, 'หยุดส่งตำแหน่งแล้ว');
  } catch (err) { return next(err); }
});

module.exports = router;
