'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { pool } = require('../config/database');
const { sendError } = require('../utils/response');

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
    const payload = jwt.verify(token, env.jwt.secret);

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

    // Forced password-change enforcement. Only forced-change tokens pay any
    // cost; normal traffic (the overwhelming majority) skips the DB entirely.
    if (payload.mustChangePassword && !MUST_CHANGE_ALLOWLIST.has(normalizePath(req))) {
      const [rows] = await pool.query(
        'SELECT must_change_password FROM users WHERE id = ? AND is_deleted = FALSE AND is_active = TRUE LIMIT 1',
        [payload.sub]
      );
      if (rows.length && rows[0].must_change_password) {
        return sendError(
          res,
          'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งานระบบ',
          [{ code: 'MUST_CHANGE_PASSWORD' }],
          403
        );
      }
    }

    return next();
  } catch (err) {
    return next(err); // propagate to errorHandler (handles JWT errors)
  }
}

module.exports = { authenticate };
