'use strict';
require('./loadTestEnv');
jest.mock('../src/middleware/auth', () => ({ authenticate: (req, _res, next) => {
  req.user = { id: 7, role: 'school', scopeId: 'SCH1', gradeScope: req.headers['x-full-school'] ? null : (req.headers['x-grade'] === 'p3' ? 'ป.3' : 'ป.5') };
  next();
} }));
const mockPoolQuery = jest.fn();
const mockGetConnection = jest.fn();
jest.mock('../src/config/database', () => ({ pool: { query: (...args) => mockPoolQuery(...args), getConnection: (...args) => mockGetConnection(...args) } }));
const mockAudit = jest.fn();
jest.mock('../src/utils/audit', () => ({ logAudit: (...args) => mockAudit(...args) }));
const mockServes = jest.fn();
jest.mock('../src/services/pickupPoint.service', () => ({ validateVehicleServesSchool: (...args) => mockServes(...args) }));
const express = require('express');
const request = require('supertest');
const app = express();
app.use(express.json());
app.use('/api/school', require('../src/routes/school.routes'));
app.use(require('../src/middleware/errorHandler'));

const student = { id: 12, prefix: 'เด็กชาย', first_name: 'เดิม', last_name: 'ทดสอบ', grade: 'ป. 5', classroom: '1', morning_enabled: 1, evening_enabled: 1, parent_name: 'ผู้ปกครองเดิม', parent_phone: '0800000000' };
const vehicle = { id: 'V1', vehicle_type: 'รถตู้', owner_name: 'เจ้าของตัวอย่าง', owner_phone: '0800000001', insurance_status: 'มีประกัน', insurance_type: 'ชั้น 1', insurance_expiry: '2026-12-31' };
let mockCurrentStudent, mockHasRider, mockCurrentVehicle, conn;
beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentStudent = { ...student }; mockHasRider = true; mockCurrentVehicle = { ...vehicle };
  mockAudit.mockResolvedValue(); mockServes.mockResolvedValue(true);
  mockPoolQuery.mockImplementation(async sql => String(sql).includes('FROM students s') ? [[student]] : String(sql).includes('FROM vehicles') ? [[vehicle]] : [{ affectedRows: 1 }]);
  conn = {
    beginTransaction: jest.fn().mockResolvedValue(), commit: jest.fn().mockResolvedValue(), rollback: jest.fn().mockResolvedValue(), release: jest.fn(),
    query: jest.fn(async sql => {
      if (sql.includes('FROM students s')) return [mockCurrentStudent ? [mockCurrentStudent] : []];
      if (sql.includes('student_transfer_requests')) return [[]];
      if (sql.includes('SELECT id FROM students')) return [mockHasRider ? [{ id: 12 }] : []];
      if (sql.includes('FROM vehicles')) return [mockCurrentVehicle ? [mockCurrentVehicle] : []];
      if (sql.includes('SELECT ps.parent_id')) return [[{ parent_id: 50, current_name: student.parent_name, current_phone: student.parent_phone }]];
      if (sql.includes('INSERT INTO parents')) return [{ insertId: 51 }];
      return [{ affectedRows: 1 }];
    }),
  };
  mockGetConnection.mockResolvedValue(conn);
});
const putStudent = body => request(app).put('/api/school/students/12').send(body);
const putVehicle = body => request(app).put('/api/school/vehicles/V1').send(body);
const writes = () => conn.query.mock.calls.filter(([sql]) => /^(UPDATE|INSERT|DELETE)/.test(sql.trim()));

test.each([{ grade: 'ป.6' }, { grade: null }, { school_id: 'OTHER' }, { is_deleted: true }, { vehicle_id: 'OTHER' }])('teacher cannot change student scope or privileged fields %j', async body => {
  expect((await putStudent(body)).status).toBe(403);
  expect(mockPoolQuery).not.toHaveBeenCalled(); expect(mockGetConnection).not.toHaveBeenCalled();
});

test('student lookup is school and grade bounded and another scope is not found', async () => {
  mockPoolQuery.mockResolvedValueOnce([[]]);
  expect((await putStudent({ first_name: 'ใหม่' })).status).toBe(404);
  const [sql, params] = mockPoolQuery.mock.calls[0];
  expect(sql).toContain('s.school_id = ?'); expect(sql).toContain('s.grade IN (?)');
  expect(params.slice(0, 2)).toEqual([12, 'SCH1']); expect(params[2]).toContain('ป.5'); expect(params[2]).not.toContain('ป.6');
  expect(mockGetConnection).not.toHaveBeenCalled();
});

