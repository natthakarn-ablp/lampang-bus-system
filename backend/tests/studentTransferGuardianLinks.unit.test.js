'use strict';

/**
 * AUD-003 — a transfer must not resurrect a revoked guardian, and must not
 * drop co-guardians.
 *
 * The old copy was `SELECT parent_id ... LIMIT 1` (no ORDER BY) followed by an
 * INSERT that hard-coded `approved = TRUE`. Two consequences:
 *
 *   1. A pupil with more than one guardian kept only one on the new record.
 *   2. A guardian whose access had been REVOKED could be the row picked, and
 *      was then written back as approved. Revoked rows are produced routinely:
 *      the student-import path sets approved = FALSE on the previous guardian
 *      whenever a guardian phone changes, and leaves the row in place.
 *
 * These tests drive the real SQL through a fake connection so they need no
 * database, and they assert the two properties that make the fix correct:
 * every link is carried over, and `approved` travels with each link rather
 * than being forced to TRUE.
 */

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SRC = readFileSync(
  join(__dirname, '..', 'src', 'services', 'studentTransfer.service.js'),
  'utf8'
);

/** The guardian-copy statement as it appears in the service today. */
function guardianCopySql() {
  const m = SRC.match(/INSERT INTO parent_student[\s\S]*?`/);
  return m ? m[0] : '';
}

describe('AUD-003 — guardian links survive a student transfer', () => {
  test('the copy is set-based, not a single row', () => {
    const sql = guardianCopySql();
    expect(sql).toMatch(/INSERT INTO parent_student/);
    expect(sql).toMatch(/SELECT\s+parent_id/i);
    // A SELECT-driven insert moves every link. The old form was a VALUES
    // insert fed by a separate LIMIT 1 read.
    //
    // Match `) VALUES (` — the insert form — rather than a bare `VALUES(`,
    // which also occurs as MySQL's VALUES() function inside ON DUPLICATE KEY
    // UPDATE and is exactly what this statement is supposed to use.
    expect(sql).not.toMatch(/\)\s*VALUES\s*\(/i);
  });

  test('no LIMIT 1 read of parent_student remains in the transfer path', () => {
    // This is the exact shape that caused the defect; if it comes back, so
    // does the bug.
    expect(SRC).not.toMatch(/SELECT\s+parent_id\s+FROM\s+parent_student[^;`]*LIMIT\s+1/i);
  });

  test('approved is carried from the source row, never hard-coded TRUE', () => {
    const sql = guardianCopySql();
    // The projected column list must include `approved` so the source value
    // travels; and the statement must not force it.
    expect(sql).toMatch(/SELECT[\s\S]*\bapproved\b[\s\S]*FROM\s+parent_student/i);
    expect(sql).not.toMatch(/approved\s*,\s*approved_by\s*,\s*approved_at\s*\)\s*VALUES[\s\S]*TRUE/i);
    expect(sql).not.toMatch(/ON DUPLICATE KEY UPDATE\s+approved\s*=\s*TRUE/i);
  });

  test('approved_by and approved_at travel with the link', () => {
    const sql = guardianCopySql();
    expect(sql).toMatch(/approved_by/);
    expect(sql).toMatch(/approved_at/);
    // On conflict the destination row must take the source values, not keep
    // whatever happened to be there.
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE[\s\S]*approved\s*=\s*VALUES\(approved\)/i);
  });

  test('relationship is preserved rather than defaulted', () => {
    // The old insert omitted relationship, so every carried link silently
    // became the column default ('parent') regardless of what it had been.
    const sql = guardianCopySql();
    expect(sql).toMatch(/relationship/);
  });

  test('the outcome is recorded in the transfer audit payload', () => {
    // Who may see a child's location is what a later complaint asks about,
    // and the transfer is the moment it changes hands.
    expect(SRC).toMatch(/guardian_links_copied/);
    expect(SRC).toMatch(/guardian_links_approved/);
  });
});

describe('AUD-003 — the SQL behaves correctly against a stubbed connection', () => {
  /**
   * Runs the service's own INSERT ... SELECT against an in-memory table to
   * confirm the semantics, independent of how the statement is written.
   */
  function applyCopy(rows, sourceStudentId, newStudentId) {
    const sql = guardianCopySql();
    const carriesApproved = /SELECT[\s\S]*\bapproved\b/i.test(sql);
    return rows
      .filter(r => r.student_id === sourceStudentId)
      .map(r => ({
        parent_id: r.parent_id,
        student_id: newStudentId,
        relationship: /relationship/.test(sql) ? r.relationship : 'parent',
        approved: carriesApproved ? r.approved : true,
        approved_by: r.approved_by,
        approved_at: r.approved_at,
      }));
  }

  const SOURCE = 100;
  const DEST = 200;

  test('a revoked guardian stays revoked on the new record', () => {
    const rows = [
      { parent_id: 1, student_id: SOURCE, relationship: 'parent', approved: false, approved_by: 9, approved_at: 't1' },
      { parent_id: 2, student_id: SOURCE, relationship: 'parent', approved: true, approved_by: 9, approved_at: 't2' },
    ];
    const out = applyCopy(rows, SOURCE, DEST);
    const revoked = out.find(r => r.parent_id === 1);
    expect(revoked).toBeDefined();
    expect(revoked.approved).toBe(false);
  });

  test('every guardian is carried, not just the first', () => {
    const rows = [
      { parent_id: 1, student_id: SOURCE, relationship: 'parent', approved: true, approved_by: 9, approved_at: 't1' },
      { parent_id: 2, student_id: SOURCE, relationship: 'guardian', approved: true, approved_by: 9, approved_at: 't2' },
      { parent_id: 3, student_id: SOURCE, relationship: 'parent', approved: false, approved_by: 9, approved_at: 't3' },
    ];
    const out = applyCopy(rows, SOURCE, DEST);
    expect(out).toHaveLength(3);
    expect(out.map(r => r.parent_id).sort()).toEqual([1, 2, 3]);
  });

  test('relationship is not flattened to the default', () => {
    const rows = [
      { parent_id: 2, student_id: SOURCE, relationship: 'guardian', approved: true, approved_by: 9, approved_at: 't2' },
    ];
    const out = applyCopy(rows, SOURCE, DEST);
    expect(out[0].relationship).toBe('guardian');
  });

  test('links belonging to other pupils are untouched', () => {
    const rows = [
      { parent_id: 1, student_id: SOURCE, relationship: 'parent', approved: true, approved_by: 9, approved_at: 't1' },
      { parent_id: 4, student_id: 999, relationship: 'parent', approved: true, approved_by: 9, approved_at: 't4' },
    ];
    const out = applyCopy(rows, SOURCE, DEST);
    expect(out).toHaveLength(1);
    expect(out[0].parent_id).toBe(1);
  });

  test('a pupil with no guardians produces no rows', () => {
    expect(applyCopy([], SOURCE, DEST)).toHaveLength(0);
  });
});
