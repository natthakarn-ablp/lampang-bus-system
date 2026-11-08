'use strict';

// SCH-ATT-3 / SCH-ATT-8 (school audit 2026-11-08): bad input on school leave and
// list endpoints is a 400 with a Thai message, never a DB error (500).
let mockUser;
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/config/database', () => {
  const q = async () => { throw Object.assign(new Error('DB must not be reached'), { code: 'ER_TEST' }); };
  return { pool: { query: q, getConnection: async () => ({ query: q, beginTransaction: async () => {}, rollback: async () => {}, release: () => {} }) } };
});

const express = require('express');
const request = require('supertest');
const app = express();
app.use(express.json());
app.use('/api/school', require('../src/routes/school.routes'));
app.use(require('../src/middleware/errorHandler'));

beforeEach(() => { mockUser = { id: 7, role: 'school', scopeId: 'SCH1', gradeScope: null }; });

test('POST /leave: unknown session → 400', async () => {
  const res = await request(app).post('/api/school/leave').send({ student_id: 1, session: 'x' });
  expect(res.status).toBe(400);
});

test('POST /leave: reason over 255 characters → 400', async () => {
  const res = await request(app).post('/api/school/leave').send({ student_id: 1, session: 'morning', reason: 'ก'.repeat(256) });
  expect(res.status).toBe(400);
});

test('GET /no-show: impossible or future date → 400', async () => {
  expect((await request(app).get('/api/school/no-show?date=2026-13-45')).status).toBe(400);
  expect((await request(app).get('/api/school/no-show?date=2999-01-01')).status).toBe(400);
});

test('GET /leaves: impossible date → 400', async () => {
  expect((await request(app).get('/api/school/leaves?date=2026-02-31')).status).toBe(400);
});