test('teacher edits own-grade profile with current locked audit values; omitted phone is preserved', async () => {
  mockCurrentStudent.first_name = 'ค่าปัจจุบัน';
  const res = await putStudent({ first_name: 'ใหม่', classroom: '2', morning_enabled: false });
  expect(res.status).toBe(200);
  expect(conn.query.mock.calls[0][0]).toMatch(/FOR UPDATE$/);
  expect(conn.beginTransaction.mock.invocationCallOrder[0]).toBeLessThan(conn.query.mock.invocationCallOrder[0]);
  const [sql, params] = writes()[0];
  expect(sql).toMatch(/school_id = \? AND grade <=> \? AND is_deleted = FALSE/);
  expect(params).toEqual(['ใหม่', '2', 0, 12, 'SCH1', 'ป. 5']);
  expect(writes()).toHaveLength(1); expect(res.body.data.parent_reassigned).toBe(false);
  expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ conn, required: true, oldValue: { first_name: 'ค่าปัจจุบัน', classroom: '1', morning_enabled: true }, newValue: { first_name: 'ใหม่', classroom: '2', morning_enabled: false } }));
  expect(conn.commit).toHaveBeenCalledTimes(1); expect(conn.release).toHaveBeenCalledTimes(1);
});

test.each([null, { ...student, grade: 'ป.6' }])('a grade change or disappearance before the locking read blocks all mutations', async current => {
  mockCurrentStudent = current;
  expect((await putStudent({ first_name: 'ใหม่', parent_name: 'ใหม่' })).status).toBe(409);
  expect(writes()).toHaveLength(0); expect(mockAudit).not.toHaveBeenCalled();
  expect(conn.rollback).toHaveBeenCalled(); expect(conn.commit).not.toHaveBeenCalled(); expect(conn.release).toHaveBeenCalled();
});

test('guardian change creates a fresh per-pupil link without changing siblings or carrying LINE identity', async () => {
  const res = await putStudent({ parent_name: 'ผู้ปกครองใหม่' });
  expect(res.status).toBe(200); expect(res.body.data.parent_reassigned).toBe(true);
  const calls = writes();
  expect(calls.find(([sql]) => sql.includes('DELETE FROM parent_student'))[1]).toEqual([12]);
  expect(calls.find(([sql]) => sql.includes('INSERT INTO parents'))[1]).toEqual(['ผู้ปกครองใหม่', '0800000000']);
  expect(calls.find(([sql]) => sql.includes('INSERT INTO parent_student'))[1]).toEqual([51, 12, 7]);
  expect(calls.some(([sql]) => /UPDATE parents|DELETE FROM parents|line_user_id/.test(sql))).toBe(false);
});

test('student audit failure rolls back and never commits', async () => {
  mockAudit.mockRejectedValueOnce(new Error('audit unavailable'));
  expect((await putStudent({ first_name: 'ใหม่' })).status).toBe(500);
  expect(conn.rollback).toHaveBeenCalled(); expect(conn.commit).not.toHaveBeenCalled(); expect(conn.release).toHaveBeenCalled();
});

test('full-school profile editing remains available without the grade clamp', async () => {
  const res = await request(app).put('/api/school/students/12').set('x-full-school', '1').send({ grade: 'ป.6' });
  expect(res.status).toBe(200); expect(mockPoolQuery.mock.calls[0][0]).not.toContain('s.grade IN (?)');
  expect(writes()[0][1]).toEqual(['ป.6', 12]);
});

test.each([{ plate_no: 'NEW' }, { driver_id: 1 }, { is_deleted: true }, { inspection_status: 'APPROVED' }])('teacher vehicle edit rejects non-profile fields %j before any DB work', async body => {
  expect((await putVehicle(body)).status).toBe(403);
  expect(mockGetConnection).not.toHaveBeenCalled(); expect(mockPoolQuery).not.toHaveBeenCalled();
});

