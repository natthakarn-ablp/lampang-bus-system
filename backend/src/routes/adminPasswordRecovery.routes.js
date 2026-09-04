'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const { pool } = require('../config/database');
const env = require('../config/env');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { verifyIdToken } = require('../services/lineIdToken.service');
const { sendTextMessage } = require('../services/line.service');
const { logAudit } = require('../utils/audit');
const { validatePassword } = require('../utils/passwordPolicy');
const { sendSuccess, sendError } = require('../utils/response');
const {
  enabledRecoveryRoles,
  isRecoveryEnabledForRole,
  recoveryPolicySummary,
} = require('../config/accountRecoveryPolicy');
const {
  generateResetToken,
  generateRecoveryCodes,
  hashResetToken,
  hashRecoveryCode,
  hashIpAddress,
  normalizeRecoveryCode,
} = require('../utils/recoveryTokens');

const router = express.Router();
const BCRYPT_COST = 12;
const RESET_TTL_MINUTES = 15;
const GENERIC_REQUEST_MESSAGE =
  'หากบัญชีนี้เปิดใช้การกู้คืน ระบบจะส่งลิงก์ไปยัง LINE ที่ผูกไว้';

const requestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, message: 'ส่งคำขอถี่เกินไป กรุณาลองใหม่ภายหลัง', errors: [], data: null },
});

const completeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, message: 'ลองรหัสหลายครั้งเกินไป กรุณาขอลิงก์ใหม่', errors: [], data: null },
});

const adminActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, message: 'ดำเนินการถี่เกินไป กรุณาลองใหม่ภายหลัง', errors: [], data: null },
});

/**
 * Policy input.
 *
 * Role flags are read from the environment, except admin's, which comes from
 * `env.features.adminPasswordRecovery` — the value the rest of the app already
 * reads and the seam the existing tests toggle. Keeping one authority per role
 * avoids the class of bug where a flag looks on in one module and off in
 * another.
 */
function recoveryEnvSource() {
  return {
    ...process.env,
    FEATURE_ADMIN_PASSWORD_RECOVERY: env.features.adminPasswordRecovery ? 'true' : 'false',
  };
}

/**
 * Gate for the shared, unauthenticated endpoints (`/request`, `/complete`).
 * Open only while at least one role is enabled; with none enabled these paths
 * 404 exactly as they did before recovery existed, so the surface an attacker
 * can probe does not grow when the mechanism ships dark.
 */
function requireFeature(_req, res, next) {
  if (enabledRecoveryRoles(recoveryEnvSource()).length === 0) {
    return sendError(res, 'ไม่พบหน้าที่ต้องการ', [], 404);
  }
  return next();
}

/**
 * Gate for the authenticated self-service endpoints. A role whose decision
 * gates are unconfirmed gets 404, not 403: an operator with a valid token for
 * a not-yet-launched role should not be able to tell the difference between
 * "off" and "does not exist".
 */
function requireRecoveryRole(req, res, next) {
  if (!req.user || !isRecoveryEnabledForRole(req.user.role, recoveryEnvSource())) {
    return sendError(res, 'ไม่พบหน้าที่ต้องการ', [], 404);
  }
  return next();
}

function resetUrl(rawToken) {
  return `${env.app.publicUrl.replace(/\/$/, '')}/reset-password#token=${encodeURIComponent(rawToken)}`;
}

function isDelivered(result) {
  return Boolean(result && result.sent === true);
}

async function replaceRecoveryCodes(executor, userId) {
  const codes = generateRecoveryCodes(8);
  await executor.query('DELETE FROM user_recovery_codes WHERE user_id = ?', [userId]);
  const values = codes.map((code) => [userId, hashRecoveryCode(code, env.jwt.secret)]);
  await executor.query('INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ?', [values]);
  return codes;
}

router.get('/config', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return sendSuccess(res, {
    // Kept for the existing frontend, which reads this key.
    admin_password_recovery: isRecoveryEnabledForRole('admin', recoveryEnvSource()),
    // Per-role status, so an operator can see WHY a role is closed rather than
    // inferring it from a 404.
    policy: recoveryPolicySummary(recoveryEnvSource()),
  });
});

