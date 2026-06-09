'use strict';

/**
 * authInactiveUser.test.js  (Phase 10.13A-11)
 *
 * ISOLATED — mocked pool, no globalSetup, no production DB. Verifies that the
 * authenticate middleware rejects disabled/deleted accounts on every request
 * (so deactivation takes effect immediately, not at token expiry), while
 * allowing logout and leaving active users unaffected.
 */

jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const { pool } = require('../src/config/database');
const env = require('../src/config/env');
const { authenticate } = require('../src/middleware/auth');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.get('/api/driver/roster', authenticate, (_req, res) => res.json({ success: true, data: 'roster' }));
  app.get('/api/school/students', authenticate, (_req, res) => res.json({ success: true, data: 'protected' }));
  app.get('/api/auth/me', authenticate, (_req, res) => res.json({ success: true, me: true }));
  app.post('/api/auth/logout', authenticate, (_req, res) => res.json({ success: true, out: true }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }));
  return app;
}

const app = makeApp();
const tok = (claims) => jwt.sign(claims, env.jwt.secret, { expiresIn: '1h' });
const ACTIVE = [[{ is_active: 1, must_change_password: 0 }]];
const INACTIVE = [[{ is_active: 0, must_change_password: 0 }]];
const NOT_FOUND = [[]]; // deleted / missing

beforeEach(() => jest.clearAllMocks());

describe('Inactive account rejection (10.13A-11)', () => {
  test('1. active user with a valid token still passes', async () => {
    pool.query.mockResolvedValue(ACTIVE);
    const res = await request(app).get('/api/school/students')
      .set('Authorization', `Bearer ${tok({ sub: 1, role: 'school' })}`);
    expect(res.status).toBe(200);
  });

  test('2. inactive user with an otherwise-valid token is rejected → 401 ACCOUNT_DISABLED', async () => {
    pool.query.mockResolvedValue(INACTIVE);
    const res = await request(app).get('/api/school/students')
      .set('Authorization', `Bearer ${tok({ sub: 3, role: 'school' })}`);
    expect(res.status).toBe(401);
    expect(res.body.errors?.[0]?.code).toBe('ACCOUNT_DISABLED');
  });

  test('3. inactive DRIVER cannot access a driver route (the reported id=3 case)', async () => {
    pool.query.mockResolvedValue(INACTIVE);
    const res = await request(app).get('/api/driver/roster')
      .set('Authorization', `Bearer ${tok({ sub: 3, role: 'driver' })}`);
    expect(res.status).toBe(401);
    expect(res.body.errors?.[0]?.code).toBe('ACCOUNT_DISABLED');
  });

  test('4. inactive user cannot access /api/auth/me as a normal authenticated user', async () => {
    pool.query.mockResolvedValue(INACTIVE);
    const res = await request(app).get('/api/auth/me')
      .set('Authorization', `Bearer ${tok({ sub: 3, role: 'driver' })}`);
    expect(res.status).toBe(401);
    expect(res.body.me).toBeUndefined();
  });

  test('5. inactive user is still allowed to LOG OUT (clean session end)', async () => {
    pool.query.mockResolvedValue(INACTIVE);
    const res = await request(app).post('/api/auth/logout')
      .set('Authorization', `Bearer ${tok({ sub: 3, role: 'driver' })}`);
    expect(res.status).toBe(200);
  });

  test('6. deleted / missing user is rejected → 401 ACCOUNT_DISABLED', async () => {
    pool.query.mockResolvedValue(NOT_FOUND);
    const res = await request(app).get('/api/driver/roster')
      .set('Authorization', `Bearer ${tok({ sub: 999, role: 'driver' })}`);
    expect(res.status).toBe(401);
    expect(res.body.errors?.[0]?.code).toBe('ACCOUNT_DISABLED');
  });

  test('7. rejection message leaks no PII (no token/hash/phone)', async () => {
    pool.query.mockResolvedValue(INACTIVE);
    const token = tok({ sub: 3, role: 'driver', username: '1 นค 1589 กรุงเทพมหานคร' });
    const res = await request(app).get('/api/driver/roster').set('Authorization', `Bearer ${token}`);
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain(token);
    expect(blob).not.toMatch(/\$2[aby]\$/);
    expect(blob).not.toMatch(/\d{10}/);
  });
});
