'use strict';

/**
 * routeDeviation.routes.js — Phase 11A (2026-06-23)
 *
 * Read-only route deviation log. Mounted at /api/route-deviations when
 * FEATURE_ROUTE_DEVIATION=true.
 *
 *   GET /api/route-deviations                — list deviations (admin / province)
 *   GET /api/route-deviations?vehicle_id=X
 *   GET /api/route-deviations?unresolved=true
 *   GET /api/route-deviations?severity=CRITICAL
 *
 * RBAC: admin + province (read-only). School / affiliation / driver are
 * intentionally excluded from this endpoint — they see deviations via the
 * operations alert dashboard + LINE notifications, not the raw log.
 */

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const devSvc = require('../services/routeDeviation.service');

router.use(authenticate, requireRole('admin', 'province'));

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const vehicleId = req.query.vehicle_id || null;
    const unresolvedOnly = req.query.unresolved === 'true';
    const severity = req.query.severity || null;
    if (severity && !['INFO', 'WARN', 'CRITICAL'].includes(severity)) {
      return sendError(res, 'severity ไม่ถูกต้อง', [], 400);
    }
    const rows = await devSvc.listDeviations({
      vehicleId,
      unresolvedOnly,
      severity,
      limit,
      offset,
    });
    return sendSuccess(res, rows);
  } catch (err) { return next(err); }
});

module.exports = router;
