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
const env               = require('../config/env');
const { authenticate }  = require('../middleware/auth');
const { requireRole }   = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { logAudit }      = require('../utils/audit');
const { validatePassword } = require('../utils/passwordPolicy');
const { isAllowedImage } = require('../utils/fileType');
const checkinSvc        = require('../services/checkin.service');
const ppSvc             = require('../services/pickupPoint.service');
const leaveSvc          = require('../services/leave.service');
const rosterReqSvc      = require('../services/rosterRequest.service');
const vllSvc            = require('../services/vehicleLocation.service');
const lineSvc           = require('../services/line.service');
const driverShiftSvc    = require('../services/driverShift.service');
const safetyPolicySvc   = require('../services/safetyPolicy.service');

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

/**
 * Shared safety-policy gate for driver operations.
 *
 * Options:
 *   emergency          — never BLOCK (emergency must always proceed).
 *   requireActiveShift — override the shift requirement (default: the feature
 *                        flag). /shifts/start passes false: it is the operation
 *                        that OPENS a shift, so it must not demand one first.
 *   skipAudit          — never write the per-call safety_policy_decision row
 *                        (FIX 2: /vehicle-location GPS pings would otherwise add
 *                        one audit_logs row per ping in OBSERVE).
 *
 * The safety-policy audit row is best-effort: logAudit swallows all errors and
 * never throws (see utils/audit.js), so no try/catch is needed here — a failed
 * audit insert must not break the operation (FIX 3).
 */
