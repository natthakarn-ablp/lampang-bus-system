'use strict';

// P-04 write part (parent audit 2026-11-08, owner-approved): a full school
// account can cut the LINE binding of a pupil's parent, with a reason,
// audited first; grade teachers and other schools cannot.
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));
jest.mock('../src/services/line.service', () => ({
  unbindLineUser: jest.fn().mockResolvedValue({ success: true }),
  sendTextMessage: jest.fn().mockResolvedValue({ dryRun: true }),
}));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = JSON.parse(decodeURIComponent(req.headers['x-test-user'])); next(); },
}));

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/database');
const { logAudit } = require('../src/utils/audit');
const lineSvc = require('../src/services/line.service');

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/school', require('../src/routes/school.routes'));
  app.use((err, _req, res, _next) => res.status(500).json({ message: err.message }));
});

const SCHOOL = { id: 5, role: 'school', scopeType: 'SCHOOL', scopeId: 'SCH0001', gradeScope: null };
const TEACHER = { ...SCHOOL, id: 6, gradeScope: 'ป.1' };
const post = (user, body = { reason: 'ผูกผิดคน' }) => request(app)
  .post('/api/school/students/101/parent-line/unlink')
  .set('x-test-user', encodeURIComponent(JSON.stringify(user))).send(body);

beforeEach(() => {
  jest.clearAllMocks();
  pool.query.mockImplementation(async (sql, params) => {
    if (/FROM students WHERE id = \? AND school_id = \?/.test(sql)) return [params[1] === 'SCH0001' ? [{ id: 101 }] : []];
    if (/FROM parent_student/.test(sql)) return [[{ line_user_id: 'U_bound', phone: '0811112222' }]];
    return [[]];
  });
});

test('full school account unlinks, audits first, and tells the LINE account', async () => {
  const res = await post(SCHOOL);
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual({ unlinked: 1 });
  expect(lineSvc.unbindLineUser).toHaveBeenCalledWith('U_bound');
  expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'DELETE', entityType: 'line_binding', newValue: { reason: 'ผูกผิดคน' }, required: true,
  }));
  expect(logAudit.mock.invocationCallOrder[0]).toBeLessThan(lineSvc.unbindLineUser.mock.invocationCallOrder[0]);
  expect(JSON.stringify(logAudit.mock.calls[0][0])).not.toContain('0811112222');
  expect(lineSvc.sendTextMessage).toHaveBeenCalledWith('U_bound', expect.any(String));
});

test('grade teacher is refused', async () => {
  expect((await post(TEACHER)).status).toBe(403);
  expect(lineSvc.unbindLineUser).not.toHaveBeenCalled();
});

test('reason is required', async () => {
  expect((await post(SCHOOL, { reason: ' ' })).status).toBe(400);
  expect(lineSvc.unbindLineUser).not.toHaveBeenCalled();
});

test('a pupil of another school is 404', async () => {
  expect((await post({ ...SCHOOL, scopeId: 'SCH0002' })).status).toBe(404);
  expect(lineSvc.unbindLineUser).not.toHaveBeenCalled();
});
