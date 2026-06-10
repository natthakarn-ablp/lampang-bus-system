'use strict';

/**
 * studentImportScope.test.js  (Phase 10.13A-24B)
 *
 * Unit test for the school-scoped student-import duplicate decision. The route's
 * lookup is `WHERE school_id = ? AND student_code = ?`, so `existing` reflects
 * only THIS school — a same code at another school yields `undefined` → INSERT.
 */

const { classifyStudentImport } = require('../src/utils/studentImport');

describe('classifyStudentImport — school-scoped student identity', () => {
  test('active student with this code in this school → SKIP', () => {
    expect(classifyStudentImport({ id: 5, is_deleted: 0 })).toBe('SKIP');
    expect(classifyStudentImport({ id: 5, is_deleted: false })).toBe('SKIP');
  });

  test('soft-deleted student with this code in this school → REACTIVATE', () => {
    expect(classifyStudentImport({ id: 5, is_deleted: 1 })).toBe('REACTIVATE');
    expect(classifyStudentImport({ id: 5, is_deleted: true })).toBe('REACTIVATE');
  });

  test('no student with this code in this school → INSERT (incl. cross-school collision)', () => {
    // Code exists only at another school → the school-scoped lookup returns nothing.
    expect(classifyStudentImport(undefined)).toBe('INSERT');
    expect(classifyStudentImport(null)).toBe('INSERT');
  });

  test('Test A — code 3307 owned by แม่ถอด, imported at บ้านบอม → INSERT (allowed)', () => {
    // บ้านบอม lookup (school_id=52020147, student_code=3307) finds nothing.
    expect(classifyStudentImport(undefined)).toBe('INSERT');
  });

  test('Test B — re-importing 3307 at the SAME school (บ้านบอม) again → SKIP', () => {
    // Second import: the row now exists active in บ้านบอม.
    expect(classifyStudentImport({ id: 1000001, is_deleted: 0 })).toBe('SKIP');
  });
});
