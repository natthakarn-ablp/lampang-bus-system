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

describe('unapproved policy notices after the meeting pilot', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each(['school', 'driver', 'transport', 'affiliation', 'province', 'admin'])(
    'hides the draft and action dialog for %s without querying the ledger', async (role) => {
      const [current, action, catalog] = await Promise.all([
        request(app).get('/api/policy-notices/current').set('X-Test-Role', role),
        request(app).get('/api/policy-notices/action/report.export').set('X-Test-Role', role),
        request(app).get('/api/policy-notices/catalog').set('X-Test-Role', role),
      ]);
      expect(current.status).toBe(200);
      expect(current.body.data).toEqual({ enabled: false, reviewMode: false, notices: [] });
      expect(action.status).toBe(200);
      expect(action.body.data).toEqual({ enabled: false, reviewMode: false, action: null });
      expect(catalog.status).toBe(200);
      expect(catalog.body.data).toEqual({ enabled: false, reviewMode: false, policies: [] });
      expect(pool.query).not.toHaveBeenCalled();
    }
  );

  test('refuses to record an acknowledgement before legal approval', async () => {
    const response = await request(app).post('/api/policy-notices/acknowledge')
      .send({ key: 'transport', version: 'meeting-pilot-20261021' });
    expect(response.status).toBe(404);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  test('does not create or consume legal evidence for a browser PDF while disabled', async () => {
    const response = await request(app).post('/api/policy-notices/consume-client-action')
      .set('X-Test-Role', 'admin').send({
        context: 'report.export', subject_type: 'report_export',
        subject_id: 'daily:2026-10-18:pdf',
      });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ consumed: false, reviewMode: false });
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
});