async function handleStatus(req, res, next) {
  try {
    const [[channel]] = await pool.query(
      `SELECT is_verified, verified_at
         FROM user_recovery_channels
        WHERE user_id = ? AND provider = 'LINE'
        LIMIT 1`,
      [req.user.id]
    );
    const [[codeCount]] = await pool.query(
      'SELECT COUNT(*) AS remaining FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL',
      [req.user.id]
    );
    return sendSuccess(res, {
      line_linked: Boolean(channel && channel.is_verified),
      verified_at: channel?.verified_at || null,
      recovery_codes_remaining: Number(codeCount?.remaining || 0),
    });
  } catch (error) {
    return next(error);
  }
}

async function handleLinkLine(req, res, next) {
  const { current_password: currentPassword, id_token: idToken } = req.body || {};
  if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 256 ||
      typeof idToken !== 'string' || !idToken || idToken.length > 10000) {
    return sendError(res, 'กรุณากรอกรหัสผ่านปัจจุบันและยืนยันบัญชี LINE', [], 400);
  }

  let conn;
  try {
    const [[user]] = await pool.query(
      `SELECT id, username, display_name, password_hash
         FROM users
        WHERE id = ? AND role = ? AND is_active = TRUE AND is_deleted = FALSE
        LIMIT 1`,
      [req.user.id, req.user.role]
    );
    if (!user || !(await bcrypt.compare(String(currentPassword), user.password_hash))) {
      return sendError(res, 'รหัสผ่านปัจจุบันไม่ถูกต้อง', [], 400);
    }

    const verified = await verifyIdToken(String(idToken));
    if (!verified.valid || !verified.userId) {
      return sendError(res, 'ไม่สามารถยืนยันบัญชี LINE ได้ กรุณาเปิดใหม่ผ่าน LINE OA', [], 400);
    }

    const delivery = await sendTextMessage(
      verified.userId,
      'กำลังยืนยัน LINE สำหรับกู้คืนรหัสผ่านผู้ดูแลระบบ School Safe Connect หากคุณไม่ได้ดำเนินการ กรุณาติดต่อผู้ดูแลระบบทันที'
    );
    if (!isDelivered(delivery)) {
      return sendError(res, 'ไม่สามารถส่งข้อความถึง LINE นี้ได้ กรุณาเพิ่มเพื่อน LINE OA แล้วลองใหม่', [], 502);
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]);
    await conn.query(
      'UPDATE password_reset_requests SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
      [user.id]
    );
    await conn.query("DELETE FROM user_recovery_channels WHERE user_id = ? AND provider = 'LINE'", [user.id]);
    await conn.query(
      `INSERT INTO user_recovery_channels
         (user_id, provider, provider_subject, is_verified, verified_at)
       VALUES (?, 'LINE', ?, TRUE, NOW())`,
      [user.id, verified.userId]
    );
    const codes = await replaceRecoveryCodes(conn, user.id);
    await logAudit({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'user_recovery_channel',
      entityId: user.id,
      newValue: { action: 'admin_line_recovery_linked', provider: 'LINE' },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      conn,
    });
    await conn.commit();
    res.set('Cache-Control', 'no-store');
    return sendSuccess(res, { recovery_codes: codes }, 'ผูก LINE สำหรับกู้คืนรหัสผ่านสำเร็จ');
  } catch (error) {
    if (conn) try { await conn.rollback(); } catch { /* preserve original error */ }
    if (error && error.code === 'ER_DUP_ENTRY') {
      return sendError(res, 'บัญชี LINE นี้ถูกผูกกับผู้ดูแลระบบบัญชีอื่นแล้ว', [], 409);
    }
    return next(error);
  } finally {
    if (conn) conn.release();
  }
}

