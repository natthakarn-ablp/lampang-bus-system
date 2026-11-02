'use strict';
require('./loadTestEnv');
jest.mock('../src/middleware/auth', () => ({ authenticate: (req, _res, next) => {
  req.user = { id: 7, role: 'school', scopeId: 'SCH1', gradeScope: req.headers['x-full-school'] ? null : 'ป.5' };
  next();
} }));
const mockQuery = jest.fn();
jest.mock('../src/config/database', () => ({ pool: { query: (...args) => mockQuery(...args) } }));
const express = require('express');
const request = require('supertest');
const app = express();
app.use('/api/school', require('../src/routes/school.routes'));
app.use(require('../src/middleware/errorHandler'));

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockImplementation(async sql => {
    if (sql.includes('SELECT DISTINCT classroom')) return [[{ classroom: '2' }, { classroom: '1' }]];
    if (sql.includes('COUNT(*)')) return [[{ total: 1 }]];
    return [[{ id: 12, classroom: '2', grade: 'ป. 5' }]];
  });
});

test('classroom options are selected only from the school and canonical grade equivalents', async () => {
  const res = await request(app).get('/api/school/students/classrooms');
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual(['1', '2']);
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toMatch(/school_id = \?.*is_deleted = FALSE.*grade IN/s);
  expect(params[0]).toBe('SCH1');
  expect(params).toContain('ป.5');
  expect(params).not.toContain('ป.6');
});

test('room filter combines with the teacher grade scope in both count and page SQL', async () => {
  const res = await request(app).get('/api/school/students?grade=ป.6&classroom=2');
  expect(res.status).toBe(200);
  expect(mockQuery).toHaveBeenCalledTimes(2);
  for (const [sql, params] of mockQuery.mock.calls) {
    expect(sql).toMatch(/school_id = \?.*grade IN.*s\.classroom = \?/s);
    expect(params[0]).toBe('SCH1');
    expect(params).toContain('ป.5');
    expect(params).not.toContain('ป.6');
    expect(params).toContain('2');
  }
});

test('malformed room query is rejected before database access', async () => {
  const res = await request(app).get('/api/school/students?classroom[]=2');
  expect(res.status).toBe(400);
  expect(mockQuery).not.toHaveBeenCalled();
});

test('classroom options endpoint is limited to grade teachers', async () => {
  const res = await request(app).get('/api/school/students/classrooms').set('x-full-school', '1');
  expect(res.status).toBe(403);
  expect(mockQuery).not.toHaveBeenCalled();
});
