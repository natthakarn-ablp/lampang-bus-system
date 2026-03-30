'use strict';

const { sendError } = require('../utils/response');

/**
 * Global Express error handler.
 * Must be registered LAST (after all routes).
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Log internals only in non-production
  if (process.env.NODE_ENV !== 'production') {
    console.error('[errorHandler]', err);
  } else {
    console.error('[errorHandler]', err.message);
  }

  // JWT-specific errors
  if (err.name === 'JsonWebTokenError') {
    return sendError(res, 'Invalid token', [], 401);
  }
  if (err.name === 'TokenExpiredError') {
    return sendError(res, 'Token expired', [], 401);
  }

  // MySQL duplicate entry
  if (err.code === 'ER_DUP_ENTRY') {
    return sendError(res, 'Duplicate entry — record already exists', [], 409);
  }

  // MySQL foreign key violation
  if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_NO_REFERENCED_ROW_2') {
    return sendError(res, 'Referenced record does not exist or is still in use', [], 400);
  }

  // Validation errors thrown from routes with a statusCode property
  if (err.statusCode) {
    return sendError(res, err.message, err.errors || [], err.statusCode);
  }

  // Default: 500 internal server error
  const message =
    process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  return sendError(res, message, [], 500);
}

module.exports = errorHandler;
