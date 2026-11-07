'use strict';

/**
 * Live QA round 2 (7 Nov 2026), reports / check-in area. Each block names the
 * finding it pins. Services run against a stubbed pool and the SQL they really
 * issue is asserted on, as in reportGradeScope.unit.test.js.
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
const ppSvc = require('../src/services/pickupPoint.service');
const checkinSvc = require('../src/services/checkin.service');
const reportRoutes = require('../src/routes/report.routes');
const { gradeEquivalents, storedGrade } = require('../src/utils/gradeScope');
const { sessionTimeError } = require('../src/utils/sessionTimeWindow');

const FULL_SCHOOL = { id: 2, role: 'school', scopeId: 'SCH0001', gradeScope: null };
const TEACHER = { id: 1, role: 'school', scopeId: 'SCH0001', gradeScope: 'ป.1' };
const AFFILIATION = { id: 3, role: 'affiliation', scopeId: 'AFF001', gradeScope: null };

beforeEach(() => { calls.length = 0; mockResponder = () => [[{}]]; });

/** Every `?` must have exactly one bound value (an array binds as one). */
function expectPlaceholdersMatch(c) {
  const marks = (c.sql.match(/\?/g) || []).length;
  expect({ sql: c.sql, marks }).toEqual({ sql: c.sql, marks: c.params.length });
}

describe('gt1-01 / swt-02 / sch-01 — รหัสนักเรียน is the student code', () => {
  test('the export query selects student_code, falling back to the id', () => {
    const { sql } = reportSvc.exportRowsQuery(FULL_SCHOOL, { date: '2026-11-07' });
    expect(sql).toMatch(/COALESCE\(NULLIF\(s\.student_code, ''\), CAST\(s\.id AS CHAR\)\) AS student_code/);
  });

  test('the CSV line writes the code in the รหัสนักเรียน column, not the id', () => {
    const line = reportRoutes._test.csvLine({ student_id: 992007, student_code: '99990001', student_name: 'QA-01' });
    expect(line.split(',')[0]).toContain('99990001');
    expect(line).not.toContain('992007');
  });
});

describe('gt1-06 / gt2-05 — a grade-scoped export says which grade', () => {
  test('file name carries the grade for a grade teacher only', () => {
    const { exportDisposition } = reportRoutes._test;
    expect(exportDisposition('report-2026-11-07', 'csv', FULL_SCHOOL))
      .toBe('attachment; filename="report-2026-11-07.csv"');
    const graded = exportDisposition('report-2026-11-07', 'csv', TEACHER);
    expect(graded).toContain('filename="report-2026-11-07.csv"');
    expect(graded).toContain(`filename*=UTF-8''${encodeURIComponent('report-2026-11-07-ป.1.csv')}`);
  });

  test('PDF heading names the grade; a whole-school or area report has none', () => {
    const { gradeHeading } = reportRoutes._test;
    expect(gradeHeading(TEACHER)).toBe('เฉพาะนักเรียนชั้น ป.1');
    expect(gradeHeading(FULL_SCHOOL)).toBeNull();
    expect(gradeHeading(AFFILIATION)).toBeNull();
    // A non-canonical value in the token never reaches a header.
    expect(gradeHeading({ role: 'school', gradeScope: 'ป.1"\r\nX: y' })).toBeNull();
  });
});

describe('gt1-02 — school-level expected counts only pupils on a vehicle', () => {
  const totals = () => calls.filter((c) => /AS (morning|evening)_total/.test(c.sql));

  test('school daily report: totals, done and ledger leave out pupils with no vehicle', async () => {
    await reportSvc.getDailyReport(FULL_SCHOOL, { date: '2026-11-07' });
    expect(totals()).toHaveLength(2);
    for (const c of totals()) expect(c.sql).toMatch(/s\.vehicle_id IS NOT NULL/);
    const ledger = calls.find((c) => c.sql.includes("'BUS_DATE'"));
    expect(ledger.sql.match(/s\.vehicle_id IS NOT NULL/g)).toHaveLength(2);
    const perSchool = calls.find((c) => /GROUP BY sc\.id, sc\.name/.test(c.sql));
    expect(perSchool.sql).toMatch(/s\.morning_enabled = TRUE AND s\.vehicle_id IS NOT NULL/);
    for (const c of calls) expectPlaceholdersMatch(c);
  });

  test('affiliation daily report is unchanged', async () => {
    await reportSvc.getDailyReport(AFFILIATION, { date: '2026-11-07' });
    for (const c of totals()) expect(c.sql).not.toMatch(/vehicle_id IS NOT NULL/);
  });

  test('monthly report is unchanged', async () => {
    await reportSvc.getMonthlyReport(FULL_SCHOOL, { month: '2026-11' }).catch(() => {});
    const ledger = calls.find((c) => c.sql.includes("'BUS_DATE'"));
    if (ledger) expect(ledger.sql).not.toMatch(/vehicle_id IS NOT NULL/);
  });

  test('school dashboard: morning/evening totals and leave counts are riders only', async () => {
    const schoolSvc = require('../src/services/school.service');
    await schoolSvc.getDashboard('SCH0001').catch(() => {});
    const qs = totals();
    expect(qs).toHaveLength(2);
    for (const c of qs) expect(c.sql.match(/vehicle_id IS NOT NULL/g)).toHaveLength(2);
  });
});

