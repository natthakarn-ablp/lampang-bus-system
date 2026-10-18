'use strict';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 27, role: 'transport', scopeType: 'PROVINCE', scopeId: 'LPG' };
    next();
  },
}));
jest.mock('../src/config/policyNotices', () => {
  const actual = jest.requireActual('../src/config/policyNotices');
  return { ...actual, APPROVED: true, VERSION: 'approved-test-v1', noticesForRole: (role) =>
    actual.noticesForRole(role).map((notice) => ({ ...notice, version: 'approved-test-v1' })) };
});
jest.mock('../src/config/database', () => ({
  pool: { query: jest.fn(), getConnection: jest.fn() },
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/database');
const { logAudit } = require('../src/utils/audit');
const router = require('../src/routes/policyNotice.routes');
const app = express();
app.use(express.json());
app.use('/api/policy-notices', router);

describe('approved staff notice boundary', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects forged topic and stale version before any write', async () => {
    for (const body of [
      { key: 'school', version: 'approved-test-v1' },
      { key: 'transport', version: 'draft-20261018' },
    ]) {
      const response = await request(app).post('/api/policy-notices/acknowledge').send(body);
      expect(response.status).toBe(400);
    }
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  test('stores actor, role, scope and audit in one transaction', async () => {
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([{ insertId: 95, affectedRows: 1 }]),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn(),
      release: jest.fn(),
    };
    pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/policy-notices/acknowledge')
      .send({ key: 'transport', version: 'approved-test-v1' });
    expect(response.status).toBe(200);
    expect(conn.query.mock.calls[0][1].slice(0, 6)).toEqual(
      [27, 'transport', 'PROVINCE', 'LPG', 'transport', 'approved-test-v1']
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 27, entityType: 'policy_acknowledgement', entityId: '95', conn, required: true,
    }));
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});
