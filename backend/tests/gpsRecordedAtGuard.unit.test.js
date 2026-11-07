'use strict';

/**
 * Audit time-03 — POST /api/driver/vehicle-location must apply the same
 * recorded_at guard as the batch endpoint (not > 2 min in the future, not older
 * than the history retention), otherwise a wrong-clock phone writes a future
 * timestamp into the LIVE row. DB-free: the service layer is mocked.
 */

require('./loadTestEnv');

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 1, role: 'driver' }; next(); },
}));
jest.mock('../src/config/database', () => ({
  pool: { query: jest.fn().mockResolvedValue([[]]), getConnection: jest.fn() },
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));
jest.mock('../src/utils/gpsTrackingWindow', () => ({
  isWithinTrackingWindow: () => true,
  configuredWindows: () => [],
  trackingInfo: () => ({}),
}));
jest.mock('../src/services/safetyPolicy.service', () => ({
  ...jest.requireActual('../src/services/safetyPolicy.service'),
  assessDriverOperation: jest.fn().mockResolvedValue({ decision: 'ALLOW', audit_required: false }),
}));
jest.mock('../src/services/checkin.service', () => ({
  ...jest.requireActual('../src/services/checkin.service'),
  getDriverVehicle: jest.fn().mockResolvedValue({ vehicle_id: 'V-A', plate_no: 'x', driver_id: 5 }),
}));
jest.mock('../src/services/vehicleLocation.service', () => ({
  getActiveDriverIdForVehicle: jest.fn().mockResolvedValue(5),
  upsertLocation: jest.fn().mockResolvedValue(),
}));

const express = require('express');
const request = require('supertest');
const vllSvc = require('../src/services/vehicleLocation.service');

const app = express();
app.use(express.json());
app.use('/api/driver', require('../src/routes/driver.routes'));
app.use(require('../src/middleware/errorHandler'));

const post = (recorded_at) => request(app)
  .post('/api/driver/vehicle-location')
  .send({ latitude: 18.29, longitude: 99.49, ...(recorded_at ? { recorded_at } : {}) });

beforeEach(() => vllSvc.upsertLocation.mockClear());

test('fix dated 3 days in the future is rejected and not stored as live position', async () => {
  const res = await post(new Date(Date.now() + 3 * 86400000).toISOString());
  expect(res.status).toBe(400);
  expect(vllSvc.upsertLocation).not.toHaveBeenCalled();
});

test('fix older than the history retention is rejected', async () => {
  const res = await post(new Date(Date.now() - 400 * 86400000).toISOString());
  expect(res.status).toBe(400);
  expect(vllSvc.upsertLocation).not.toHaveBeenCalled();
});

test('fix within 2 minutes of clock skew and fix without recorded_at are accepted', async () => {
  expect((await post(new Date(Date.now() + 60 * 1000).toISOString())).status).toBe(200);
  expect((await post()).status).toBe(200);
  expect(vllSvc.upsertLocation).toHaveBeenCalledTimes(2);
});