test('shared vehicle may be edited when a current own-grade pupil uses it; audit and edit share the lock/transaction', async () => {
  expect((await putVehicle({ vehicle_type: 'รถสองแถว' })).status).toBe(200);
  const [scopeSql, params] = conn.query.mock.calls[0];
  expect(scopeSql).toContain('vehicle_id = ? AND school_id = ?'); expect(scopeSql).toMatch(/grade IN \(\?\).*FOR UPDATE/s);
  expect(params.slice(0, 2)).toEqual(['V1', 'SCH1']); expect(params[2]).toContain('ป.5');
  expect(conn.query.mock.calls[1][0]).toMatch(/FROM vehicles.*FOR UPDATE/s);
  expect(writes()).toEqual([['UPDATE vehicles SET vehicle_type = ? WHERE id = ?', ['รถสองแถว', 'V1']]]);
  expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ conn, required: true, newValue: { vehicle_type: 'รถสองแถว' } }));
  expect(mockServes).not.toHaveBeenCalled(); expect(conn.commit).toHaveBeenCalled();
});

test('no current own-grade vehicle link rejects before reading/editing the shared vehicle', async () => {
  mockHasRider = false;
  expect((await putVehicle({ owner_name: 'ใหม่' })).status).toBe(404);
  expect(conn.query).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(0);
  expect(conn.rollback).toHaveBeenCalled(); expect(conn.commit).not.toHaveBeenCalled(); expect(mockAudit).not.toHaveBeenCalled();
});

test('deleted vehicle rejects and rolls back', async () => {
  mockCurrentVehicle = null;
  expect((await putVehicle({ vehicle_type: 'รถตู้' })).status).toBe(404);
  expect(writes()).toHaveLength(0); expect(conn.rollback).toHaveBeenCalled(); expect(conn.commit).not.toHaveBeenCalled();
});

test('vehicle audit failure rolls back the edit', async () => {
  mockAudit.mockRejectedValueOnce(new Error('audit unavailable'));
  expect((await putVehicle({ owner_name: 'ใหม่', insurance_expiry: '2027-01-31' })).status).toBe(500);
  expect(conn.rollback).toHaveBeenCalled(); expect(conn.commit).not.toHaveBeenCalled(); expect(conn.release).toHaveBeenCalled();
});

test('full-school vehicle edit retains school membership check', async () => {
  expect((await request(app).put('/api/school/vehicles/V1').set('x-full-school', '1').send({ owner_name: 'ใหม่' })).status).toBe(200);
  expect(mockServes).toHaveBeenCalledWith('V1', 'SCH1'); expect(mockGetConnection).not.toHaveBeenCalled();
});

test('teacher withdraws only a currently assigned-grade pupil with required audit', async () => {
  expect((await request(app).delete('/api/school/students/12')).status).toBe(200);
  expect(conn.query.mock.calls[0][0]).toMatch(/school_id = \?.*FOR UPDATE/s);
  expect(conn.query.mock.calls[0][1]).toEqual([12, 'SCH1']);
  expect(writes()).toEqual([
    [expect.stringContaining('is_deleted = TRUE'), [12, 'SCH1']],
    [expect.stringContaining('DELETE spp FROM student_pickup_points'), [[12]]], // SCH-STU-7
  ]);
  expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ conn, required: true, entityId: 12 }));
  expect(conn.commit).toHaveBeenCalledTimes(1);
});

test.each([null, { ...student, grade: 'ป.6' }])('teacher cannot withdraw missing or moved pupil', async current => {
  mockCurrentStudent = current;
  expect((await request(app).delete('/api/school/students/12')).status).toBe(404);
  expect(writes()).toHaveLength(0);
  expect(conn.rollback).toHaveBeenCalled();
  expect(mockAudit).not.toHaveBeenCalled();
});

test('withdraw audit failure rolls back instead of hiding an unaudited deletion', async () => {
  mockAudit.mockRejectedValueOnce(new Error('audit unavailable'));
  expect((await request(app).delete('/api/school/students/12')).status).toBe(500);
  expect(conn.rollback).toHaveBeenCalled();
  expect(conn.commit).not.toHaveBeenCalled();
});

const restoreWrite = () => writes().find(([sql]) => sql.includes('is_deleted = FALSE'));

test('teacher restores a withdrawn pupil in own grade with required audit', async () => {
  mockCurrentStudent = { ...student, is_deleted: 1 };
  const res = await request(app).post('/api/school/students/12/restore').send({ classroom: ' 2 ' });
  expect(res.status).toBe(200);
  expect(conn.query.mock.calls[0][1]).toEqual([12, 'SCH1']);
  expect(restoreWrite()[1]).toEqual(['ป.5', '2', 12, 'SCH1', 'ป. 5']);
  expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ conn, required: true, entityId: 12 }));
  expect(conn.commit).toHaveBeenCalledTimes(1);
});

