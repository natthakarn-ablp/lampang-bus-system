'use strict';

/**
 * GET /api/admin/pickup-points/map — compact rows for the admin map + check view.
 *
 * Asserts:
 *   - admin-only (province / school get 403, no token 401)
 *   - exact compact key set (an allow-list, so a new PII column fails loudly)
 *   - student_count + school_names come from the assigned students
 *   - a point with no students and (0,0) coordinates is returned as-is, so the
 *     page can flag it — the endpoint does not hide bad data
 *   - vehicle_id filters, and meta reports total / truncated honestly
 */

require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');

const ROUTE = '/api/admin/pickup-points/map';
const TEST_STUDENT_ID = 99999;
const TEST_VEHICLE = 'V-test000000ab';
const LABEL_WITH = '__probe-admin-map-with';
const LABEL_EMPTY = '__probe-admin-map-empty';
const ADMIN_USER = '__test_admin_pickup_map';

const ALLOWED_KEYS = [
  'id', 'vehicle_id', 'plate_no', 'sequence', 'label', 'latitude', 'longitude',
  'session', 'notes', 'student_count', 'school_names',
].sort();

const tokens = {};
const pointIds = [];

async function tokenFor(username, role, scopeType, scopeId) {
  await pool.query(
    `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name)
     VALUES (?, '$2b$12$0000000000000000000000000000000000000000000000000000', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role), is_active = TRUE, is_deleted = FALSE`,
    [username, role, scopeType, scopeId, username]
  );
  const [[u]] = await pool.query(
    'SELECT id, username, role, scope_type, scope_id FROM users WHERE username = ? LIMIT 1', [username]
  );
  return jwt.sign(
    {
      sub: u.id, username: u.username, role: u.role,
      scopeType: u.scope_type, scopeId: u.scope_id,
      gradeScope: null, displayName: u.username, mustChangePassword: false,
    },
    env.jwt.secret, { expiresIn: '1h' }
  );
}

beforeAll(async () => {
  tokens.admin = await tokenFor(ADMIN_USER, 'admin', null, null);
  tokens.province = await tokenFor('__test_province', 'province', 'PROVINCE', 'LPG');
  tokens.school = await tokenFor('__test_school', 'school', 'SCHOOL', '__TSCH');

  await pool.query('DELETE FROM pickup_points WHERE label IN (?, ?)', [LABEL_WITH, LABEL_EMPTY]);
  const [a] = await pool.query(
    `INSERT INTO pickup_points (vehicle_id, sequence, label, latitude, longitude, session)
     VALUES (?, 97, ?, 18.28530000, 99.49250000, 'both')`,
    [TEST_VEHICLE, LABEL_WITH]
  );
  pointIds.push(a.insertId);
  await pool.query(
    'INSERT INTO student_pickup_points (student_id, pickup_point_id) VALUES (?, ?)',
    [TEST_STUDENT_ID, a.insertId]
  );
  const [b] = await pool.query(
    `INSERT INTO pickup_points (vehicle_id, sequence, label, latitude, longitude, session)
     VALUES (?, 98, ?, 0, 0, 'morning')`,
    [TEST_VEHICLE, LABEL_EMPTY]
  );
  pointIds.push(b.insertId);
});

afterAll(async () => {
  if (pointIds.length) {
    await pool.query('DELETE FROM student_pickup_points WHERE pickup_point_id IN (?)', [pointIds]);
    await pool.query('DELETE FROM pickup_points WHERE id IN (?)', [pointIds]);
  }
  await pool.query('DELETE FROM users WHERE username = ?', [ADMIN_USER]);
});

describe('GET /api/admin/pickup-points/map', () => {
  test('rejects non-admin roles and anonymous callers', async () => {
    const anon = await request(app).get(ROUTE);
    expect(anon.status).toBe(401);
    for (const role of ['province', 'school']) {
      const res = await request(app).get(ROUTE).set('Authorization', `Bearer ${tokens[role]}`);
      expect(`${role} -> ${res.status}`).toBe(`${role} -> 403`);
    }
  });

  test('returns compact rows with counts and school names, nothing else', async () => {
    const res = await request(app)
      .get(`${ROUTE}?vehicle_id=${TEST_VEHICLE}`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const rows = res.body.data;
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(ALLOWED_KEYS);
      expect(r.vehicle_id).toBe(TEST_VEHICLE);
    }

    const withStudent = rows.find(r => r.label === LABEL_WITH);
    expect(withStudent).toBeTruthy();
    expect(withStudent.student_count).toBe(1);
    expect(withStudent.school_names).toEqual(['__Test School']);
    expect(withStudent.latitude).toBeCloseTo(18.2853, 4);
    expect(withStudent.plate_no).toBe('__TEST PLATE 9999');

    const empty = rows.find(r => r.label === LABEL_EMPTY);
    expect(empty).toBeTruthy();
    expect(empty.student_count).toBe(0);
    expect(empty.school_names).toEqual([]);
    expect(empty.latitude).toBe(0);
    expect(empty.longitude).toBe(0);

    // No student PII in the body.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('__Test Student');
    expect(body).not.toContain('0000000001');

    expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
    expect(res.body.meta.returned).toBe(rows.length);
    expect(res.body.meta.truncated).toBe(false);
    expect(res.body.meta.cap).toBeGreaterThan(0);
  });

  test('vehicle filter excludes other vehicles', async () => {
    const res = await request(app)
      .get(`${ROUTE}?vehicle_id=V-doesnotexist`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  test('soft-deleted points are not returned', async () => {
    await pool.query('UPDATE pickup_points SET is_deleted = TRUE WHERE id = ?', [pointIds[1]]);
    try {
      const res = await request(app)
        .get(`${ROUTE}?vehicle_id=${TEST_VEHICLE}`)
        .set('Authorization', `Bearer ${tokens.admin}`);
      expect(res.status).toBe(200);
      expect(res.body.data.find(r => r.label === LABEL_EMPTY)).toBeUndefined();
    } finally {
      await pool.query('UPDATE pickup_points SET is_deleted = FALSE WHERE id = ?', [pointIds[1]]);
    }
  });
});
