'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

const { pool } = require('../config/database');
const env = require('../config/env');
const { authenticate } = require('../middleware/auth');
const { sendSuccess, sendError } = require('../utils/response');
const { logAudit } = require('../utils/audit');
const { validatePassword } = require('../utils/passwordPolicy');
const { sessionResetJti, durationMs, recordSessionReset, issuedBeforeReset } = require('../utils/sessionReset');

const router = express.Router();

const BCRYPT_COST = 12;

// JWT must only ever be verified/signed with the symmetric algorithm we use.
// Pinning this closes the alg-confusion / "alg:none" class permanently
// (audit 2026-06-18, auth-crypto).
const JWT_ALG = 'HS256';

// Fixed bcrypt hash used to equalise login timing on the user-not-found and
// account-disabled branches, so response latency can't be used to enumerate
// usernames (audit 2026-06-18, auth-crypto). Computed once at startup; the input
// is a constant that no real password equals.
const DUMMY_BCRYPT_HASH = bcrypt.hashSync('lampang-login-timing-equaliser', BCRYPT_COST);

// Per-(username+IP) failed-login lockout, layered on top of the per-IP rate
// limiter. Stops sustained guessing against a single account even when the
// attacker stays under the IP limit.
//
// A1-9: this used to be a Map in this process, with a comment saying it had to
// move before running more than one instance. It has. The counter now lives in
// login_lockouts (migration 051) so N instances enforce one ceiling of 10
// rather than N ceilings of 10, and it survives a restart — a deploy no longer
// releases every account an attacker was working on.
const {
  loginLockKey: loginKey,
  isLoginLocked,
  noteLoginFail,
  clearLoginFails,
} = require('../utils/sharedSecurityState');

// ─── Rate limiters ──────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'มีการพยายามเข้าสู่ระบบหลายครั้ง กรุณาลองใหม่ใน 15 นาที', errors: [], data: null },
});

// How long after rotation a re-presented refresh token is still read as a
// client retry rather than a replay. Long enough for a mobile client to resend a
// request whose response was lost, short enough that a stolen token used later
// — the ordinary case — is caught.
const REPLAY_GRACE_MS = 10 * 1000;

const refreshLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Try again shortly.', errors: [], data: null },
});

// ─── helpers ────────────────────────────────────────────────────────────────

function generateAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      scopeType: user.scope_type || null,
      scopeId: user.scope_id || null,
      // Phase 7.11.2 — null for every existing account; only set on
      // teacher (homeroom) sub-accounts created in Phase 7.11.5.
      gradeScope: user.grade_scope || null,
      displayName: user.display_name || '',
      // Phase 10.12D — carried so the auth middleware can enforce the forced
      // password change at the backend (H2).
      mustChangePassword: !!user.must_change_password,
    },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn, algorithm: JWT_ALG }
  );
}

function generateRefreshToken(userId) {
  const jti = uuidv4();
  const token = jwt.sign(
    { sub: userId, jti, type: 'refresh' },
    env.jwt.secret,
    { expiresIn: env.jwt.refreshExpiresIn, algorithm: JWT_ALG }
  );
  return { token, jti };
}

/**
 * Decode a refresh token without throwing — returns payload or null.
 */
function decodeRefreshToken(token) {
  try {
    return jwt.verify(token, env.jwt.secret, { algorithms: [JWT_ALG] });
  } catch {
    return null;
  }
}

/**
 * Calculate expiry Date from a JWT payload exp (Unix seconds).
 */
function expToDate(exp) {
  return new Date(exp * 1000);
}

