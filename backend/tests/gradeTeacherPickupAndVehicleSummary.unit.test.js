'use strict';

// Owner decision 2026-11-11:
//  1. Grade teachers may create / edit / delete pickup points, limited to their
//     own grade (vehicle must carry their grade; pupils must be their grade;
//     edits touch only their grade's rows; delete only if no other grade uses it).
//  2. GET /api/school/grade-vehicle-summary: pupils with / without a vehicle by
//     grade. School main account sees every grade, a teacher only theirs.
require('./loadTestEnv');
let mockUser;
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { ...mockUser }; next(); },
}));
const mockQuery = jest.fn();
const mockConn = { query: jest.fn(async () => [[]]), beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
jest.mock('../src/config/database', () => ({ pool: { query: (...a) => mockQuery(...a), getConnection: jest.fn(async () => mockConn) } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));

const express = require('express');
const request = require('supertest');
const app = express();
app.use(express.json());
app.use('/api/school', require('../src/routes/school.routes'));
app.use(require('../src/middleware/errorHandler'));

const SCHOOL = { id: 1, role: 'school', scopeId: 'SCH1', gradeScope: null };
const TEACHER = { id: 2, role: 'school', scopeId: 'SCH1', gradeScope: 'ป.1' };
const POINT = { id: 5, vehicle_id: 'V-aaaaaaaaaaaa', sequence: 1, label: 'P', latitude: 18.29, longitude: 99.49, session: 'both' };
const BODY = { vehicle_id: 'V-aaaaaaaaaaaa', label: 'บ้านหนองหล่ม', latitude: 18.3, longitude: 99.5, session: 'both', student_ids: [11, 12] };

function fakeDb(opts = {}) {
  const o = { carriesGrade: true, studentsMatched: 2, outsideGrade: 0, otherSchool: 0, ...opts };
  mockQuery.mockImplementation(async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/FROM pickup_points/.test(s) && !/student_pickup_points/.test(s) && /WHERE/.test(s)) return [[POINT]];
    if (/SELECT 1 AS ok FROM students/.test(s)) return [o.carriesGrade ? [{ ok: 1 }] : []];
    if (/COUNT\(\*\) AS matched/.test(s)) return [[{ matched: o.studentsMatched }]];
    if (/AS conflicts/.test(s)) return [[{ conflicts: 0 }]];
    if (/NOT \(s\.school_id = \? AND s\.grade IS NOT NULL AND s\.grade IN/.test(s)) return [[{ n: o.outsideGrade }]];
    if (/COUNT\(\*\)/.test(s) && /<>/.test(s)) return [[{ n: o.otherSchool }]];
    if (/COUNT\(\*\)/.test(s)) return [[{ n: 1 }]];
    if (/SELECT 1 FROM students/.test(s)) return [[{ 1: 1 }]];
    return [[]];
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockConn.query.mockReset();
  mockConn.commit.mockClear(); mockConn.rollback.mockClear();
  mockConn.query.mockImplementation(async (sql) => {
    const q = String(sql);
    if (/INSERT INTO pickup_points/.test(q)) return [{ insertId: 77 }];
    if (/FOR UPDATE/.test(q)) return [[POINT]];
    if (/COUNT\(\*\)/.test(q)) return [[{ n: 0 }]];
    return [[]];
  });
});

const findConn = (re) => mockConn.query.mock.calls.find(c => re.test(String(c[0])));

describe('grade teacher pickup-point writes', () => {
  test('teacher can create a point on a vehicle carrying their grade with their pupils', async () => {
    mockUser = TEACHER; fakeDb();
    const res = await request(app).post('/api/school/pickup-points').send(BODY);
    expect(res.status).toBe(201);
    const matchedCall = mockQuery.mock.calls.find(c => /COUNT\(\*\) AS matched/.test(String(c[0])));
    expect(String(matchedCall[0])).toMatch(/grade IN \(\?\)/);
    expect(matchedCall[1][3]).toEqual(expect.arrayContaining(['ป.1']));
  });

  test('teacher cannot create a point on a vehicle without their grade', async () => {
    mockUser = TEACHER; fakeDb({ carriesGrade: false });
    const res = await request(app).post('/api/school/pickup-points').send(BODY);
    expect(res.status).toBe(400);
    expect(mockConn.query).not.toHaveBeenCalled();
  });

  test('teacher cannot add pupils of another grade', async () => {
    mockUser = TEACHER; fakeDb({ studentsMatched: 1 });
    const res = await request(app).post('/api/school/pickup-points').send(BODY);
    expect(res.status).toBe(400);
    expect(mockConn.query).not.toHaveBeenCalled();
  });

  test('teacher PUT students replaces only their own grade rows', async () => {
    mockUser = TEACHER; fakeDb();
    const res = await request(app).put('/api/school/pickup-points/5/students').send({ student_ids: [11, 12] });
    expect(res.status).toBe(200);
    const del = findConn(/DELETE spp FROM student_pickup_points/);
    expect(String(del[0])).toMatch(/s\.grade IN \(\?\)/);
    expect(del[1][1]).toBe('SCH1');
    expect(del[1][2]).toEqual(expect.arrayContaining(['ป.1']));
  });

  test('school main account PUT keeps the whole-school restriction (no grade clause)', async () => {
    mockUser = SCHOOL; fakeDb({ studentsMatched: 1 });
    const res = await request(app).put('/api/school/pickup-points/5/students').send({ student_ids: [11] });
    expect(res.status).toBe(200);
    const del = findConn(/DELETE spp FROM student_pickup_points/);
    expect(String(del[0])).not.toMatch(/grade IN/);
    expect(del[1]).toEqual([5, 'SCH1']);
  });

  test('teacher cannot delete a point used by another grade', async () => {
    mockUser = TEACHER; fakeDb({ outsideGrade: 3 });
    const res = await request(app).delete('/api/school/pickup-points/5');
    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('POINT_SHARED_WITH_OTHER_GRADE');
    expect(mockQuery.mock.calls.some(c => /UPDATE pickup_points/.test(String(c[0])))).toBe(false);
  });

  test('outside-grade count treats NULL-grade same-school pupils as outside', async () => {
    mockUser = TEACHER; fakeDb({ outsideGrade: 1 });
    await request(app).delete('/api/school/pickup-points/5');
    const q = mockQuery.mock.calls.find(c => /NOT \(s\.school_id = \?/.test(String(c[0])));
    expect(String(q[0])).toMatch(/s\.grade IS NOT NULL AND s\.grade IN/);
  });

  test('teacher cannot delete a point on a bus without their grade', async () => {
    mockUser = TEACHER; fakeDb({ carriesGrade: false });
    const res = await request(app).delete('/api/school/pickup-points/5');
    expect(res.status).toBe(403);
  });

  test('teacher must pick at least one pupil when creating a point', async () => {
    mockUser = TEACHER; fakeDb();
    const res = await request(app).post('/api/school/pickup-points').send({ ...BODY, student_ids: [] });
    expect(res.status).toBe(400);
    expect(mockConn.query).not.toHaveBeenCalled();
  });

  test('teacher can delete a point used only by their grade', async () => {
    mockUser = TEACHER; fakeDb();
    const res = await request(app).delete('/api/school/pickup-points/5');
    expect(res.status).toBe(200);
  });

  // Owner decision 2026-11-13: delete clears every pupil reference in the same
  // transaction as the soft delete, and the audit row (written on the same
  // connection) records the cleared pupils.
  test('delete clears pupil references + soft-deletes + audits in one transaction', async () => {
    const { logAudit } = require('../src/utils/audit');
    logAudit.mockClear();
    mockUser = TEACHER; fakeDb();
    mockConn.query.mockImplementation(async (sql) => {
      const q = String(sql);
      if (/FOR UPDATE/.test(q)) return [[POINT]];
      if (/COUNT\(\*\)/.test(q)) return [[{ n: 0 }]];
      if (/SELECT student_id FROM student_pickup_points/.test(q)) return [[{ student_id: 11 }, { student_id: 12 }]];
      return [{ affectedRows: 1 }];
    });
    const res = await request(app).delete('/api/school/pickup-points/5');
    expect(res.status).toBe(200);
    expect(res.body.data.cleared_students).toBe(2);
    const sqls = mockConn.query.mock.calls.map(c => String(c[0]).replace(/\s+/g, ' '));
    const iDel = sqls.findIndex(s => /DELETE FROM student_pickup_points WHERE pickup_point_id = \?/.test(s));
    const iSoft = sqls.findIndex(s => /UPDATE pickup_points SET is_deleted = TRUE/.test(s));
    expect(iDel).toBeGreaterThan(-1);
    expect(iSoft).toBeGreaterThan(iDel);
    // the in-transaction grade re-check ran with the teacher's grade
    expect(sqls.some(s => /NOT \(s\.school_id = \? AND s\.grade IS NOT NULL/.test(s))).toBe(true);
    expect(mockConn.commit).toHaveBeenCalled();
    // nothing deleted outside the transaction
    expect(mockQuery.mock.calls.some(c => /UPDATE pickup_points|DELETE FROM student_pickup_points/.test(String(c[0])))).toBe(false);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE', entityType: 'pickup_point', entityId: 5, conn: mockConn,
      oldValue: expect.objectContaining({ student_ids: [11, 12] }),
      newValue: expect.objectContaining({ cleared_student_ids: [11, 12], scope: 'grade_teacher', grade_scope: 'ป.1' }),
    }));
  });

  test('a pupil of another school assigned mid-flight aborts the delete (409, rollback)', async () => {
    mockUser = SCHOOL; fakeDb();
    mockConn.query.mockImplementation(async (sql) => {
      const q = String(sql);
      if (/FOR UPDATE/.test(q)) return [[POINT]];
      if (/<>/.test(q)) return [[{ n: 1 }]];
      return [[]];
    });
    const res = await request(app).delete('/api/school/pickup-points/5');
    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('POINT_SHARED_WITH_OTHER_SCHOOL');
    expect(mockConn.rollback).toHaveBeenCalled();
    expect(mockConn.query.mock.calls.some(c => /DELETE FROM student_pickup_points|UPDATE pickup_points/.test(String(c[0])))).toBe(false);
  });

  test('school main account delete has no grade re-check', async () => {
    mockUser = SCHOOL; fakeDb();
    const res = await request(app).delete('/api/school/pickup-points/5');
    expect(res.status).toBe(200);
    expect(mockConn.query.mock.calls.some(c => /s\.grade IN/.test(String(c[0])))).toBe(false);
  });
});

describe('GET /grade-vehicle-summary', () => {
  const ROWS = [
    { id: 1, prefix: 'ด.ช.', first_name: 'ก', last_name: 'ข', grade: 'ป.1', classroom: '1', vehicle_id: 'V-aaaaaaaaaaaa', plate_no: 'กข 1', morning_enabled: 1, evening_enabled: 1 },
    { id: 2, prefix: 'ด.ญ.', first_name: 'ค', last_name: 'ง', grade: 'ประถมศึกษาปีที่ 1', classroom: '2', vehicle_id: null, plate_no: null, morning_enabled: 1, evening_enabled: 0 },
    { id: 3, prefix: 'ด.ช.', first_name: 'จ', last_name: 'ฉ', grade: 'อ.2', classroom: '1', vehicle_id: null, plate_no: null, morning_enabled: 1, evening_enabled: 1 },
    { id: 4, prefix: null, first_name: 'ช', last_name: 'ซ', grade: null, classroom: null, vehicle_id: 'V-bbbbbbbbbbbb', plate_no: 'กข 2', morning_enabled: 1, evening_enabled: 1 },
  ];

  test('school sees every grade, grouped and ordered, with totals', async () => {
    mockUser = SCHOOL;
    mockQuery.mockImplementation(async () => [ROWS]);
    const res = await request(app).get('/api/school/grade-vehicle-summary');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.grades.map(g => g.grade)).toEqual(['อ.2', 'ป.1', 'ไม่ระบุชั้น']);
    expect(d.grades[1]).toMatchObject({ total: 2, with_vehicle: 1, without_vehicle: 1 });
    expect(d.totals).toEqual({ total: 4, with_vehicle: 2, without_vehicle: 2 });
    expect(String(mockQuery.mock.calls[0][0])).not.toMatch(/grade IN/);
    expect(JSON.stringify(d)).not.toMatch(/cid_hash|phone/);
  });

  test('teacher query is limited to their grade', async () => {
    mockUser = TEACHER;
    mockQuery.mockImplementation(async () => [[ROWS[0], ROWS[1]]]);
    const res = await request(app).get('/api/school/grade-vehicle-summary');
    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toMatch(/s\.grade IN \(\?\)/);
    expect(params[0]).toBe('SCH1');
    expect(params[1]).toEqual(expect.arrayContaining(['ป.1', 'ประถมศึกษาปีที่ 1']));
    expect(res.body.data.grade_scope).toBe('ป.1');
  });

  test('xlsx download is audit-logged and returns a workbook', async () => {
    mockUser = SCHOOL;
    mockQuery.mockImplementation(async () => [ROWS]);
    const { logAudit } = require('../src/utils/audit');
    logAudit.mockClear();
    const res = await request(app).get('/api/school/grade-vehicle-summary?format=xlsx').buffer(true)
      .parse((r, cb) => { const b = []; r.on('data', c => b.push(c)); r.on('end', () => cb(null, Buffer.concat(b))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.body.slice(0, 2).toString()).toBe('PK');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'grade_vehicle_summary_xlsx' }));
  });
});
