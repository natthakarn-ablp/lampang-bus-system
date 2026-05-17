'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { pool } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { sendSuccess, sendError } = require('../utils/response');
const lineSvc = require('../services/line.service');
const idTokenSvc = require('../services/lineIdToken.service');
const tpl = require('../services/lineFlexTemplates.service');

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

// ─── LIFF bind flow (Phase 10.3E-UX1) ───────────────────────────────────────
// Two-step server-trusted bind: preview (read-only) then confirm (writes).
// Both endpoints require a valid LIFF ID token — line_user_id is NEVER taken
// from the request body. The canonical lineUserId is the `sub` field of the
// LINE-verified token, full stop.

function validatePhone(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\D/g, '');
  if (!/^\d{10}$/.test(s)) return null;
  return s;
}

function validateStudentId(raw) {
  const n = typeof raw === 'string' || typeof raw === 'number' ? parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

// POST /api/parent/line/bind-preview
// body: { idToken, phone, studentId }
// → 200 { student: { ... }, masked_phone: "090****567" }   parent may proceed
// → 400 invalid input
// → 401 idToken invalid
// → 404 phone+studentId combo not found
// → 409 already linked (different parent)
router.post('/line/bind-preview', async (req, res, next) => {
  try {
    const { idToken, phone, studentId } = req.body || {};
    const errors = [];
    const cleanPhone = validatePhone(phone);
    const cleanStudent = validateStudentId(studentId);
    if (!cleanPhone)   errors.push({ field: 'phone',     message: 'กรุณากรอกเบอร์โทรศัพท์ 10 หลัก' });
    if (!cleanStudent) errors.push({ field: 'studentId', message: 'กรุณากรอกรหัสนักเรียน (ตัวเลข)' });
    if (errors.length) return sendError(res, 'ข้อมูลไม่ถูกต้อง', errors, 400);

    const verify = await idTokenSvc.verifyIdToken(idToken);
    if (!verify.valid) {
      console.warn('[LINE_BIND_PREVIEW] id_token_invalid', { error: verify.error });
      return sendError(res, 'ไม่สามารถยืนยันบัญชี LINE ของคุณได้ กรุณาเปิดผ่านลิงก์ใน LINE OA อีกครั้ง', [], 401);
    }
    const lineUserId = verify.userId;

    // If this LINE userId is already bound to someone, surface that early so
    // the form can guide them to "ยกเลิกผูกบัญชี" first.
    const existing = await lineSvc.getLinkedParentId(lineUserId);
    if (existing) {
      return sendError(res, 'บัญชี LINE นี้ผูกอยู่กับผู้ปกครองท่านอื่นแล้ว กรุณาพิมพ์ "ยกเลิกผูกบัญชี" ก่อน', [], 409);
    }

    const match = await lineSvc.findLinkableParent(cleanPhone, cleanStudent);
    if (!match.found) return sendError(res, match.message || 'ไม่พบข้อมูลที่ตรงกัน', [], 404);

    console.log('[LINE_BIND_PREVIEW] ok', { hasStudent: true });
    return sendSuccess(res, {
      student: match.student,
      masked_phone: tpl.maskPhone(cleanPhone),
    });
  } catch (err) { return next(err); }
});

// POST /api/parent/line/bind-confirm
// body: { idToken, phone, studentId }
// → 201 success
// → same error codes as preview
router.post('/line/bind-confirm', async (req, res, next) => {
  try {
    const { idToken, phone, studentId } = req.body || {};
    const cleanPhone = validatePhone(phone);
    const cleanStudent = validateStudentId(studentId);
    if (!cleanPhone || !cleanStudent) {
      return sendError(res, 'ข้อมูลไม่ถูกต้อง', [], 400);
    }
    const verify = await idTokenSvc.verifyIdToken(idToken);
    if (!verify.valid) {
      console.warn('[LINE_BIND_CONFIRM] id_token_invalid', { error: verify.error });
      return sendError(res, 'ไม่สามารถยืนยันบัญชี LINE ของคุณได้ กรุณาเปิดผ่านลิงก์ใน LINE OA อีกครั้ง', [], 401);
    }
    const lineUserId = verify.userId;

    const existing = await lineSvc.getLinkedParentId(lineUserId);
    if (existing) {
      return sendError(res, 'บัญชี LINE นี้ผูกอยู่แล้ว', [], 409);
    }
    const match = await lineSvc.findLinkableParent(cleanPhone, cleanStudent);
    if (!match.found) return sendError(res, match.message || 'ไม่พบข้อมูลที่ตรงกัน', [], 404);

    await lineSvc.commitLineLink(lineUserId, match.parentId);
    await lineSvc.logMessage(lineUserId, 'system', 'bind_success_liff', 'ok', `parent_id=${match.parentId}`);
    console.log('[LINE_BIND_CONFIRM] linked', { parentId: match.parentId });

    // Push the standard HF4.2 success Flex card to the OA so the chat thread
    // also reflects the binding (parent sees both in-LIFF success + the OA
    // card). Best-effort: a push failure here does NOT undo the bind.
    try {
      const children = await lineSvc.getLinkedChildren(lineUserId);
      await lineSvc.pushParentFlex(lineUserId, {
        flex:         tpl.buildParentBindSuccessCard(children),
        fallbackText: tpl.fallbackBindSuccess(children),
        logPrefix:    '[LINE_PARENT_BIND_FLEX]',
      });
    } catch (pushErr) {
      console.warn('[LINE_BIND_CONFIRM] post_push_failed', { error: pushErr.message });
    }

    return sendSuccess(res, { ok: true }, 'ผูกบัญชีสำเร็จ', null, 201);
  } catch (err) { return next(err); }
});

module.exports = router;
