'use strict';

/**
 * AUTH-02: POST /auth/logout must revoke the ACCESS token (by jti) as well as
 * the refresh token, without ending the user's other sessions.
 */

require('./loadTestEnv');
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
process.env.JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-logout-access-0123456789abcdef';

jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('bcrypt', () => ({
  hashSync: () => 'dummy-hash',
  hash: jest.fn().mockResolvedValue('h'),
  compare: jest.fn().mockResolvedValue(true),
}));

const express = require('express');
const request = require('supertest');

const { pool } = require('../src/config/database');
const authRoutes = require('../src/routes/auth.routes');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: err.message }));

// Tiny in-memory model of revoked_tokens: INSERTs record the jti (first param);
// the authenticate() lookup reports a revoked_at for any revoked jti it is asked about.
const revoked = new Map();

function wire() {
  revoked.clear();
  pool.query.mockImplementation(async (sql, params = []) => {
    if (sql.includes('FROM users u')) {
      const hit = params.find((p) => typeof p === 'string' && revoked.has(p));
      return [[{
        is_active: 1, must_change_password: 0, driver_id: null, password_changed_at: null,
        sessions_reset_at: null,
        access_revoked_at: hit ? revoked.get(hit) : null,
        revoked_at: hit ? revoked.get(hit) : null,
      }]];
    }
    if (sql.includes('INSERT INTO revoked_tokens')) {
      revoked.set(params[0], new Date());
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM users') && sql.includes('password_hash')) {
      return [[{
        id: 7, username: 'u', password_hash: 'x', role: 'province', scope_type: 'PROVINCE',
        scope_id: 'LPG', grade_scope: null, display_name: 'u', is_active: 1, is_deleted: 0,
        must_change_password: 0, driver_id: null,
      }]];
    }
    if (sql.startsWith('UPDATE users SET last_login')) return [{ affectedRows: 1 }];
    if (sql.includes('FROM users') && sql.includes('last_login')) {
      return [[{ id: 7, username: 'u', role: 'province' }]];
    }
    return [[]];
  });
}

const login = async () =>
  (await request(app).post('/api/auth/login').send({ username: 'u', password: 'p' })).body.data;
const me = (t) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${t}`);

beforeEach(wire);

test('access token is rejected after logout; a second session is untouched', async () => {
  const a = await login();
  expect(a && a.access_token).toBeTruthy();
  // iat has 1s resolution, so tokens could be byte-identical; the jti must differ.
  const b = await login();

  expect((await me(a.access_token)).status).toBe(200);

  const lo = await request(app).post('/api/auth/logout')
    .set('Authorization', `Bearer ${a.access_token}`).send({ refresh_token: a.refresh_token });
  expect(lo.status).toBe(200);

  const after = await me(a.access_token);
  expect(after.status).toBe(401);

  // Idempotent: logging out again with the revoked token still succeeds.
  const lo2 = await request(app).post('/api/auth/logout')
    .set('Authorization', `Bearer ${a.access_token}`).send({ refresh_token: a.refresh_token });
  expect(lo2.status).toBe(200);

  expect((await me(b.access_token)).status).toBe(200);
});

test('logout without a refresh token still revokes the access token', async () => {
  const a = await login();
  const lo = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${a.access_token}`).send({});
  expect(lo.status).toBe(200);
  expect((await me(a.access_token)).status).toBe(401);
});
