'use strict';

// AUD-SCH-01: a pickup point that holds only ANOTHER school's pupils must not
// be readable (label / lat / lng / notes) or editable by id through a school
// account that merely shares the vehicle.
require('./loadTestEnv');
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 1, role: 'school', scopeId: 'SCH1', gradeScope: null };
    next();
  },
}));
const mockQuery = jest.fn();
jest.mock('../src/config/database', () => ({ pool: { query: (...a) => mockQuery(...a), getConnection: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));

const express = require('express');
const request = require('supertest');
const app = express();
app.use(express.json());
app.use('/api/school', require('../src/routes/school.routes'));
app.use(require('../src/middleware/errorHandler'));

const POINT = { id: 5, vehicle_id: 'V-1', sequence: 1, label: 'OTHER-SCHOOL-HOME', latitude: 18.29, longitude: 99.49, session: 'both', notes: 'secret note' };

// Fake DB: SCH1 has a pupil on vehicle V-1, but point 5 holds only SCH2 pupils.
function fakeDb(ownOnPoint, otherOnPoint) {
  mockQuery.mockImplementation(async (sql, params) => {
    const s = String(sql);
    if (/FROM pickup_points/.test(s) && /WHERE/.test(s) && !/student_pickup_points/.test(s)) return [[POINT]];
    if (/COUNT\(\*\)/.test(s) && /<>/.test(s)) return [[{ n: otherOnPoint }]];
    if (/COUNT\(\*\)/.test(s)) return [[{ n: ownOnPoint }]];
    if (/SELECT 1 FROM students/.test(s)) return [[{ 1: 1 }]];
    return [[]];
  });
}

beforeEach(() => mockQuery.mockReset());

test('assignable-students does not reveal a point holding only another school pupils', async () => {
  fakeDb(0, 2);
  const res = await request(app).get('/api/school/pickup-points/5/assignable-students');
  expect(JSON.stringify(res.body)).not.toContain('OTHER-SCHOOL-HOME');
  expect(res.status).toBe(404);
});

test('PUT students cannot edit a point holding only another school pupils', async () => {
  fakeDb(0, 2);
  const res = await request(app).put('/api/school/pickup-points/5/students').send({ student_ids: [] });
  expect(res.status).toBe(404);
  expect(mockQuery.mock.calls.some(c => /DELETE|INSERT|UPDATE/.test(String(c[0])))).toBe(false);
});

test('a shared point holding own pupils stays readable', async () => {
  fakeDb(1, 2);
  const res = await request(app).get('/api/school/pickup-points/5/assignable-students');
  expect(res.status).toBe(200);
  expect(res.body.data.point.label).toBe('OTHER-SCHOOL-HOME');
});

test('an empty point on a vehicle serving the school stays readable', async () => {
  fakeDb(0, 0);
  const res = await request(app).get('/api/school/pickup-points/5/assignable-students');
  expect(res.status).toBe(200);
});
