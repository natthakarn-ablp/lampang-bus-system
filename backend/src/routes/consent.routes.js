'use strict';

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const idTokenSvc = require('../services/lineIdToken.service');
const consentSvc = require('../services/consent.service');
const { getConsentText, isValidConsentType } = require('../config/consentText');

const DRIVER_CONSENTS = new Set(['qr_driver_public', 'qr_driver_parent', 'qr_driver_sensitive']);

// Small local parent-LINE guard (mirrors parent.routes; that file is left untouched).
async function requireParentLineAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const token = bearer ||
      (typeof req.query.id_token === 'string' ? req.query.id_token : '') ||
      (req.body && typeof req.body.id_token === 'string' ? req.body.id_token : '') || '';
    if (!token) return sendError(res, 'กรุณาเปิดผ่าน LINE ก่อนใช้งาน', [], 401);
    const verify = await idTokenSvc.verifyIdToken(token);
    if (!verify.valid) return sendError(res, 'ไม่สามารถยืนยันบัญชี LINE ได้', [], 401);
    req.lineUserId = verify.userId;
    return next();
  } catch (err) { return next(err); }
}

// ─── GET /api/consent/notice?type=... ─ public: text + version for a consent type
router.get('/notice', (req, res) => {
  const type = String(req.query.type || '');
  if (!isValidConsentType(type)) return sendError(res, 'ประเภทความยินยอมไม่ถูกต้อง', [], 400);
  const t = getConsentText(type);
  return sendSuccess(res, { type, version: t.version, required: t.required, title: t.title, body: t.body });
});

// ─── Parent (LINE-verified) ──────────────────────────────────────────────────
router.get('/me/parent', requireParentLineAuth, async (req, res, next) => {
  try { return sendSuccess(res, await consentSvc.getMyConsents({ lineUserId: req.lineUserId })); }
  catch (err) { next(err); }
});
router.post('/parent', requireParentLineAuth, async (req, res, next) => {
  try {
    const out = await consentSvc.grantConsent({ lineUserId: req.lineUserId, userRole: 'parent', consentType: 'qr_parent_optin', ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    return sendSuccess(res, out, 'บันทึกความยินยอมแล้ว', null, 201);
  } catch (err) { next(err); }
});
router.post('/parent/withdraw', requireParentLineAuth, async (req, res, next) => {
  try {
    const out = await consentSvc.withdrawConsent({ lineUserId: req.lineUserId, userRole: 'parent', consentType: 'qr_parent_optin', ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    return sendSuccess(res, out, 'ถอนความยินยอมแล้ว');
  } catch (err) { next(err); }
});

// ─── Driver / staff (JWT) ────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res, next) => {
  try { return sendSuccess(res, await consentSvc.getMyConsents({ userId: req.user.id })); }
  catch (err) { next(err); }
});
router.post('/', authenticate, requireRole('driver'), async (req, res, next) => {
  try {
    const type = String((req.body || {}).consent_type || '');
    if (!DRIVER_CONSENTS.has(type)) return sendError(res, 'ประเภทความยินยอมไม่ถูกต้อง', [], 400);
    const out = await consentSvc.grantConsent({ userId: req.user.id, userRole: req.user.role, consentType: type, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    return sendSuccess(res, out, 'บันทึกความยินยอมแล้ว', null, 201);
  } catch (err) { next(err); }
});
router.post('/withdraw', authenticate, requireRole('driver'), async (req, res, next) => {
  try {
    const type = String((req.body || {}).consent_type || '');
    if (!DRIVER_CONSENTS.has(type)) return sendError(res, 'ประเภทความยินยอมไม่ถูกต้อง', [], 400);
    const out = await consentSvc.withdrawConsent({ userId: req.user.id, userRole: req.user.role, consentType: type, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    return sendSuccess(res, out, 'ถอนความยินยอมแล้ว · หากเป็นความยินยอมที่จำเป็น ระบบจะระงับการแสดงผลของคนขับ');
  } catch (err) { next(err); }
});

module.exports = router;