test('teacher P.3 restores a pupil recorded under P.2: moves into P.3, classroom empty, audit has old and new', async () => {
  mockCurrentStudent = { ...student, grade: 'ป.2', classroom: '1', is_deleted: 1 };
  const res = await request(app).post('/api/school/students/12/restore').set('x-grade', 'p3');
  expect(res.status).toBe(200);
  expect(restoreWrite()[1]).toEqual(['ป.3', null, 12, 'SCH1', 'ป.2']);
  const audit = mockAudit.mock.calls[0][0];
  expect(audit.required).toBe(true);
  expect(audit.oldValue).toMatchObject({ grade: 'ป.2', classroom: '1' });
  expect(audit.newValue).toMatchObject({ grade: 'ป.3', classroom: null, previous_grade: 'ป.2', previous_classroom: '1' });
  expect(conn.commit).toHaveBeenCalledTimes(1);
});

test('restore returns 409 when an active pupil already has the same student code', async () => {
  mockCurrentStudent = { ...student, student_code: '9001', grade: 'ป.2', is_deleted: 1 };
  const res = await request(app).post('/api/school/students/12/restore');
  expect(res.status).toBe(409);
  expect(writes()).toHaveLength(0);
  expect(conn.rollback).toHaveBeenCalled();
});

test.each([null, { ...student, grade: 'ป.6', is_deleted: 0 }])('teacher cannot restore another school or see an active pupil of another grade', async current => {
  mockCurrentStudent = current;
  expect((await request(app).post('/api/school/students/12/restore')).status).toBe(404);
  expect(writes()).toHaveLength(0);
  expect(conn.rollback).toHaveBeenCalled();
  expect(mockAudit).not.toHaveBeenCalled();
});

test('full-school account may restore a withdrawn pupil and choose a new grade; omitted keeps the old one', async () => {
  mockCurrentStudent = { ...student, grade: 'ป.6', classroom: '3', is_deleted: 1 };
  expect((await request(app).post('/api/school/students/12/restore').set('x-full-school', '1').send({ grade: 'ป. 3', classroom: '2' })).status).toBe(200);
  expect(restoreWrite()[1]).toEqual(['ป.3', '2', 12, 'SCH1', 'ป.6']);
  conn.query.mockClear();
  expect((await request(app).post('/api/school/students/12/restore').set('x-full-school', '1')).status).toBe(200);
  expect(restoreWrite()[1]).toEqual(['ป.6', '3', 12, 'SCH1', 'ป.6']);
  expect((await request(app).post('/api/school/students/12/restore').set('x-full-school', '1').send({ grade: 'xx' })).status).toBe(400);
});

describe('deleted-pupil search', () => {
  test.each(['', ' ', 'ก'])('term %j returns nothing and never queries', async q => {
    const res = await request(app).get('/api/school/students/deleted-search').query({ q });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
  test('missing term returns nothing', async () => {
    const res = await request(app).get('/api/school/students/deleted-search');
    expect(res.body.data).toEqual([]);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
  test('school-wide, limited to 20, minimal columns, escaped wildcards', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ id: 1, first_name: 'ตัวอย่าง' }]]);
    const res = await request(app).get('/api/school/students/deleted-search').query({ q: '50%_' });
    expect(res.status).toBe(200);
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain('s.school_id = ?'); expect(sql).toContain('is_deleted = TRUE'); expect(sql).toContain('LIMIT 20');
    expect(sql).not.toMatch(/grade IN|parent|phone|vehicle/i);
    const escaped = '%50' + String.fromCharCode(92) + '%' + String.fromCharCode(92) + '_%';
    expect(params).toEqual(['SCH1', escaped, escaped]);
  });
});

test('restore audit failure rolls back instead of showing an unaudited pupil', async () => {
  mockCurrentStudent = { ...student, is_deleted: 1 };
  mockAudit.mockRejectedValueOnce(new Error('audit unavailable'));
  expect((await request(app).post('/api/school/students/12/restore')).status).toBe(500);
  expect(conn.rollback).toHaveBeenCalled();
  expect(conn.commit).not.toHaveBeenCalled();
});
