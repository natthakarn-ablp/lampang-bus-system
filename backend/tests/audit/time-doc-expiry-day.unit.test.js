'use strict';
jest.mock('../../src/config/database', () => ({ pool: { query: jest.fn() } }));
const { buildDocumentStatus } = require('../../src/services/qrAccess.service');
afterEach(() => jest.useRealTimers());

const all = (d) => ({ insurance_expiry: d, registration_expiry: d, compulsory_insurance_expiry: d, tax_expiry: d });

test('document expiring today is not EXPIRED during the expiry day (10:00 Bangkok)', () => {
  jest.useFakeTimers({ now: new Date('2026-11-07T03:00:00Z') });
  const expiryToday = new Date('2026-11-06T17:00:00Z'); // 2026-11-07 00:00 Bangkok
  const s = buildDocumentStatus(all(expiryToday));
  expect(s.insurance).toBe('EXPIRING');
  expect(s.tax).toBe('EXPIRING');
});

test('document is EXPIRED the day after the expiry date (Bangkok)', () => {
  jest.useFakeTimers({ now: new Date('2026-11-07T17:30:00Z') }); // 08 Nov 00:30 Bangkok
  const s = buildDocumentStatus(all(new Date('2026-11-06T17:00:00Z')));
  expect(s.insurance).toBe('EXPIRED');
});

test('31 days ahead is VALID, 30 days ahead is EXPIRING', () => {
  jest.useFakeTimers({ now: new Date('2026-11-07T03:00:00Z') });
  expect(buildDocumentStatus(all(new Date('2026-12-07T17:00:00Z'))).tax).toBe('VALID'); // 8 Dec
  expect(buildDocumentStatus(all(new Date('2026-12-06T17:00:00Z'))).tax).toBe('EXPIRING'); // 7 Dec
});
