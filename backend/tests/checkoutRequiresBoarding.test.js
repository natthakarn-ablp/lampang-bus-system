'use strict';

/**
 * checkoutRequiresBoarding.test.js  (DP-02 — regression)
 *
 * INTEGRATION — disposable test DB only (globalSetup seeds the __TEST driver,
 * vehicle and student 99999).
 *
 * Defect: POST /api/driver/checkout accepted a child who never boarded (or whose
 * boarding was voided) and queued a "dropped off" notification to the parent.
 * checkout-all already refuses this; the single endpoint did not.
 */

require('dotenv').config();
const request = require('supertest');
const { getTestConnection, getTestPool } = require('./dbHelper');
const app = require('../src/app');

const DRIVER = { username: '__TEST PLATE 9999', password: 'testpass123' };
const VEHICLE_ID = 'V-test000000ab';
const STUDENT_ID = 99999;

let token = '';
let pool;

const auth = (r) => r.set('Authorization', `Bearer ${token}`);
const checkin  = (session) => auth(request(app).post('/api/driver/checkin')).send({ student_id: STUDENT_ID, session });
const checkout = (session) => auth(request(app).post('/api/driver/checkout')).send({ student_id: STUDENT_ID, session });

async function cleanupToday() {
  const conn = await getTestConnection();
  await conn.query('DELETE FROM checkin_logs WHERE vehicle_id = ? AND check_date = CURDATE()', [VEHICLE_ID]);
  await conn.query('DELETE FROM daily_status  WHERE vehicle_id = ? AND check_date = CURDATE()', [VEHICLE_ID]);
  await conn.query('DELETE FROM notifications WHERE student_id = ?', [STUDENT_ID]);
  await conn.end();
}

async function counts() {
  const conn = await getTestConnection();
  const [[l]] = await conn.query(
    `SELECT COUNT(*) n FROM checkin_logs WHERE student_id = ? AND check_date = CURDATE() AND status = 'CHECKED_OUT'`, [STUDENT_ID]);
  const [[n]] = await conn.query(
    `SELECT COUNT(*) n FROM notifications WHERE student_id = ? AND notification_type = 'checkout'`, [STUDENT_ID]);
  await conn.end();
  return { logs: l.n, notes: n.n };
}

beforeAll(async () => {
  token = await request(app).post('/api/auth/login').send(DRIVER)
    .then(r => r.body.data?.access_token || '');
  pool = getTestPool();
});
beforeEach(cleanupToday);
afterAll(async () => {
  await cleanupToday();
  if (pool) await pool.end();
});

describe('DP-02 — single checkout requires a prior board', () => {
  it('rejects checkout of a child who never boarded, with no log or parent notification', async () => {
    const res = await checkout('evening');
    expect(res.status).toBe(409);
    expect(await counts()).toEqual({ logs: 0, notes: 0 });
  });

  it('control: checkout after a board still succeeds', async () => {
    expect((await checkin('evening')).status).toBe(201);
    expect((await checkout('evening')).status).toBe(201);
    expect((await counts()).logs).toBe(1);
  });
});
