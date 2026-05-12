'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { sendError } = require('../utils/response');

/**
 * Verify the Bearer access token from the Authorization header.
 * On success, attaches req.user = { id, username, role, scopeType,
 * scopeId, gradeScope, displayName }.
 *
 * `gradeScope` is Phase 7.11.2 plumbing — null for every existing
 * account, populated only when the user is a homeroom-teacher
 * sub-account (role='school' + grade_scope set). Endpoint-level
 * filtering arrives in Phase 7.11.3.
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
    };

    return next();
  } catch (err) {
    return next(err); // propagate to errorHandler (handles JWT errors)
  }
}

module.exports = { authenticate };
