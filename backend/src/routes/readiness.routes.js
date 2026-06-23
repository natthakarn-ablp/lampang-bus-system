'use strict';

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess } = require('../utils/response');
const env = require('../config/env');
const { getDeploymentReadiness } = require('../services/deploymentReadiness.service');

// Deployment readiness is a province-wide aggregate oversight view. RBAC is
// enforced at the backend (CLAUDE.md rule 9): only province + admin may read
// it. The report contains AGGREGATE COUNTS ONLY — no student/parent/driver
// names, phones, or CIDs — so no PII audit is required on read.
router.use(authenticate, requireRole('province', 'admin'));

// ─── GET /api/readiness  (alias: /api/readiness/summary) ────────────────────
// Returns the aggregate readiness report in the standard response format.
async function handleReadiness(req, res, next) {
  try {
    const { pool } = require('../config/database');
    const report = await getDeploymentReadiness(pool, { mode: env.safetyPolicy.mode });
    return sendSuccess(res, report);
  } catch (err) {
    return next(err);
  }
}

router.get('/', handleReadiness);
router.get('/summary', handleReadiness);

module.exports = router;
