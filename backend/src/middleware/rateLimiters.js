'use strict';

// Shared rate-limit helpers.
//
// KEYING (training-room fix, 2026-11): the operator limiters used to key on the
// client IP. A school office or a training room (40-60 teachers behind one NAT
// address) then shared ONE budget, so ordinary clicking by the whole room hit
// 429 within a minute. Authenticated requests are now keyed by the user id in
// the Bearer access token, so every person gets the same per-user budget the
// IP used to get. Requests without a valid access token fall back to the IP
// (via express-rate-limit's ipKeyGenerator, which collapses IPv6 to a /56 so a
// single host can't rotate addresses inside its prefix).
//
// The token is verified with the same secret and pinned algorithm as
// middleware/auth.js. That is NOT an authentication decision — authenticate()
// still runs on every route and does the DB checks. Verifying (not just
// decoding) matters here: an unverified `sub` would let one client mint a
// fresh bucket per request just by changing the claim.
//
// Export/import endpoints OUTSIDE /api/reports (which has its own exportLimiter
// in app.js): audit 2026-06-18 #27 — those embedded endpoints build full
// datasets / parse uploads and had only the generic floor. Same budget as the
// reports limiter: 40 requests / 5 min / user. Skipped under test so the suite
// isn't throttled.

const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const { ipKeyGenerator } = rateLimit;
const JWT_ALG = 'HS256';

function ipKey(req) {
  return `ip:${ipKeyGenerator(req.ip || '')}`;
}

/** User id from a VALID access token in the Authorization header, else null. */
function accessTokenUserId(req) {
  const header = req.headers && req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), env.jwt.secret, { algorithms: [JWT_ALG] });
    if (!payload || payload.type === 'refresh' || payload.sub == null || payload.sub === '') return null;
    return String(payload.sub);
  } catch {
    return null;
  }
}

/** Rate-limit key: `u:<id>` for a valid access token, otherwise `ip:<ip>`. */
function userOrIpKey(req) {
  const id = accessTokenUserId(req);
  return id ? `u:${id}` : ipKey(req);
}

/** Rate-limit key for refresh: `r:<sub>` of a valid refresh token in the body, else IP. */
function refreshTokenKey(req) {
  const token = req.body && req.body.refresh_token;
  if (typeof token === 'string' && token) {
    try {
      const payload = jwt.verify(token, env.jwt.secret, { algorithms: [JWT_ALG] });
      if (payload && payload.type === 'refresh' && payload.sub != null && payload.sub !== '') {
        return `r:${payload.sub}`;
      }
    } catch {
      // fall through to the IP bucket
    }
  }
  return ipKey(req);
}

/**
 * A limiter keyed per user (falling back to IP). `skipInTest: false` is for
 * unit tests that exercise the real limiter behaviour.
 */
function createUserKeyedLimiter({ windowMs, max, message, extraSkip, skipInTest = true }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userOrIpKey,
    skip: (req) => (skipInTest && process.env.NODE_ENV === 'test') || (extraSkip ? extraSkip(req) : false),
    message,
  });
}

// ─── Budgets (per user; per IP only for unauthenticated requests) ───────────
const GLOBAL_API_BUDGET = Object.freeze({
  windowMs: 60 * 1000, // 1 minute
  max: 120,            // ~2/sec per user, plenty for UI
  message: { success: false, message: 'คำขอถี่เกินไป กรุณารอสักครู่', errors: [], data: null },
});

const REPORT_EXPORT_BUDGET = Object.freeze({
  windowMs: 5 * 60 * 1000,
  max: 40,
  message: { success: false, message: 'ขอรายงานถี่เกินไป กรุณารอสักครู่', errors: [], data: null },
});

const IMPORT_EXPORT_BUDGET = Object.freeze({
  windowMs: 5 * 60 * 1000,
  max: 40,
  message: { success: false, message: 'ขอข้อมูล/นำเข้าถี่เกินไป กรุณารอสักครู่', errors: [], data: null },
});

// Unconditional — for dedicated export/import endpoints (templates, file imports,
// research export).
const importExportLimiter = createUserKeyedLimiter(IMPORT_EXPORT_BUDGET);

// Only throttles the expensive export path on dual-purpose endpoints that ALSO
// serve JSON browsing (e.g. /audit-logs which exports when ?format=csv). Normal
// paginated browsing stays under the generic floor; only ?format=... is capped.
const exportFormatOnly = (req) => !(req.query && req.query.format);
const exportFormatLimiter = createUserKeyedLimiter({ ...IMPORT_EXPORT_BUDGET, extraSkip: exportFormatOnly });

module.exports = {
  importExportLimiter,
  exportFormatLimiter,
  exportFormatOnly,
  createUserKeyedLimiter,
  userOrIpKey,
  refreshTokenKey,
  accessTokenUserId,
  GLOBAL_API_BUDGET,
  REPORT_EXPORT_BUDGET,
  IMPORT_EXPORT_BUDGET,
};
