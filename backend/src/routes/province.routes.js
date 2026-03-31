'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess } = require('../utils/response');
const provSvc = require('../services/province.service');

// Province routes: role 'province' or 'admin' (per RBAC matrix)
router.use(authenticate, requireRole('province', 'admin'));

/**
 * GET /api/province/dashboard
 */
router.get('/dashboard', async (req, res, next) => {
  try {
    const data = await provSvc.getDashboard();
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

/**
 * GET /api/province/affiliations
 */
router.get('/affiliations', async (req, res, next) => {
  try {
    const data = await provSvc.getAffiliations();
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

/**
 * GET /api/province/schools
 * Query: affiliation_id, page, per_page
 */
router.get('/schools', async (req, res, next) => {
  try {
    const { affiliation_id } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(200, Math.max(1, parseInt(req.query.per_page, 10) || 50));

    const result = await provSvc.getSchools({ affiliation_id, page, per_page });
    return sendSuccess(res, result.schools, 'OK', result.meta);
  } catch (err) { next(err); }
});

/**
 * GET /api/province/students
 * Query: search, grade, school_id, affiliation_id, page, per_page, sort, order
 */
router.get('/students', async (req, res, next) => {
  try {
    const { search, grade, school_id, affiliation_id, sort, order } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));

    const result = await provSvc.getStudents({
      search, grade, school_id, affiliation_id, page, per_page, sort, order,
    });
    return sendSuccess(res, result.students, 'OK', result.meta);
  } catch (err) { next(err); }
});

/**
 * GET /api/province/vehicles
 */
router.get('/vehicles', async (req, res, next) => {
  try {
    const data = await provSvc.getVehicles();
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

/**
 * GET /api/province/status-today
 */
router.get('/status-today', async (req, res, next) => {
  try {
    const data = await provSvc.getStatusToday();
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

/**
 * GET /api/province/emergencies
 * Query: page, per_page
 */
router.get('/emergencies', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));

    const result = await provSvc.getEmergencies({ page, per_page });
    return sendSuccess(res, result.emergencies, 'OK', result.meta);
  } catch (err) { next(err); }
});

module.exports = router;