async function handleRegenerateCodes(req, res, next) {
  const { current_password: currentPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 256) {
    return sendError(res, 'กรุณากรอกรหัสผ่านปัจจุบัน', [], 400);
  }
  let conn;
  try {
    const [[user]] = await pool.query(
      `SELECT id, password_hash FROM users
        WHERE id = ? AND role = ? AND is_active = TRUE AND is_deleted = FALSE LIMIT 1`,
      [req.user.id, req.user.role]
    );
    if (!user || !(await bcrypt.compare(String(currentPassword), user.password_hash))) {
      return sendError(res, 'รหัสผ่านปัจจุบันไม่ถูกต้อง', [], 400);
    }
    const [[channel]] = await pool.query(
      `SELECT id FROM user_recovery_channels
        WHERE user_id = ? AND provider = 'LINE' AND is_verified = TRUE LIMIT 1`,
      [user.id]
    );
    if (!channel) return sendError(res, 'กรุณาผูก LINE ก่อนสร้างรหัสกู้คืน', [], 400);

    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]);
    const codes = await replaceRecoveryCodes(conn, user.id);
    await conn.query(
      'UPDATE password_reset_requests SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
      [user.id]
    );
    await logAudit({
      userId: user.id, action: 'UPDATE', entityType: 'user_recovery_code', entityId: user.id,
      newValue: { action: 'admin_recovery_codes_regenerated' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], conn,
    });
    await conn.commit();
    res.set('Cache-Control', 'no-store');
    return sendSuccess(res, { recovery_codes: codes }, 'สร้างรหัสกู้คืนชุดใหม่สำเร็จ');
  } catch (error) {
    if (conn) try { await conn.rollback(); } catch { /* preserve original error */ }
    return next(error);
  } finally {
    if (conn) conn.release();
  }
}

async function handleUnlinkLine(req, res, next) {
  const { current_password: currentPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 256) {
    return sendError(res, 'กรุณากรอกรหัสผ่านปัจจุบัน', [], 400);
  }
  let conn;
  try {
    const [[user]] = await pool.query(
      `SELECT id, password_hash FROM users
        WHERE id = ? AND role = ? AND is_active = TRUE AND is_deleted = FALSE LIMIT 1`,
      [req.user.id, req.user.role]
    );
    if (!user || !(await bcrypt.compare(String(currentPassword), user.password_hash))) {
      return sendError(res, 'รหัสผ่านปัจจุบันไม่ถูกต้อง', [], 400);
    }
    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]);
    await conn.query('DELETE FROM password_reset_requests WHERE user_id = ? AND used_at IS NULL', [user.id]);
    await conn.query('DELETE FROM user_recovery_codes WHERE user_id = ?', [user.id]);
    await conn.query("DELETE FROM user_recovery_channels WHERE user_id = ? AND provider = 'LINE'", [user.id]);
    await logAudit({
      userId: user.id, action: 'DELETE', entityType: 'user_recovery_channel', entityId: user.id,
      newValue: { action: 'admin_line_recovery_unlinked', provider: 'LINE' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], conn,
    });
    await conn.commit();
    return sendSuccess(res, null, 'ยกเลิกการผูก LINE สำหรับกู้คืนรหัสผ่านแล้ว');
  } catch (error) {
    if (conn) try { await conn.rollback(); } catch { /* preserve original error */ }
    return next(error);
  } finally {
    if (conn) conn.release();
  }
}

// ─── Authenticated self-service ─────────────────────────────────────────────
//
// The roadmap (Phase 2) asks for the self-service endpoints to be separated
// from per-role policy. The handlers above are role-agnostic: they read the
// caller's own role from the token and never accept one from the request, so
// the same code serves every role that policy opens.
//
// `/self/*` is the general form. `/admin/*` stays as it was so the shipped
// admin UI keeps working, and keeps its explicit admin role guard rather than
// inheriting whatever policy later enables.
const selfServiceGate = [requireFeature, authenticate, requireRecoveryRole];
const adminGate = [requireFeature, authenticate, requireRole('admin'), requireRecoveryRole];

router.get('/self/status', ...selfServiceGate, handleStatus);
router.post('/self/link-line', adminActionLimiter, ...selfServiceGate, handleLinkLine);
router.post('/self/regenerate-codes', adminActionLimiter, ...selfServiceGate, handleRegenerateCodes);
router.delete('/self/line', adminActionLimiter, ...selfServiceGate, handleUnlinkLine);

router.get('/admin/status', ...adminGate, handleStatus);
router.post('/admin/link-line', adminActionLimiter, ...adminGate, handleLinkLine);
router.post('/admin/regenerate-codes', adminActionLimiter, ...adminGate, handleRegenerateCodes);
router.delete('/admin/line', adminActionLimiter, ...adminGate, handleUnlinkLine);

