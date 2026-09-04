'use strict';

const { sendError } = require('../utils/response');

/**
 * Global Express error handler.
 * Must be registered LAST (after all routes).
 *
 * Bug fix (2026-07-07, Bug #4 + #7): logging now happens AFTER the error is
 * classified. Expected client errors (JWT expiry/invalid, duplicate entry, FK
 * violations, and any statusCode < 500 business validations) are NO LONGER
 * logged in production — they were spamming the error log with thousands of
 * "jwt expired" / "โรงเรียนนี้ไม่มีนักเรียน..." lines that are normal client
 * behaviour, not server faults. Only genuine 5xx / unexpected errors reach the
 * console.error call, so the log now reflects real problems. Under test and in
 * non-production dev mode the old verbose behaviour is preserved.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // ── Classify the error first ───────────────────────────────────────────────
  // Resolve the HTTP status that will be sent so we can decide log level.
  let status = 500;
  let message = err.message;
  let errors = [];

  // JWT-specific errors
  if (err.name === 'JsonWebTokenError') { status = 401; message = 'Invalid token'; }
  else if (err.name === 'TokenExpiredError') { status = 401; message = 'Token expired'; }
  // MySQL duplicate entry
  else if (err.code === 'ER_DUP_ENTRY') { status = 409; message = 'Duplicate entry — record already exists'; }
  // MySQL foreign key violation
  else if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_NO_REFERENCED_ROW_2') {
    status = 400; message = 'Referenced record does not exist or is still in use';
  }
  // MySQL column overflow. Bad input, not a server fault: MySQL runs in
  // STRICT_TRANS_TABLES so an over-long value is an error rather than a silent
  // truncation, and every route that writes a user-supplied string without its
  // own length check reached this handler as a 500. A 500 is wrong twice — the
  // caller is told nothing it can act on, and the error log records a server
  // problem that is really a form that needs shortening.
  //
  // The message stays generic on purpose. err.sqlMessage names the column
  // ("Data too long for column 'name'") but not the table, so it cannot be
  // mapped to a field label without guessing, and echoing it would put schema
  // detail in a client response. Routes that know which field it is say so
  // themselves before the query runs.
  else if (err.code === 'ER_DATA_TOO_LONG' || err.code === 'WARN_DATA_TRUNCATED') {
    status = 400;
    message = 'ข้อมูลบางช่องยาวเกินที่ระบบรองรับ กรุณาย่อให้สั้นลงแล้วบันทึกใหม่';
    errors = [{ code: 'FIELD_TOO_LONG' }];
  }
  // Validation errors thrown from routes with a statusCode property
  else if (err.statusCode) {
    status = err.statusCode; message = err.message; errors = err.errors || [];
  }
  // Default: 500 internal server error
  else {
    message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  }

  // ── Logging — only for real server-side problems ───────────────────────────
  const isExpectedClientError = status < 500;
  if (process.env.JEST_WORKER_ID) {
    // silent — expected errors during testing
  } else if (isExpectedClientError && process.env.NODE_ENV === 'production') {
    // Bug #4 + #7 fix: do NOT log expected 4xx client errors (token expiry,
    // business validation, duplicates) in production. They are normal flow,
    // not server faults, and were drowning real errors in noise.
  } else if (process.env.NODE_ENV !== 'production') {
    // Dev: full stack trace for easier debugging.
    console.error('[errorHandler]', err);
  } else {
    // Production + genuine 5xx: log the message (no stack unless non-prod).
    console.error('[errorHandler]', err.message);
  }

  return sendError(res, message, errors, status);
}

module.exports = errorHandler;
