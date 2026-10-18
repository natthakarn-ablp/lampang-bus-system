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
    actual.noticesForRole(role).map((notice) => ({ ...notice, version: 'approved-test-v1' })),
  actionPolicyForRole: (role, context) => {
    const action = actual.actionPolicyForRole(role, context);
    return action ? { ...action, version: 'approved-test-v1' } : null;
  } };
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
    const parameters = conn.query.mock.calls[0][1];
    expect(parameters[6]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(parameters[7])).toEqual(expect.objectContaining({
      key: 'transport', version: 'approved-test-v1', kind: 'notice',
    }));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 27, entityType: 'policy_acknowledgement', entityId: '95', conn, required: true,
    }));
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  test('prepares a one-use action token bound to actor, context and subject', async () => {
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([{ insertId: 117, affectedRows: 1 }]),
      commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn(), release: jest.fn(),
    };
    pool.getConnection.mockResolvedValue(conn);
    const response = await request(app).post('/api/policy-notices/prepare-action').send({
      context: 'transport.vehicle_export',
      subject_type: 'transport_safety_report', subject_id: 'vehicles',
      claim: { contains_students: false, contains_phone_numbers: false, report: 'vehicle_safety', student_name: 'must-not-persist' },
    });
    expect(response.status).toBe(200);
    expect(response.body.data.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const parameters = conn.query.mock.calls[0][1];
    expect(parameters.slice(0, 10)).toEqual([
      27, 'transport', 'PROVINCE', 'LPG', 'transport.vehicle_export', 'warning',
      'transport_safety_report', 'vehicles', 'transport_export', 'approved-test-v1',
    ]);
    expect(parameters[13]).toMatch(/^[a-f0-9]{64}$/);
    expect(parameters[13]).not.toBe(response.body.data.token);
    expect(JSON.parse(parameters[12])).toEqual({
      report: 'vehicle_safety', contains_students: false, contains_phone_numbers: false,
    });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'policy_action_evidence', entityId: '117', required: true, conn,
    }));
  });

  test('rejects a forged action context and mismatched subject before writing', async () => {
    for (const body of [
      { context: 'school.student_import_apply', subject_type: 'import_batch', subject_id: '1', claim: { rows: 2 } },
      { context: 'transport.vehicle_export', subject_type: 'student', subject_id: '1', claim: { rows: 2 } },
    ]) {
      const response = await request(app).post('/api/policy-notices/prepare-action').send(body);
      expect([400, 403]).toContain(response.status);
    }
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  test('does not create evidence for a vehicle outside the current data set', async () => {
    pool.query.mockResolvedValue([[]]);
    const response = await request(app).post('/api/policy-notices/prepare-action').send({
      context: 'transport.inspection_create',
      subject_type: 'vehicle', subject_id: 'V-not-found',
      claim: { inspection_date: '2026-10-18', expiry_date: null, result: 'PASSED', has_notes: false },
    });
    expect(response.status).toBe(404);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM vehicles'), ['V-not-found']);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
});
