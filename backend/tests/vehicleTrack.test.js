'use strict';

/**
 * vehicleTrack.test.js — GPS route replay + offline batch flush against the
 * disposable lampang_bus_test DB (CI: npm run test:ci). Complements the
 * DB-free vehicleTrackRoutes.unit.test.js by running the REAL SQL:
 *   • scope (school / affiliation / province) via vehicleScopeSql
 *   • Bangkok-day bounds on TIMESTAMP(3) recorded_at
 *   • batch idempotency pre-check (recorded_at IN (...)) on real rows
 *
 * Seeds an extra affiliation + school + vehicle + pupil, cleaned in afterAll.
 */

require('dotenv').config();
const request = require('supertest');
const { getTestConnection } = require('./dbHelper');
const app = require('../src/app');
const { todayBangkok } = require('../src/utils/thaiTime');
const { addDays } = require('../src/services/vehicleTrack.service');

const OWN_VEHICLE = 'V-test000000ab';          // seeded: serves __TSCH (__TAFF), driven by __test_driver
const OTHER_AFF = '__TAFFT';
const OTHER_SCHOOL = '__TSCHT';
const OTHER_VEHICLE = 'V-testT0000001';
const OTHER_STUDENT = 99797;
const yesterday = addDays(todayBangkok(), -1);
const bkkIso = (hms) => new Date(`${yesterday}T${hms}+07:00`).toISOString();

const db = () => getTestConnection();
const login = async (username) => (await request(app).post('/api/auth/login')
  .send({ username, password: 'testpass123' })).body.data?.access_token || '';
const tokens = {};

async function cleanup(conn) {
  await conn.query('DELETE FROM vehicle_location_history WHERE vehicle_id IN (?, ?)', [OWN_VEHICLE, OTHER_VEHICLE]);
  await conn.query('DELETE FROM vehicle_latest_locations WHERE vehicle_id IN (?, ?)', [OWN_VEHICLE, OTHER_VEHICLE]);
  await conn.query('DELETE FROM daily_status WHERE student_id = ?', [OTHER_STUDENT]);
  await conn.query('DELETE FROM students WHERE id = ?', [OTHER_STUDENT]);
  await conn.query('DELETE FROM vehicles WHERE id = ?', [OTHER_VEHICLE]);
  await conn.query('DELETE FROM schools WHERE id = ?', [OTHER_SCHOOL]);
  await conn.query('DELETE FROM affiliations WHERE id = ?', [OTHER_AFF]);
}

beforeAll(async () => {
  const conn = await db();
  await cleanup(conn);
  await conn.query(`INSERT INTO affiliations (id, name) VALUES (?, '__Track Aff')`, [OTHER_AFF]);
  await conn.query(`INSERT INTO schools (id, name, affiliation_id) VALUES (?, '__Track School', ?)`, [OTHER_SCHOOL, OTHER_AFF]);
  await conn.query(`INSERT INTO vehicles (id, plate_no, normalized_plate, vehicle_type)
                    VALUES (?, '__TEST TRACK T01', '__testtrackt01', 'รถตู้')`, [OTHER_VEHICLE]);
  await conn.query(
    `INSERT INTO students (id, cid_hash, prefix, first_name, last_name, grade, classroom,
                           school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
     VALUES (?, SHA2('3333333333333', 256), 'เด็กชาย', '__Track', 'Pupil', 'ป.3', '1', ?, ?, TRUE, TRUE, '2568-2')`,
    [OTHER_STUDENT, OTHER_SCHOOL, OTHER_VEHICLE]);
  // Two history fixes per vehicle, yesterday 06:00 Bangkok (Bangkok literal, pool is +07:00).
  for (const vid of [OWN_VEHICLE, OTHER_VEHICLE]) {
    await conn.query(
      `INSERT INTO vehicle_location_history (vehicle_id, latitude, longitude, accuracy_meters, speed_mps, recorded_at)
       VALUES (?, 18.29, 99.49, 10, 5, ?), (?, 18.291, 99.49, 10, 5, ?)`,
      [vid, `${yesterday} 06:00:00.000`, vid, `${yesterday} 06:00:15.000`]);
  }
  await conn.end();
  tokens.school = await login('__test_school');
  tokens.affiliation = await login('__test_affiliation');
  tokens.province = await login('__test_province');
  tokens.driver = await login('__TEST PLATE 9999');
});

