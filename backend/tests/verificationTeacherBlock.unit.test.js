'use strict';
require('./loadTestEnv');
jest.mock('../src/middleware/auth', () => ({ authenticate: (req, _res, next) => {
  req.user = { id: 7, role: req.headers['x-role'] || 'school', scopeId: 'SCH1',
    ...(req.headers['x-grade'] ? { [req.headers['x-snake'] ? 'grade_scope' : 'gradeScope']: 'ป.5' } : {}) };
  next();
} }));
const mockPool = { query: jest.fn().mockResolvedValue([[]]), getConnection: jest.fn() };
jest.mock('../src/config/database', () => ({ pool: mockPool }));
const mockVerification = {
  listSchoolApplications: jest.fn().mockResolvedValue([]),
  getApplication: jest.fn().mockResolvedValue({ id: 1 }),
  createApplication: jest.fn().mockResolvedValue({ id: 1 }),
  markReadyToPrint: jest.fn(), cancelApplication: jest.fn(), reviewApplication: jest.fn(),
};
jest.mock('../src/services/vehicleVerification.service', () => mockVerification);
jest.mock('../src/services/driverShift.service', () => ({}));
jest.mock('../src/services/driverDocuments.service', () => ({}));
const express = require('express');
const request = require('supertest');
const app = express();
app.use(express.json());
app.use('/api/verification', require('../src/routes/verification.routes'));
app.use(require('../src/middleware/errorHandler'));
beforeEach(() => jest.clearAllMocks());

test.each([
  ['get', '/school/applications'], ['get', '/applications/1'], ['get', '/applications/1/timeline'],
  ['post', '/school/applications'], ['post', '/applications/1/ready'],
  ['post', '/applications/1/cancel'], ['post', '/applications/1/review'],
])('grade teacher cannot %s %s before any DB or service call', async (method, path) => {
  const res = await request(app)[method]('/api/verification' + path).set('x-grade', '1').send({ vehicle_id: 'V1' });
  expect(res.status).toBe(403);
  expect(res.body.errors[0].code).toBe('FULL_SCHOOL_SCOPE_REQUIRED');
  expect(mockPool.query).not.toHaveBeenCalled();
  expect(mockPool.getConnection).not.toHaveBeenCalled();
  for (const method of Object.values(mockVerification)) expect(method).not.toHaveBeenCalled();
});

test('snake-case grade scope is denied too', async () => {
  const res = await request(app).get('/api/verification/applications/1').set({ 'x-grade': '1', 'x-snake': '1' });
  expect(res.status).toBe(403);
  expect(mockVerification.getApplication).not.toHaveBeenCalled();
});

test('full-school account can list, read and create applications', async () => {
  expect((await request(app).get('/api/verification/school/applications')).status).toBe(200);
  expect((await request(app).get('/api/verification/applications/1')).status).toBe(200);
  expect((await request(app).post('/api/verification/school/applications').send({ vehicle_id: 'V1' })).status).toBe(201);
  expect(mockVerification.listSchoolApplications).toHaveBeenCalledWith(mockPool, { schoolId: 'SCH1', status: null });
  expect(mockVerification.createApplication).toHaveBeenCalledWith(mockPool, expect.objectContaining({ issuingSchoolId: 'SCH1', vehicleId: 'V1' }));
});

test.each(['transport', 'province', 'admin'])('%s application read remains available', async role => {
  const res = await request(app).get('/api/verification/applications/1').set('x-role', role);
  expect(res.status).toBe(200);
  expect(mockVerification.getApplication).toHaveBeenCalled();
});
