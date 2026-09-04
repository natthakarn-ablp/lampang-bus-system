'use strict';

/**
 * Province sees vehicles at summary level, without the phone numbers.
 *
 * CLAUDE.md §5.5 says the province vehicle list strips phones, and
 * province.routes.js says the same at the handler that does it. Both services
 * SELECT the identical columns — owner_phone, driver_phone, attendant_phone —
 * so the difference between the two roles is one destructuring line in the
 * province handler. That is the kind of thing a refactor removes without anyone
 * noticing, because nothing else changes: the endpoint still answers, still
 * lists the same vehicles, and the extra fields look like part of the payload.
 *
 * WHY affiliation IS ASSERTED TOO
 * ------------------------------
 * Not to require that affiliation sees phones — that is existing behaviour, not
 * a rule this file invents. It is the floor. Every assertion here is about a
 * value NOT being in a response, and that passes just as well when the value
 * never reached the query, the vehicle is not in the list, or the fixture has no
 * phone to leak. Three response sweeps in this repository have already passed
 * for exactly that reason. Affiliation returning the same three phones proves
 * the data is there to be leaked.
 */

require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');

const TEST_VEHICLE = 'V-test000000ab';
const TEST_PLATE = '__TEST PLATE 9999';
// Set by this file, restored afterwards.
const PROBE_OWNER_PHONE = '0811110001';
const PROBE_ATTENDANT_PHONE = '0811110002';
// Seeded by tests/setup.js on '__Test Driver'; read here, never written.
const FIXTURE_DRIVER_PHONE = '0000000001';

// The floor uses only what this file writes. The driver phone arrives through
// driver_vehicle_assignments.is_active, which other suites legitimately end and
// restore, so requiring it made this file fail on their scheduling rather than
// on anything about province — a floor has to be under this file's control.
const REQUIRED_PHONES = [PROBE_OWNER_PHONE, PROBE_ATTENDANT_PHONE];
// Everything province must not emit. The driver phone belongs here because its
// absence is safe and its presence would be a leak either way.
const ALL_PHONES = [...REQUIRED_PHONES, FIXTURE_DRIVER_PHONE];

const tokens = {};
let vehicleBefore = null;

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

  // Snapshot before writing: this vehicle is the fixture every check-in suite
  // depends on, and a column left changed here has already broken four of them.
  const [[snap]] = await pool.query('SELECT owner_phone FROM vehicles WHERE id = ?', [TEST_VEHICLE]);
  vehicleBefore = snap;
  await pool.query('UPDATE vehicles SET owner_phone = ? WHERE id = ?', [PROBE_OWNER_PHONE, TEST_VEHICLE]);
  await pool.query('DELETE FROM vehicle_attendants WHERE phone = ?', [PROBE_ATTENDANT_PHONE]);
  await pool.query(
    'INSERT INTO vehicle_attendants (vehicle_id, name, phone) VALUES (?, ?, ?)',
    [TEST_VEHICLE, '__ผู้ดูแลทดสอบ', PROBE_ATTENDANT_PHONE]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM vehicle_attendants WHERE phone = ?', [PROBE_ATTENDANT_PHONE]);
  if (vehicleBefore) {
    await pool.query('UPDATE vehicles SET owner_phone = ? WHERE id = ?',
      [vehicleBefore.owner_phone, TEST_VEHICLE]);
  }
  // Deliberately NOT deleting __test_province or __test_affiliation. They are
  // seeded by tests/setup.js and shared by the whole run; tokenFor only revives
  // them, it does not create them. Removing them here took out ten suites in one
  // run and left the next run green, because whether it mattered depended on
  // which suites jest happened to schedule after this one.
});

async function get(path, role) {
  const res = await request(app).get(path).set('Authorization', `Bearer ${tokens[role]}`);
  expect(`${role} ${path} -> ${res.status}`).toBe(`${role} ${path} -> 200`);
  return res;
}

const leaked = (res) => ALL_PHONES.filter((p) => JSON.stringify(res.body).includes(p));

describe('the province vehicle list is summary level', () => {
  it('affiliation returns the phones this file seeded — the data is there to leak', async () => {
    const res = await get('/api/affiliation/vehicles', 'affiliation');
    const rows = res.body.data || [];
    const mine = rows.find((v) => v.id === TEST_VEHICLE);
    expect(`affiliation sees the fixture vehicle: ${!!mine}`).toBe('affiliation sees the fixture vehicle: true');
    const present = REQUIRED_PHONES.filter((p) => JSON.stringify(res.body).includes(p));
    expect(`affiliation returns: ${present.sort().join(', ')}`)
      .toBe(`affiliation returns: ${REQUIRED_PHONES.slice().sort().join(', ')}`);
  });

  it('province returns the same vehicle without any of them', async () => {
    const res = await get('/api/province/vehicles', 'province');
    const rows = res.body.data || [];
    const mine = rows.find((v) => v.id === TEST_VEHICLE);

    // Asserted first: "no phone in the response" is also true of a response that
    // does not contain the vehicle.
    expect(`province sees the fixture vehicle: ${!!mine}`).toBe('province sees the fixture vehicle: true');
    expect(`province row carries the plate: ${mine.plate_no === TEST_PLATE}`)
      .toBe('province row carries the plate: true');

    expect(`province leaked: ${leaked(res).join(', ') || 'nothing'}`).toBe('province leaked: nothing');
  });

  it('province carries no phone-shaped key at all, not merely empty ones', async () => {
    const res = await get('/api/province/vehicles', 'province');
    const mine = (res.body.data || []).find((v) => v.id === TEST_VEHICLE);
    const phoneKeys = Object.keys(mine).filter((k) => k.endsWith('_phone'));
    expect(`phone keys on the province row: ${phoneKeys.join(', ') || 'none'}`)
      .toBe('phone keys on the province row: none');
    // The non-PII half of the same columns stays, so the strip is targeted.
    expect(`owner_name still present: ${'owner_name' in mine}`).toBe('owner_name still present: true');
  });

  it('vehicles-at-risk never selects them in the first place', async () => {
    const res = await get('/api/province/vehicles-at-risk?limit=50', 'province');
    const rows = res.body.data || [];
    expect(`at-risk sees the fixture vehicle: ${rows.some((v) => v.id === TEST_VEHICLE)}`)
      .toBe('at-risk sees the fixture vehicle: true');
    expect(`at-risk leaked: ${leaked(res).join(', ') || 'nothing'}`).toBe('at-risk leaked: nothing');
  });

  it('the affiliation at-risk list is scoped the same way', async () => {
    // Its comment claims the same thing as the province one, and the two queries
    // were written together, so the claim is checked on both.
    const res = await get('/api/affiliation/vehicles-at-risk?limit=50', 'affiliation');
    const rows = res.body.data || [];
    expect(`at-risk sees the fixture vehicle: ${rows.some((v) => v.id === TEST_VEHICLE)}`)
      .toBe('at-risk sees the fixture vehicle: true');
    expect(`affiliation at-risk leaked: ${leaked(res).join(', ') || 'nothing'}`)
      .toBe('affiliation at-risk leaked: nothing');
  });
});