afterAll(async () => {
  const conn = await db();
  await cleanup(conn);
  await conn.end();
});

const get = (role, path) => request(app).get(`/api/${role}${path}`).set('Authorization', `Bearer ${tokens[role]}`);

describe('route replay — real SQL scope', () => {
  test('school reads its own vehicle\'s Bangkok day', async () => {
    const res = await get('school', `/vehicles/${OWN_VEHICLE}/track?date=${yesterday}`);
    expect(res.status).toBe(200);
    expect(res.body.data.summary.point_count).toBe(2);
    expect(res.body.data.points[0].t).toBe(bkkIso('06:00:00'));
    expect(res.body.data.summary.distance_km).toBeGreaterThan(0.1);
  });

  test('school cannot read another school\'s vehicle', async () => {
    expect((await get('school', `/vehicles/${OTHER_VEHICLE}/track?date=${yesterday}`)).status).toBe(404);
    expect((await get('school', `/vehicles/${OTHER_VEHICLE}/track-days`)).status).toBe(404);
  });

  test('affiliation boundary', async () => {
    expect((await get('affiliation', `/vehicles/${OWN_VEHICLE}/track?date=${yesterday}`)).status).toBe(200);
    expect((await get('affiliation', `/vehicles/${OTHER_VEHICLE}/track?date=${yesterday}`)).status).toBe(404);
  });

  test('province reads both; track-days lists the 7-day window with yesterday filled', async () => {
    expect((await get('province', `/vehicles/${OTHER_VEHICLE}/track?date=${yesterday}`)).status).toBe(200);
    const res = await get('province', `/vehicles/${OWN_VEHICLE}/track-days`);
    expect(res.status).toBe(200);
    expect(res.body.data.days).toHaveLength(7);
    const y = res.body.data.days.find(d => d.date === yesterday);
    expect(y.point_count).toBe(2);
  });
});

describe('driver batch flush — real SQL', () => {
  const pts = (...hms) => hms.map(t => ({ latitude: 18.3, longitude: 99.5, accuracy_meters: 8, recorded_at: bkkIso(t) }));
  const post = (points) => request(app).post('/api/driver/vehicle-location/batch')
    .set('Authorization', `Bearer ${tokens.driver}`).send({ points });

  test('stores in-window points, ignores off-hours, and is idempotent on retry', async () => {
    const first = await post(pts('06:30:00', '06:30:15', '12:00:00'));
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ accepted: 2, rejected: 1 });
    const again = await post(pts('06:30:00', '06:30:15', '06:30:30'));
    expect(again.body.data).toMatchObject({ accepted: 1, duplicates: 2 });

    const conn = await db();
    const [[{ n }]] = await conn.query(
      `SELECT COUNT(*) n FROM vehicle_location_history
       WHERE vehicle_id = ? AND recorded_at >= ? AND recorded_at < ?`,
      [OWN_VEHICLE, `${yesterday} 06:30:00`, `${yesterday} 06:31:00`]);
    // The live row took the newest fix, received_at no later than that fix
    const [[live]] = await conn.query(
      'SELECT recorded_at, received_at FROM vehicle_latest_locations WHERE vehicle_id = ?', [OWN_VEHICLE]);
    await conn.end();
    expect(Number(n)).toBe(3);
    expect(new Date(live.recorded_at).toISOString()).toBe(bkkIso('06:30:30'));
    expect(new Date(live.received_at).getTime()).toBeLessThanOrEqual(new Date(live.recorded_at).getTime());
  });

  test('an older flush never drags the live row backwards', async () => {
    await post(pts('06:10:00'));
    const conn = await db();
    const [[live]] = await conn.query('SELECT recorded_at FROM vehicle_latest_locations WHERE vehicle_id = ?', [OWN_VEHICLE]);
    await conn.end();
    expect(new Date(live.recorded_at).toISOString()).toBe(bkkIso('06:30:30'));
  });
});
