'use strict';

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { pool } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { optionalAuth } = require('../middleware/optionalAuth');
const { sendSuccess, sendError } = require('../utils/response');
const { logAudit } = require('../utils/audit');
const qr = require('../services/qrAccess.service');

// Level-1 is unauthenticated → rate-limit the public scan endpoint per IP.
const qrLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, message: 'มีการเรียกดูบ่อยเกินไป กรุณาลองใหม่ภายหลัง', errors: [], data: null },
});

// ─── GET /api/qr/vehicle/:qr_token ───────────────────────────────────────────
// Public scan. `optionalAuth` attaches whatever identity it can prove; the level
// is computed server-side from credentials only and the response carries ONLY
// that level's fields. Anonymous → L1; verified parent on this vehicle → L2;
// staff (transport/admin/province) → L3 (audited).
router.get('/vehicle/:qr_token', qrLimiter, optionalAuth, async (req, res, next) => {
  try {
    const vehicle = await qr.getVehicleByQrToken(req.params.qr_token);
    if (!vehicle) return sendError(res, 'ไม่พบรถสำหรับ QR นี้', [], 404);
    const level = await qr.resolveAccessLevel(req, vehicle.id);
    const view = await qr.buildViewForLevel(req, vehicle, level);
    return sendSuccess(res, view);
  } catch (err) { next(err); }
});

// ─── Admin/transport: mint or rotate a vehicle's QR token ────────────────────
router.post('/vehicle/:id/token', authenticate, requireRole('admin', 'transport'), async (req, res, next) => {
  try {
    const [[v]] = await pool.query('SELECT id FROM vehicles WHERE id = ? AND COALESCE(is_deleted, FALSE) = FALSE', [req.params.id]);
    if (!v) return sendError(res, 'ไม่พบรถ', [], 404);
    const token = crypto.randomBytes(16).toString('base64url'); // 22 chars, opaque, non-enumerable
    await pool.query('UPDATE vehicles SET qr_token = ?, qr_revoked_at = NULL WHERE id = ?', [token, v.id]);
    await logAudit({ userId: req.user.id, action: 'UPDATE', entityType: 'vehicle_qr', entityId: String(v.id),
      newValue: { rotated: true }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    return sendSuccess(res, { vehicle_id: v.id, qr_token: token, qr_path: `/qr/${token}` }, 'สร้าง QR token แล้ว', null, 201);
  } catch (err) { next(err); }
});

// ─── Admin/transport: read a vehicle's current QR token ──────────────────────
router.get('/vehicle/:id/token', authenticate, requireRole('admin', 'transport'), async (req, res, next) => {
  try {
    const [[v]] = await pool.query('SELECT id, qr_token, qr_revoked_at FROM vehicles WHERE id = ? AND COALESCE(is_deleted, FALSE) = FALSE', [req.params.id]);
    if (!v) return sendError(res, 'ไม่พบรถ', [], 404);
    const active = v.qr_token && !v.qr_revoked_at;
    return sendSuccess(res, { vehicle_id: v.id, qr_token: active ? v.qr_token : null, qr_path: active ? `/qr/${v.qr_token}` : null, revoked: !!v.qr_revoked_at });
  } catch (err) { next(err); }
});

// ─── Admin/transport: revoke a vehicle's QR token ────────────────────────────
router.post('/vehicle/:id/revoke', authenticate, requireRole('admin', 'transport'), async (req, res, next) => {
  try {
    const [[v]] = await pool.query('SELECT id FROM vehicles WHERE id = ? AND COALESCE(is_deleted, FALSE) = FALSE', [req.params.id]);
    if (!v) return sendError(res, 'ไม่พบรถ', [], 404);
    await pool.query('UPDATE vehicles SET qr_revoked_at = NOW() WHERE id = ? AND qr_revoked_at IS NULL', [v.id]);
    await logAudit({ userId: req.user.id, action: 'UPDATE', entityType: 'vehicle_qr', entityId: String(v.id),
      newValue: { revoked: true }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    return sendSuccess(res, { vehicle_id: v.id, revoked: true }, 'ยกเลิก QR แล้ว');
  } catch (err) { next(err); }
});

module.exports = router;