// ─── POST /api/auth/login ────────────────────────────────────────────────────

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return sendError(res, 'username and password are required', [], 400);
    }

    const lockKey = loginKey(username, req.ip);
    if (await isLoginLocked(lockKey)) {
      return sendError(res, 'มีการพยายามเข้าสู่ระบบหลายครั้ง กรุณาลองใหม่ใน 15 นาที', [], 429);
    }

    const [rows] = await pool.query(
      `SELECT id, username, password_hash, role, scope_type, scope_id,
              grade_scope, display_name, is_active, is_deleted, must_change_password,
              driver_id
       FROM users
       WHERE username = ? AND is_deleted = FALSE
       LIMIT 1`,
      [String(username).trim()]
    );

    if (rows.length === 0) {
      // Run a dummy bcrypt compare so the not-found path costs the same as a real
      // one — removes the timing oracle for username enumeration (auth-crypto).
      await bcrypt.compare(String(password), DUMMY_BCRYPT_HASH);
      await noteLoginFail(lockKey);
      await logAudit({ userId: null, action: 'LOGIN', entityType: 'user', entityId: null,
        newValue: { username: String(username).trim(), result: 'failed', reason: 'user_not_found' },
        ipAddress: req.ip, userAgent: req.headers['user-agent'] });
      return sendError(res, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', [], 401);
    }

    const user = rows[0];

    if (!user.is_active) {
      await bcrypt.compare(String(password), DUMMY_BCRYPT_HASH); // equalise timing
      await noteLoginFail(lockKey);
      await logAudit({ userId: user.id, action: 'LOGIN', entityType: 'user', entityId: user.id,
        newValue: { username: user.username, result: 'failed', reason: 'account_disabled' },
        ipAddress: req.ip, userAgent: req.headers['user-agent'] });
      // Phase 10.13B-1 — return the SAME generic message as wrong-password /
      // user-not-found so a disabled account is not externally distinguishable
      // (prevents username enumeration). The real reason is audited above.
      return sendError(res, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', [], 401);
    }

    const passwordMatch = await bcrypt.compare(String(password), user.password_hash);
    if (!passwordMatch) {
      await noteLoginFail(lockKey);
      await logAudit({ userId: user.id, action: 'LOGIN', entityType: 'user', entityId: user.id,
        newValue: { username: user.username, result: 'failed', reason: 'wrong_password' },
        ipAddress: req.ip, userAgent: req.headers['user-agent'] });
      return sendError(res, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', [], 401);
    }

    await clearLoginFails(lockKey);

    // Update last_login
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    const accessToken = generateAccessToken(user);
    const { token: refreshToken } = generateRefreshToken(user.id);

    await logAudit({
      userId: user.id,
      action: 'LOGIN',
      entityType: 'user',
      entityId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(
      res,
      {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: env.jwt.expiresIn,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          scope_type: user.scope_type,
          scope_id: user.scope_id,
          grade_scope: user.grade_scope || null,
          display_name: user.display_name,
          must_change_password: !!user.must_change_password,
          driver_id: user.driver_id || null,
        },
        // Phase 11A audit fix M7: expose feature flags so the frontend can
        // conditionally show/hide sidebar links and route guards without
        // hitting a 404 when a flag-gated route is not mounted on the backend.
        features: env.features,
      },
      'Login successful',
      null,
      200
    );
  } catch (err) {
    return next(err);
  }
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, username, role, scope_type, scope_id, grade_scope,
              display_name, driver_id, last_login, created_at
       FROM users
       WHERE id = ? AND is_deleted = FALSE AND is_active = TRUE
       LIMIT 1`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return sendError(res, 'User not found or account disabled', [], 401);
    }

    return sendSuccess(res, rows[0]);
  } catch (err) {
    return next(err);
  }
});

// ─── POST /api/auth/change-password ─────────────────────────────────────────

router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return sendError(res, 'current_password and new_password are required', [], 400);
    }

    const [rows] = await pool.query(
      'SELECT id, username, password_hash FROM users WHERE id = ? AND is_deleted = FALSE LIMIT 1',
      [req.user.id]
    );

    if (rows.length === 0) {
      return sendError(res, 'User not found', [], 404);
    }

    const match = await bcrypt.compare(String(current_password), rows[0].password_hash);
    if (!match) {
      return sendError(res, 'Current password is incorrect', [], 400);
    }

    const pwCheck = validatePassword(new_password, { username: rows[0].username });
    if (!pwCheck.ok) {
      return sendError(res, pwCheck.message, [], 400);
    }

    const newHash = await bcrypt.hash(String(new_password), BCRYPT_COST);

    await pool.query(
      'UPDATE users SET password_hash = ?, must_change_password = FALSE, password_changed_at = NOW() WHERE id = ?',
      [newHash, req.user.id]
    );

    // Also revoke the specific refresh token sent with this request (belt + suspenders)
    const clientRefreshToken = req.body.refresh_token;
    if (clientRefreshToken) {
      const rtPayload = decodeRefreshToken(clientRefreshToken);
      if (rtPayload && rtPayload.jti) {
        await pool.query(
          'INSERT INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE revoked_at = revoked_at',
          [rtPayload.jti, req.user.id, expToDate(rtPayload.exp)]
        );
      }
    }

    await logAudit({
      userId: req.user.id,
      action: 'UPDATE',
      entityType: 'user',
      entityId: req.user.id,
      newValue: { action: 'password_changed' },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, null, 'Password changed successfully');
  } catch (err) {
    return next(err);
  }
});

// ─── POST /api/auth/refresh-token ────────────────────────────────────────────

router.post('/refresh-token', refreshLimiter, async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return sendError(res, 'refresh_token is required', [], 400);
    }

    const payload = decodeRefreshToken(refresh_token);

    if (!payload || payload.type !== 'refresh') {
      return sendError(res, 'Invalid or expired refresh token', [], 401);
    }

    // Check the revocation list, and read this user's session-reset cutoff in
    // the same round trip.
    const [revokedRows] = await pool.query(
      'SELECT jti, revoked_at FROM revoked_tokens WHERE jti IN (?, ?)',
      [payload.jti, sessionResetJti(payload.sub)]
    );
    const revoked = revokedRows.find((r) => r.jti === payload.jti) || null;
    const resetRow = revokedRows.find((r) => r.jti === sessionResetJti(payload.sub)) || null;

    // A reset already fired for this account; anything minted before it is gone.
    if (issuedBeforeReset(payload.iat, resetRow && resetRow.revoked_at)) {
      return sendError(res, 'เซสชันถูกยกเลิกเพื่อความปลอดภัย กรุณาเข้าสู่ระบบใหม่', [{ code: 'SESSION_REVOKED' }], 401);
    }

    if (revoked) {
      // Rotation puts the previous token here on every legitimate refresh, so a
      // hit is not automatically theft: a client that retried a request whose
      // response it never saw sends the same token again, seconds later, in good
      // faith. Inside REPLAY_GRACE_MS that is treated as the retry it almost
      // certainly is — a plain 401, and the client logs in again.
      //
      // Past the grace window there is no benign reading. A well-behaved client
      // does not hold a token it exchanged minutes ago, so two parties held it,
      // and rotation alone would leave whichever one won the race rotating a
      // valid token forever while the victim saw a single logout. Every session
      // for the account ends here, and both sides have to authenticate again.
      const revokedAgeMs = Date.now() - new Date(revoked.revoked_at).getTime();
      if (revokedAgeMs > REPLAY_GRACE_MS) {
        await recordSessionReset(pool, payload.sub, durationMs(env.jwt.refreshExpiresIn));
        await logAudit({
          userId: payload.sub,
          action: 'LOGIN',
          entityType: 'refresh_token_replay',
          entityId: String(payload.sub),
          newValue: { jti: payload.jti, revoked_age_seconds: Math.round(revokedAgeMs / 1000) },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
        return sendError(
          res,
          'ตรวจพบการใช้โทเคนซ้ำ ระบบได้ยกเลิกทุกเซสชันของบัญชีนี้เพื่อความปลอดภัย กรุณาเข้าสู่ระบบใหม่',
          [{ code: 'REFRESH_TOKEN_REPLAY' }],
          401
        );
      }
      return sendError(res, 'Refresh token has been revoked', [{ code: 'REFRESH_TOKEN_REVOKED' }], 401);
    }

    // Check user still active
    const [rows] = await pool.query(
      `SELECT id, username, role, scope_type, scope_id, grade_scope, display_name,
              password_changed_at, must_change_password
       FROM users
       WHERE id = ? AND is_deleted = FALSE AND is_active = TRUE
       LIMIT 1`,
      [payload.sub]
    );
    if (rows.length === 0) {
      return sendError(res, 'User not found or account disabled', [], 401);
    }

    // Reject tokens issued before the last password change
    const user = rows[0];
    if (user.password_changed_at && payload.iat) {
      const changedAtUnix = Math.floor(new Date(user.password_changed_at).getTime() / 1000);
      if (payload.iat < changedAtUnix) {
        return sendError(res, 'Token invalidated by password change. Please login again.', [], 401);
      }
    }

    const accessToken = generateAccessToken(user);

    // Medium fix: rotate the refresh token — revoke the old one and issue a
    // new one. This limits a stolen refresh token to a single use instead of
    // being valid for the full 7-day window.
    const { token: newRefreshToken, jti: newJti } = generateRefreshToken(user.id);
    const oldExp = payload.exp ? expToDate(payload.exp) : new Date(Date.now() + 7 * 86400000);
    await pool.query(
      'INSERT INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)',
      [payload.jti, user.id, oldExp]
    );

    return sendSuccess(
      res,
      {
        access_token: accessToken,
        refresh_token: newRefreshToken,
        token_type: 'Bearer',
        expires_in: env.jwt.expiresIn,
      },
      'Token refreshed'
    );
  } catch (err) {
    return next(err);
  }
});

// ─── POST /api/auth/logout ───────────────────────────────────────────────────

router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      // No refresh token provided — still a valid logout (access token not stored)
      return sendSuccess(res, null, 'Logged out');
    }

    const payload = decodeRefreshToken(refresh_token);

    if (payload && payload.type === 'refresh' && payload.jti) {
      const expiresAt = expToDate(payload.exp);

      // Upsert to avoid duplicate error if client calls logout twice
      await pool.query(
        `INSERT INTO revoked_tokens (jti, user_id, expires_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE revoked_at = revoked_at`,
        [payload.jti, req.user.id, expiresAt]
      );
    }

    return sendSuccess(res, null, 'Logged out successfully');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
