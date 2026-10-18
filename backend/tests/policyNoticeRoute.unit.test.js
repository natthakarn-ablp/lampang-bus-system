'use strict';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 17, role: 'transport', scopeType: 'PROVINCE', scopeId: 'LPG' };
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

describe('unapproved policy notices', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns no draft content and does not query the ledger', async () => {
    const response = await request(app).get('/api/policy-notices/current');
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ enabled: false, notices: [] });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('refuses to record an acknowledgement before legal approval', async () => {
    const response = await request(app).post('/api/policy-notices/acknowledge')
      .send({ key: 'transport', version: 'draft-20261018' });
    expect(response.status).toBe(404);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
});
