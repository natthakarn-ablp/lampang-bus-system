'use strict';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 7, role: req.headers['x-test-role'] || 'school' };
    next();
  },
}));
jest.mock('../src/services/transport.service', () => ({ getSafetyExportRows: jest.fn() }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn() }));

const express = require('express');
const request = require('supertest');
const service = require('../src/services/transport.service');
const { logAudit } = require('../src/utils/audit');
const errorHandler = require('../src/middleware/errorHandler');

function app() {
  const instance = express();
  instance.use('/api/transport', require('../src/routes/transport.routes'));
  instance.use(errorHandler);
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  service.getSafetyExportRows.mockResolvedValue([{
    plate_no: '=1+1', vehicle_type: 'BUS', latest_inspection_result: 'PASSED',
    owner_phone: 'MUST_NOT_LEAK', student_name: 'MUST_NOT_LEAK', notes: 'MUST_NOT_LEAK',
  }]);
  logAudit.mockResolvedValue();
});

test('school cannot call the dedicated transport export', async () => {
  const response = await request(app()).get('/api/transport/export/vehicles.csv').set('x-test-role', 'school');
  expect(response.status).toBe(403);
  expect(service.getSafetyExportRows).not.toHaveBeenCalled();
});

test('transport receives vehicle-only CSV and an audited export', async () => {
  const response = await request(app()).get('/api/transport/export/vehicles.csv').set('x-test-role', 'transport');
  expect(response.status).toBe(200);
  expect(response.text).toContain('ทะเบียนรถ');
  expect(response.text).toContain("\"'=1+1\"");
  expect(response.text).not.toContain('MUST_NOT_LEAK');
  expect(response.headers['cache-control']).toBe('no-store');
  expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
    userId: 7, action: 'EXPORT', entityType: 'transport_safety_report', required: true,
  }));
});

test('audit failure prevents release of the CSV', async () => {
  logAudit.mockRejectedValueOnce(new Error('audit unavailable'));
  const response = await request(app()).get('/api/transport/export/vehicles.csv').set('x-test-role', 'transport');
  expect(response.status).toBe(500);
  expect(response.text).not.toContain('ทะเบียนรถ');
});
