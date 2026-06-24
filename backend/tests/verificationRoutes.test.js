'use strict';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: 7,
      role: req.headers['x-test-role'] || 'school',
      scopeId: req.headers['x-test-scope'] || 'S1',
      gradeScope: req.headers['x-test-grade'] || null,
    };
    next();
  },
}));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/services/vehicleVerification.service', () => ({
  createApplication: jest.fn(),
  listSchoolApplications: jest.fn(),
  getApplication: jest.fn(),
  markReadyToPrint: jest.fn(),
  cancelApplication: jest.fn(),
  listTransportQueue: jest.fn(),
  listChecklistTemplates: jest.fn(),
  startInspection: jest.fn(),
  finalizeInspection: jest.fn(),
}));
jest.mock('../src/services/driverShift.service', () => ({
  listDrivers: jest.fn(),
  authorizeDriverForVehicle: jest.fn(),
  verifyDriverQualification: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const service = require('../src/services/vehicleVerification.service');
const driverService = require('../src/services/driverShift.service');
const errorHandler = require('../src/middleware/errorHandler');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/verification', require('../src/routes/verification.routes'));
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  service.createApplication.mockResolvedValue({ id: 77, status: 'DRAFT' });
  service.listSchoolApplications.mockResolvedValue([{ id: 77, status: 'DRAFT' }]);
  service.getApplication.mockResolvedValue({
    id: 77, plate_no: 'นข 1 ลำปาง', peak_rider_count: 14,
    schools: [{ school_id: 'S1', morning_rider_count: 8, evening_rider_count: 9 }],
    drivers: [{ driver_id: 4, driver_name: 'สมชาย' }],
  });
  service.markReadyToPrint.mockResolvedValue({ id: 77, status: 'READY_TO_PRINT' });
  service.cancelApplication.mockResolvedValue({ id: 77, status: 'CANCELLED' });
  service.listTransportQueue.mockResolvedValue([{ id: 77, plate_no: 'นข 1 ลำปาง', peak_rider_count: 14 }]);
  service.listChecklistTemplates.mockResolvedValue([{ id: 5, version_no: 1, items: [] }]);
  service.startInspection.mockResolvedValue({ attempt_id: 91, status: 'IN_PROGRESS' });
  service.finalizeInspection.mockResolvedValue({ attempt_id: 91, application_status: 'PASSED' });
  driverService.listDrivers.mockResolvedValue([{ id: 4, name: 'สมชาย', authorized_vehicle_count: 2 }]);
  driverService.authorizeDriverForVehicle.mockResolvedValue({ assignment_id: 31, assignment_role: 'BACKUP' });
  driverService.verifyDriverQualification.mockResolvedValue({ qualification_id: 44, status: 'VERIFIED' });
});

test('school application always uses the authenticated school scope', async () => {
  const response = await request(makeApp())
    .post('/api/verification/school/applications')
    .set('x-test-role', 'school')
    .set('x-test-scope', 'S1')
    .send({ vehicle_id: 'V-1', issuing_school_id: 'OTHER' });
  expect(response.status).toBe(201);
  expect(service.createApplication).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    vehicleId: 'V-1', issuingSchoolId: 'S1', userId: 7,
  }));
});

test('grade-scoped teacher cannot create or change a verification request', async () => {
  const response = await request(makeApp())
    .post('/api/verification/school/applications')
    .set('x-test-role', 'school')
    .set('x-test-grade', '4')
    .send({ vehicle_id: 'V-1' });
  expect(response.status).toBe(403);
  expect(response.body.errors[0].code).toBe('FULL_SCHOOL_SCOPE_REQUIRED');
});

test('transport queue is restricted to transport/admin and exposes no student or parent PII', async () => {
  const allowed = await request(makeApp())
    .get('/api/verification/transport/queue')
    .set('x-test-role', 'transport');
  expect(allowed.status).toBe(200);
  expect(JSON.stringify(allowed.body)).not.toMatch(/student_id|student_name|parent|cid_hash/i);

  const denied = await request(makeApp())
    .get('/api/verification/transport/queue')
    .set('x-test-role', 'school');
  expect(denied.status).toBe(403);
});

test('province can read application summary but cannot start an inspection', async () => {
  const detail = await request(makeApp())
    .get('/api/verification/applications/77')
    .set('x-test-role', 'province');
  expect(detail.status).toBe(200);
  expect(service.getApplication).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    viewer: { role: 'province', schoolId: null },
  }));

  const mutation = await request(makeApp())
    .post('/api/verification/transport/applications/77/start')
    .set('x-test-role', 'province')
    .send({});
  expect(mutation.status).toBe(403);
});

test('transport can start and finalize an attempt through standard envelopes', async () => {
  const app = makeApp();
  const started = await request(app)
    .post('/api/verification/transport/applications/77/start')
    .set('x-test-role', 'transport')
    .send({ inspection_date: '2026-06-22' });
  expect(started.status).toBe(201);
  expect(started.body).toMatchObject({ success: true, data: { attempt_id: 91 } });

  const finalized = await request(app)
    .post('/api/verification/transport/attempts/91/finalize')
    .set('x-test-role', 'transport')
    .send({ result: 'PASSED', expiry_date: '2027-06-22', items: [] });
  expect(finalized.status).toBe(200);
  expect(service.finalizeInspection).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    attemptId: 91, inspectorUserId: 7, result: 'PASSED', expiryDate: '2027-06-22',
  }));
});

test('transport can manage driver pool and qualifications while school cannot', async () => {
  const app = makeApp();
  const listed = await request(app).get('/api/verification/transport/drivers').set('x-test-role', 'transport');
  expect(listed.status).toBe(200);

  const assigned = await request(app)
    .post('/api/verification/transport/vehicles/V-1/drivers')
    .set('x-test-role', 'transport')
    .send({ driver_id: 4, assignment_role: 'BACKUP', valid_until: '2027-06-22' });
  expect(assigned.status).toBe(201);
  expect(driverService.authorizeDriverForVehicle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    driverId: 4, vehicleId: 'V-1', assignmentRole: 'BACKUP', userId: 7,
  }));

  const qualified = await request(app)
    .post('/api/verification/transport/drivers/4/qualification')
    .set('x-test-role', 'transport')
    .send({ license_no: 'DLT-001', license_expiry: '2027-06-22' });
  expect(qualified.status).toBe(201);

  const denied = await request(app).get('/api/verification/transport/drivers').set('x-test-role', 'school');
  expect(denied.status).toBe(403);
});
