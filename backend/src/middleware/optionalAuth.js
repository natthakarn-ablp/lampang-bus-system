'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { pool } = require('../config/database');
const idTokenSvc = require('../services/lineIdToken.service');

// Phase QR-1 — "auth if present, never 401". Attaches whatever identity it can
// prove so a handler can ESCALATE the access level; missing/invalid credentials
// are silent (the caller stays anonymous = lowest level). It deliberately does
// NOT modify authenticate() / requireParentLineAuth() — it only reuses the same
// verification primitives (HS256 pin + DB recheck, LINE id_token verify).
//
// Both a staff JWT and a LIFF id_token can arrive in the Authorization header.
// We try the JWT first (a LIFF token can't verify as our HS256 JWT); if that
// doesn't resolve a live user, we try the same value as a LIFF id_token.
async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const idTokenParam =
    (typeof req.query.id_token === 'string' ? req.query.id_token : '') ||
    (req.body && typeof req.body.id_token === 'string' ? req.body.id_token : '') ||
    '';

  // 1) Staff/web JWT — same HS256 + DB re-check path as authenticate().
  if (bearer) {
    try {
      const payload = jwt.verify(bearer, env.jwt.secret, { algorithms: ['HS256'] });
      if (payload && payload.type !== 'refresh' && payload.sub) {
        const [rows] = await pool.query(
          'SELECT is_active, password_changed_at FROM users WHERE id = ? AND is_deleted = FALSE LIMIT 1',
          [payload.sub]
        );
        const dbUser = rows[0];
        const tokenPredatesPwChange = dbUser && dbUser.password_changed_at && payload.iat &&
          payload.iat < Math.floor(new Date(dbUser.password_changed_at).getTime() / 1000);
        if (dbUser && dbUser.is_active && !tokenPredatesPwChange) {
          req.user = {
            id: payload.sub,
            username: payload.username || '',
            role: payload.role,
            scopeType: payload.scopeType || null,
            scopeId: payload.scopeId || null,
          };
        }
      }
    } catch { /* not a valid staff JWT — fall through to LIFF */ }
  }

  // 2) LIFF id_token (verified parent). Only if no staff user resolved above.
  if (!req.user) {
    const candidate = idTokenParam || bearer;
    if (candidate) {
      try {
        const verify = await idTokenSvc.verifyIdToken(candidate);
        if (verify && verify.valid) req.lineUserId = verify.userId;
      } catch { /* not a valid LIFF token — stay anonymous */ }
    }
  }

  return next();
}

module.exports = { optionalAuth };