router.post('/request', requestLimiter, requireFeature, async (req, res, next) => {
  const username = String(req.body?.username || '').trim();
  if (!username || username.length > 100) {
    return sendSuccess(res, null, GENERIC_REQUEST_MESSAGE);
  }
  // Snapshot the allowlist once so the lookup and the locking re-read agree
  // even if a flag is flipped mid-request.
  const enabledRoles = enabledRecoveryRoles(recoveryEnvSource());
  let conn;
  let committed = false;
  try {
    const [[row]] = await pool.query(
      `SELECT u.id, u.display_name, rc.provider_subject
         FROM users u
         JOIN user_recovery_channels rc ON rc.user_id = u.id
          AND rc.provider = 'LINE' AND rc.is_verified = TRUE
        WHERE u.username = ? AND u.role IN (?)
          AND u.is_active = TRUE AND u.is_deleted = FALSE
          AND EXISTS (
            SELECT 1 FROM user_recovery_codes crc
             WHERE crc.user_id = u.id AND crc.used_at IS NULL
          )
        LIMIT 1`,
      [username, enabledRoles]
    );

    if (row) {
      const rawToken = generateResetToken();
      const requestId = uuidv4();
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [[lockedChannel]] = await conn.query(
        `SELECT rc.provider_subject
           FROM users u
           JOIN user_recovery_channels rc ON rc.user_id = u.id
            AND rc.provider = 'LINE' AND rc.is_verified = TRUE
          WHERE u.id = ? AND u.role IN (?)
            AND u.is_active = TRUE AND u.is_deleted = FALSE
            AND EXISTS (
              SELECT 1 FROM user_recovery_codes crc
               WHERE crc.user_id = u.id AND crc.used_at IS NULL
            )
          LIMIT 1 FOR UPDATE`,
        [row.id, enabledRoles]
      );
      if (!lockedChannel) {
        await conn.rollback();
        return sendSuccess(res, null, GENERIC_REQUEST_MESSAGE);
      }
      await conn.query(
        'UPDATE password_reset_requests SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
        [row.id]
      );
      await conn.query(
        `INSERT INTO password_reset_requests
           (id, user_id, token_hash, expires_at, delivery_status, request_ip_hash)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 'PENDING', ?)`,
        [requestId, row.id, hashResetToken(rawToken), RESET_TTL_MINUTES, hashIpAddress(req.ip, env.jwt.secret)]
      );
      await conn.commit();
      committed = true;
      const delivery = await sendTextMessage(
        lockedChannel.provider_subject,
        `คำขอเปลี่ยนรหัสผ่าน School Safe Connect\nลิงก์นี้ใช้ได้ ${RESET_TTL_MINUTES} นาที และต้องใช้รหัสกู้คืน 1 ชุดร่วมด้วย\n${resetUrl(rawToken)}\nหากคุณไม่ได้ขอเปลี่ยนรหัสผ่าน ไม่ต้องกดลิงก์และกรุณาแจ้งผู้ดูแลระบบ`
      );
      await pool.query(
        `UPDATE password_reset_requests
            SET delivery_status = ?, used_at = IF(? = 'FAILED', NOW(), used_at)
          WHERE id = ?`,
        [isDelivered(delivery) ? 'SENT' : 'FAILED', isDelivered(delivery) ? 'SENT' : 'FAILED', requestId]
      );
      await logAudit({
        userId: row.id, action: 'UPDATE', entityType: 'password_reset_request', entityId: requestId,
        newValue: { action: 'admin_password_reset_requested', delivered: isDelivered(delivery) },
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
      });
    }
    return sendSuccess(res, null, GENERIC_REQUEST_MESSAGE);
  } catch (error) {
    if (conn && !committed) try { await conn.rollback(); } catch { /* preserve original error */ }
    return next(error);
  } finally {
    if (conn) conn.release();
  }
});

