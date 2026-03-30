'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { sendError } = require('../utils/response');

/**
 * Verify the Bearer access token from the Authorization header.
 * On success, attaches req.user = { id, role, scopeType, scopeId, displayName }.
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
      displayName: payload.displayName || '',
    };

    return next();
  } catch (err) {
    return next(err); // propagate to errorHandler (handles JWT errors)
  }
}

module.exports = { authenticate };
