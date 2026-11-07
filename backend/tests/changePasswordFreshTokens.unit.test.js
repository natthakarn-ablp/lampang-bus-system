'use strict';

/**
 * load-03 (training 2026-11): POST /auth/change-password returns a fresh token
 * pair minted no earlier than the stored password_changed_at, so the forced
 * first-login change does not cost a second /auth/login — and the new pair
 * passes the same iat >= password_changed_at rule the middleware enforces.
 */

require('./loadTestEnv');
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
process.env.JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-change-password-fresh-0123456789';

jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('bcrypt', () => ({
  hashSync: () => 'dummy-hash',
  hash: jest.fn().mockResolvedValue('new-hash'),
  compare: jest.fn().mockResolvedValue(true),
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const { pool } = require('../src/config/database');
const env = require('../src/config/env');
const authRoutes = require('../src/routes/auth.routes');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: err.message }));

const sign = (claims, opts = {}) => jwt.sign(claims, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h', ...opts });

// Stored cutoff a few seconds in the "future" relative to the app clock: models
// DB/app clock skew or TIMESTAMP rounding up. The new tokens must not predate it.
const changedAt = new Date(Math.floor(Date.now() / 1000) * 1000 + 3000);

function wire() {
  pool.query.mockImplementation(async (sql) => {
    if (sql.includes('u.is_active, u.must_change_password')) {
      // authenticate middleware: account still forced to change, no reset yet
      return [[{ is_active: 1, must_change_password: 1, driver_id: null, password_changed_at: null, sessions_reset_at: null }]];
    }
    // change-password lockout counter (AUTH-01): never locked here
    if (sql.includes('login_lockouts')) return sql.startsWith('SELECT') ? [[]] : [{ affectedRows: 1 }];
    if (sql.includes('SELECT id, username, password_hash')) return [[{ id: 2, username: 'teacher1', password_hash: 'old' }]];
    if (sql.startsWith('UPDATE users SET password_hash')) return [{ affectedRows: 1 }];
    if (sql.includes('INSERT INTO revoked_tokens')) return [{ affectedRows: 1 }];
    if (sql.includes('must_change_password, driver_id, password_changed_at')) {
      return [[{
        id: 2, username: 'teacher1', role: 'school', scope_type: 'SCHOOL', scope_id: 'SCH0001',
        grade_scope: 'ป.1', display_name: 'ครู ป.1', must_change_password: 0, driver_id: null,
        password_changed_at: changedAt,
      }]];
    }
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  });
}

beforeEach(() => { jest.clearAllMocks(); wire(); });

test('returns a fresh access + refresh pair that survives the password_changed_at cutoff', async () => {
  const oldRefresh = sign({ sub: 2, jti: 'old-jti', type: 'refresh' });
  const res = await request(app)
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${sign({ sub: 2, role: 'school', mustChangePassword: true })}`)
    .send({ current_password: 'Initial#2569', new_password: 'Lampang#Teacher2569', refresh_token: oldRefresh });

  expect(res.body.message).toBe('เปลี่ยนรหัสผ่านสำเร็จ');
  expect(res.status).toBe(200);
  const { access_token, refresh_token, user } = res.body.data;
  expect(user).toMatchObject({ id: 2, role: 'school', grade_scope: 'ป.1', must_change_password: false });

  const cutoff = Math.floor(changedAt.getTime() / 1000);
  const access = jwt.verify(access_token, env.jwt.secret, { algorithms: ['HS256'] });
  const refresh = jwt.verify(refresh_token, env.jwt.secret, { algorithms: ['HS256'] });
  expect(access).toMatchObject({ sub: 2, role: 'school', gradeScope: 'ป.1', mustChangePassword: false });
  expect(refresh).toMatchObject({ sub: 2, type: 'refresh' });
  expect(access.iat).toBeGreaterThanOrEqual(cutoff);
  expect(refresh.iat).toBeGreaterThanOrEqual(cutoff);
  expect(refresh.jti).not.toBe('old-jti');

  // The refresh token sent with the request is still revoked.
  const revoke = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO revoked_tokens'));
  expect(revoke[1][0]).toBe('old-jti');
});

test('wrong current password returns no tokens', async () => {
  require('bcrypt').compare.mockResolvedValueOnce(false);
  const res = await request(app)
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${sign({ sub: 2, role: 'school' })}`)
    .send({ current_password: 'nope', new_password: 'Lampang#Teacher2569' });
  expect(res.status).toBe(400);
  expect(res.body.data).toBeNull();
});
