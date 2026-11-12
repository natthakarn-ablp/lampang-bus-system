'use strict';

/**
 * vehicleTrips.test.js — INTEGRATION (disposable lampang_bus_test DB;
 * tests/setup.js seeds driver __TEST PLATE 9999 on V-test000000ab, pupil 99999
 * of __TSCH in __TAFF, __test_school, __test_affiliation).
 *
 * Several trips per round (migration 062, FEATURE_MULTI_TRIP): the real driver
 * flow — board → cannot start (on board) → drop all → start trip 2 with a
 * reason → cannot stack trip 3 before anyone boards trip 2 — and the school /
 * affiliation summaries.
 */

require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');
const { getTestConnection } = require('./dbHelper');

const DRIVER = { username: '__TEST PLATE 9999', password: 'testpass123' };
const SCHOOL = { username: '__test_school', password: 'testpass123' };
const AFF = { username: '__test_affiliation', password: 'testpass123' };
const VEHICLE_ID = 'V-test000000ab';
const STUDENT_ID = 99999;
const SESSION = 'evening';

let driverToken = '';
let schoolToken = '';
let affToken = '';
let flagBefore;

async function q(sql, params = []) {
  const conn = await getTestConnection();
  try { return (await conn.query(sql, params))[0]; } finally { await conn.end(); }
}

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data.access_token;
}

async function cleanup() {
  await q('DELETE FROM vehicle_trips WHERE vehicle_id = ?', [VEHICLE_ID]);
  await q('DELETE FROM checkin_logs WHERE vehicle_id = ? AND check_date = CURDATE()', [VEHICLE_ID]);
  await q('DELETE FROM daily_status WHERE vehicle_id = ? AND check_date = CURDATE()', [VEHICLE_ID]);
  await q('DELETE FROM notifications WHERE student_id = ?', [STUDENT_ID]);
  await q("DELETE FROM audit_logs WHERE entity_type = 'vehicle_trip' AND entity_id LIKE ?", [`${VEHICLE_ID}:%`]);
}

const asDriver = (r) => r.set('Authorization', `Bearer ${driverToken}`);
const tripState = () => asDriver(request(app).get(`/api/driver/trips?session=${SESSION}`));
const startTrip = (body) => asDriver(request(app).post('/api/driver/trips')).send({ session: SESSION, ...body });

beforeAll(async () => {
  flagBefore = env.features.multiTrip;
  env.features.multiTrip = true;
  await cleanup();
  driverToken = await login(DRIVER);
  schoolToken = await login(SCHOOL);
  affToken = await login(AFF);
});

afterAll(async () => {
  env.features.multiTrip = flagBefore;
  await cleanup();
});

test('driver flow: trip 2 only after the bus is empty, with a reason; no empty stacking', async () => {
  let st = await tripState();
  expect(st.status).toBe(200);
  expect(st.body.data).toMatchObject({ current_trip: 1, on_board: 0, can_start_next: false });

  const board = await asDriver(request(app).post('/api/driver/checkin')).send({ student_id: STUDENT_ID, session: SESSION });
  expect([200, 201]).toContain(board.status);

  st = await tripState();
  expect(st.body.data).toMatchObject({ on_board: 1, can_start_next: false });
  const early = await startTrip({ reason_code: 'SEATS' });
  expect(early.status).toBe(409);

  const drop = await asDriver(request(app).post('/api/driver/checkout-all')).send({ session: SESSION });
  expect([200, 201]).toContain(drop.status);

  st = await tripState();
  expect(st.body.data).toMatchObject({ on_board: 0, can_start_next: true });

  expect((await startTrip({ reason_code: 'OTHER', reason_text: '' })).status).toBe(400);
  const ok = await startTrip({ reason_code: 'SEATS' });
  expect(ok.status).toBe(201);
  expect(ok.body.data).toMatchObject({ trip_no: 2, reason_label: 'ที่นั่งไม่พอ' });

  st = await tripState();
  expect(st.body.data).toMatchObject({ current_trip: 2, boarded_this_trip: 0, can_start_next: false });
  const stacked = await startTrip({ reason_code: 'SEATS' });
  expect(stacked.status).toBe(409);

  const [row] = await q('SELECT trip_no, reason_code, started_by FROM vehicle_trips WHERE vehicle_id = ?', [VEHICLE_ID]);
  expect(row).toMatchObject({ trip_no: 2, reason_code: 'SEATS' });
  const audits = await q("SELECT action FROM audit_logs WHERE entity_type = 'vehicle_trip' AND entity_id = ?", [`${VEHICLE_ID}:${SESSION}:2`]);
  expect(audits).toHaveLength(1);
});

test('school and affiliation see the bus with 2 trips and the reason', async () => {
  for (const [path, token] of [['/api/school/vehicle-trips', schoolToken], ['/api/affiliation/vehicle-trips', affToken]]) {
    const res = await request(app).get(path).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const mine = res.body.data.rows.find((r) => r.vehicle_id === VEHICLE_ID && r.session === SESSION);
    expect(mine).toMatchObject({ trips: 2, reasons: ['ที่นั่งไม่พอ'] });
  }
});

test('flag off: driver and school endpoints answer 404', async () => {
  env.features.multiTrip = false;
  try {
    expect((await tripState()).status).toBe(404);
    expect((await request(app).get('/api/school/vehicle-trips').set('Authorization', `Bearer ${schoolToken}`)).status).toBe(404);
  } finally {
    env.features.multiTrip = true;
  }
});
