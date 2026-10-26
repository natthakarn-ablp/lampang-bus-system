'use strict';

jest.mock('../src/config/policyNotices', () => ({
  APPROVED: true,
  actionPolicyForRole: (role, context) => role === 'transport' && context === 'transport.vehicle_export'
    ? { key: 'transport_export', version: 'approved-v1', subjectType: 'transport_safety_report' }
    : null,
}));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../src/config/database');
const { consumePolicyAction, tokenDigest } = require('../src/utils/policyActionEvidence');

function responseDouble() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe('policy action evidence consumption', () => {
  beforeEach(() => jest.clearAllMocks());

  test('atomically consumes an actor/context/subject-bound token', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 1 }]);
    const req = {
      user: { id: 8, role: 'transport' },
      get: jest.fn().mockReturnValue('one-use-token'),
    };
    const res = responseDouble();
    await expect(consumePolicyAction(req, res, {
      context: 'transport.vehicle_export', subjectType: 'transport_safety_report', subjectId: 'vehicles',
    })).resolves.toBe(true);
    expect(pool.query.mock.calls[0][1]).toEqual([
      tokenDigest('one-use-token'), 8, 'transport', 'transport.vehicle_export',
      'transport_safety_report', 'vehicles', 'transport_export', 'approved-v1',
    ]);
    expect(pool.query.mock.calls[0][0]).toContain('expires_at >= CURRENT_TIMESTAMP');
  });

  test('fails closed for a missing or already-used token', async () => {
    const req = { user: { id: 8, role: 'transport' }, get: jest.fn().mockReturnValue(null) };
    const res = responseDouble();
    await expect(consumePolicyAction(req, res, {
      context: 'transport.vehicle_export', subjectType: 'transport_safety_report', subjectId: 'vehicles',
    })).resolves.toBe(false);
    expect(res.statusCode).toBe(428);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
