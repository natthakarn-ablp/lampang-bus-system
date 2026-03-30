'use strict';

const { sendError } = require('../utils/response');

/**
 * Role-based access control middleware factory.
 *
 * Usage:
 *   router.get('/secret', authenticate, requireRole('province', 'admin'), handler);
 *
 * @param {...string} roles - Allowed role names
 * @returns {import('express').RequestHandler}
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, 'Unauthenticated', [], 401);
    }
    if (!roles.includes(req.user.role)) {
      return sendError(res, 'You do not have permission to access this resource', [], 403);
    }
    return next();
  };
}

/**
 * Scope enforcement helper — verifies that req.user.scopeId matches the
 * requested resource's scope (school_id, affiliation_id, etc.).
 *
 * Use inside individual route handlers after requireRole() has passed.
 *
 * @param {import('express').Request} req
 * @param {string} resourceScopeId - The scope ID of the resource being accessed
 * @returns {boolean} true if the user is allowed to access the resource
 */
function isScopeAllowed(req, resourceScopeId) {
  const { role, scopeId } = req.user;

  // province and admin see everything
  if (role === 'province' || role === 'admin') return true;

  // All other scoped roles must match exactly
  return scopeId === String(resourceScopeId);
}

module.exports = { requireRole, isScopeAllowed };
