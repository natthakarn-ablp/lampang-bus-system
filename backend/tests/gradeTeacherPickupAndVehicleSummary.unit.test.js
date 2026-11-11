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
    if (/NOT \(s\.school_id = \? AND s\.grade IN/.test(s)) return [[{ n: o.outsideGrade }]];
    if (/COUNT\(\*\)/.test(s) && /<>/.test(s)) return [[{ n: o.otherSchool }]];
    if (/COUNT\(\*\)/.test(s)) return [[{ n: 1 }]];
    if (/SELECT 1 FROM students/.test(s)) return [[{ 1: 1 }]];
    return [[]];
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockConn.query.mockReset();
  mockConn.query.mockImplementation(async (sql) => (/INSERT INTO pickup_points/.test(String(sql)) ? [{ insertId: 77 }] : [[]]));
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

  test('teacher can delete a point used only by their grade', async () => {
    mockUser = TEACHER; fakeDb();
    const res = await request(app).delete('/api/school/pickup-points/5');
    expect(res.status).toBe(200);
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
