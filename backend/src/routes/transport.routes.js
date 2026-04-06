'use strict';

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { logAudit } = require('../utils/audit');
const transportSvc = require('../services/transport.service');

// All routes require transport or admin role
router.use(authenticate, requireRole('transport', 'admin'));

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
    const { vehicle_id, inspection_date, expiry_date, result, notes } = req.body;
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

module.exports = router;
