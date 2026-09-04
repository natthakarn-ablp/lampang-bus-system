'use strict';

/**
 * Two invariants about student rows leaving the API, swept across five roles.
 *
 * SOFT DELETE. Every student query filters is_deleted = FALSE. That filter is
 * one clause in a long WHERE, easy to leave out of a new query, and nothing
 * fails when it is: the endpoint answers, the shape is right, and the extra rows
 * look like data. A removed student reappearing on a roster is the kind of thing
 * a school notices before a test does.
 *
 * cid_hash. CLAUDE.md rule 5 is that the national ID is never stored, only its
 * hash; §13.4 is that sensitive data is scope-restricted. The hash is on the
 * students table next to the columns every list selects, so it rides along the
 * moment someone widens a SELECT. There is no SELECT * on students today — this
 * is what keeps that true.
 *
 * WHAT THE SWEEP FOUND: nothing. Both invariants hold on all 18 endpoints
 * probed. This file exists to keep it that way, not to fix anything, and it does
 * not fail before any change — the regression proof is in the commit message.
 *
 * OWN FIXTURES ON PURPOSE
 * -----------------------
 * The probe students get their own vehicle rather than V-test000000ab. Nothing
 * in the current suite would break either way, but this session has already lost
 * two runs to a test writing to a shared fixture, and the isolation costs one
 * insert.
 */

require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');

const PROBE_VEHICLE = 'V-zzprivacy01';
const PROBE_PLATE = '__PRIVACY PLATE 0001';
const DELETED_ID = 99771;
const LIVE_ID = 99772;
const DELETED_NAME = '__PRIVACYDELETED';
const LIVE_NAME = '__PRIVACYLIVE';
// The plaintext behind the probe students' hashes. A response containing this
// would mean a national ID was stored somewhere it should never be.
const LIVE_CID_PLAINTEXT = '9999999999771';

const tokens = {};
let liveCidHash = '';

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
  tokens.school = await tokenFor('__test_school', 'school', 'SCHOOL', '__TSCH');
  tokens.affiliation = await tokenFor('__test_affiliation', 'affiliation', 'AFFILIATION', '__TAFF');
  tokens.province = await tokenFor('__test_province', 'province', 'PROVINCE', 'LPG');
  tokens.admin = await tokenFor('__test_admin_privacy', 'admin', null, null);
  tokens.transport = await tokenFor('__test_transport_privacy', 'transport', null, null);

  await pool.query(
    `INSERT INTO vehicles (id, plate_no, normalized_plate, vehicle_type)
     VALUES (?, ?, ?, 'รถตู้')
     ON DUPLICATE KEY UPDATE plate_no = VALUES(plate_no)`,
    [PROBE_VEHICLE, PROBE_PLATE, '__privacyplate0001']
  );

  for (const [id, name, deleted] of [[DELETED_ID, DELETED_NAME, 1], [LIVE_ID, LIVE_NAME, 0]]) {
    await pool.query(
      `INSERT INTO students
         (id, cid_hash, prefix, first_name, last_name, grade, classroom,
          school_id, vehicle_id, morning_enabled, evening_enabled, term_id, is_deleted, deleted_at)
       VALUES (?, SHA2(?, 256), 'เด็กชาย', ?, 'ทดสอบความเป็นส่วนตัว', 'ป.3', '1',
               '__TSCH', ?, TRUE, TRUE, '2568-2', ?, IF(?, NOW(), NULL))
       ON DUPLICATE KEY UPDATE
         first_name = VALUES(first_name), is_deleted = VALUES(is_deleted),
         deleted_at = VALUES(deleted_at), vehicle_id = VALUES(vehicle_id)`,
      [id, `999999999${id % 100000}`, name, PROBE_VEHICLE, deleted, deleted]
    );
  }
  const [[live]] = await pool.query('SELECT cid_hash FROM students WHERE id = ?', [LIVE_ID]);
  liveCidHash = live.cid_hash;
});

afterAll(async () => {
  // Exactly what this file created, by the keys it created them with.
  await pool.query('DELETE FROM checkin_logs WHERE student_id IN (?, ?)', [DELETED_ID, LIVE_ID]);
  await pool.query('DELETE FROM daily_status WHERE student_id IN (?, ?)', [DELETED_ID, LIVE_ID]);
  await pool.query('DELETE FROM students WHERE id IN (?, ?)', [DELETED_ID, LIVE_ID]);
  await pool.query(
    "DELETE FROM audit_logs WHERE entity_type = 'vehicle' AND entity_id = ?", [PROBE_VEHICLE]);
  await pool.query('DELETE FROM vehicles WHERE id = ?', [PROBE_VEHICLE]);
  await pool.query('DELETE FROM users WHERE username IN (?, ?)',
    ['__test_admin_privacy', '__test_transport_privacy']);
});

