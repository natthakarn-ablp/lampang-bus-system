'use strict';

/**
 * consent.test.js — Phase QR-1
 * Append-only ledger + the auto-suspend cascade: withdrawing a REQUIRED driver
 * consent suspends that driver's public display in the same transaction.
 */
const conn = { query: jest.fn(), beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));

const { pool } = require('../src/config/database');
const svc = require('../src/services/consent.service');

beforeEach(() => {
  jest.clearAllMocks();
  pool.getConnection.mockResolvedValue(conn);
  pool.query.mockResolvedValue([{ insertId: 1 }]);
  conn.query.mockReset();
});

describe('grantConsent', () => {
  test('inserts a granted ledger row', async () => {
    const out = await svc.grantConsent({ userId: 5, userRole: 'driver', consentType: 'qr_driver_public', ipAddress: '1.1.1.1', userAgent: 'ua' });
    expect(out.status).toBe('granted');
    const insert = pool.query.mock.calls.find((c) => /INSERT INTO consent_records/.test(c[0]));
    expect(insert).toBeTruthy();
    expect(insert[1]).toEqual(expect.arrayContaining(['qr_driver_public', 'granted']));
  });
  test('invalid consent type → 400', async () => {
    await expect(svc.grantConsent({ userId: 5, consentType: 'bogus' })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('withdrawConsent — auto-suspend cascade', () => {
  test('withdrawing a REQUIRED driver consent suspends the driver (atomic)', async () => {
    conn.query.mockImplementation(async (sql) => {
      if (/INSERT INTO consent_records/.test(sql)) return [{ insertId: 2 }];
      if (/FROM users WHERE id/.test(sql)) return [[{ driver_id: 7 }]];
      if (/INSERT INTO driver_display_status/.test(sql)) return [{}];
      return [[]];
    });
    const out = await svc.withdrawConsent({ userId: 5, userRole: 'driver', consentType: 'qr_driver_public', ipAddress: '1.1.1.1', userAgent: 'ua' });
    expect(out.status).toBe('withdrawn');
    expect(out.suspended_driver_id).toBe(7);
    expect(conn.query.mock.calls.some((c) => /driver_display_status/.test(c[0]) && /suspended/.test(c[0]))).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
  });
  test('withdrawing a NON-required consent does not suspend', async () => {
    conn.query.mockImplementation(async (sql) => {
      if (/INSERT INTO consent_records/.test(sql)) return [{ insertId: 3 }];
      return [[]];
    });
    const out = await svc.withdrawConsent({ userId: 5, userRole: 'driver', consentType: 'qr_driver_sensitive', ipAddress: '1.1.1.1', userAgent: 'ua' });
    expect(out.suspended_driver_id).toBeNull();
    expect(conn.query.mock.calls.some((c) => /driver_display_status/.test(c[0]))).toBe(false);
  });
  test('parent withdrawing opt-in suspends nobody', async () => {
    conn.query.mockImplementation(async (sql) => {
      if (/INSERT INTO consent_records/.test(sql)) return [{ insertId: 4 }];
      return [[]];
    });
    const out = await svc.withdrawConsent({ lineUserId: 'U1', userRole: 'parent', consentType: 'qr_parent_optin', ipAddress: '1.1.1.1', userAgent: 'ua' });
    expect(out.status).toBe('withdrawn');
    expect(out.suspended_driver_id).toBeNull();
  });
  test('rolls back on error', async () => {
    conn.query.mockRejectedValue(new Error('boom'));
    await expect(svc.withdrawConsent({ userId: 5, userRole: 'driver', consentType: 'qr_driver_public' })).rejects.toThrow();
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('getMyConsents', () => {
  test('queries latest-per-type for a user', async () => {
    pool.query.mockResolvedValueOnce([[{ consent_type: 'qr_driver_public', consent_status: 'granted', consent_version: 'v1', created_at: 'now' }]]);
    const out = await svc.getMyConsents({ userId: 5 });
    expect(out[0]).toMatchObject({ type: 'qr_driver_public', status: 'granted' });
  });
});
