'use strict';

/**
 * Training-readiness fixes for the school area (2026-11):
 *   grade-teacher-03  a grade teacher can cancel today's leave in their grade
 *   grade-teacher-04  backdated attendance: a grade teacher may only record the
 *                     one teacher status per session
 *   school-teacher-02 a pickup point shared with another school's pupils
 *                     cannot be deleted by this school
 *
 * DB-free: the pool is mocked; queries are answered by SQL shape.
 */

require('./loadTestEnv');

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 7, role: 'school', scopeId: 'SCH1', gradeScope: req.headers['x-full-school'] ? null : 'ป.4' };
    next();
  },
}));
const mockQuery = jest.fn();
const mockGetConnection = jest.fn();
jest.mock('../src/config/database', () => ({
  pool: { query: (...args) => mockQuery(...args), getConnection: (...args) => mockGetConnection(...args) },
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));
jest.mock('../src/utils/policyActionEvidence', () => ({ consumePolicyAction: jest.fn().mockResolvedValue(true) }));
jest.mock('../src/services/vehicleDedup.service', () => ({
  annotateVehicleList: rows => rows,
  classifyPlateAgainstDb: jest.fn().mockResolvedValue({ code: 'VALID_NEW_VEHICLE' }),
}));

const express = require('express');
const request = require('supertest');
const { todayBangkok } = require('../src/utils/thaiTime');
const backdated = require('../src/services/backdatedAttendance.service');

const app = express();
app.use(express.json());
app.use('/api/school', require('../src/routes/school.routes'));
app.use(require('../src/middleware/errorHandler'));

beforeEach(() => { mockQuery.mockReset(); mockGetConnection.mockReset(); });

function answer(handlers) {
  mockQuery.mockImplementation(async (sql) => {
    for (const [needle, result] of handlers) {
      if (sql.includes(needle)) return typeof result === 'function' ? result() : result;
    }
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  });
}
const updateCalls = () => mockQuery.mock.calls.filter(([sql]) => /UPDATE student_leaves|UPDATE pickup_points/.test(sql));

describe('grade-teacher-03 — DELETE /school/leaves/:id', () => {
  const leaveRow = (over = {}) => [[{ id: 55, leave_date: todayBangkok(), session: 'morning', grade: 'ประถมศึกษาปีที่ ๔', reported_by: 7, ...over }]];

  test('grade teacher cancels today\'s single-round leave in their own grade', async () => {
    answer([['FROM student_leaves sl', leaveRow()], ['UPDATE student_leaves', [{ affectedRows: 1 }]]]);
    const res = await request(app).delete('/api/school/leaves/55');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 55, cancelled: true });
    expect(updateCalls()).toHaveLength(1);
  });

  test('a leave in another grade reads as not found and is not touched', async () => {
    answer([['FROM student_leaves sl', leaveRow({ grade: 'ป.5' })]]);
    const res = await request(app).delete('/api/school/leaves/55');
    expect(res.status).toBe(404);
    expect(updateCalls()).toHaveLength(0);
  });

  test('a past-day or whole-day leave stays with the school account', async () => {
    answer([['FROM student_leaves sl', leaveRow({ leave_date: '2026-01-05' })]]);
    expect((await request(app).delete('/api/school/leaves/55')).status).toBe(403);
    answer([['FROM student_leaves sl', leaveRow({ session: 'both' })]]);
    expect((await request(app).delete('/api/school/leaves/55')).status).toBe(403);
    expect(updateCalls()).toHaveLength(0);
  });

  test('a leave a parent, driver or another account reported is refused (403) and not touched', async () => {
    answer([['FROM student_leaves sl', leaveRow({ reported_by: 99 })]]);
    const res = await request(app).delete('/api/school/leaves/55');
    expect(res.status).toBe(403);
    expect(updateCalls()).toHaveLength(0);
  });

  test('full-school account keeps its unrestricted cancel', async () => {
    answer([
      ['FROM student_leaves sl', leaveRow({ grade: 'ม.3', leave_date: '2026-01-05', session: 'both', reported_by: 99 })],
      ['UPDATE student_leaves', [{ affectedRows: 1 }]],
    ]);
    const res = await request(app).delete('/api/school/leaves/55').set('x-full-school', '1');
    expect(res.status).toBe(200);
  });
});

