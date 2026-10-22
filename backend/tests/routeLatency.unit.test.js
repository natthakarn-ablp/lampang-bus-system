'use strict';

const { EventEmitter } = require('events');
const { routeLatencyMiddleware, snapshot } = require('../src/services/routeLatency.service');

function serve(request, statusCode) {
  const response = new EventEmitter();
  response.statusCode = statusCode;
  response.writableEnded = true;
  const next = jest.fn();
  routeLatencyMiddleware(request, response, next);
  expect(next).toHaveBeenCalledTimes(1);
  response.emit('finish');
  response.emit('close'); // a normal close must not double-count
}

describe('privacy-safe route latency aggregation', () => {
  test('stores only a registered template and an allowlisted role', () => {
    const secret = 'CHILD_ID_987654321';
    serve({
      path: `/api/school/students/${secret}`,
      originalUrl: `/api/school/students/${secret}?token=SECRET_VALUE`,
      route: { path: '/students/:studentId' },
      method: 'GET',
      user: { role: 'school', id: 991 },
    }, 200);
    const report = snapshot();
    const item = report.routes.find((entry) => entry.route === '/api/school/students/:studentId');
    expect(item).toMatchObject({ role: 'school', method: 'GET', count: 1, status_2xx: 1 });
    expect(item.histogram.reduce((a, b) => a + b, 0)).toBe(1);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('SECRET_VALUE');
    expect(serialized).not.toContain('"id":991');
  });

  test('pre-auth 429 and unknown route shapes never use the actual URL', () => {
    const secret = 'PARENT_TOKEN_2468';
    serve({
      path: `/api/admin/invalid/${secret}`,
      originalUrl: `/api/admin/invalid/${secret}`,
      method: 'POST',
    }, 429);
    const report = snapshot();
    const item = report.routes.find((entry) => entry.route === '/api/admin/_unclassified');
    expect(item).toMatchObject({ role: 'unattributed', status_429: 1, status_4xx: 1 });
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  test('ignores parent, LINE and non-API URLs entirely', () => {
    const before = snapshot().routes.reduce((count, entry) => count + entry.count, 0);
    for (const path of ['/api/parent/status/1', '/api/line/webhook', '/student/1']) {
      serve({ path, method: 'GET', route: { path: '/:id' } }, 200);
    }
    const after = snapshot().routes.reduce((count, entry) => count + entry.count, 0);
    expect(after).toBe(before);
  });

  test('counts an aborted request without presenting it as served latency', () => {
    const response = new EventEmitter();
    response.writableEnded = false;
    const req = { path: '/api/transport/vehicles/9', method: 'GET', route: { path: '/vehicles/:id' }, user: { role: 'transport' } };
    routeLatencyMiddleware(req, response, () => {});
    response.emit('close');
    const item = snapshot().routes.find((entry) => entry.route === '/api/transport/vehicles/:id');
    expect(item).toMatchObject({ count: 1, aborted: 1 });
    expect(item.histogram.reduce((a, b) => a + b, 0)).toBe(0);
  });

  test('the aggregate endpoint rejects unauthenticated access', async () => {
    const request = require('supertest');
    const app = require('../src/app');
    const response = await request(app).get('/api/admin/operations/route-latency');
    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body)).not.toContain('histogram_upper_ms');
  });

  test('reads an Express-mounted route template after a real response', async () => {
    const express = require('express');
    const request = require('supertest');
    const app = express();
    const router = express.Router();
    app.use(routeLatencyMiddleware);
    router.get('/students/:studentId', (req, res) => {
      req.user = { role: 'school' };
      res.json({ ok: true });
    });
    app.use('/api/school', router);
    await request(app).get('/api/school/students/SECRET_CHILD_123').expect(200);
    const report = snapshot();
    const item = report.routes.find((entry) => entry.route === '/api/school/students/:studentId');
    expect(item).toMatchObject({ role: 'school', status_2xx: 1 });
    expect(JSON.stringify(report)).not.toContain('SECRET_CHILD_123');
  });
});
