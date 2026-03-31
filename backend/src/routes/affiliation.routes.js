'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const affSvc = require('../services/affiliation.service');

// All affiliation routes require authentication + role 'affiliation'
router.use(authenticate, requireRole('affiliation'));

/**
 * GET /api/affiliation/dashboard
 */
router.get('/dashboard', async (req, res, next) => {
  try {
    const affId = req.user.scopeId;
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่ที่ผูกกับบัญชีนี้', [], 403);

    const data = await affSvc.getDashboard(affId);
    return sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/affiliation/schools
 */
router.get('/schools', async (req, res, next) => {
  try {
    const affId = req.user.scopeId;
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่ที่ผูกกับบัญชีนี้', [], 403);

    const schools = await affSvc.getSchools(affId);
    return sendSuccess(res, schools);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/affiliation/students
 * Query: search, grade, school_id, page, per_page, sort, order
 */
router.get('/students', async (req, res, next) => {
  try {
    const affId = req.user.scopeId;
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่ที่ผูกกับบัญชีนี้', [], 403);

    const { search, grade, school_id, sort, order } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));

    const result = await affSvc.getStudents(affId, {
      search, grade, school_id, page, per_page, sort, order,
    });
    return sendSuccess(res, result.students, 'OK', result.meta);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/affiliation/vehicles
 */
router.get('/vehicles', async (req, res, next) => {
  try {
    const affId = req.user.scopeId;
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่ที่ผูกกับบัญชีนี้', [], 403);

    const vehicles = await affSvc.getVehicles(affId);
    return sendSuccess(res, vehicles);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/affiliation/status-today
 */
router.get('/status-today', async (req, res, next) => {
  try {
    const affId = req.user.scopeId;
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่ที่ผูกกับบัญชีนี้', [], 403);

    const data = await affSvc.getStatusToday(affId);
    return sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/affiliation/emergencies
 * Query: page, per_page
 */
router.get('/emergencies', async (req, res, next) => {
  try {
    const affId = req.user.scopeId;
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่ที่ผูกกับบัญชีนี้', [], 403);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));

    const result = await affSvc.getEmergencies(affId, { page, per_page });
    return sendSuccess(res, result.emergencies, 'OK', result.meta);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
