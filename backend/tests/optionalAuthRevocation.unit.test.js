'use strict';

jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/config/env', () => ({ jwt: { secret: 'synthetic-qr-test-key-not-used-in-production' } }));
jest.mock('../src/services/lineIdToken.service', () => ({ verifyIdToken: jest.fn() }));
const jwt = require('jsonwebtoken');
const { pool } = require('../src/config/database');
const env = require('../src/config/env');
const line = require('../src/services/lineIdToken.service');
const { optionalAuth } = require('../src/middleware/optionalAuth');
const { resolveAccessLevel } = require('../src/services/qrAccess.service');

const issued = Math.floor(Date.now() / 1000) - 100;
const token = (claims = {}, key = env.jwt.secret) => jwt.sign({ sub: 123, role: 'admin', iat: issued, type: 'access', ...claims }, key, { expiresIn: '1h' });
const row = (over = {}) => ({ is_active: 1, must_change_password: 0, password_changed_at: null, sessions_reset_at: null, ...over });
async function check(over = {}, claims = {}) {
  pool.query.mockResolvedValue([[row(over)]]);
  const req = { headers: { authorization: `Bearer ${token(claims)}` }, query: {} };
  const next = jest.fn();
  await optionalAuth(req, {}, next);
  expect(next).toHaveBeenCalledTimes(1);
  return req;
}
beforeEach(() => { jest.clearAllMocks(); line.verifyIdToken.mockResolvedValue({ valid: false }); });

test.each(['admin', 'transport', 'province'])('revoked %s token never grants staff QR level', async role => {
  const req = await check({ sessions_reset_at: new Date((issued + 10) * 1000) }, { role });
  expect(req.user).toBeUndefined();
  expect(await resolveAccessLevel(req, 'synthetic-vehicle')).toBe(1);
});
test('same-second revocation also removes staff identity', async () => {
  expect((await check({ sessions_reset_at: new Date(issued * 1000) })).user).toBeUndefined();
});
test.each([null, new Date((issued - 10) * 1000)])('valid staff keeps access after cutoff %s', async sessions_reset_at => {
  const req = await check({ sessions_reset_at });
  expect(await resolveAccessLevel(req, 'synthetic-vehicle')).toBe(3);
});
test.each([{ is_active: 0 }, { must_change_password: 1 }, { password_changed_at: new Date((issued + 10) * 1000) }])('quarantined account stays anonymous: %j', async state => {
  expect((await check(state)).user).toBeUndefined();
});
test('refresh tokens cannot provide staff access', async () => {
  expect((await check({}, { type: 'refresh' })).user).toBeUndefined();
  expect(pool.query).not.toHaveBeenCalled();
});
test('lookup failure falls back without staff privileges', async () => {
  pool.query.mockRejectedValue(new Error('synthetic database outage'));
  const req = { headers: { authorization: `Bearer ${token()}` }, query: {} };
  await optionalAuth(req, {}, jest.fn());
  expect(req.user).toBeUndefined();
});
test('missing/deleted user stays anonymous', async () => {
  pool.query.mockResolvedValue([[]]);
  const req = { headers: { authorization: `Bearer ${token()}` }, query: {} };
  await optionalAuth(req, {}, jest.fn());
  expect(req.user).toBeUndefined();
});
test('invalid JWT may still resolve an independently verified LINE parent', async () => {
  line.verifyIdToken.mockResolvedValue({ valid: true, userId: 'synthetic-parent' });
  const req = { headers: { authorization: `Bearer ${token({}, 'different-test-key')}` }, query: {} };
  await optionalAuth(req, {}, jest.fn());
  expect(req.user).toBeUndefined();
  expect(req.lineUserId).toBe('synthetic-parent');
});
test('no credentials leave the request anonymous', async () => {
  const req = { headers: {}, query: {} };
  const next = jest.fn();
  await optionalAuth(req, {}, next);
  expect(req.user).toBeUndefined();
  expect(pool.query).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledTimes(1);
});