describe('grade-teacher-03 — getTeacherRoster leave fields', () => {
  const { getTeacherRoster } = require('../src/services/checkin.service');
  const row = (over = {}) => ({
    id: 12, prefix: 'ด.ช.', first_name: 'ก', last_name: 'ข', grade: 'ป.4', classroom: '1',
    vehicle_id: 'V-1', plate_no: 'กข 1', log_id: null, log_status: null, checked_by: null,
    self_travel: 0, self_id: null, self_reported_by: null,
    leave_session: null, leave_id: null, leave_reported_by: null, ...over,
  });
  async function rosterStudent(over, session = 'morning') {
    const pool = { query: jest.fn().mockResolvedValue([[row(over)]]) };
    const data = await getTeacherRoster(pool, { schoolId: 'SCH1', gradeFilter: 'ป.4', session, userId: 7 });
    return data.vehicles[0].students[0];
  }

  test('a single-round leave this teacher recorded exposes leave_id and can_undo', async () => {
    const st = await rosterStudent({ leave_session: 'morning', leave_id: 55, leave_reported_by: 7 });
    expect(st).toMatchObject({ on_leave: true, leave_id: 55, can_undo: true, log_id: null });
  });

  test('a leave someone else reported is shown but cannot be undone here', async () => {
    const st = await rosterStudent({ leave_session: 'morning', leave_id: 55, leave_reported_by: 99 });
    expect(st).toMatchObject({ on_leave: true, leave_id: 55, can_undo: false });
  });

  test('a whole-day leave gives leave_id null and no undo button', async () => {
    const st = await rosterStudent({ leave_session: 'both', leave_id: null, leave_reported_by: null });
    expect(st).toMatchObject({ on_leave: true, leave_id: null, can_undo: false });
  });

  test('no leave: leave_id null, undo follows the teacher own tap', async () => {
    const st = await rosterStudent({ log_id: 3, log_status: 'CHECKED_OUT', checked_by: 7 });
    expect(st).toMatchObject({ on_leave: false, leave_id: null, can_undo: true, log_id: 3 });
  });
});

describe('school-teacher-02 — DELETE /school/pickup-points/:id', () => {
  const point = [[{ id: 9, vehicle_id: 'V-1', label: 'หน้าวัด', latitude: '18.1', longitude: '99.4', session: 'morning' }]];

  test('refuses (409) when another school\'s pupils use the point', async () => {
    answer([
      ['FROM pickup_points', point],
      ['FROM students\n    WHERE vehicle_id', [[{ 1: 1 }]]],
      ['FROM student_pickup_points spp', [[{ n: 2 }]]],
    ]);
    const res = await request(app).delete('/api/school/pickup-points/9').set('x-full-school', '1');
    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('POINT_SHARED_WITH_OTHER_SCHOOL');
    expect(updateCalls()).toHaveLength(0);
    const countCall = mockQuery.mock.calls.find(([sql]) => sql.includes('FROM student_pickup_points spp'));
    expect(countCall[1]).toEqual([9, 'SCH1']);
  });

  test('deletes a point used only by this school', async () => {
    answer([
      ['FROM pickup_points\n      WHERE id', point],
      ['FROM students\n    WHERE vehicle_id', [[{ 1: 1 }]]],
      ['FROM student_pickup_points spp', [[{ n: 0 }]]],
      ['UPDATE pickup_points', [{ affectedRows: 1 }]],
    ]);
    const res = await request(app).delete('/api/school/pickup-points/9').set('x-full-school', '1');
    expect(res.status).toBe(200);
    expect(updateCalls()).toHaveLength(1);
  });
});

describe('grade-teacher-04 — recordBackdatedCheck status rule', () => {
  const now = new Date('2026-11-07T05:00:00Z');
  const base = {
    userId: 7, schoolId: 'SCH1', studentId: 12, checkDate: '2026-11-05', time: '07:30', reason: 'มือถือคนขับแบตหมด', now,
  };
  const reached = () => Promise.reject(new Error('DB must not be reached'));
  const throwingPool = { query: jest.fn(reached), getConnection: jest.fn(reached) };

  test.each([
    ['morning', 'CHECKED_IN'],
    ['evening', 'CHECKED_OUT'],
  ])('grade teacher cannot record %s %s (403, before any DB access)', async (session, status) => {
    throwingPool.query.mockClear(); throwingPool.getConnection.mockClear();
    await expect(backdated.recordBackdatedCheck(throwingPool, { ...base, gradeFilter: 'ป.4', session, status }))
      .rejects.toMatchObject({ statusCode: 403, code: 'TEACHER_STATUS_ONLY' });
    expect(throwingPool.query).not.toHaveBeenCalled();
    expect(throwingPool.getConnection).not.toHaveBeenCalled();
  });

  test('teacher statuses match the live teacher-check model', () => {
    const { TEACHER_STATUS } = require('../src/services/checkin.service');
    expect(backdated.TEACHER_STATUS).toEqual(TEACHER_STATUS);
  });

  test('a full-school caller is not limited to the teacher status', async () => {
    // Passes the status rule, then reaches the DB — which this pool refuses,
    // proving validation did not stop it.
    await expect(backdated.recordBackdatedCheck(throwingPool, { ...base, session: 'morning', status: 'CHECKED_IN' }))
      .rejects.toThrow('DB must not be reached');
  });
});
