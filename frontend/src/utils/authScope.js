/**
 * Phase 7.11.4 — frontend helpers for the new school grade-teacher
 * sub-account. The backend already enforces every scope decision
 * (Phase 7.11.3 wired `requireFullSchoolScope` + per-service
 * gradeFilter); these helpers exist only so the UI can match the
 * backend behaviour and avoid showing affordances that will 403.
 *
 * Backend is the source of truth. If a write button is accidentally
 * left visible, `requireFullSchoolScope` still returns 403.
 */

/**
 * Return the user's grade_scope value (e.g. 'ป.4') or null.
 * Defends against either snake_case (from login response) or
 * camelCase (legacy).
 */
export function getGradeScope(user) {
  return user?.grade_scope || user?.gradeScope || null;
}

/**
 * True when the user is a school account scoped to a single grade
 * (i.e. a homeroom teacher sub-account). Read-only in MVP.
 */
export function isGradeTeacher(user) {
  return user?.role === 'school' && !!getGradeScope(user);
}

/**
 * True when the user is the full school account (school role + no
 * grade_scope set). Preserves prior behaviour everywhere.
 */
export function isFullSchoolAccount(user) {
  return user?.role === 'school' && !getGradeScope(user);
}

/**
 * Display string for the scope chip rendered above each teacher page.
 * Returns '' when no chip should be shown (full school / non-school).
 */
export function getScopeLabel(user) {
  const grade = getGradeScope(user);
  return grade ? `ขอบเขตข้อมูล: ${grade}` : '';
}
