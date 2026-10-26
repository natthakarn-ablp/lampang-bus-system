'use strict';

/**
 * AUD-004 — reports must respect the grade boundary.
 *
 * A school sub-account with users.grade_scope set (a homeroom teacher) is pinned
 * to its own grade in every /api/school read. Reports were the one module that
 * disagreed: buildScopeFilter clamped to s.school_id and never looked at
 * user.gradeScope, so the CSV/Excel/PDF export handed a single-grade teacher
 * every student in the school — names, grades, bus plates and attendance.
 *
 * Product-owner decision (28 ส.ค. 2569): grade teachers see ONLY their own
 * grade. Filter, do not block.
 *
 * These tests drive the REAL service functions against a stubbed pool and read
 * back every statement the service actually issued. That is deliberate: asserting
 * on the emitted SQL catches the ways this particular change goes wrong — a query
 * that builds its own WHERE and never sees the clause, an alias rewrite that
 * mangles it, or a params array that drifts out of step with the placeholders.
 */

require('./loadTestEnv');

const calls = [];
jest.mock('../src/config/database', () => ({
  pool: {
    query: jest.fn((sql, params) => {
      calls.push({ sql: String(sql), params: params || [] });
      // One row of an empty object satisfies both destructuring shapes the
      // service uses: `const [[{ x }]]` and `const [rows]`.
      return Promise.resolve([[{}]]);
    }),
  },
}));

const reportSvc = require('../src/services/report.service');
const { gradeEquivalents } = require('../src/utils/gradeScope');

const TEACHER = { id: 1, role: 'school', scopeId: 'SCH0001', gradeScope: 'ป.4' };
const FULL_SCHOOL = { id: 2, role: 'school', scopeId: 'SCH0001', gradeScope: null };
const AFFILIATION = { id: 3, role: 'affiliation', scopeId: 7, gradeScope: null };

const P4 = gradeEquivalents('ป.4');

beforeEach(() => { calls.length = 0; });

/** Statements that read the students table under either alias. */
const studentQueries = () =>
  calls.filter((c) => /\bstudents\s+s2?\b/.test(c.sql) || /JOIN\s+students\s+s2?\b/.test(c.sql));