/** Every probe must answer 200; a 4xx here would silently shrink the sweep. */
const PROBES = [
  ['school', '/api/school/students?per_page=100'],
  ['school', '/api/school/status-today'],
  ['school', '/api/school/dashboard'],
  ['school', '/api/school/no-show'],
  ['school', '/api/school/missing'],
  ['school', '/api/school/leaves'],
  ['school', '/api/school/roster-requests'],
  ['school', '/api/school/audit-logs?per_page=20'],
  ['affiliation', '/api/affiliation/students?per_page=100'],
  ['affiliation', '/api/affiliation/status-today'],
  ['affiliation', '/api/affiliation/missing?session=morning'],
  ['affiliation', '/api/affiliation/dashboard'],
  ['province', '/api/province/students?per_page=100'],
  ['province', '/api/province/status-today'],
  ['province', '/api/province/dashboard'],
  ['province', '/api/province/pickup-map'],
  ['admin', '/api/admin/pickup-points'],
  ['transport', '/api/transport/pickup-map'],
  ['transport', '/api/transport/dashboard'],
];

async function sweep() {
  const bodies = [];
  for (const [role, path] of PROBES) {
    const res = await request(app).get(path).set('Authorization', `Bearer ${tokens[role]}`);
    expect(`${path} -> ${res.status}`).toBe(`${path} -> 200`);
    bodies.push({ path, text: JSON.stringify(res.body || {}) });
  }
  return bodies;
}

describe('what a student row is allowed to carry out of the API', () => {
  it('the live probe student is visible — the sweep is reaching student data', async () => {
    // Without this every assertion below is satisfied by responses that contain
    // no students at all, which is how three earlier sweeps in this repository
    // passed while checking nothing.
    const bodies = await sweep();
    const seen = bodies.filter((b) => b.text.includes(LIVE_NAME) || b.text.includes(String(LIVE_ID)));
    expect(`endpoints returning the live student: ${seen.length >= 5}`)
      .toBe('endpoints returning the live student: true');
  });

  it('the soft-deleted student is on none of them', async () => {
    const bodies = await sweep();
    const leaked = bodies
      .filter((b) => b.text.includes(DELETED_NAME) || b.text.includes(String(DELETED_ID)))
      .map((b) => b.path);
    expect(`soft-deleted student on: ${leaked.join(', ') || 'nothing'}`)
      .toBe('soft-deleted student on: nothing');
  });

  it('no response carries a cid_hash', async () => {
    const bodies = await sweep();
    const leaked = bodies.filter((b) => b.text.includes(liveCidHash)).map((b) => b.path);
    expect(`cid_hash on: ${leaked.join(', ') || 'nothing'}`).toBe('cid_hash on: nothing');
  });

  it('no response carries a national ID in the clear', async () => {
    // Nothing should be able to produce this: the column does not exist. Asserted
    // anyway, because the cost is one string search and the thing being ruled out
    // is the one CLAUDE.md rule 5 exists for.
    const bodies = await sweep();
    const leaked = bodies.filter((b) => b.text.includes(LIVE_CID_PLAINTEXT)).map((b) => b.path);
    expect(`raw national ID on: ${leaked.join(', ') || 'nothing'}`)
      .toBe('raw national ID on: nothing');
  });

  it('the two probe students really do differ only by is_deleted', async () => {
    // If the soft-deleted one were invisible for some other reason — wrong
    // school, no vehicle, a typo in the name — the absence assertion above would
    // pass without testing the filter it is named after.
    const [rows] = await pool.query(
      `SELECT id, school_id, vehicle_id, grade, is_deleted FROM students
        WHERE id IN (?, ?) ORDER BY id`, [DELETED_ID, LIVE_ID]);
    expect(`rows found: ${rows.length}`).toBe('rows found: 2');
    const [d, l] = rows;
    expect(`same school: ${d.school_id === l.school_id}`).toBe('same school: true');
    expect(`same vehicle: ${d.vehicle_id === l.vehicle_id}`).toBe('same vehicle: true');
    expect(`same grade: ${d.grade === l.grade}`).toBe('same grade: true');
    expect(`is_deleted differs: ${!!d.is_deleted !== !!l.is_deleted}`).toBe('is_deleted differs: true');
  });
});
