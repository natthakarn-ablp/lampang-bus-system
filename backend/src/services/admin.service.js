'use strict';

const { pool } = require('../config/database');

/**
 * getUsersNeedingAction — top N users in a state that needs admin
 * follow-up: account deactivated OR still on a temporary password
 * (must_change_password=TRUE).
 *
 * Returns { total, rows } so the Admin Attention Panel can show a true
 * total count on the badge while only rendering the top-N preview.
 *
 * Sort: inactive accounts first (most urgent — user is locked out),
 * then accounts pending password change, then by created_at DESC
 * (newest first within each group, so recently-created onboarding
 * gaps surface).
 *
 * Defensive: does NOT select password_hash. Username + display_name
 * + role are already exposed across UserManagement / audit-logs.
 */
async function getUsersNeedingAction({ limit = 10 } = {}) {
  const topN = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

  const [[{ total }]] = await pool.query(`
    SELECT COUNT(*) AS total FROM users
    WHERE is_deleted = FALSE
      AND (is_active = FALSE OR must_change_password = TRUE)
  `);

  const [rows] = await pool.query(`
    SELECT id, username, display_name, role, scope_type, scope_id,
           is_active, must_change_password, last_login, created_at
    FROM users
    WHERE is_deleted = FALSE
      AND (is_active = FALSE OR must_change_password = TRUE)
    ORDER BY is_active ASC,             -- FALSE sorts before TRUE → inactive first
             must_change_password DESC,  -- TRUE sorts before FALSE → pending-pw next
             created_at DESC
    LIMIT ?
  `, [topN]);

  return { total, rows };
}

/**
 * getPendingRosterRequestsSystemWide — top N pending roster_change_requests
 * across the entire system, oldest first so longest-waiting requests
 * (highest SLA risk) surface at the top.
 *
 * Today this data is only queryable at school scope (school owns
 * approvals via /school/roster-requests). The Admin Attention Panel
 * needs the system-wide count + preview to flag governance backlog.
 *
 * Returns { total, rows } same shape as getUsersNeedingAction so the
 * frontend treats both signals uniformly.
 */
async function getPendingRosterRequestsSystemWide({ limit = 10 } = {}) {
  const topN = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

  const [[{ total }]] = await pool.query(`
    SELECT COUNT(*) AS total FROM roster_change_requests
    WHERE status = 'pending'
  `);

  const [rows] = await pool.query(`
    SELECT rcr.id, rcr.school_id, rcr.vehicle_id, rcr.student_id,
           rcr.request_type, rcr.reason, rcr.created_at,
           sc.name     AS school_name,
           v.plate_no  AS plate_no
    FROM roster_change_requests rcr
    LEFT JOIN schools  sc ON sc.id = rcr.school_id  AND sc.is_deleted = FALSE
    LEFT JOIN vehicles v  ON v.id  = rcr.vehicle_id
    WHERE rcr.status = 'pending'
    ORDER BY rcr.created_at ASC   -- oldest first → longest-waiting first
    LIMIT ?
  `, [topN]);

  return { total, rows };
}

module.exports = {
  getUsersNeedingAction,
  getPendingRosterRequestsSystemWide,
};
