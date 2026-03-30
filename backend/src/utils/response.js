'use strict';

/**
 * Send a successful JSON response.
 *
 * @param {import('express').Response} res
 * @param {*} data
 * @param {string} message
 * @param {object|null} meta  - pagination info: { page, per_page, total }
 * @param {number} statusCode - HTTP status (default 200)
 */
function sendSuccess(res, data = null, message = 'OK', meta = null, statusCode = 200) {
  const body = { success: true, message, data };
  if (meta !== null) body.meta = meta;
  return res.status(statusCode).json(body);
}

/**
 * Send an error JSON response.
 *
 * @param {import('express').Response} res
 * @param {string} message
 * @param {Array<{field:string, message:string}>} errors
 * @param {number} statusCode - HTTP status (default 400)
 */
function sendError(res, message = 'Error', errors = [], statusCode = 400) {
  return res.status(statusCode).json({
    success: false,
    message,
    errors,
    data: null,
  });
}

module.exports = { sendSuccess, sendError };
