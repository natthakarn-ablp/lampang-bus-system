'use strict';

/**
 * visits.routes.js
 *
 * Public daily-visit counter (aggregate only).
 *
 * POST /api/visits/track    — public, no auth, body { logged_in?: boolean }
 *                              Increments today's daily_visits row
 *                              (creates row on first hit of the day).
 *
 * Frontend dedupes per browser tab via sessionStorage,
 * so this endpoint is fired ~once per browser session.
 *
 * No PII captured. No IP / user-agent stored.
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { sendSuccess } = require('../utils/response');

router.post('/track', async (req, res, next) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const isLoggedIn = !!(req.body && req.body.logged_in === true);
    const publicInc = isLoggedIn ? 0 : 1;
    const loggedInInc = isLoggedIn ? 1 : 0;

    await pool.query(
      `INSERT INTO daily_visits (visit_date, total_visits, public_visits, logged_in_visits)
       VALUES (?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE
         total_visits = total_visits + 1,
         public_visits = public_visits + VALUES(public_visits),
         logged_in_visits = logged_in_visits + VALUES(logged_in_visits)`,
      [today, publicInc, loggedInInc]
    );

    return sendSuccess(res, { tracked: true, date: today }, 'OK', null, 201);
  } catch (err) { return next(err); }
});

module.exports = router;
