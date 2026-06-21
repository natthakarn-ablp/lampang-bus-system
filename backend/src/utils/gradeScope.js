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

// ── Tolerant grade matching ──────────────────────────────────────────────────
// students.grade is stored inconsistently ('ป.5', 'ประถมศึกษาปีที่ 5', 'ป. 5',
// 'อนุบาล 2', 'อ2', 'อบ.2' …). These helpers let the grade FILTER match every
// variant of a canonical grade WITHOUT touching the stored data (no migration).
// Operator-confirmed: 'อบ' means 'อ.' (อนุบาล).
const GRADE_PREFIX_VARIANTS = {
  'อ': ['อ.', 'อ', 'อนุบาล', 'อบ.', 'อบ'],
  'ป': ['ป.', 'ป', 'ประถมศึกษาปีที่', 'ประถม'],
  'ม': ['ม.', 'ม', 'มัธยมศึกษาปีที่', 'มัธยม'],
};
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const toArabicDigits = (s) => String(s).replace(/[๐-๙]/g, (d) => THAI_DIGITS.indexOf(d));

// Forward: any stored/typed form → canonical ('ป.5' | 'อ.2' | 'ม.1') or null.
function normalizeGrade(raw) {
  if (raw == null) return null;
  const s = toArabicDigits(String(raw).trim()).replace(/\s+/g, '');
  let m;
  if ((m = s.match(/^(?:อ\.?|อนุบาล|อบ\.?)(\d{1,2})$/))) return `อ.${m[1]}`;
  if ((m = s.match(/^(?:ป\.?|ประถมศึกษาปีที่|ประถม)(\d{1,2})$/))) return `ป.${m[1]}`;
  if ((m = s.match(/^(?:ม\.?|มัธยมศึกษาปีที่|มัธยม)(\d{1,2})$/))) return `ม.${m[1]}`;
  return null;
}

// Reverse: a canonical grade → all stored variants that mean the same grade
// (same level + same number only — never widens to another grade). Used for
// `WHERE s.grade IN (...)`. Unknown input returns [input] so it matches as-is.
function gradeEquivalents(canonical) {
  const m = toArabicDigits(String(canonical == null ? '' : canonical).trim()).match(/^(อ|ป|ม)\.?\s*(\d{1,2})$/);
  if (!m) return [canonical];
  const [, lvl, num] = m;
  const variants = GRADE_PREFIX_VARIANTS[lvl] || [`${lvl}.`];
  const forms = new Set();
  for (const p of variants) { forms.add(`${p}${num}`); forms.add(`${p} ${num}`); }
  return [...forms];
}

module.exports = { VALID_GRADE_SCOPES, isValidGradeScope, normalizeGradeScope, normalizeGrade, gradeEquivalents };
