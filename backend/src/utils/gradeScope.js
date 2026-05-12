'use strict';

/**
 * Phase 7.11.5 — shared canonical Thai-grade validator. Mirrors the
 * CHECK constraint defined in migration 018 so the route layer can
 * fast-reject before MySQL ever sees a bad value, AND so the helper
 * is reachable from BOTH school.routes.js and admin.routes.js
 * without duplicating the list.
 *
 * IMPORTANT: keep this list in sync with chk_users_grade_scope.
 */

const VALID_GRADE_SCOPES = [
  'อ.1','อ.2','อ.3',
  'ป.1','ป.2','ป.3','ป.4','ป.5','ป.6',
  'ม.1','ม.2','ม.3','ม.4','ม.5','ม.6',
];

function isValidGradeScope(value) {
  if (value == null) return false;
  return VALID_GRADE_SCOPES.includes(String(value).trim());
}

function normalizeGradeScope(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return VALID_GRADE_SCOPES.includes(trimmed) ? trimmed : null;
}

module.exports = { VALID_GRADE_SCOPES, isValidGradeScope, normalizeGradeScope };
