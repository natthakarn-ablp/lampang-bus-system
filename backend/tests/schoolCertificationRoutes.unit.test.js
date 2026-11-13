'use strict';

/**
 * /api/certification route gating (FEATURE_SCHOOL_CERTIFICATION) — DB-free.
 * Flag off → 404 before auth; grade teachers 403; school-only writes refuse
 * other roles; appointment confirm is transport/admin only; scope comes from
 * the token, never the body.
 */

require('./loadTestEnv');
jest.mock('../src/middleware/auth', () => ({ authenticate: (req, _res, next) => {
  req.user = { id: 7, role: req.headers['x-role'] || 'school', scopeId: req.headers['x-scope'] || 'SCH1',
    ...(req.headers['x-grade'] ? { gradeScope: 'ป.5' } : {}) };
  next();
} }));
const mockPool = { query: jest.fn().mockResolvedValue([[]]), getConnection: jest.fn() };
jest.mock('../src/config/database', () => ({ pool: mockPool }));
jest.mock('../src/services/schoolCertification.service', () => {
  const env = require('../src/config/env');
  return {
    enabled: () => env.features.schoolCertification === true,
    getWindowSummary: jest.fn().mockResolvedValue({ window_state: 'NOT_SET' }),
    setWindow: jest.fn().mockResolvedValue({}),
    getDocumentChecklist: jest.fn().mockResolvedValue({ items: [] }),
    issueCertificate: jest.fn().mockResolvedValue({ created: true, certificate: { id: 1 } }),
    listSchoolCertificates: jest.fn().mockResolvedValue([]),
    revokeCertificate: jest.fn().mockResolvedValue({ revoked: true }),
    listAppointments: jest.fn().mockResolvedValue([]),
    createAppointment: jest.fn().mockResolvedValue({ id: 1 }),
    cancelAppointment: jest.fn().mockResolvedValue({}),
    confirmAppointment: jest.fn().mockResolvedValue({ status: 'CONFIRMED' }),
    markAppointmentDone: jest.fn().mockResolvedValue({}),
    getCaretaker: jest.fn().mockResolvedValue(null),
    setCaretaker: jest.fn().mockResolvedValue({}),
    listVehicleCertificates: jest.fn().mockResolvedValue([]),
    getCertificateForViewer: jest.fn(),
  };
});
jest.mock('../src/services/checkin.service', () => ({ getDriverVehicle: jest.fn().mockResolvedValue({ vehicle_id: 'V1' }) }));

const express = require('express');
const request = require('supertest');
const env = require('../src/config/env');
const svc = require('../src/services/schoolCertification.service');

const app = express();
app.use(express.json());
app.use('/api/certification', require('../src/routes/certification.routes'));
app.use(require('../src/middleware/errorHandler'));

beforeEach(() => { jest.clearAllMocks(); env.features.schoolCertification = true; });
afterAll(() => { env.features.schoolCertification = false; });

test('flag off: every path is 404 and no service is called', async () => {
  env.features.schoolCertification = false;
  for (const [m, p] of [['get', '/school/window'], ['post', '/school/certificates/1/revoke'],
    ['post', '/transport/appointments/1/confirm'], ['put', '/driver/caretaker']]) {
    const res = await request(app)[m](`/api/certification${p}`).send({});
    expect(res.status).toBe(404);
  }
  expect(svc.getWindowSummary).not.toHaveBeenCalled();
  expect(svc.revokeCertificate).not.toHaveBeenCalled();
});

test('grade teacher (sub-account) is refused', async () => {
  const res = await request(app).post('/api/certification/school/applications/5/certificate').set('x-grade', '1');
  expect(res.status).toBe(403);
  expect(res.body.errors[0].code).toBe('FULL_SCHOOL_SCOPE_REQUIRED');
  expect(svc.issueCertificate).not.toHaveBeenCalled();
});

test('school issue/revoke use the token school, not the body', async () => {
  await request(app).post('/api/certification/school/applications/5/certificate').send({ school_id: 'OTHER' });
  expect(svc.issueCertificate).toHaveBeenCalledWith(mockPool, { applicationId: 5, schoolId: 'SCH1', userId: 7 });
  await request(app).post('/api/certification/school/certificates/3/revoke').send({ reason: 'ไม่ผ่านเกณฑ์', school_id: 'OTHER' });
  expect(svc.revokeCertificate).toHaveBeenCalledWith(mockPool, expect.objectContaining({ certificateId: 3, schoolId: 'SCH1' }));
});

test.each(['transport', 'driver', 'affiliation', 'province'])('%s cannot issue or revoke', async (role) => {
  expect((await request(app).post('/api/certification/school/applications/5/certificate').set('x-role', role)).status).toBe(403);
  expect((await request(app).post('/api/certification/school/certificates/3/revoke').set('x-role', role).send({ reason: 'xxxxxx' })).status).toBe(403);
});

test.each(['school', 'driver', 'affiliation', 'province'])('%s cannot confirm an appointment', async (role) => {
  const res = await request(app).post('/api/certification/transport/appointments/1/confirm')
    .set('x-role', role).send({ confirmed_date: '2099-01-01' });
  expect(res.status).toBe(403);
  expect(svc.confirmAppointment).not.toHaveBeenCalled();
});

test('transport confirms with a date', async () => {
  const res = await request(app).post('/api/certification/transport/appointments/1/confirm')
    .set('x-role', 'transport').send({ confirmed_date: '2099-01-01' });
  expect(res.status).toBe(200);
  expect(svc.confirmAppointment).toHaveBeenCalledWith(mockPool, { appointmentId: 1, userId: 7, confirmedDate: '2099-01-01' });
});

test('driver sets caretaker for the vehicle resolved from the token', async () => {
  const res = await request(app).put('/api/certification/driver/caretaker').set('x-role', 'driver')
    .send({ name: 'นางดูแล', phone: '0811111111', vehicle_id: 'OTHER' });
  expect(res.status).toBe(200);
  expect(svc.setCaretaker).toHaveBeenCalledWith(mockPool, expect.objectContaining({ vehicleId: 'V1' }));
});

test('certificate PDF scope errors surface as 404', async () => {
  const err = new Error('ไม่พบหนังสือรับรอง'); err.statusCode = 404;
  svc.getCertificateForViewer.mockRejectedValueOnce(err);
  const res = await request(app).get('/api/certification/certificates/9/pdf').set('x-role', 'school');
  expect(res.status).toBe(404);
});