const gradeClauses = (sql) => sql.match(/\bs2?\.grade\s+IN\s*\(/g) || [];

describe('AUD-004 — a grade teacher gets only their own grade', () => {
  test('every student-backed query in the daily report carries the grade clause', async () => {
    await reportSvc.getDailyReport(TEACHER, { date: '2026-08-28' });
    const qs = studentQueries();
    expect(qs.length).toBeGreaterThan(0);
    for (const c of qs) {
      expect(gradeClauses(c.sql).length).toBeGreaterThan(0);
    }
  });

  test('the export rows are filtered — this is the CSV/Excel/PDF path', async () => {
    await reportSvc.getExportRows(TEACHER, { date: '2026-08-28' });
    expect(calls.length).toBe(1);
    expect(gradeClauses(calls[0].sql).length).toBe(1);
    // The grade values must actually be bound, not just named in the SQL.
    for (const variant of P4) expect(calls[0].params).toContain(variant);
  });

  test('the monthly report is filtered too', async () => {
    await reportSvc.getMonthlyReport(TEACHER, { month: '2026-08' });
    const qs = studentQueries();
    expect(qs.length).toBeGreaterThan(0);
    for (const c of qs) expect(gradeClauses(c.sql).length).toBeGreaterThan(0);
  });

  test('the summary report is filtered too', async () => {
    await reportSvc.getSummaryReport(TEACHER, { date: '2026-08-28' });
    const qs = studentQueries();
    expect(qs.length).toBeGreaterThan(0);
    for (const c of qs) expect(gradeClauses(c.sql).length).toBeGreaterThan(0);
  });

  test('the clause survives the s → s2 alias rewrite used by the vehicle queries', async () => {
    // getDailyReport and getMonthlyReport rewrite the whole where-string for a
    // second student alias. A clause written with a bare column name, or one the
    // regex mangles, would silently drop out of exactly the query that lists
    // every bus in the school.
    await reportSvc.getDailyReport(TEACHER, { date: '2026-08-28' });
    const rewritten = calls.filter((c) => /JOIN\s+students\s+s2\b/.test(c.sql));
    expect(rewritten.length).toBeGreaterThan(0);
    for (const c of rewritten) {
      expect(c.sql).toMatch(/\bs2\.grade\s+IN\s*\(/);
      // No stray `s.grade` may remain — the rewritten query has no `s` alias, so
      // one would be a SQL error at runtime rather than a silent leak.
      expect(c.sql).not.toMatch(/\bs\.grade\b/);
    }
  });

  test('grade matching is tolerant, so variant spellings are not silently excluded', async () => {
    // students.grade is stored inconsistently. An exact `= 'ป.4'` would hide a
    // teacher's own pupils rather than fail loudly.
    await reportSvc.getExportRows(TEACHER, { date: '2026-08-28' });
    expect(P4.length).toBeGreaterThan(1);
    expect(calls[0].params).toEqual(expect.arrayContaining(['ป.4', 'ประถมศึกษาปีที่4']));
  });

  test('placeholders and bound params stay in step in every statement', async () => {
    // The failure this guards against is silent and severe: one extra param
    // shifts every later value by one slot, so a date lands in a school_id.
    await reportSvc.getDailyReport(TEACHER, { date: '2026-08-28' });
    await reportSvc.getMonthlyReport(TEACHER, { month: '2026-08' });
    for (const c of calls) {
      const placeholders = (c.sql.match(/\?/g) || []).length;
      expect(c.params.length).toBe(placeholders);
    }
  });
});

describe('AUD-004 — the fix must not widen or narrow anyone else', () => {
  test('a full school account still sees the whole school', async () => {
    await reportSvc.getDailyReport(FULL_SCHOOL, { date: '2026-08-28' });
    for (const c of calls) expect(gradeClauses(c.sql).length).toBe(0);
    for (const c of studentQueries()) expect(c.sql).toMatch(/s2?\.school_id = \?/);
  });

  test('an affiliation account is unchanged and still clamped to its affiliation', async () => {
    await reportSvc.getDailyReport(AFFILIATION, { date: '2026-08-28' });
    for (const c of calls) expect(gradeClauses(c.sql).length).toBe(0);
    const scoped = calls.filter((c) => /affiliation_id = \?/.test(c.sql));
    expect(scoped.length).toBeGreaterThan(0);
    for (const c of scoped) expect(c.params).toContain(7);
  });

  test('an affiliation asking for a school keeps its own affiliation clamp', async () => {
    // The existing AND-clamp must not regress: naming a school never replaces
    // the affiliation restriction, it only narrows within it.
    await reportSvc.getExportRows(AFFILIATION, { date: '2026-08-28', school_id: 'SCH9999' });
    expect(calls[0].sql).toMatch(/sc\.affiliation_id = \?/);
    expect(calls[0].sql).toMatch(/s\.school_id = \?/);
    expect(calls[0].params).toContain(7);
    expect(calls[0].params).toContain('SCH9999');
  });
});

describe('AUD-004 — a grade teacher cannot widen their own scope', () => {
  test('naming another school does not escape the teacher grade or school clamp', async () => {
    await reportSvc.getExportRows(TEACHER, { date: '2026-08-28', school_id: 'SCH9999' });
    // buildScopeFilter drops a foreign school_id for role='school' entirely.
    expect(calls[0].params).not.toContain('SCH9999');
    expect(calls[0].params).toContain('SCH0001');
    expect(gradeClauses(calls[0].sql).length).toBe(1);
  });

  test('naming their OWN school still keeps the grade clause', async () => {
    await reportSvc.getExportRows(TEACHER, { date: '2026-08-28', school_id: 'SCH0001' });
    expect(gradeClauses(calls[0].sql).length).toBe(1);
    for (const variant of P4) expect(calls[0].params).toContain(variant);
  });

  test('an affiliation_id filter cannot be used by a school account at all', async () => {
    await reportSvc.getExportRows(TEACHER, { date: '2026-08-28', affiliation_id: 99 });
    expect(calls[0].params).not.toContain(99);
    expect(gradeClauses(calls[0].sql).length).toBe(1);
  });

  test('the policy report stays closed to a grade teacher', async () => {
    // It reads province-wide totals with no scope filter at all, so the guard in
    // front of it is the only thing standing between a teacher and the province.
    await expect(reportSvc.getPolicyReport(TEACHER, {}))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(calls.length).toBe(0);
  });
});