describe('gt2-04 — GET /school/pickup-vehicles for a grade teacher', () => {
  test('placeholders bind in SQL order: the JOIN grade before the WHERE school', async () => {
    await ppSvc.getVehiclesForSchool('SCH0001', { gradeFilter: 'ป.1' });
    const c = calls[0];
    expectPlaceholdersMatch(c);
    const eq = gradeEquivalents('ป.1');
    expect(c.params).toEqual(['SCH0001', eq, eq, 'SCH0001']);
  });

  test('full-school call is unchanged', async () => {
    await ppSvc.getVehiclesForSchool('SCH0001');
    expect(calls[0].params).toEqual(['SCH0001', 'SCH0001']);
  });
});

describe('swt-03 — an emptied pickup point stays listed', () => {
  test('full-school list includes points with no pupils on a bus serving the school', async () => {
    await ppSvc.getPickupPointsForSchool('SCH0001', { session: 'morning' });
    const c = calls[0];
    expect(c.sql).toMatch(/NOT EXISTS \(SELECT 1 FROM student_pickup_points spp3/);
    expect(c.sql).toMatch(/s4\.vehicle_id = pp\.vehicle_id AND s4\.school_id = \?/);
    expectPlaceholdersMatch(c);
    expect(c.params[c.params.length - 1]).toBe('SCH0001');
  });

  test('grade teacher list still shows only points with pupils of their grade', async () => {
    await ppSvc.getPickupPointsForSchool('SCH0001', { gradeFilter: 'ป.1' });
    expect(calls[0].sql).not.toMatch(/spp3/);
    expectPlaceholdersMatch(calls[0]);
  });
});

describe('swt-04 — same-day override can be undone by a full-school account', () => {
  const base = { target: 'CHECKED_OUT', userId: 7 };
  test.each([
    ['own teacher tap', { status: 'CHECKED_OUT', checkedBy: 7, checkedByRole: 'school', gradeFilter: 'ป.1' }, true],
    ['own morning override (CHECKED_IN)', { status: 'CHECKED_IN', checkedBy: 7, checkedByRole: 'school', gradeFilter: null }, true],
    ['another school account, full-school user', { status: 'CHECKED_IN', checkedBy: 8, checkedByRole: 'school', gradeFilter: null }, true],
    ['another school account, grade teacher', { status: 'CHECKED_OUT', checkedBy: 8, checkedByRole: 'school', gradeFilter: 'ป.1' }, false],
    ['driver check, full-school user', { status: 'CHECKED_IN', checkedBy: 9, checkedByRole: 'driver', gradeFilter: null }, false],
    ['no status', { status: null, checkedBy: 7, checkedByRole: 'school', gradeFilter: null }, false],
  ])('%s', (_n, input, expected) => {
    expect(checkinSvc.canUndoSchoolCheck({ ...base, ...input })).toBe(expected);
  });

  test('undoTeacherCheck lets a full-school user void another account\'s override', async () => {
    const pool = {
      query: jest.fn(async () => [[{
        id: 50, student_id: 5, session: 'morning', status: 'CHECKED_IN', checked_by: 8,
        checked_by_role: 'school', is_today: 1, latest_id: 50,
      }]]),
      getConnection: jest.fn(async () => { throw new Error('reached voidCheckin'); }),
    };
    await expect(checkinSvc.undoTeacherCheck(pool, { userId: 7, schoolId: 'SCH0001', logId: 50 }))
      .rejects.toThrow('reached voidCheckin');
    await expect(checkinSvc.undoTeacherCheck(pool, { userId: 7, schoolId: 'SCH0001', gradeFilter: 'ป.1', logId: 50 }))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('swt-05 — a school override counts as done on เช็กชื่อวันนี้', () => {
  const row = (extra) => ({
    id: 5, first_name: 'ก', last_name: 'ข', vehicle_id: 'V-1', plate_no: 'x',
    log_id: 50, log_status: 'CHECKED_IN', checked_at: new Date(), ...extra,
  });
  test.each([
    ['school override', { checked_by: 8, checked_by_role: 'school' }, true, true],
    ['driver boarding', { checked_by: 9, checked_by_role: 'driver' }, false, false],
  ])('morning CHECKED_IN by %s', async (_n, extra, done, canUndo) => {
    const pool = { query: jest.fn(async () => [[row(extra)]]) };
    const r = await checkinSvc.getTeacherRoster(pool, { schoolId: 'SCH0001', session: 'morning', userId: 7 });
    const st = r.vehicles[0].students[0];
    expect(st.done).toBe(done);
    expect(st.can_undo).toBe(canUndo);
    expect(st.own_check).toBe(false);
  });
});

describe('gt1-04 — a corrected time must fall in its round', () => {
  test.each([
    ['evening', '07:45', false],
    ['evening', '11:00', true],
    ['evening', '16:30', true],
    ['morning', '07:45', true],
    ['morning', '12:59', true],
    ['morning', '13:00', false],
    ['morning', '18:00', false],
  ])('%s %s', (session, time, ok) => {
    expect(sessionTimeError(session, time) === null).toBe(ok);
  });
});

describe('gt1-05 — a typed grade is stored in canonical form', () => {
  test.each([
    ['ป1', 'ป.1'], ['ป. 1', 'ป.1'], ['ประถมศึกษาปีที่ 1', 'ป.1'], ['ม.3', 'ม.3'],
    ['  อ2 ', 'อ.2'], ['เตรียมอนุบาล', 'เตรียมอนุบาล'], ['', null], [null, null],
  ])('%p -> %p', (input, expected) => {
    expect(storedGrade(input)).toBe(expected);
  });
});
