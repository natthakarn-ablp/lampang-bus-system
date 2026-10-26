'use strict';

/**
 * /pickup-map is aggregate-only, on every role that exposes it.
 *
 * province.routes.js, affiliation.routes.js and transport.routes.js each carry
 * the same comment: "Aggregate-only rows: no student names / phones /
 * addresses." Nothing enforced it. The query behind them JOINs students —
 * that is where the counts come from — so adding one column to the SELECT and
 * one line to the row mapper is all it would take, and the endpoint would keep
 * working, keep its shape, and keep its comment.
 *
 * WHY AN ALLOW-LIST OF KEYS AND NOT A SEARCH FOR PII
 * -------------------------------------------------
 * Searching a response for a seeded name or phone only catches the values the
 * fixture happens to contain. Asserting the exact key set catches a field that
 * is added empty today and populated later, and it fails loudly with the name of
 * the new key rather than silently continuing to pass. The value sweep is kept
 * as well, because a key can be renamed.
 *
 * NOT ASSERTED: that label and notes contain no PII. They are free text a school
 * types, so a phone number in a pickup-point label is a data-entry matter, not
 * something this endpoint can be blamed for or fixed by.
 */

require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');

const TEST_STUDENT_ID = 99999;
const TEST_VEHICLE = 'V-test000000ab';
const PROBE_LABEL = '__probe-pickup-map';
const PROBE_ADDRESS = '__PROBE_ADDRESS_9f2a';
const PROBE_PARENT_PHONE = '0811110003';

/** Exactly what a point may carry. A new key here is a deliberate decision. */
const ALLOWED_POINT_KEYS = [
  'pickup_point_id', 'label', 'latitude', 'longitude', 'sequence', 'session',
  'notes', 'vehicle_id', 'plate_no', 'vehicle_type', 'school_id', 'school_name',
  'affiliation_id', 'affiliation_name', 'student_count_in_scope', 'grade_summary',
  'updated_at',
].sort();

const ROUTES = {
  province: '/api/province/pickup-map',
  affiliation: '/api/affiliation/pickup-map',
  transport: '/api/transport/pickup-map',
};

const tokens = {};
let pointId = null;
let parentId = null;
let studentBefore = null;

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
  tokens.province = await tokenFor('__test_province', 'province', 'PROVINCE', 'LPG');
  tokens.affiliation = await tokenFor('__test_affiliation', 'affiliation', 'AFFILIATION', '__TAFF');
  tokens.transport = await tokenFor('__test_transport_map', 'transport', null, null);

  // A pickup point with a student actually attached — the JOIN is on
  // student_pickup_points, so a point with no student appears nowhere and every
  // assertion below would pass against an empty list.
  await pool.query('DELETE FROM pickup_points WHERE label = ?', [PROBE_LABEL]);
  const [pp] = await pool.query(
    `INSERT INTO pickup_points (vehicle_id, sequence, label, latitude, longitude, session, notes)
     VALUES (?, 99, ?, 18.28530000, 99.49250000, 'both', 'probe')`,
    [TEST_VEHICLE, PROBE_LABEL]
  );
  pointId = pp.insertId;
  await pool.query(
    'INSERT INTO student_pickup_points (student_id, pickup_point_id) VALUES (?, ?)',
    [TEST_STUDENT_ID, pointId]
  );

  // PII on the student and a guardian, so the value sweep has something to find
  // if the shape ever changes. Snapshot first: this student is a shared fixture.
  const [[snap]] = await pool.query(
    'SELECT dropoff_address FROM students WHERE id = ?', [TEST_STUDENT_ID]);
  studentBefore = snap;
  await pool.query('UPDATE students SET dropoff_address = ? WHERE id = ?',
    [PROBE_ADDRESS, TEST_STUDENT_ID]);

  await pool.query('DELETE FROM parents WHERE phone = ?', [PROBE_PARENT_PHONE]);
  const [pr] = await pool.query(
    'INSERT INTO parents (name, phone, verified) VALUES (?, ?, TRUE)',
    ['__ผู้ปกครองทดสอบแผนที่', PROBE_PARENT_PHONE]
  );
  parentId = pr.insertId;
  await pool.query(
    `INSERT INTO parent_student (parent_id, student_id, approved) VALUES (?, ?, TRUE)
     ON DUPLICATE KEY UPDATE approved = TRUE`,
    [parentId, TEST_STUDENT_ID]
  );
});

afterAll(async () => {
  if (pointId) {
    await pool.query('DELETE FROM student_pickup_points WHERE pickup_point_id = ?', [pointId]);
    await pool.query('DELETE FROM pickup_points WHERE id = ?', [pointId]);
  }
  if (parentId) {
    await pool.query('DELETE FROM parent_student WHERE parent_id = ?', [parentId]);
    await pool.query('DELETE FROM parents WHERE id = ?', [parentId]);
  }
  if (studentBefore) {
    await pool.query('UPDATE students SET dropoff_address = ? WHERE id = ?',
      [studentBefore.dropoff_address, TEST_STUDENT_ID]);
  }
  await pool.query('DELETE FROM users WHERE username = ?', ['__test_transport_map']);
});

async function fetchMap(role) {
  const res = await request(app).get(ROUTES[role]).set('Authorization', `Bearer ${tokens[role]}`);
  expect(`${role} -> ${res.status}`).toBe(`${role} -> 200`);
  const points = (res.body.data && res.body.data.points) || [];
  return { res, points, mine: points.find((p) => p.label === PROBE_LABEL) };
}

describe('pickup-map returns aggregates on every role that exposes it', () => {
  for (const role of Object.keys(ROUTES)) {
    it(`${role} returns the seeded point, with its student counted`, async () => {
      const { mine } = await fetchMap(role);
      expect(`${role} found the probe point: ${!!mine}`).toBe(`${role} found the probe point: true`);
      expect(`${role} counted its student: ${mine.student_count_in_scope >= 1}`)
        .toBe(`${role} counted its student: true`);
    });

    it(`${role} carries only the aggregate keys`, async () => {
      const { mine } = await fetchMap(role);
      expect(`${role} keys: ${Object.keys(mine).sort().join(',')}`)
        .toBe(`${role} keys: ${ALLOWED_POINT_KEYS.join(',')}`);
    });

    it(`${role} leaks neither the guardian phone nor the dropoff address`, async () => {
      const { res } = await fetchMap(role);
      const body = JSON.stringify(res.body);
      const found = [PROBE_ADDRESS, PROBE_PARENT_PHONE].filter((v) => body.includes(v));
      expect(`${role} leaked: ${found.join(', ') || 'nothing'}`).toBe(`${role} leaked: nothing`);
    });
  }
});
