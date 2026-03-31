'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const schoolSvc = require('../services/school.service');

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

module.exports = router;
