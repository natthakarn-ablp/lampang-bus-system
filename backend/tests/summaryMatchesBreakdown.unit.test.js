'use strict';

/**
 * The headline figure and the per-school rows under it must count the same set.
 *
 * An affiliation reported (2 ต.ค. 2569) that its summary and its per-school list
 * disagreed. Two causes, both fixed here:
 *
 *  1. Denominator. The daily/summary report headline measures each session
 *     against the pupils who use it (morning_enabled / evening_enabled); the
 *     per-school, per-vehicle and per-affiliation rows divided by EVERY pupil.
 *     A school with one evening-only child showed "ค้าง" under a headline that
 *     said everything was done.
 *  2. Set. The headline totals (dashboards and reports, affiliation and
 *     province) counted pupils of a closed school (schools.is_deleted) and buses
 *     that had been deleted; the lists beneath them did not.
 *
 * Driven against a stubbed pool, like reportGradeScope.unit.test.js: the SQL the
 * service really issues is what is asserted on.
 */

require('./loadTestEnv');

const calls = [];
let mockResponder = () => [[{}]];
jest.mock('../src/config/database', () => ({
  pool: {
    query: jest.fn((sql, params) => {
      calls.push({ sql: String(sql), params: params || [] });
      return Promise.resolve(mockResponder(String(sql)));
    }),
  },
}));

const reportSvc = require('../src/services/report.service');
const affSvc = require('../src/services/affiliation.service');
const provSvc = require('../src/services/province.service');

const AFFILIATION = { id: 3, role: 'affiliation', scopeId: 'AFF001', gradeScope: null };
const PROVINCE = { id: 4, role: 'province', scopeId: 'LPG', gradeScope: null };

beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
beforeEach(() => { calls.length = 0; mockResponder = () => [[{}]]; });

/** Statements that count pupils through a join to their school. */
const studentSchoolQueries = () =>
  calls.filter((c) => /\bstudents\s+s\d?\b/.test(c.sql) && /\bschools\s+sc\d?\b/.test(c.sql));

const closedSchoolExcluded = (sql) => /\bsc\d?\.is_deleted\s*=\s*FALSE/.test(sql);

describe('cause 2 — headline and rows count the same pupils', () => {
  test.each([
    ['daily report', () => reportSvc.getDailyReport(AFFILIATION, { date: '2026-10-02' })],
    ['monthly report', () => reportSvc.getMonthlyReport(AFFILIATION, { month: '2026-10' })],
    ['summary report', () => reportSvc.getSummaryReport(PROVINCE, { date: '2026-10-02' })],
    ['affiliation dashboard', () => affSvc.getDashboard('AFF001')],
  ])('%s: every pupil count joined to a school leaves closed schools out', async (_n, run) => {
    await run().catch(() => {});
    const qs = studentSchoolQueries();
    expect(qs.length).toBeGreaterThan(0);
    for (const c of qs) expect({ sql: c.sql, ok: closedSchoolExcluded(c.sql) }).toEqual({ sql: c.sql, ok: true });
  });

  test('province dashboard totals join schools, so they match the school list', async () => {
    await provSvc.getDashboard().catch(() => {});
    const total = calls.find((c) => /AS total_students/.test(c.sql));
    expect(total.sql).toMatch(/JOIN schools sc ON sc\.id = s\.school_id AND sc\.is_deleted = FALSE/);
    for (const name of ['morning_total', 'evening_total']) {
      expect(calls.find((c) => new RegExp(`AS ${name}`).test(c.sql)).sql).toMatch(/sc\.is_deleted = FALSE/);
    }
  });

  test.each([
    ['daily report', () => reportSvc.getDailyReport(AFFILIATION, { date: '2026-10-02' })],
    ['affiliation dashboard', () => affSvc.getDashboard('AFF001')],
    ['province dashboard', () => provSvc.getDashboard()],
  ])('%s: the vehicle total leaves deleted vehicles out, as the vehicle list does', async (_n, run) => {
    await run().catch(() => {});
    const q = calls.find((c) => /AS total_vehicles/.test(c.sql));
    expect(q.sql).toMatch(/JOIN vehicles v ON v\.id = s\.vehicle_id AND v\.is_deleted = FALSE/);
  });

  test('per-school vehicle_count leaves deleted vehicles out (affiliation and province lists)', async () => {
    await affSvc.getSchools('AFF001');
    await provSvc.getSchools({});
    const lists = calls.filter((c) => /AS vehicle_count/.test(c.sql));
    expect(lists).toHaveLength(2);
    for (const c of lists) expect(c.sql).toMatch(/v\.is_deleted = FALSE/);
  });
});

describe('cause 1 — rows use the headline denominator', () => {
  // A school of 10 pupils: 8 ride in the morning, all 10 in the evening, and
  // every one of them was handled today. It is complete, and must say so.
  const ROW = {
    student_count: 10, morning_expected: 8, evening_expected: 10,
    morning_done: 8, evening_done: 10,
  };

  test('summary report: per-school, per-vehicle and per-affiliation KPI are 100%, not 80%', async () => {
    mockResponder = (sql) => {
      if (/GROUP BY sc\.id, sc\.name/.test(sql)) return [[{ school_id: 'SCH1', school_name: 'A', ...ROW }]];
      if (/GROUP BY v\.id, v\.plate_no/.test(sql)) return [[{ vehicle_id: 'V-1', plate_no: 'x', ...ROW }]];
      if (/GROUP BY a\.id, a\.name/.test(sql)) return [[{ affiliation_id: 'AFF001', affiliation_name: 'B', ...ROW }]];
      return [[{}]];
    };
    const r = await reportSvc.getSummaryReport(PROVINCE, { date: '2026-10-02' });
    for (const row of [r.schools[0], r.vehicles[0], r.affiliations[0]]) {
      expect(row.morning_kpi).toBe(100);
      expect(row.evening_kpi).toBe(100);
    }
  });

  test('daily report rows carry morning_expected / evening_expected for the table', async () => {
    await reportSvc.getDailyReport(AFFILIATION, { date: '2026-10-02' });
    const breakdowns = calls.filter((c) => /GROUP BY (sc\.id, sc\.name|v\.id, v\.plate_no)/.test(c.sql));
    expect(breakdowns).toHaveLength(2);
    for (const c of breakdowns) {
      expect(c.sql).toMatch(/AS morning_expected/);
      expect(c.sql).toMatch(/AS evening_expected/);
    }
  });

  test('monthly report: a vehicle is measured against its riders of each session', async () => {
    mockResponder = (sql) => {
      if (/GROUP BY v\.id, v\.plate_no/.test(sql)) {
        return [[{ vehicle_id: 'V-1', plate_no: 'x', student_count: 10, morning_expected: 8,
          evening_expected: 10, total_morning_done: 16, total_evening_done: 20, days_with_data: 2 }]];
      }
      return [[{}]];
    };
    const r = await reportSvc.getMonthlyReport(AFFILIATION, { month: '2026-10' });
    expect(r.vehicles[0].morning_kpi).toBe(100);
    expect(r.vehicles[0].evening_kpi).toBe(100);
  });
});
