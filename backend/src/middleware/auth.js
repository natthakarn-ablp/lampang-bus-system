'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { pool } = require('../config/database');
const { sendError } = require('../utils/response');
const { sessionResetJti, issuedBeforeReset } = require('../utils/sessionReset');

// Endpoints a user MUST still be able to reach while a forced password change
// is pending (Phase 10.12D). The forced flow for every role routes through the
// generic change-password page → POST /api/auth/change-password.
const MUST_CHANGE_ALLOWLIST = new Set([
  '/api/auth/me',
  '/api/auth/change-password',
  '/api/auth/logout',
]);

function normalizePath(req) {
  const raw = (req.originalUrl || req.url || '').split('?')[0];
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed || '/';
}

/**
 * Verify the Bearer access token from the Authorization header.
 * On success, attaches req.user = { id, username, role, scopeType,
 * scopeId, gradeScope, displayName, mustChangePassword }.
 *
 * Phase 10.12D — enforces forced password change at the backend (H2): when the
 * token carries mustChangePassword, all routes except the allow-list above are
 * blocked with 403 MUST_CHANGE_PASSWORD. The flag is re-confirmed against the
 * DB so a user who has *just* changed their password is not locked out by a
 * still-stale token flag (the token keeps the old claim until it expires).
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 'Authorization header missing or malformed', [], 401);
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    // Pin the algorithm so a forged alg:none / alg-confusion token can never verify
    // (audit 2026-06-18, auth-crypto).
    const payload = jwt.verify(token, env.jwt.secret, { algorithms: ['HS256'] });

    // Reject refresh tokens presented as access tokens
    if (payload.type === 'refresh') {
      return sendError(res, 'Invalid token type', [], 401);
    }

    req.user = {
      id: payload.sub,
      username: payload.username || '',
      role: payload.role,
      scopeType: payload.scopeType || null,
      scopeId: payload.scopeId || null,
      gradeScope: payload.gradeScope || null,
      displayName: payload.displayName || '',
      mustChangePassword: !!payload.mustChangePassword,
    };

    const path = normalizePath(req);

    // Phase 10.13A-11 — re-validate account status against the DB on EVERY
    // authenticated request, so a disabled/deleted account is rejected
    // immediately rather than remaining valid until its access token expires.
    // One indexed primary-key lookup that also yields the current
    // must_change_password flag (no second query needed).
    // The LEFT JOIN reads the session-reset sentinel in the same round trip —
    // rt.jti is the primary key and its value is known here, so this stays one
    // lookup rather than a second query on every authenticated request.
    const [rows] = await pool.query(
      `SELECT u.is_active, u.must_change_password, u.driver_id, u.password_changed_at,
              rt.revoked_at AS sessions_reset_at
         FROM users u
         LEFT JOIN revoked_tokens rt ON rt.jti = ?
        WHERE u.id = ? AND u.is_deleted = FALSE
        LIMIT 1`,
      [sessionResetJti(payload.sub), payload.sub]
    );
    const dbUser = rows[0];

    if (!dbUser || !dbUser.is_active) {
      // Allow logout so a disabled user can cleanly end its session; reject
      // everything else (including /me) with a generic, leak-free message.
      if (path === '/api/auth/logout') return next();
      return sendError(res, 'บัญชีนี้ถูกปิดการใช้งาน', [{ code: 'ACCOUNT_DISABLED' }], 401);
    }

    // Phase 10.13C audit (auth-crypto H3 completion) — hard-invalidate any ACCESS
    // token minted before the last password change/reset, mirroring the
    // /refresh-token guard. Without this, a stolen access token stayed valid for
    // its full 24h even after the victim changed their password. Logout is still
    // allowed through so the client can clear its own state.
    if (dbUser.password_changed_at && payload.iat && path !== '/api/auth/logout') {
      const changedAtUnix = Math.floor(new Date(dbUser.password_changed_at).getTime() / 1000);
      if (payload.iat < changedAtUnix) {
        return sendError(res, 'เซสชันหมดอายุจากการเปลี่ยนรหัสผ่าน กรุณาเข้าสู่ระบบใหม่', [{ code: 'PASSWORD_CHANGED' }], 401);
      }
    }

    // A refresh token was replayed for this account, so every token minted
    // before that moment is treated as compromised — including this access
    // token, which would otherwise stay valid for its full 24h. Same shape as
    // the password_changed_at rule above, against a different cutoff.
    if (path !== '/api/auth/logout' && issuedBeforeReset(payload.iat, dbUser.sessions_reset_at)) {
      return sendError(res, 'เซสชันถูกยกเลิกเพื่อความปลอดภัย กรุณาเข้าสู่ระบบใหม่', [{ code: 'SESSION_REVOKED' }], 401);
    }

    req.user.mustChangePassword = !!dbUser.must_change_password;
    // Phase 10.13A-20 — expose the relational driver link (NULL for legacy/
    // YELLOW users) so driver vehicle resolution can prefer driver_id.
    req.user.driver_id = dbUser.driver_id ?? null;

    // Forced password-change enforcement (H2) — use the fresh DB value so a
    // just-changed user is not locked out, and an admin reset takes effect even
    // on a token that pre-dates it.
    if (dbUser.must_change_password && !MUST_CHANGE_ALLOWLIST.has(path)) {
      return sendError(
        res,
        'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งานระบบ',
        [{ code: 'MUST_CHANGE_PASSWORD' }],
        403
      );
    }

    return next();
  } catch (err) {
    return next(err); // propagate to errorHandler (handles JWT errors)
  }
}

module.exports = { authenticate };
