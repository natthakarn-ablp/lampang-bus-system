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
const { pool }          = require('../config/database');
const { authenticate }  = require('../middleware/auth');
const { requireRole }   = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { logAudit }      = require('../utils/audit');
const checkinSvc        = require('../services/checkin.service');

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
      return sendError(res, 'student_id and session are required', [], 400);
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
      return sendError(res, 'student_id and session are required', [], 400);
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
      return sendError(res, 'session is required', [], 400);
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

module.exports = router;