router.post('/complete', completeLimiter, requireFeature, async (req, res, next) => {
  const rawToken = String(req.body?.token || '');
  const rawRecoveryCode = req.body?.recovery_code;
  const recoveryCode = normalizeRecoveryCode(rawRecoveryCode);
  const newPassword = req.body?.new_password;
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken) ||
      typeof rawRecoveryCode !== 'string' || rawRecoveryCode.length > 32 || recoveryCode.length !== 12 ||
      typeof newPassword !== 'string' || !newPassword) {
    return sendError(res, 'ลิงก์หรือข้อมูลยืนยันไม่ครบถ้วน', [], 400);
  }

  let conn;
  let committed = false;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[reset]] = await conn.query(
      `SELECT pr.id, pr.user_id, pr.failed_attempts, u.username, u.password_hash,
              rc.provider_subject
         FROM password_reset_requests pr
         JOIN users u ON u.id = pr.user_id
         JOIN user_recovery_channels rc ON rc.user_id = u.id
          AND rc.provider = 'LINE' AND rc.is_verified = TRUE
        WHERE pr.token_hash = ? AND pr.delivery_status = 'SENT'
          AND pr.used_at IS NULL AND pr.expires_at > NOW()
          AND pr.failed_attempts < 5
          AND u.role IN (?) AND u.is_active = TRUE AND u.is_deleted = FALSE
        LIMIT 1 FOR UPDATE`,
      [hashResetToken(rawToken), enabledRecoveryRoles(recoveryEnvSource())]
    );
    if (!reset) {
      await conn.rollback();
      return sendError(res, 'ลิงก์หมดอายุหรือถูกใช้งานแล้ว กรุณาขอลิงก์ใหม่', [], 400);
    }

    const pwCheck = validatePassword(newPassword, { username: reset.username });
    if (!pwCheck.ok) {
      await conn.rollback();
      return sendError(res, pwCheck.message, [], 400);
    }
    if (await bcrypt.compare(String(newPassword), reset.password_hash)) {
      await conn.rollback();
      return sendError(res, 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม', [], 400);
    }

    const codeHash = hashRecoveryCode(recoveryCode, env.jwt.secret);
    const [[code]] = await conn.query(
      `SELECT id FROM user_recovery_codes
        WHERE user_id = ? AND code_hash = ? AND used_at IS NULL
        LIMIT 1 FOR UPDATE`,
      [reset.user_id, codeHash]
    );
    if (!code) {
      await conn.query(
        `UPDATE password_reset_requests
            SET used_at = IF(failed_attempts + 1 >= 5, NOW(), used_at),
                failed_attempts = failed_attempts + 1
          WHERE id = ?`,
        [reset.id]
      );
      await conn.commit();
      committed = true;
      return sendError(res, 'รหัสกู้คืนไม่ถูกต้องหรือถูกใช้งานแล้ว', [], 400);
    }

    const passwordHash = await bcrypt.hash(String(newPassword), BCRYPT_COST);
    await conn.query(
      'UPDATE users SET password_hash = ?, must_change_password = FALSE, password_changed_at = NOW() WHERE id = ?',
      [passwordHash, reset.user_id]
    );
    await conn.query('UPDATE user_recovery_codes SET used_at = NOW() WHERE id = ?', [code.id]);
    await conn.query('UPDATE password_reset_requests SET used_at = NOW() WHERE id = ?', [reset.id]);
    await conn.query(
      'UPDATE password_reset_requests SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
      [reset.user_id]
    );
    await logAudit({
      userId: reset.user_id, action: 'UPDATE', entityType: 'user', entityId: reset.user_id,
      newValue: { action: 'admin_password_recovered', method: 'LINE_AND_RECOVERY_CODE' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], conn,
    });
    await conn.commit();
    committed = true;
    try {
      await sendTextMessage(
        reset.provider_subject,
        'เปลี่ยนรหัสผ่านผู้ดูแลระบบ School Safe Connect สำเร็จแล้ว เซสชันเดิมถูกยกเลิก กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่'
      );
    } catch (notifyError) {
      console.error('[ADMIN_RECOVERY] password changed but confirmation push failed', {
        error: notifyError.message,
      });
    }
    return sendSuccess(res, null, 'เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่');
  } catch (error) {
    if (conn && !committed) try { await conn.rollback(); } catch { /* preserve original error */ }
    return next(error);
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
module.exports._test = { resetUrl, isDelivered, replaceRecoveryCodes, requireFeature, requireRecoveryRole };
