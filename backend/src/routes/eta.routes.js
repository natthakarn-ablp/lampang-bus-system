'use strict';

/**
 * eta.routes.js — Phase 11A (2026-06-23)
 *
 * Read-only ETA predictions. Mounted at /api/eta when FEATURE_ETA=true.
 *
 *   GET /api/eta/vehicle/:vehicleId        — all pickup-point ETAs for a vehicle
 *   GET /api/eta/vehicle/:vehicleId?session=morning|evening
 *   GET /api/eta/student/:studentId        — ETA for one student's pickup point
 *
 * RBAC:
 *   - admin / province: any vehicle
 *   - affiliation: vehicles serving schools in own affiliation
 *   - school: vehicles serving own school
 *   - driver: own vehicle only
 *   - parent: own children only (via /api/parent/children/:id/eta — see parent.routes)
 *
 * The response contains NO PII — only plate_no (low sensitivity, parents
 * already know their child's vehicle), pickup point label, ETA seconds,
 * distance, and confidence. The internal vehicle_id is NOT exposed.
 */

const express = require('express');
const router = express.Router();

const { pool } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const etaSvc = require('../services/eta.service');

router.use(authenticate);

/**
 * Scope check: is the caller allowed to see this vehicle's ETA?
 */
async function canSeeVehicle(req, vehicleId) {
  const role = req.user.role;
  if (role === 'admin' || role === 'province') return true;
  if (role === 'driver') {
    // Existence-check: is THIS specific vehicle assigned to the driver?
    // Uses both driver_id AND vehicle_id in the WHERE clause so a driver
    // with multiple active assignments (PRIMARY/BACKUP pool) can see ETA
    // for any of their vehicles — not just whichever LIMIT 1 picked.
    // Read-only ETA must NOT require an active operating shift.
    if (!req.user.driver_id) return false;
    const [[row]] = await pool.query(
      `SELECT 1
         FROM driver_vehicle_assignments dva
         JOIN vehicles v ON v.id = dva.vehicle_id AND v.is_deleted = FALSE
        WHERE dva.driver_id = ? AND dva.vehicle_id = ? AND dva.is_active = TRUE
          AND (dva.end_date IS NULL OR dva.end_date >= CURDATE())
        LIMIT 1`,
      [req.user.driver_id, vehicleId]
    );
    return !!row;
  }
  if (role === 'school') {
    const [[row]] = await pool.query(
      `SELECT 1 FROM students s
        WHERE s.vehicle_id = ? AND s.school_id = ? AND s.is_deleted = FALSE
        LIMIT 1`,
      [vehicleId, req.user.scopeId]
    );
    return !!row;
  }
  if (role === 'affiliation') {
    const [[row]] = await pool.query(
      `SELECT 1 FROM students s
         JOIN schools sc ON sc.id = s.school_id
        WHERE s.vehicle_id = ? AND sc.affiliation_id = ?
          AND s.is_deleted = FALSE
        LIMIT 1`,
      [vehicleId, req.user.scopeId]
    );
    return !!row;
  }
  return false;
}

// ─── GET /api/eta/vehicle/:vehicleId ─────────────────────────────────────────
router.get('/vehicle/:vehicleId', requireRole('admin', 'province', 'affiliation', 'school', 'driver'), async (req, res, next) => {
  try {
    const vehicleId = req.params.vehicleId;
    const allowed = await canSeeVehicle(req, vehicleId);
    if (!allowed) return sendError(res, 'ไม่มีสิทธิ์ดูข้อมูลรถคันนี้', [], 403);

    const session = req.query.session; // optional
    if (session && !['morning', 'evening'].includes(session)) {
      return sendError(res, "session must be 'morning' or 'evening'", [], 400);
    }

    const etas = await etaSvc.getForVehicle(vehicleId, { session });
    return sendSuccess(res, etas);
  } catch (err) { return next(err); }
});

// ─── GET /api/eta/student/:studentId ─────────────────────────────────────────
// School / affiliation / admin / province can query a student's ETA.
// Parents use /api/parent/children/:id/eta (LINE-verified).
router.get('/student/:studentId', requireRole('admin', 'province', 'affiliation', 'school'), async (req, res, next) => {
  try {
    const studentId = parseInt(req.params.studentId, 10);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return sendError(res, 'รหัสนักเรียนไม่ถูกต้อง', [], 400);
    }

    // Scope check for school / affiliation.
    if (req.user.role === 'school') {
      const [[row]] = await pool.query(
        `SELECT 1 FROM students WHERE id = ? AND school_id = ? AND is_deleted = FALSE`,
        [studentId, req.user.scopeId]
      );
      if (!row) return sendError(res, 'ไม่มีสิทธิ์ดูข้อมูลนักเรียนนี้', [], 403);
    } else if (req.user.role === 'affiliation') {
      const [[row]] = await pool.query(
        `SELECT 1 FROM students s
           JOIN schools sc ON sc.id = s.school_id
          WHERE s.id = ? AND sc.affiliation_id = ? AND s.is_deleted = FALSE`,
        [studentId, req.user.scopeId]
      );
      if (!row) return sendError(res, 'ไม่มีสิทธิ์ดูข้อมูลนักเรียนนี้', [], 403);
    }

    const eta = await etaSvc.getForStudent(studentId);
    return sendSuccess(res, eta);
  } catch (err) { return next(err); }
});

module.exports = router;
