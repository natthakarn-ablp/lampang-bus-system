'use strict';

// Shared rate limiters for export/import endpoints that live OUTSIDE /api/reports
// (which already has its own exportLimiter in app.js). Audit 2026-06-18 #27: those
// embedded endpoints build full datasets / parse uploads and had only the generic
// 120/min floor. Same budget as the reports limiter: 40 requests / 5 min / IP.
// Skipped under test so the suite isn't throttled.

const rateLimit = require('express-rate-limit');

const WINDOW_MS = 5 * 60 * 1000;
const MAX = 40;
const MESSAGE = { success: false, message: 'ขอข้อมูล/นำเข้าถี่เกินไป กรุณารอสักครู่', errors: [], data: null };

function make(extraSkip) {
  return rateLimit({
    windowMs: WINDOW_MS,
    max: MAX,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => process.env.NODE_ENV === 'test' || (extraSkip ? extraSkip(req) : false),
    message: MESSAGE,
  });
}

// Unconditional — for dedicated export/import endpoints (templates, file imports,
// research export).
const importExportLimiter = make();

// Only throttles the expensive export path on dual-purpose endpoints that ALSO
// serve JSON browsing (e.g. /audit-logs which exports when ?format=csv). Normal
// paginated browsing stays under the generic floor; only ?format=... is capped.
const exportFormatLimiter = make((req) => !(req.query && req.query.format));

module.exports = { importExportLimiter, exportFormatLimiter };
