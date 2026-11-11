'use strict';
// P4-FIX-001: SB-A2-01 (pickup-students vehicle_id validation) and
// SB-B1-04 (process-notifications fails closed outside development/test).
const http = require('http');
const express = require('express');

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 1, role: 'school', scopeId: 'S1' }; next(); },
}));
jest.mock('../src/services/pickupPoint.service', () => ({
  getStudentsForSchoolAndVehicle: jest.fn(async () => [{ id: 1 }]),
}));
jest.mock('../src/services/line.service', () => ({
  processUnsentNotifications: jest.fn(async () => ({ sent: 0 })),
}));

const env = require('../src/config/env');
const ppSvc = require('../src/services/pickupPoint.service');
const lineSvc = require('../src/services/line.service');
const schoolRouter = require('../src/routes/school.routes');
const lineRouter = require('../src/routes/line.routes');

function call(router, method, url, headers = {}) {
  const app = express();
  app.use(router);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const req = http.request({ port: server.address().port, method, path: url, headers }, (res) => {
        let b = '';
        res.on('data', (c) => { b += c; });
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }); });
      });
      req.on('error', (e) => { server.close(); reject(e); });
      req.end();
    });
  });
}

describe('GET /pickup-students vehicle_id validation (SB-A2-01)', () => {
  beforeEach(() => ppSvc.getStudentsForSchoolAndVehicle.mockClear());

  test.each([
    ['object', '?vehicle_id[a]=1'],
    ['object operator', '?vehicle_id[$ne]=1'],
    ['array', '?vehicle_id=1&vehicle_id=2'],
    ['spaces/operators', '?vehicle_id=1%20OR%201=1'],
    ['quote', "?vehicle_id=V-1'"],
    ['decimal point', '?vehicle_id=1.5'],
    ['too long', '?vehicle_id=' + 'V'.repeat(21)],
  ])('%s -> 400, service not called', async (_n, qs) => {
    const r = await call(schoolRouter, 'GET', '/pickup-students' + qs);
    expect(r.status).toBe(400);
    expect(r.body.success).toBe(false);
    expect(ppSvc.getStudentsForSchoolAndVehicle).not.toHaveBeenCalled();
  });

  test('missing -> 400', async () => {
    const r = await call(schoolRouter, 'GET', '/pickup-students');
    expect(r.status).toBe(400);
  });

  test.each(['V-3fa9c0d1e2b4', 'V-ABCDEF012345', '42'])('real vehicle id %p -> 200, passed downstream unchanged', async (id) => {
    const r = await call(schoolRouter, 'GET', '/pickup-students?vehicle_id=' + id);
    expect(r.status).toBe(200);
    expect(ppSvc.getStudentsForSchoolAndVehicle).toHaveBeenCalledTimes(1);
    expect(ppSvc.getStudentsForSchoolAndVehicle.mock.calls[0][1]).toBe(id);
  });
});

describe('POST /process-notifications auth (SB-B1-04)', () => {
  const saved = { k: env.app.cronApiKey, e: env.app.nodeEnv };
  afterAll(() => { env.app.cronApiKey = saved.k; env.app.nodeEnv = saved.e; });
  beforeEach(() => lineSvc.processUnsentNotifications.mockClear());

  test.each(['production', 'staging', 'prod', ''])('no key + nodeEnv=%p -> 503', async (ne) => {
    env.app.cronApiKey = ''; env.app.nodeEnv = ne;
    const r = await call(lineRouter, 'POST', '/process-notifications');
    expect(r.status).toBe(503);
    expect(lineSvc.processUnsentNotifications).not.toHaveBeenCalled();
  });

  test.each(['development', 'test'])('no key + nodeEnv=%s -> passes', async (ne) => {
    env.app.cronApiKey = ''; env.app.nodeEnv = ne;
    const r = await call(lineRouter, 'POST', '/process-notifications');
    expect(r.status).toBe(200);
    expect(lineSvc.processUnsentNotifications).toHaveBeenCalledTimes(1);
  });

  test('key set + wrong key -> 401', async () => {
    env.app.cronApiKey = 'right-key-value'; env.app.nodeEnv = 'production';
    const r = await call(lineRouter, 'POST', '/process-notifications', { 'x-api-key': 'wrong' });
    expect(r.status).toBe(401);
    expect(lineSvc.processUnsentNotifications).not.toHaveBeenCalled();
  });

  test('key set + right key -> passes', async () => {
    env.app.cronApiKey = 'right-key-value'; env.app.nodeEnv = 'production';
    const r = await call(lineRouter, 'POST', '/process-notifications', { 'x-api-key': 'right-key-value' });
    expect(r.status).toBe(200);
  });
});