async function assessSafety(req, vehicle, operation, {
  emergency = false,
  requireActiveShift = env.features.driverShiftSelection,
  skipAudit = false,
} = {}) {
  const policy = await safetyPolicySvc.assessDriverOperation(pool, {
    vehicleId: vehicle.vehicle_id,
    driverId: vehicle.driver_id || req.user.driver_id,
    mode: env.safetyPolicy.mode,
    requireActiveShift,
  });

  // Only audit when the policy says so AND the caller hasn't opted out. Steady-
  // state ALLOW_WITH_WARNING on high-frequency endpoints (location) is skipped to
  // avoid ballooning audit_logs; BLOCK/checkin/checkout/etc. still audit.
  if (policy.audit_required && !skipAudit) {
    await logAudit({
      userId: req.user.id,
      action: 'CREATE',
      entityType: 'safety_policy_decision',
      entityId: `${operation}:${req.user.id}:${Date.now()}`,
      newValue: { operation, vehicle_id: vehicle.vehicle_id, ...policy },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  if (policy.decision === 'BLOCK' && !emergency) {
    const error = new Error('ไม่สามารถดำเนินการได้ เนื่องจากข้อมูลความปลอดภัยยังไม่ผ่านเกณฑ์');
    error.statusCode = 409;
    error.errors = [{ code: 'SAFETY_POLICY_BLOCKED', reasons: policy.reasons }];
    throw error;
  }
  return policy;
}

// ─── Authorized vehicle pool and actual-driver shift attribution ────────────
router.get('/authorized-vehicles', async (req, res, next) => {
  try {
    const data = await driverShiftSvc.listAuthorizedVehicles(pool, { driverId: req.user.driver_id });
    return sendSuccess(res, data);
  } catch (error) { return next(error); }
});

router.get('/active-shift', async (req, res, next) => {
  try {
    const data = await driverShiftSvc.getActiveShift(pool, { driverId: req.user.driver_id });
    return sendSuccess(res, data);
  } catch (error) { return next(error); }
});

router.post('/shifts/start', async (req, res, next) => {
  try {
    // FIX 4 — reuse the shared assessSafety gate (single source of truth) instead
    // of duplicating the assess + audit + BLOCK logic. requireActiveShift:false
    // because this IS the operation that opens a shift, so it must not demand one
    // first. assessSafety derives the driver_id from req.user.driver_id when the
    // vehicle stub doesn't carry one.
    await assessSafety(
      req,
      { vehicle_id: req.body.vehicle_id },
      'SHIFT_START',
      { requireActiveShift: false }
    );
    const data = await driverShiftSvc.startShift(pool, {
      driverId: req.user.driver_id,
      vehicleId: req.body.vehicle_id,
      session: req.body.session,
      userId: req.user.id,
      note: req.body.note || null,
    });
    return sendSuccess(res, data, 'เริ่มรอบปฏิบัติงานแล้ว', null, 201);
  } catch (error) { return next(error); }
});

router.post('/shifts/:id/end', async (req, res, next) => {
  try {
    const data = await driverShiftSvc.endShift(pool, {
      driverId: req.user.driver_id,
      shiftId: Number(req.params.id),
      userId: req.user.id,
      note: req.body.note || null,
    });
    return sendSuccess(res, data, data.already_closed ? 'รอบนี้ปิดแล้ว' : 'ปิดรอบปฏิบัติงานแล้ว');
  } catch (error) { return next(error); }
});

// ─── GET /roster ─────────────────────────────────────────────────────────────

router.get('/roster', async (req, res, next) => {
  try {
    const session = req.query.session; // 'morning' | 'evening' | undefined

    if (session && !['morning', 'evening'].includes(session)) {
      return sendError(res, "session must be 'morning' or 'evening'", [], 400);
    }

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
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

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
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
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
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

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
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

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
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

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
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

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
    const policy = await assessSafety(req, vehicle, 'CHECKIN');

    const result = await checkinSvc.processCheckin(pool, {
      userId:    req.user.id,
      vehicleId: vehicle.vehicle_id,
      plateNo:   vehicle.plate_no,
      studentId: parseInt(student_id, 10),
      session,
      source:    'web',
    });

    return sendSuccess(res, { ...result, safety_policy: policy }, 'Student checked in successfully', null, 201);
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

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
    const policy = await assessSafety(req, vehicle, 'CHECKOUT');

    const result = await checkinSvc.processCheckout(pool, {
      userId:    req.user.id,
      vehicleId: vehicle.vehicle_id,
      plateNo:   vehicle.plate_no,
      studentId: parseInt(student_id, 10),
      session,
      source:    'web',
    });

    return sendSuccess(res, { ...result, safety_policy: policy }, 'Student checked out successfully', null, 201);
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

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
    const policy = await assessSafety(req, vehicle, 'CHECKIN_ALL');

    const result = await checkinSvc.processCheckinAll(pool, {
      userId:    req.user.id,
      vehicleId: vehicle.vehicle_id,
      plateNo:   vehicle.plate_no,
      session,
      source:    'web',
    });

    const message = `Checked in ${result.succeeded.length} student(s)` +
      (result.failed.length > 0 ? `, ${result.failed.length} failed` : '');

    return sendSuccess(res, { ...result, safety_policy: policy }, message, null, 201);
  } catch (err) {
    return next(err);
  }
});

// ─── POST /emergency ──────────────────────────────────────────────────────────

router.post('/emergency', async (req, res, next) => {
  try {
    const { detail, note, latitude, longitude, accuracy, gps_status } = req.body;

    if (!detail) {
      return sendError(res, 'detail is required', [], 400);
    }

    // GPS is OPTIONAL — if provided, validate ranges. Bad values are dropped
    // (warning logged) rather than failing the whole emergency report.
    let lat = null, lng = null, acc = null;
    if (latitude != null && longitude != null) {
      const la = Number(latitude);
      const lo = Number(longitude);
      if (Number.isFinite(la) && la >= -90 && la <= 90 &&
          Number.isFinite(lo) && lo >= -180 && lo <= 180) {
        lat = la;
        lng = lo;
        const a = Number(accuracy);
        acc = Number.isFinite(a) && a >= 0 ? Math.min(Math.round(a), 2147483647) : null;
      } else {
        console.warn('[emergency] invalid GPS payload dropped:', { latitude, longitude });
      }
    }

    // HF2-debug: surface the driver-side GPS state machine outcome so we can
    // tell from server logs whether the iPhone hit denied / timeout / etc.
    // No coordinates logged here — only the status label.
    const validGpsStatuses = new Set(['requesting','granted','denied','timeout','unsupported']);
    const gpsStatus = validGpsStatuses.has(gps_status) ? gps_status : 'unknown';
    console.log('[EMERGENCY_GPS_STATUS]', {
      userId:   req.user.id,
      hasCoord: lat != null,
      status:   gpsStatus,
      accuracy: acc,
    });

    // FIX 1 (HIGH) — an emergency must NEVER be blocked by the shift gate.
    // getDriverVehicle throws ACTIVE_SHIFT_REQUIRED / MULTIPLE_OPEN_SHIFTS when
    // FEATURE_DRIVER_SHIFT_SELECTION is on and the driver hasn't opened a shift,
    // BEFORE assessSafety's emergency bypass can run. Resolve shift-independently
    // instead; if even that can't pin a vehicle, still log the emergency with
    // whatever identity we have rather than hard-failing.
    let vehicle;
    try {
      vehicle = await checkinSvc.resolveVehicleForEmergency(pool, req.user);
    } catch (resolveErr) {
      console.warn('[emergency] vehicle resolution failed, filing without vehicle:', resolveErr.message);
      vehicle = { vehicle_id: null, plate_no: null, driver_id: req.user.driver_id || null };
    }

    // Safety assessment stays non-blocking for emergencies. Skip it entirely when
    // we couldn't resolve a vehicle (assessDriverOperation needs a vehicle_id).
    let policy = null;
    if (vehicle.vehicle_id) {
      policy = await assessSafety(req, vehicle, 'EMERGENCY_REPORT', { emergency: true });
    }

    const [result] = await pool.query(
      `INSERT INTO emergency_logs
         (reported_by, channel, vehicle_id, plate_no, detail, note,
          latitude, longitude, location_accuracy_m)
       VALUES (?, 'web', ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, vehicle.vehicle_id, vehicle.plate_no, detail, note || null,
       lat, lng, acc]
    );

    await logAudit({
      userId:     req.user.id,
      action:     'CREATE',
      entityType: 'emergency',
      entityId:   result.insertId,
      newValue:   {
        vehicleId: vehicle.vehicle_id,
        plateNo:   vehicle.plate_no,
        detail,
        hasGps:    lat != null,
        gpsStatus,
        safety_policy: policy,
      },
      ipAddress:  req.ip,
      userAgent:  req.headers['user-agent'],
    });

    // Phase 10.3E-HF2 — push Flex card to school LINE group.
    // Wrapped so a LINE failure NEVER blocks the emergency report.
    try {
      const [[meta]] = await pool.query(
        `SELECT v.vehicle_type,
                (SELECT GROUP_CONCAT(DISTINCT sc.name SEPARATOR ', ')
                   FROM students s
                   JOIN schools sc ON sc.id = s.school_id
                  WHERE s.vehicle_id = v.id AND s.is_deleted = FALSE) AS schools
           FROM vehicles v
          WHERE v.id = ?`,
        [vehicle.vehicle_id]
      );
      await lineSvc.pushEmergencyFlexMessage({
        plateNo:     vehicle.plate_no,
        vehicleType: meta?.vehicle_type,
        driverName:  req.user.display_name || req.user.username || '-',
        schools:     meta?.schools,
        detail,
        note:        note || null,
        timestamp:   new Date(),
        latitude:    lat,
        longitude:   lng,
        accuracy:    acc,
      });
    } catch (pushErr) {
      console.error('[LINE_EMERGENCY_FLEX_PUSH] unexpected error (suppressed):', pushErr.message);
    }

    return sendSuccess(
      res,
      {
        id: result.insertId,
        vehicle_id: vehicle.vehicle_id,
        plate_no: vehicle.plate_no,
        has_gps: lat != null,
        safety_policy: policy,
      },
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
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
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
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
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

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);

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

    // Audit 2026-06-18 (fileupload-import): the extension filter is not enough —
    // sniff the actual bytes and reject anything that isn't a real image, deleting
    // the just-written file so a disguised payload can't linger on disk.
    try {
      const head = fs.readFileSync(req.file.path).subarray(0, 16);
      if (!isAllowedImage(head)) {
        fs.unlink(req.file.path, () => {});
        return sendError(res, 'ไฟล์ที่อัปโหลดไม่ใช่รูปภาพที่รองรับ (.jpg, .png, .webp)', [], 400);
      }
    } catch {
      fs.unlink(req.file.path, () => {});
      return sendError(res, 'ไม่สามารถอ่านไฟล์รูปภาพได้', [], 400);
    }

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
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

    const bcrypt = require('bcrypt');
    const [[user]] = await pool.query(`SELECT username, password_hash FROM users WHERE id = ? AND is_deleted = FALSE`, [req.user.id]);
    if (!user) return sendError(res, 'ไม่พบผู้ใช้', [], 404);

    // Verify the current password BEFORE the strength check so a wrong current
    // password is reported as such (keeps the generic "incorrect" response).
    const match = await bcrypt.compare(String(current_password), user.password_hash);
    if (!match) return sendError(res, 'รหัสผ่านเดิมไม่ถูกต้อง', [], 400);

    // Audit 2026-06-18 (auth-crypto): share the system-wide password policy.
    const pwCheck = validatePassword(new_password, { username: user.username });
    if (!pwCheck.ok) return sendError(res, pwCheck.message, [], 400);

    const newHash = await bcrypt.hash(String(new_password), 12);
    // Audit 2026-06-18 (HIGH, auth-crypto): set password_changed_at + clear the
    // forced-change flag exactly like every other password path, so previously
    // issued access/refresh tokens are invalidated. Previously this route updated
    // only password_hash, leaving stolen sessions valid for up to 7 days.
    await pool.query(
      `UPDATE users SET password_hash = ?, must_change_password = FALSE, password_changed_at = NOW() WHERE id = ?`,
      [newHash, req.user.id]
    );

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

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
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
    // Phase 10.12E — scope cancellation to the driver's active vehicle (H4):
    // a driver may only cancel a leave belonging to their own vehicle.
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
    const result = await leaveSvc.cancelLeave(parseInt(req.params.id, 10), req.user.id, vehicle.vehicle_id);
    return sendSuccess(res, result, 'ยกเลิกการลาสำเร็จ');
  } catch (err) { return next(err); }
});

// ─── GET /leaves ─────────────────────────────────────────────────────────────

router.get('/leaves', async (req, res, next) => {
  try {
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
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

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
    const like = `%${q}%`;

    const [rows] = await pool.query(
      // Audit 2026-06-18 (authz-scope): constrain the search to schools this
      // driver's vehicle actually serves, so a driver can't enumerate the
      // province-wide student directory. A vehicle with no students yet returns
      // nothing (there is no school context to add into).
      `SELECT s.id, s.prefix, s.first_name, s.last_name, s.grade, s.classroom,
              sc.name AS school_name, v.plate_no AS current_plate
       FROM students s
       LEFT JOIN schools sc ON sc.id = s.school_id
       LEFT JOIN vehicles v ON v.id = s.vehicle_id
       WHERE s.is_deleted = FALSE
         AND (s.vehicle_id IS NULL OR s.vehicle_id != ?)
         AND s.school_id IN (
           SELECT DISTINCT school_id FROM students
           WHERE vehicle_id = ? AND is_deleted = FALSE AND school_id IS NOT NULL
         )
         AND (
           CAST(s.id AS CHAR) LIKE ?
           OR s.first_name LIKE ?
           OR s.last_name LIKE ?
           OR CONCAT(s.first_name, ' ', s.last_name) LIKE ?
           OR s.grade LIKE ?
         )
       ORDER BY s.first_name
       LIMIT 20`,
      [vehicle.vehicle_id, vehicle.vehicle_id, like, like, like, like, like]
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

    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);

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
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
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
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
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
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
    const policy = await assessSafety(req, vehicle, 'PRETRIP');
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
        safety_policy: policy,
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

    return sendSuccess(res, { date: today, all_pass, safety_policy: policy }, 'บันทึกผลตรวจรถก่อนออกสำเร็จ', null, 201);
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
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
    if (!vehicle) return sendError(res, 'ไม่พบรถที่ลงทะเบียน', [], 404);
    // FIX 2 — do NOT write a per-ping safety_policy_decision audit row. In OBSERVE
    // every vehicle is UNVERIFIED so audit_required is always true, which would
    // add one audit_logs row for every GPS ping (~every 15s). The BLOCK path in
    // ENFORCE still works (assessSafety throws before reaching the upsert).
    const policy = await assessSafety(req, vehicle, 'VEHICLE_LOCATION', { skipAudit: true });

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

    return sendSuccess(res, { received_at: new Date().toISOString(), safety_policy: policy }, 'OK');
  } catch (err) { return next(err); }
});

router.delete('/vehicle-location', async (req, res, next) => {
  try {
    const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
    if (!vehicle) return sendError(res, 'ไม่พบรถที่ลงทะเบียน', [], 404);

    await vllSvc.pauseLocation(vehicle.vehicle_id);
    return sendSuccess(res, null, 'หยุดส่งตำแหน่งแล้ว');
  } catch (err) { return next(err); }
});

module.exports = router;
