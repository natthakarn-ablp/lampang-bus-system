'use strict';

jest.mock('../src/middleware/auth', () => ({ authenticate: (req, res, next) => {
  if (!req.headers['x-test-role']) return res.status(401).json({ success: false });
  req.user = { id: 7, role: req.headers['x-test-role'] };
  return next();
} }));
jest.mock('../src/services/transportIncident.service', () => ({ getIncidentVehicle: jest.fn() }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn() }));
const express = require('express');
const request = require('supertest');
const service = require('../src/services/transportIncident.service');
const { logAudit } = require('../src/utils/audit');
const app = express();
app.use('/api/transport', require('../src/routes/transport.routes'));
app.use(require('../src/middleware/errorHandler'));
const url = '/api/transport/vehicles/V-unit21/incident-roster?date=2026-10-21&session=evening';
beforeEach(() => {
  jest.clearAllMocks();
  service.getIncidentVehicle.mockResolvedValue({ date: '2026-10-21', session: 'evening',
    current_roster: [{ name: 'SYNTHETIC_PUPIL' }], recorded_events: [] });
  logAudit.mockResolvedValue();
});
test.each([undefined, 'school', 'driver', 'affiliation', 'province'])('deny unauthenticated/wrong role %s', async role => {
  const call = request(app).get(url);
  if (role) call.set('x-test-role', role);
  const response = await call;
  expect(response.status).toBe(role ? 403 : 401);
  expect(service.getIncidentVehicle).not.toHaveBeenCalled();
  expect(response.text).not.toContain('SYNTHETIC_PUPIL');
});
test.each(['transport', 'admin'])('allow %s only after required audit', async role => {
  const response = await request(app).get(url).set('x-test-role', role);
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toContain('no-store');
  expect(service.getIncidentVehicle).toHaveBeenCalledWith({ vehicleId: 'V-unit21', date: '2026-10-21', session: 'evening', role });
  expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
    userId: 7, action: 'VIEW', entityType: 'transport_incident_roster', required: true,
    newValue: { date: '2026-10-21', session: 'evening', roster_count: 1, event_count: 0 },
  }));
  expect(JSON.stringify(logAudit.mock.calls)).not.toContain('SYNTHETIC_PUPIL');
});
test('audit failure releases no pupil names', async () => {
  logAudit.mockRejectedValueOnce(new Error('unavailable'));
  const response = await request(app).get(url).set('x-test-role', 'transport');
  expect(response.status).toBe(500);
  expect(response.text).not.toContain('SYNTHETIC_PUPIL');
});
test('no POST or export variant is enabled', async () => {
  const response = await request(app).post(url).set('x-test-role', 'transport');
  expect(response.status).toBe(404);
  expect(service.getIncidentVehicle).not.toHaveBeenCalled();
});
