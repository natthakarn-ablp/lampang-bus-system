'use strict';

/**
 * AUTH-01: POST /auth/change-password must not let a holder of a stolen access
 * token guess current_password without limit. Wrong guesses share the
 * login_lockouts counter (keyed by user id) and lock out with 429.
 */

require('./loadTestEnv');
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
process.env.JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
process.env.JWT_SECRET =process.env.JWT_SECRET || 'unit-test-secret-change-password-throttle-0123456789';

jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('bcrypt', () => ({
  hashSync: () => 'dummy-hash',
  hash: jest.fn().mockResolvedValue('new-hash'),
  compare: jest.fn().mockImplementation(async (pw) => pw === 'Correct-Pass-2026x'),
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const { pool } = require('../src/config/database');
const { logAudit } = require('../src/utils/audit');
const env = require('../src/config/env');
const authRoutes = require('../src/routes/auth.routes');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: err.message }));

const token = jwt.sign({ sub: 7, role: 'province' }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
let lockouts;

function wire() {
  lockouts = new Map();
  pool.query.mockImplementation(async (sql, params) => {
    if (sql.includes('u.is_active, u.must_change_password')) {
      return [[{ is_active: 1, must_change_password: 0, driver_id: null, password_changed_at: null, sessions_reset_at: null }]];
    }
    if (sql.startsWith('SELECT') && sql.includes('FROM login_lockouts')) {
      const n = lockouts.get(params[0]);
      return [n === undefined ? [] : [{ fail_count: n }]];
    }
    if (sql.includes('INSERT INTO login_lockouts')) {
      lockouts.set(params[0], (lockouts.get(params[0]) || 0) + 1);
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('DELETE FROM login_lockouts')) { lockouts.delete(params[0]); return [{ affectedRows: 1 }]; }
    if (sql.includes('SELECT id, username, password_hash')) return [[{ id: 7, username: 'prov1', password_hash: 'old' }]];
    if (sql.startsWith('UPDATE users SET password_hash')) return [{ affectedRows: 1 }];
    if (sql.includes('must_change_password, driver_id, password_changed_at')) {
      return [[{ id: 7, username: 'prov1', role: 'province', scope_type: 'PROVINCE', scope_id: 'LPG',
        grade_scope: null, display_name: 'p', must_change_password: 0, driver_id: null, password_changed_at: new Date() }]];
    }
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  });
}

beforeEach(() => { jest.clearAllMocks(); wire(); });

const attempt = (cur) => request(app).post('/api/auth/change-password')
  .set('Authorization', `Bearer ${token}`)
  .send({ current_password: cur, new_password: 'Another-Pass-2026y' });

test('repeated wrong current_password locks change-password with 429, even for the right password', async () => {
  const codes = [];
  for (let i = 0; i < 15; i++) codes.push((await attempt(`wrong-guess-${i}`)).status);
  expect(codes.slice(0, 10).every((c) => c === 400)).toBe(true);
  expect(codes.slice(10).every((c) => c === 429)).toBe(true);

  const locked = await attempt('Correct-Pass-2026x');
  expect(locked.status).toBe(429);
  expect(locked.body.message).toMatch(/ลองใหม่/);
  // failures are audited
  expect(logAudit.mock.calls.some(([a]) => a.newValue && a.newValue.reason === 'wrong_current_password')).toBe(true);
});

test('a correct password under the threshold still works and resets the counter', async () => {
  for (let i = 0; i < 3; i++) expect((await attempt('bad')).status).toBe(400);
  const ok = await attempt('Correct-Pass-2026x');
  expect([ok.status, ok.body.message]).toEqual([200, "เปลี่ยนรหัสผ่านสำเร็จ"]);
  expect(lockouts.size).toBe(0);
});
