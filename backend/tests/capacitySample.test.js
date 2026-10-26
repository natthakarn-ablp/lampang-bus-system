'use strict';

/**
 * GET /api/admin/operations/capacity-sample, live against the test database.
 *
 * The load test polls this while a stage runs (backend/scripts/load-test.js
 * --admin-token), so three things matter: an admin gets the full sample from
 * the real pool, nobody else gets it (it describes the server), and it is
 * cheap — one SHOW STATUS, one SHOW VARIABLES, one indexed COUNT.
 */

require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');

const ADMIN_USER = '__test_admin_capacity_sample';
const SCHOOL_USER = '__test_school_capacity_sample';
let adminToken = null;
let schoolToken = null;
const ids = {};

async function upsert(username, role, scopeType, scopeId) {
  await pool.query(
    `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name)
     VALUES (?, '$2b$12$0000000000000000000000000000000000000000000000000000', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role), is_active = TRUE, is_deleted = FALSE`,
    [username, role, scopeType, scopeId, username]
  );
  const [[u]] = await pool.query('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
  return u.id;
}

const sign = (id, username, role, scopeType, scopeId) => jwt.sign(
  { sub: id, username, role, scopeType, scopeId, gradeScope: null, displayName: username, mustChangePassword: false },
  env.jwt.secret, { expiresIn: '1h' }
);

beforeAll(async () => {
  ids.admin = await upsert(ADMIN_USER, 'admin', null, null);
  ids.school = await upsert(SCHOOL_USER, 'school', 'SCHOOL', 'SCH0001');
  adminToken = sign(ids.admin, ADMIN_USER, 'admin', null, null);
  schoolToken = sign(ids.school, SCHOOL_USER, 'school', 'SCHOOL', 'SCH0001');
});

afterAll(async () => {
  await pool.query('DELETE FROM audit_logs WHERE user_id IN (?, ?)', [ids.admin, ids.school]);
  await pool.query('DELETE FROM users WHERE username IN (?, ?)', [ADMIN_USER, SCHOOL_USER]);
});

const get = (token) => {
  const r = request(app).get('/api/admin/operations/capacity-sample');
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

describe('access', () => {
  it('needs a token', async () => {
    expect((await get(null)).status).toBe(401);
  });

  it('is admin-only — a school account gets 403, not a server profile', async () => {
    expect((await get(schoolToken)).status).toBe(403);
  });
});

describe('the sample', () => {
  let data;

  beforeAll(async () => {
    const res = await get(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    data = res.body.data;
  });

  it('reads the real pool: limit 10 (database.js), at least this request\'s connection open', () => {
    expect(data.db_pool.limit).toBe(10);
    expect(data.db_pool.open).toBeGreaterThanOrEqual(1);
    expect(data.db_pool.in_use + data.db_pool.free).toBe(data.db_pool.open);
    expect(data.db_pool.utilisation).toBeGreaterThanOrEqual(0);
    expect(data.db_pool.utilisation).toBeLessThanOrEqual(1);
  });

  it('reads MySQL status and variables as numbers', () => {
    for (const k of ['threads_connected', 'threads_running', 'slow_queries', 'max_used_connections', 'max_connections', 'uptime_sec']) {
      expect(`${k}: ${typeof data.db_server[k]}`).toBe(`${k}: number`);
    }
    expect(data.db_server.max_connections).toBeGreaterThan(0);
  });

  it('reports the LINE queue by the dispatcher\'s definition', () => {
    expect(typeof data.line_queue.pending).toBe('number');
    expect(typeof data.line_queue.exhausted).toBe('number');
  });

  it('reports process and host resources, with nulls rather than zeros for what the host cannot say', () => {
    expect(data.process.rss_mb).toBeGreaterThan(0);
    expect(data.host.mem_total_mb).toBeGreaterThan(0);
    if (process.platform === 'win32') {
      expect(data.host.load_avg_1m).toBeNull();
      expect(data.host.swap_used_mb).toBeNull();
      expect(data.host.swap_note).toMatch(/\/proc\/meminfo/);
    } else {
      expect(typeof data.host.load_avg_1m).toBe('number');
    }
  });

  it('carries no personal data', () => {
    const text = JSON.stringify(data);
    for (const forbidden of ['line_user_id', 'student', 'phone', 'cid', 'username', 'message_json', 'password']) {
      expect(`contains ${forbidden}: ${text.includes(forbidden)}`).toBe(`contains ${forbidden}: false`);
    }
  });

  it('is cheap enough to poll every few seconds', async () => {
    const t0 = Date.now();
    for (let i = 0; i < 5; i += 1) expect((await get(adminToken)).status).toBe(200);
    // Five samples well under a second on a warm pool; the operations/health
    // route this deliberately is not would take longer than that once.
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
