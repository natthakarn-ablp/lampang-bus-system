'use strict';

/**
 * authSessionHardening.test.js  (Phase 10.12D — H2/H3)
 *
 * ISOLATED — the MySQL pool is mocked, so these run without globalSetup and
 * never touch the production DB. They exercise the real `authenticate`
 * middleware (forced password-change enforcement) by mounting it on a tiny app.
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
  app.get('/api/school/students', authenticate, (req, res) =>
    res.json({ success: true, data: 'protected', mustChangePassword: req.user.mustChangePassword }));
  app.get('/api/auth/me', authenticate, (_req, res) => res.json({ success: true, me: true }));
  app.post('/api/auth/change-password', authenticate, (_req, res) => res.json({ success: true, cp: true }));
  app.post('/api/auth/logout', authenticate, (_req, res) => res.json({ success: true, out: true }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }));
  return app;
}

const app = makeApp();
const sign = (claims) => jwt.sign(claims, env.jwt.secret, { expiresIn: '1h' });

beforeEach(() => jest.clearAllMocks());

describe('Forced password-change enforcement (H2)', () => {
  test('1. no token → 401', async () => {
    const res = await request(app).get('/api/school/students');
    expect(res.status).toBe(401);
  });

  test('2. normal user (mustChangePassword=false) reaches protected route — no DB hit', async () => {
    const res = await request(app).get('/api/school/students')
      .set('Authorization', `Bearer ${sign({ sub: 1, role: 'school', mustChangePassword: false })}`);
    expect(res.status).toBe(200);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('3. forced user (DB still true) is blocked on a protected route → 403 MUST_CHANGE_PASSWORD', async () => {
    pool.query.mockResolvedValue([[{ must_change_password: 1 }]]);
    const res = await request(app).get('/api/school/students')
      .set('Authorization', `Bearer ${sign({ sub: 2, role: 'school', mustChangePassword: true })}`);
    expect(res.status).toBe(403);
    expect(res.body.errors?.[0]?.code).toBe('MUST_CHANGE_PASSWORD');
    expect(res.body.message).toMatch(/เปลี่ยนรหัสผ่าน/);
  });

  test('4. forced user can still reach POST /api/auth/change-password (allow-listed, no DB hit / no block)', async () => {
    const res = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${sign({ sub: 2, role: 'school', mustChangePassword: true })}`);
    expect(res.status).toBe(200);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('5. forced user can still reach /api/auth/me and /api/auth/logout', async () => {
    const me = await request(app).get('/api/auth/me')
      .set('Authorization', `Bearer ${sign({ sub: 2, role: 'driver', mustChangePassword: true })}`);
    expect(me.status).toBe(200);
    const out = await request(app).post('/api/auth/logout')
      .set('Authorization', `Bearer ${sign({ sub: 2, role: 'driver', mustChangePassword: true })}`);
    expect(out.status).toBe(200);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('6. just-changed user (stale token=true but DB now false) is NOT locked out → 200', async () => {
    pool.query.mockResolvedValue([[{ must_change_password: 0 }]]);
    const res = await request(app).get('/api/school/students')
      .set('Authorization', `Bearer ${sign({ sub: 2, role: 'school', mustChangePassword: true })}`);
    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('7. 403 body leaks no token or password hash', async () => {
    pool.query.mockResolvedValue([[{ must_change_password: 1 }]]);
    const token = sign({ sub: 2, role: 'school', mustChangePassword: true });
    const res = await request(app).get('/api/school/students').set('Authorization', `Bearer ${token}`);
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain(token);
    expect(blob).not.toMatch(/\$2[aby]\$/); // bcrypt hash signature
    expect(blob).not.toMatch(/password_hash/);
  });
});
