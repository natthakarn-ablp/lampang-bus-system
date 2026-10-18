'use strict';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: 17, role: req.get('X-Test-Role') || 'transport',
      scopeType: 'PROVINCE', scopeId: 'LPG',
    };
    next();
  },
}));
jest.mock('../src/config/database', () => ({
  pool: { query: jest.fn(), getConnection: jest.fn() },
}));

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/database');
const router = require('../src/routes/policyNotice.routes');

const app = express();
app.use(express.json());
app.use('/api/policy-notices', router);

describe('unapproved policy notices in explicit review mode', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns labelled role-scoped draft content without querying the ledger', async () => {
    const response = await request(app).get('/api/policy-notices/current');
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.objectContaining({
      enabled: true, reviewMode: true,
      notices: expect.arrayContaining([expect.objectContaining({ key: 'transport', acknowledged: false })]),
    }));
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('refuses to record an acknowledgement before legal approval', async () => {
    const response = await request(app).post('/api/policy-notices/acknowledge')
      .send({ key: 'transport', version: 'meeting-pilot-20261021' });
    expect(response.status).toBe(404);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  test('exposes action and catalog drafts only as review mode', async () => {
    const [action, catalog] = await Promise.all([
      request(app).get('/api/policy-notices/action/transport.vehicle_export'),
      request(app).get('/api/policy-notices/catalog'),
    ]);
    expect(action.body.data).toEqual(expect.objectContaining({
      enabled: true, reviewMode: true,
      action: expect.objectContaining({ context: 'transport.vehicle_export', kind: 'warning' }),
    }));
    expect(catalog.body.data).toEqual(expect.objectContaining({
      enabled: true, reviewMode: true,
      policies: expect.arrayContaining([expect.objectContaining({ key: 'transport' })]),
    }));
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('does not create or consume legal evidence for a browser PDF in review mode', async () => {
    const response = await request(app).post('/api/policy-notices/consume-client-action')
      .set('X-Test-Role', 'admin').send({
        context: 'report.export', subject_type: 'report_export',
        subject_id: 'daily:2026-10-18:pdf',
      });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ consumed: false, reviewMode: true });
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
});
