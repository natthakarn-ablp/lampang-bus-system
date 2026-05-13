'use strict';

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { logAudit } = require('../utils/audit');
const transportSvc = require('../services/transport.service');
const ppSvc = require('../services/pickupPoint.service');

// All routes require transport or admin role
router.use(authenticate, requireRole('transport', 'admin'));

// ─── POST /api/transport/vehicles (create new vehicle for inspection) ───────
router.post('/vehicles', async (req, res, next) => {
  try {
    const { plate_no, vehicle_type } = req.body;
    if (!plate_no || !plate_no.trim()) return sendError(res, 'กรุณาระบุทะเบียนรถ', [], 400);

    const { pool } = require('../config/database');
    const { generateVehicleId } = require('../utils/hash');
    const { logAudit } = require('../utils/audit');

    const trimmed = plate_no.trim();
    // Check duplicate
    const [[existing]] = await pool.query('SELECT id FROM vehicles WHERE plate_no = ? AND is_deleted = FALSE', [trimmed]);
    if (existing) return sendSuccess(res, { id: existing.id, plate_no: trimmed, existed: true }, 'รถคันนี้มีในระบบแล้ว');

    const id = generateVehicleId(trimmed);
    await pool.query(
      'INSERT INTO vehicles (id, plate_no, vehicle_type) VALUES (?, ?, ?)',
      [id, trimmed, vehicle_type || null]
    );

    await logAudit({
      userId: req.user.id, action: 'CREATE', entityType: 'vehicle', entityId: id,
      newValue: { plate_no: trimmed, source: 'transport_inspection' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    sendSuccess(res, { id, plate_no: trimmed, existed: false }, 'เพิ่มรถใหม่เรียบร้อย', null, 201);
  } catch (err) { next(err); }
});

// ─── GET /api/transport/schools (read-only list for dropdowns) ──────────────
router.get('/schools', async (req, res, next) => {
  try {
    const { pool } = require('../config/database');
    const [schools] = await pool.query(
      `SELECT id, name FROM schools WHERE is_deleted = FALSE ORDER BY name`
    );
    sendSuccess(res, schools);
  } catch (err) { next(err); }
});

// ─── GET /api/transport/dashboard ───────────────────────────────────────────
router.get('/dashboard', async (req, res, next) => {
  try {
    const data = await transportSvc.getDashboard();
    sendSuccess(res, data);
  } catch (err) { next(err); }
});

// ─── GET /api/transport/vehicles ────────────────────────────────────────────
router.get('/vehicles', async (req, res, next) => {
  try {
    const { status, page, per_page } = req.query;
    const data = await transportSvc.getVehicles({
      status,
      page: parseInt(page) || 1,
      per_page: parseInt(per_page) || 50,
    });
    sendSuccess(res, data.vehicles, 'OK', data.meta);
  } catch (err) { next(err); }
});

// ─── GET /api/transport/vehicles/:id ────────────────────────────────────────
router.get('/vehicles/:id', async (req, res, next) => {
  try {
    const data = await transportSvc.getVehicles({ page: 1, per_page: 1 });
    // Filter by id from full list — simple approach for MVP
    const { pool } = require('../config/database');
    const [rows] = await pool.query(
      `SELECT v.*,
              (SELECT d.name FROM driver_vehicle_assignments dva
               JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
               WHERE dva.vehicle_id = v.id AND dva.is_active = TRUE LIMIT 1) AS driver_name,
              (SELECT d.phone FROM driver_vehicle_assignments dva
               JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
               WHERE dva.vehicle_id = v.id AND dva.is_active = TRUE LIMIT 1) AS driver_phone
       FROM vehicles v WHERE v.id = ? AND v.is_deleted = FALSE`,
      [req.params.id]
    );
    if (rows.length === 0) return sendError(res, 'Vehicle not found', [], 404);
    sendSuccess(res, rows[0]);
  } catch (err) { next(err); }
});

// ─── GET /api/transport/inspections ─────────────────────────────────────────
router.get('/inspections', async (req, res, next) => {
  try {
    const { vehicle_id, result, page, per_page } = req.query;
    const data = await transportSvc.getInspections({
      vehicle_id, result,
      page: parseInt(page) || 1,
      per_page: parseInt(per_page) || 20,
    });
    sendSuccess(res, data.inspections, 'OK', data.meta);
  } catch (err) { next(err); }
});

// ─── POST /api/transport/inspections ────────────────────────────────────────
router.post('/inspections', async (req, res, next) => {
  try {
    const { vehicle_id, inspection_date, expiry_date, result, notes, certifying_school_id } = req.body;
    if (!vehicle_id || !inspection_date || !result) {
      return sendError(res, 'vehicle_id, inspection_date, and result are required', [], 400);
    }
    const validResults = ['PASSED', 'FAILED', 'NEEDS_FIX', 'PENDING'];
    if (!validResults.includes(result)) {
      return sendError(res, `result must be one of: ${validResults.join(', ')}`, [], 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inspection_date)) {
      return sendError(res, 'inspection_date must be YYYY-MM-DD format', [], 400);
    }
    if (expiry_date && !/^\d{4}-\d{2}-\d{2}$/.test(expiry_date)) {
      return sendError(res, 'expiry_date must be YYYY-MM-DD format', [], 400);
    }

    const id = await transportSvc.createInspection({
      vehicleId: vehicle_id,
      inspectionDate: inspection_date,
      expiryDate: expiry_date,
      result,
      notes,
      certifyingSchoolId: certifying_school_id || null,
      userId: req.user.id,
    });

    await logAudit({
      userId: req.user.id, action: 'CREATE', entityType: 'vehicle_inspection',
      entityId: id, newValue: req.body,
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    sendSuccess(res, { id }, 'Inspection recorded', null, 201);
  } catch (err) { next(err); }
});

// ─── PUT /api/transport/inspections/:id ─────────────────────────────────────
router.put('/inspections/:id', async (req, res, next) => {
  try {
    const { expiry_date, result, notes } = req.body;
    if (!result) return sendError(res, 'result is required', [], 400);

    await transportSvc.updateInspection({
      inspectionId: req.params.id,
      expiryDate: expiry_date,
      result,
      notes,
      userId: req.user.id,
    });

    await logAudit({
      userId: req.user.id, action: 'UPDATE', entityType: 'vehicle_inspection',
      entityId: req.params.id, newValue: req.body,
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    sendSuccess(res, null, 'Inspection updated');
  } catch (err) { next(err); }
});

// ─── Phase 7.12.2 — GET /api/transport/pickup-map ───────────────────────────
// Read-only multi-role pickup-point map for transport oversight. Aggregate-only
// rows: no student names / phones / addresses.
router.get('/pickup-map', async (req, res, next) => {
  try {
    const { affiliation_id, school_id, vehicle_id, session, grade, search } = req.query;

    if (!ppSvc.isValidSession(session || null)) {
      return sendError(res, 'session ต้องเป็น morning, evening หรือ both', [], 400);
    }
    if (!ppSvc.isValidGrade(grade || null)) {
      return sendError(res, 'ชั้นเรียนไม่ถูกต้อง', [], 400);
    }

    const data = await ppSvc.getReadOnlyPickupMap({
      filterAffiliationId: affiliation_id || null,
      filterSchoolId: school_id || null,
      filterVehicleId: vehicle_id || null,
      session: session || null,
      grade: grade || null,
      search: search || null,
    });

    ppSvc.maybeAuditPickupMapView({
      userId: req.user.id,
      entityType: 'transport_pickup_map',
      entityId: 'transport',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    sendSuccess(res, data);
  } catch (err) { next(err); }
});

module.exports = router;
