'use strict';

const { sendError } = require('./response');

/**
 * pathParams.js — one canonical guard for numeric path parameters.
 *
 * WHY A REGEX ON THE RAW STRING, NOT Number.isInteger ON THE PARSED VALUE
 * ----------------------------------------------------------------------
 * The guard this replaces read:
 *
 *     const id = parseInt(req.params.id, 10);
 *     if (!Number.isInteger(id) || id <= 0) return sendError(res, 'invalid id', [], 400);
 *
 * Number.isInteger there is applied to the ALREADY-COERCED value, so it can
 * only ever reject input parseInt gave up on entirely. parseInt stops at the
 * first character it cannot read and keeps the prefix, so
 *
 *     parseInt('1e5', 10) === 1      parseInt('1abc', 10) === 1
 *     parseInt('1.9', 10) === 1      parseInt(' 1',   10) === 1
 *     parseInt('+1',  10) === 1      parseInt('01',   10) === 1
 *
 * all passed the guard and were answered as id 1. On a mutating route that
 * destroys data: DELETE /api/school/students/99999abc returned 200 and
 * soft-deleted students.id=99999 — a malformed URL removing a real child's
 * record. Validating the RAW string leaves parseInt nothing to salvage.
 *
 * WHY LEADING ZEROS ARE REJECTED
 * ------------------------------
 * An id has exactly one canonical decimal form. Accepting '01' as well as '1'
 * gives one row two URLs, and several handlers write String(req.params.id)
 * straight into audit_logs.entity_id (a varchar), so the same row's history
 * would split across two entity_id keys and a later lookup by id would miss
 * half of it. A client that legitimately holds id 1 always sends '1', so
 * rejecting costs nothing.
 */
const CANONICAL_POSITIVE_INT = /^[1-9][0-9]*$/;

// Thai, matching the message already used for this exact condition in
// geofence.routes.js. The inherited 'invalid id' was English and out of place
// among its Thai neighbours.
const INVALID_ID_MESSAGE = 'รหัสไม่ถูกต้อง';

/**
 * Parse a raw path-parameter string into a positive integer.
 *
 * @param {*} raw
 * @returns {number|null} the value, or null if it is not a canonical
 *          positive decimal integer safely representable as a Number.
 */
function parsePositiveIntParam(raw) {
  if (typeof raw !== 'string' || !CANONICAL_POSITIVE_INT.test(raw)) return null;
  const value = Number(raw);
  // Past 2^53-1 a decimal string no longer round-trips through Number, so the
  // id that would reach SQL is not the id the client asked for.
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Read a numeric path parameter, or answer 400 and return null.
 *
 * The null check is mandatory and MUST run before any read or write, because
 * this function has already sent the response when it returns null:
 *
 *     const studentId = readIdParam(req, res, 'id');
 *     if (studentId === null) return;
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} name - the :param name, e.g. 'id', 'batchId', 'logId'
 * @returns {number|null}
 */
function readIdParam(req, res, name = 'id') {
  const value = parsePositiveIntParam(req.params[name]);
  if (value === null) {
    sendError(res, INVALID_ID_MESSAGE, [{ field: name, message: INVALID_ID_MESSAGE }], 400);
    return null;
  }
  return value;
}

module.exports = {
  CANONICAL_POSITIVE_INT,
  INVALID_ID_MESSAGE,
  parsePositiveIntParam,
  readIdParam,
};
