'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { pool } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { sendSuccess, sendError } = require('../utils/response');
const lineSvc = require('../services/line.service');

// Rate limit: 60 requests per minute per IP (parents querying status)
const parentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Try again shortly.', errors: [], data: null },
});
router.use(parentLimiter);

/**
 * Parent REST API — for LIFF or web-based parent access.
 * Authentication can be via:
 *   1. JWT token (if parent has a web account) — future
 *   2. LINE LIFF access token verification — future
 *   3. Query by line_user_id passed from LIFF context — MVP approach
 *
 * MVP: These endpoints accept ?line_user_id= as identification.
 * In production, this should be replaced with proper LIFF token verification.
 */

// ─── GET /api/parent/children ───────────────────────────────────────────────
// Returns linked children for a verified LINE parent user
router.get('/children', async (req, res, next) => {
  try {
    const lineUserId = req.query.line_user_id;
    if (!lineUserId) return sendError(res, 'line_user_id is required', [], 400);

    const children = await lineSvc.getLinkedChildren(lineUserId);
    sendSuccess(res, children);
  } catch (err) { next(err); }
});

// ─── GET /api/parent/children/:id/status ────────────────────────────────────
// Returns today's checkin/checkout status for a specific child
router.get('/children/:id/status', async (req, res, next) => {
  try {
    const lineUserId = req.query.line_user_id;
    if (!lineUserId) return sendError(res, 'line_user_id is required', [], 400);

    // Verify the parent is linked to this student
    const children = await lineSvc.getLinkedChildren(lineUserId);
    const child = children.find(c => c.id === parseInt(req.params.id));
    if (!child) return sendError(res, 'Student not linked to this account', [], 403);

    const status = await lineSvc.getChildStatusToday(parseInt(req.params.id));
    sendSuccess(res, { ...child, ...status });
  } catch (err) { next(err); }
});

// ─── GET /api/parent/children/:id/history ───────────────────────────────────
// Returns recent checkin/checkout history for a child (last 7 days)
router.get('/children/:id/history', async (req, res, next) => {
  try {
    const lineUserId = req.query.line_user_id;
    if (!lineUserId) return sendError(res, 'line_user_id is required', [], 400);

    // Verify linkage
    const children = await lineSvc.getLinkedChildren(lineUserId);
    const child = children.find(c => c.id === parseInt(req.params.id));
    if (!child) return sendError(res, 'Student not linked to this account', [], 403);

    const days = parseInt(req.query.days) || 7;
    const [rows] = await pool.query(
      `SELECT check_date, session, status, checked_at
       FROM checkin_logs
       WHERE student_id = ? AND check_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       ORDER BY check_date DESC, checked_at DESC`,
      [parseInt(req.params.id), days]
    );

    sendSuccess(res, { student: child, history: rows });
  } catch (err) { next(err); }
});

module.exports = router;
