'use strict';

// GET /api/<role>/pending-summary — "งานรออนุมัติ" badge + page for every
// approver role. Mounted inside each role router, so authentication, the role
// guard and the global per-user rate limit come from that router. Scope comes
// from the token only (CLAUDE.md §12.9); ?detail=1 adds the item lists.

const { sendSuccess } = require('../utils/response');
const { pool } = require('../config/database');
const pendingSvc = require('../services/pendingQueue.service');

function pendingSummaryHandler({ withOpsAlerts = false } = {}) {
  return async (req, res, next) => {
    try {
      const viewer = {
        role: req.user.role,
        scopeId: req.user.scopeId || null,
        gradeScope: req.user.gradeScope || null,
      };
      const detail = req.query.detail === '1' || req.query.detail === 'true';
      const data = await pendingSvc.getSummary(pool, viewer, { detail });
      if (withOpsAlerts && req.user.role === 'admin') {
        data.ops_alerts = await require('../services/opsWatch.service').listRecentAlerts(pool);
      }
      // School main account: recent LINE-recovery binds/unbinds by its grade
      // teachers and its pupils' drivers (recoveryBindingAlert.service).
      if (req.user.role === 'school' && !req.user.gradeScope && req.user.scopeId) {
        data.recovery_alerts = await require('../services/recoveryBindingAlert.service')
          .listForSchool(pool, req.user.scopeId, { days: 14, limit: 10 })
          .catch(() => []);
      }
      return sendSuccess(res, data);
    } catch (err) { return next(err); }
  };
}

module.exports = { pendingSummaryHandler };
