'use strict';

/**
 * gradeScope.unit.test.js
 *
 * Pure-util coverage for backend/src/utils/gradeScope.js — the whitelist +
 * tolerant matchers that back "a grade-scoped teacher sees ONLY their own
 * grade" (#2). These functions decide which student rows a teacher account
 * can read, so their correctness is a security property, not a nicety.
 *
 * DB-free: runs under jest.unit.config.js on any box (`npm run test:unit`).
 *
 * Also pins the KNOWN DIVERGENCE surfaced during the audit: getStudents
 * filters with gradeEquivalents() (tolerant) while getDashboard/getVehicles/
 * getStatusToday/pickupPoint filter with an EXACT `s.grade = ?` against the
 * canonical value. For a student whose grade is stored in a variant form the
 * two disagree (list shows them, counts show zero). The last describe block
 * documents exactly that so a future fix has a red/green anchor.
 */

const {
  VALID_GRADE_SCOPES,
  isValidGradeScope,
  normalizeGradeScope,
  normalizeGrade,
  gradeEquivalents,
} = require('../src/utils/gradeScope');

describe('isValidGradeScope', () => {
  test('accepts every canonical grade', () => {
    for (const g of VALID_GRADE_SCOPES) expect(isValidGradeScope(g)).toBe(true);
  });
  test('trims surrounding whitespace before validating', () => {
    expect(isValidGradeScope('  ป.4  ')).toBe(true);
  });
  test.each([
    ['ป.7', 'grade above the ป range'],
    ['ม.7', 'grade above the ม range'],
    ['อ.4', 'grade above the อ range'],
    ['P.4', 'latin prefix'],
    ['ประถม 4', 'un-normalized variant is NOT a valid scope value'],
    ['', 'empty string'],
    [null, 'null'],
    [undefined, 'undefined'],
  ])('rejects %s (%s)', (input) => {
    expect(isValidGradeScope(input)).toBe(false);
  });
});

describe('normalizeGradeScope', () => {
  test('passes through a canonical value', () => {
    expect(normalizeGradeScope('ป.4')).toBe('ป.4');
  });
  test('trims then validates', () => {
    expect(normalizeGradeScope(' ม.3 ')).toBe('ม.3');
  });
  test('non-canonical → null (never coerces a variant into a scope)', () => {
    expect(normalizeGradeScope('ประถมศึกษาปีที่ 4')).toBeNull();
    expect(normalizeGradeScope('ป.7')).toBeNull();
    expect(normalizeGradeScope(null)).toBeNull();
  });
});

describe('normalizeGrade (any stored/typed form → canonical)', () => {
  test.each([
    ['ป.5', 'ป.5'],
    ['ป. 5', 'ป.5'],
    ['ป5', 'ป.5'],
    ['ประถมศึกษาปีที่ 5', 'ป.5'],
    ['ประถม5', 'ป.5'],
    ['อ.2', 'อ.2'],
    ['อนุบาล 2', 'อ.2'],
    ['อบ.2', 'อ.2'],   // operator-confirmed อบ == อ (อนุบาล)
    ['อบ2', 'อ.2'],
    ['ม.3', 'ม.3'],
    ['มัธยมศึกษาปีที่ 3', 'ม.3'],
    ['ม๓', 'ม.3'],      // Thai digits
    ['ป.๖', 'ป.6'],     // Thai digit ๖ = 6
  ])('%s → %s', (input, expected) => {
    expect(normalizeGrade(input)).toBe(expected);
  });

  test.each([
    ['junk'],
    ['เตรียมอนุบาล'],
    [''],
    [null],
    [undefined],
  ])('unrecognised %s → null', (input) => {
    expect(normalizeGrade(input)).toBeNull();
  });
});

describe('gradeEquivalents (canonical → all stored variants of the SAME grade)', () => {
  test('includes the common stored variants of ป.5', () => {
    const eq = gradeEquivalents('ป.5');
    expect(eq).toEqual(expect.arrayContaining([
      'ป.5', 'ป. 5', 'ป5', 'ป 5',
      'ประถมศึกษาปีที่5', 'ประถมศึกษาปีที่ 5',
      'ประถม5', 'ประถม 5',
    ]));
  });

  test('NEVER widens to an adjacent grade (no grade-scope escape)', () => {
    const eq = gradeEquivalents('ป.5');
    expect(eq).not.toContain('ป.6');
    expect(eq).not.toContain('ป.4');
    expect(eq).not.toContain('ป6');
    expect(eq).not.toContain('ประถม6');
  });

  test('every equivalent round-trips back to the same canonical grade', () => {
    for (const canonical of ['อ.2', 'ป.5', 'ม.3']) {
      for (const variant of gradeEquivalents(canonical)) {
        expect(normalizeGrade(variant)).toBe(canonical);
      }
    }
  });

  test('unknown input matches only itself (safe fallback)', () => {
    expect(gradeEquivalents('junk')).toEqual(['junk']);
  });
});

/**
 * DIVERGENCE GUARD — documents the tolerant-vs-exact inconsistency found in
 * the audit. getStudents() uses gradeEquivalents() (tolerant) so a student
 * stored as 'ประถมศึกษาปีที่ 4' IS returned for a ป.4 teacher; but
 * getDashboard/getVehicles/getStatusToday/pickupPoint compare `s.grade = 'ป.4'`
 * (exact) and therefore MISS that same student. This test locks in the two
 * facts that make those two code paths disagree. If a future change unifies
 * them (e.g. everyone uses gradeEquivalents, or grades are normalised at
 * write time), update this test accordingly.
 */
describe('tolerant-vs-exact divergence (documents the current bug)', () => {
  const stored = 'ประถมศึกษาปีที่ 4'; // a real variant form seen in students.grade
  const canonical = 'ป.4';

  test('tolerant filter (gradeEquivalents → WHERE s.grade IN (...)) DOES match it → getStudents returns the row', () => {
    expect(gradeEquivalents(canonical)).toContain(stored);
    expect(normalizeGrade(stored)).toBe(canonical);
  });

  test('exact filter (WHERE s.grade = ?) does NOT match it → getDashboard/getVehicles/getStatusToday count it as ZERO', () => {
    // These endpoints compare the raw canonical string against the stored value.
    expect(stored).not.toBe(canonical);
  });
});
