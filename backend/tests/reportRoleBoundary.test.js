'use strict';

/**
 * A1-11 finding S7 — two routes the generated RBAC matrix reports too widely.
 *
 * `/api/reports` mounts one router-level guard:
 *
 *     router.use(authenticate, requireRole('school', 'affiliation', 'province', 'admin'))
 *
 * and scripts/generate-rbac-matrix.js reads guards from the router graph, so
 * every route under that mount is published as reachable by all four roles.
 * Two of them are not:
 *
 *   GET  /api/reports/policy        report.service.js:516-521 throws 403 for
 *                                   anything but province/admin
 *   POST /api/reports/decision-log  report.routes.js:674-676 compares against
 *                                   DECISION_LOG_ROLES = ['province','admin']
 *
 * Both enforce below the router, where the generator cannot see them.
 *
 * S7 is therefore a defect in a DELIVERABLE, not in the system: the RC2
 * role-to-route matrix that A1-3 hands to an external reviewer says a school
 * account can read province-wide policy reporting. A reviewer who believes it
 * concludes something false in one direction or approves a matrix they know to
 * be wrong in the other.
 *
 * WHAT THIS TEST IS FOR
 * ---------------------
 * It does NOT fail against current code — the enforcement is real and this
 * pins it. Written deliberately as a regression pin, because the fix for S7
 * lives in the matrix generator, and the moment someone "aligns the code to
 * the matrix" instead of the matrix to the code, these four assertions are
 * what stops it.
 *
 * The behaviour it pins was verified by removing each guard in turn: with
 * report.service.js:516-521 deleted, a school token receives 200 from
 * /api/reports/policy.
 */

require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');

// Own fixtures. setup.js seeds __test_school and __test_province; a suite that
// deletes those takes out every other suite sharing the run.
const USERS = [
  ['__test_s7_school', 'school', 'SCHOOL', '__TSCH'],
  ['__test_s7_affiliation', 'affiliation', 'AFFILIATION', '__TAFF'],
  ['__test_s7_province', 'province', 'PROVINCE', 'LPG'],
];
const tokens = {};
const ids = {};

beforeAll(async () => {
  for (const [username, role, scopeType, scopeId] of USERS) {
    await pool.query(
      `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name)
       VALUES (?, '$2b$12$0000000000000000000000000000000000000000000000000000', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE role = VALUES(role), is_active = TRUE, is_deleted = FALSE`,
      [username, role, scopeType, scopeId, username]
    );
    const [[u]] = await pool.query('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
    ids[role] = u.id;
    // Signed, not logged in: loginLimiter is 20/15min/IP with no test skip.
    tokens[role] = jwt.sign(
      { sub: u.id, username, role, scopeType, scopeId, gradeScope: null,
        displayName: username, mustChangePassword: false },
      env.jwt.secret, { expiresIn: '1h' }
    );
  }
});

afterAll(async () => {
  for (const role of Object.keys(ids)) {
    await pool.query('DELETE FROM audit_logs WHERE user_id = ?', [ids[role]]);
  }
  await pool.query(
    `DELETE FROM users WHERE username IN (${USERS.map(() => '?').join(',')})`,
    USERS.map((u) => u[0])
  );
});

describe('GET /api/reports/policy is province/admin only', () => {
  it('refuses school with 403, not 200', async () => {
    const res = await request(app).get('/api/reports/policy')
      .set('Authorization', `Bearer ${tokens.school}`);
    expect(`${res.status}`).toBe('403');
  });

  it('refuses affiliation with 403', async () => {
    const res = await request(app).get('/api/reports/policy')
      .set('Authorization', `Bearer ${tokens.affiliation}`);
    expect(`${res.status}`).toBe('403');
  });

  it('lets province through, so the 403s above are the guard and not a 404', async () => {
    // Floor. Without this, deleting the route entirely would turn the two
    // assertions above green for the wrong reason.
    const res = await request(app).get('/api/reports/policy')
      .set('Authorization', `Bearer ${tokens.province}`);
    expect(`${res.status}`).toBe('200');
  });
});

describe('POST /api/reports/decision-log is province/admin only', () => {
  const body = {
    decision_id: '__s7_probe',
    decision: 'ยอมรับ',
    rationale: 'regression pin สำหรับ A1-11 S7',
  };

  it('refuses school with 403', async () => {
    const res = await request(app).post('/api/reports/decision-log')
      .set('Authorization', `Bearer ${tokens.school}`).send(body);
    expect(`${res.status}`).toBe('403');
  });

  it('refuses affiliation with 403', async () => {
    const res = await request(app).post('/api/reports/decision-log')
      .set('Authorization', `Bearer ${tokens.affiliation}`).send(body);
    expect(`${res.status}`).toBe('403');
  });

  it('the refusal is the role check, not the body validation', async () => {
    // province reaches validation and is answered on the merits of the body,
    // never 403. Whatever that answer is, it proves the school/affiliation
    // 403s came from the role gate rather than from a malformed payload.
    const res = await request(app).post('/api/reports/decision-log')
      .set('Authorization', `Bearer ${tokens.province}`).send(body);
    expect(`province got 403: ${res.status === 403}`).toBe('province got 403: false');
  });
});

describe('the router guard alone is wider than the enforcement', () => {
  it('all four roles clear the mount, which is why the matrix over-reports', () => {
    // The generator reads this line and nothing below it. Asserted so the
    // finding stays legible if someone later narrows the mount instead of
    // fixing the generator — that would be a fine fix, and this test should
    // then be updated deliberately rather than silently.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'report.routes.js'), 'utf8');
    expect(`mount guard: ${/requireRole\('school', 'affiliation', 'province', 'admin'\)/.test(src)}`)
      .toBe('mount guard: true');
  });
});
