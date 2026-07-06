'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { sendSuccess } = require('../utils/response');
const { pool } = require('../config/database');
const { getCurrentTerm } = require('../services/term.service');

router.use(authenticate);

// GET /api/terms/current
// The term the system will stamp on any data ENTERED TODAY (date-derived, Bangkok),
// plus its window — so the UI can tell schools exactly which academic term they are
// filling in and avoid the mis-tag that a manual/implicit term used to cause.
router.get('/current', async (_req, res, next) => {
  try {
    const termId = await getCurrentTerm(pool);
    // DATE_FORMAT → 'YYYY-MM-DD' strings so a DATE column can't drift by a day
    // through mysql2's Date-object parsing before it reaches the client.
    const [[row]] = await pool.query(
      `SELECT id, name,
              DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
              DATE_FORMAT(end_date,   '%Y-%m-%d') AS end_date
         FROM terms WHERE id = ?`,
      [termId]
    );
    return sendSuccess(res, {
      term_id: termId,
      name: row ? row.name : null,
      start_date: row ? row.start_date : null,
      end_date: row ? row.end_date : null,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
