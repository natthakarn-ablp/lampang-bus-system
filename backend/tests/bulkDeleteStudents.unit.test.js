'use strict';

/**
 * POST /api/school/students/bulk-delete — DB-free wiring: scope from the token,
 * grade-teacher filter, one transaction, rollback when nothing is eligible.
 * The SQL itself is proven in bulkDeleteStudents.test.js.
 */

let mockUser;
const mockConn = {
  query: jest.fn(),
  beginTransaction: jest.fn(async () => {}),
  commit: jest.fn(async () => {}),
  rollback: jest.fn(async () => {}),
  release: jest.fn(),
};
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
}));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn(async () => mockConn) } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn(async () => {}), AUDIT_ACTIONS: [] }));
jest.mock('../src/services/pickupCleanup.service', () => ({ clearStalePickupAssignments: jest.fn(async () => {}) }));

const express = require('express');
const request = require('supertest');
const { logAudit } = require('../src/utils/audit');
const routes = require('../src/routes/school.routes');

const app = express();
app.use(express.json());
app.use('/api/school', routes);
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }));

const ROWS = [
  { id: 1, prefix: 'ด.ช.', first_name: 'ก', last_name: 'ข', grade: 'ป.1', classroom: '1', vehicle_id: 'V-1', plate_no: 'x' },
  { id: 2, prefix: 'ด.ช.', first_name: 'ค', last_name: 'ง', grade: 'ป.2', classroom: '1', vehicle_id: null, plate_no: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 9, role: 'school', scopeId: 'S1', gradeScope: null };
  mockConn.query.mockImplementation(async (sql) => (/^\s*SELECT/.test(sql) ? [ROWS] : [{ affectedRows: 1 }]));
});

const post = (body) => request(app).post('/api/school/students/bulk-delete').send(body);

test('main account withdraws every found pupil in one transaction; school from token', async () => {
  const res = await post({ student_ids: [1, 2, 3], school_id: 'OTHER' });
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ deleted: 2, skipped: [3] });
  const select = mockConn.query.mock.calls[0];
  expect(select[1]).toEqual([1, 2, 3, 'S1']);
  expect(mockConn.commit).toHaveBeenCalledTimes(1);
  expect(logAudit).toHaveBeenCalledTimes(2);
  expect(logAudit.mock.calls[0][0]).toMatchObject({ action: 'DELETE', entityType: 'student', required: true });
});

test('grade teacher: other grades are skipped, not withdrawn', async () => {
  mockUser = { id: 9, role: 'school', scopeId: 'S1', gradeScope: 'ป.1' };
  const res = await post({ student_ids: [1, 2] });
  expect(res.body.data).toMatchObject({ deleted: 1, skipped: [2] });
  const update = mockConn.query.mock.calls.find(([sql]) => /UPDATE students/.test(sql));
  expect(update[1]).toEqual([1, 'S1']);
});

test('nothing eligible → 404, rolled back, nothing written', async () => {
  mockConn.query.mockImplementation(async () => [[]]);
  const res = await post({ student_ids: [5] });
  expect(res.status).toBe(404);
  expect(mockConn.rollback).toHaveBeenCalled();
  expect(mockConn.commit).not.toHaveBeenCalled();
  expect(logAudit).not.toHaveBeenCalled();
});

test.each([
  [{}], [{ student_ids: [] }], [{ student_ids: ['x'] }], [{ student_ids: [0] }],
  [{ student_ids: Array.from({ length: 501 }, (_, i) => i + 1) }],
])('invalid body %# is 400 before any database work', async (body) => {
  const res = await post(body);
  expect(res.status).toBe(400);
  expect(mockConn.beginTransaction).not.toHaveBeenCalled();
});

test('duplicate ids are counted once', async () => {
  await post({ student_ids: [1, 1, 2] });
  expect(mockConn.query.mock.calls[0][1]).toEqual([1, 2, 'S1']);
});
