'use strict';

/**
 * parentConsentGate.unit.test.js  (#3 — parent consent gate on the LIFF API)
 *
 * Locks in the "linked AND consented" rule that guards /api/parent child-detail
 * endpoints, and — critically — that it is DARK by default: with the feature off
 * the gate allows everything with NO DB call, so the live parent experience is
 * byte-for-byte unchanged. With the feature on, a linked parent must hold a
 * granted tracking consent.
 *
 * DB-free: pure decision + injectable db/flag. Runs under jest.unit.config.js.
 */

const {
  isParentViewAllowed,
  hasParentTrackingConsent,
  guardParentView,
  PARENT_CONSENT_TYPES,
} = require('../src/services/parentConsentGate');

describe('isParentViewAllowed (pure decision)', () => {
  test('feature OFF → always allowed regardless of consent', () => {
    expect(isParentViewAllowed({ featureEnabled: false, consentGranted: false })).toBe(true);
    expect(isParentViewAllowed({ featureEnabled: false, consentGranted: true })).toBe(true);
  });
  test('feature ON → allowed only with granted consent', () => {
    expect(isParentViewAllowed({ featureEnabled: true, consentGranted: true })).toBe(true);
    expect(isParentViewAllowed({ featureEnabled: true, consentGranted: false })).toBe(false);
  });
});

describe('hasParentTrackingConsent', () => {
  const db = (rows) => ({ query: jest.fn(async () => [rows]) });

  test('no lineUserId → false without querying', async () => {
    const d = db([]);
    expect(await hasParentTrackingConsent(null, d)).toBe(false);
    expect(d.query).not.toHaveBeenCalled();
  });

  test('latest consent granted → true', async () => {
    expect(await hasParentTrackingConsent('U1', db([{ consent_status: 'granted' }]))).toBe(true);
  });

  test('latest consent withdrawn → false', async () => {
    expect(await hasParentTrackingConsent('U1', db([{ consent_status: 'withdrawn' }]))).toBe(false);
  });

  test('no consent record → false', async () => {
    expect(await hasParentTrackingConsent('U1', db([]))).toBe(false);
  });

  test('accepts either the parent-tracking or the QR opt-in consent type', async () => {
    const d = db([{ consent_status: 'granted' }]);
    await hasParentTrackingConsent('U1', d);
    const [, params] = d.query.mock.calls[0];
    expect(params).toEqual(['U1', PARENT_CONSENT_TYPES[0], PARENT_CONSENT_TYPES[1]]);
  });
});

describe('guardParentView', () => {
  test('feature OFF (default dark) → allowed, and NEVER touches the DB', async () => {
    const db = { query: jest.fn() };
    const gate = await guardParentView('U1', { db, featureEnabled: false });
    expect(gate).toEqual({ allowed: true, featureEnabled: false });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('feature ON + consent granted → allowed', async () => {
    const db = { query: jest.fn(async () => [[{ consent_status: 'granted' }]]) };
    const gate = await guardParentView('U1', { db, featureEnabled: true });
    expect(gate).toMatchObject({ allowed: true, featureEnabled: true, consentGranted: true });
  });

  test('feature ON + no consent → blocked', async () => {
    const db = { query: jest.fn(async () => [[]]) };
    const gate = await guardParentView('U1', { db, featureEnabled: true });
    expect(gate).toMatchObject({ allowed: false, featureEnabled: true, consentGranted: false });
  });
});
