'use strict';

/**
 * registrationMatch.js — Phase 10.14
 *
 * Pure, dependency-free helpers for the driver→school vehicle-registration
 * reconciliation flow:
 *   - stripThaiPrefix : drop ด.ช./ด.ญ./เด็กชาย/… so names compare fairly
 *   - nameSimilarity  : normalized Levenshtein ratio (0..1)
 *   - suggestMatch    : code-exact first, then fuzzy-name
 *   - evaluateEligibility : all-schools-approved AND inspection-passed
 *   - normalizePickup : MORNING | EVENING | BOTH
 *
 * No DB / env / crypto imports → unit-testable in isolation (DB-free).
 */

const THAI_PREFIXES = [
  'เด็กชาย', 'เด็กหญิง', 'ด.ช.', 'ด.ญ.', 'ดช.', 'ดญ.',
  'นางสาว', 'น.ส.', 'นาย', 'นาง', 'เด็ก',
];

function stripThaiPrefix(name) {
  let s = String(name == null ? '' : name).trim();
  for (const p of THAI_PREFIXES) {
    if (s.startsWith(p)) { s = s.slice(p.length).trim(); break; }
  }
  return s.replace(/\s+/g, ' ');
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j += 1) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i += 1) {
      const tmp = dp[i];
      dp[i] = Math.min(
        dp[i] + 1,
        dp[i - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prev = tmp;
    }
  }
  return dp[m];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Name similarity in [0, 1] after stripping Thai honorific prefixes.
 */
function nameSimilarity(a, b) {
  const x = stripThaiPrefix(a);
  const y = stripThaiPrefix(b);
  if (!x.length || !y.length) return 0;
  if (x === y) return 1;
  const dist = levenshtein(x, y);
  return round2(1 - dist / Math.max(x.length, y.length));
}

/**
 * Suggest a real student for a driver-typed raw entry.
 *
 * @param {{raw_student_code?:string, raw_student_name?:string}} raw
 * @param {Array<{id:number, student_code?:string, full_name:string}>} schoolStudents
 * @param {{threshold?:number}} [opts]
 * @returns {{confidence:'high'|'medium'|'ambiguous'|'none', student?:object, candidates?:object[], score?:number}}
 */
function suggestMatch(raw, schoolStudents, { threshold = 0.8 } = {}) {
  const students = Array.isArray(schoolStudents) ? schoolStudents : [];

  // 1) exact student_code → high confidence
  const code = raw && raw.raw_student_code != null ? String(raw.raw_student_code).trim() : '';
  if (code) {
    const byCode = students.find((s) => s.student_code != null && String(s.student_code).trim() === code);
    if (byCode) return { confidence: 'high', student: byCode };
  }

  // 2) fuzzy name
  const cleanName = stripThaiPrefix(raw && raw.raw_student_name);
  if (!cleanName) return { confidence: 'none' };

  const scored = students
    .map((s) => ({ student: s, score: nameSimilarity(s.full_name, cleanName) }))
    .filter((x) => x.score >= threshold)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 1) {
    return { confidence: 'medium', student: scored[0].student, score: scored[0].score };
  }
  if (scored.length > 1) {
    // genuine tie / multiple plausible → let the school pick
    return {
      confidence: 'ambiguous',
      candidates: scored.map((x) => ({ ...x.student, score: x.score })),
    };
  }
  return { confidence: 'none' };
}

const ELIGIBLE_VERIFICATION = new Set(['ELIGIBLE', 'EXPIRING']);

/**
 * A vehicle is eligible when EVERY participating school has approved its roster
 * AND the shared inspection left the vehicle in an eligible verification state.
 *
 * @param {{approvals?:string[], verificationStatus?:string|null}} input
 * @returns {boolean}
 */
function evaluateEligibility({ approvals = [], verificationStatus = null } = {}) {
  if (!Array.isArray(approvals) || approvals.length === 0) return false;
  const allApproved = approvals.every((a) => a === 'APPROVED');
  return allApproved && ELIGIBLE_VERIFICATION.has(verificationStatus);
}

function normalizePickup(value) {
  const v = String(value == null ? '' : value).trim().toUpperCase();
  if (['MORNING', 'EVENING', 'BOTH'].includes(v)) return v;
  // Thai-friendly aliases
  if (v === 'เช้า') return 'MORNING';
  if (v === 'เย็น') return 'EVENING';
  if (v === 'ทั้งวัน') return 'BOTH';
  return null;
}

module.exports = {
  stripThaiPrefix,
  nameSimilarity,
  suggestMatch,
  evaluateEligibility,
  normalizePickup,
};
