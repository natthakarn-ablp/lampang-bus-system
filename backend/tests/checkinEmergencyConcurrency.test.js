'use strict';

/**
 * checkinEmergencyConcurrency.test.js  (CS5-04 — regression)
 *
 * INTEGRATION — needs the disposable lampang_bus_test DB (globalSetup seeds the
 * __TEST driver + vehicle + student 99999). Never run on the prod box.
 *
 * Defect (docs/audit/core-scope-defect-hunt-2026-09-04.md §CS5-04): the
 * duplicate guards for check-in and for the emergency button were read-then-write
 * with no lock, so they only caught taps far enough apart for the first
 * transaction to commit. Three SIMULTANEOUS taps produced three checkin_logs rows
 * (and three parent notifications), and three emergency_logs rows.
 *
 * Every case here fires with Promise.all — genuinely parallel requests, not an
 * awaited sequence (tests/emergencyDoubleTap.test.js already covers the awaited
 * sequence and passed even while the race was open). Each parallel case is
 * paired with the sequential control it must not regress.
 */

require('dotenv').config();
const request = require('supertest');
const { getTestConnection } = require('./dbHelper');
const app = require('../src/app');

const DRIVER = { username: '__TEST PLATE 9999', password: 'testpass123' };
const SCHOOL = { username: '__test_school',     password: 'testpass123' };
const VEHICLE_ID = 'V-test000000ab';
const STUDENT_ID = 99999;
const DETAIL_PARALLEL   = '__cs504 เบรกแตก พร้อมกัน';
const DETAIL_SEQUENTIAL = '__cs504 เบรกแตก เรียงลำดับ';

let driverToken = '';
let schoolToken = '';

const login = async (creds) =>
  (await request(app).post('/api/auth/login').send(creds)).body.data?.access_token || '';

const checkin = (session) => request(app)
  .post('/api/driver/checkin')
  .set('Authorization', `Bearer ${driverToken}`)
  .send({ student_id: STUDENT_ID, session });

const override = (session) => request(app)
  .post('/api/school/checkin-override')
  .set('Authorization', `Bearer ${schoolToken}`)
  .send({ student_id: STUDENT_ID, session, status: 'CHECKED_IN', reason: 'คนขับยังไม่ได้กดยืนยัน' });

const emergency = (detail) => request(app)
  .post('/api/driver/emergency')
  .set('Authorization', `Bearer ${driverToken}`)
  .send({ detail });

async function cleanup() {
  const conn = await getTestConnection();
  await conn.query('DELETE FROM checkin_logs WHERE vehicle_id = ? AND check_date = CURDATE()', [VEHICLE_ID]);
  await conn.query('DELETE FROM daily_status  WHERE vehicle_id = ? AND check_date = CURDATE()', [VEHICLE_ID]);
  await conn.query('DELETE FROM notifications WHERE student_id = ?', [STUDENT_ID]);
  await conn.query('DELETE FROM audit_logs WHERE entity_type = ? AND entity_id = ?', ['checkin_override', String(STUDENT_ID)]);
  await conn.query(
    'DELETE FROM audit_logs WHERE entity_type = ? AND JSON_EXTRACT(new_value, "$.detail") IN (?, ?)',
    ['emergency', DETAIL_PARALLEL, DETAIL_SEQUENTIAL]
  );
  await conn.query('DELETE FROM emergency_logs WHERE detail IN (?, ?)', [DETAIL_PARALLEL, DETAIL_SEQUENTIAL]);
  await conn.end();
}

async function checkinLogs(session) {
  const conn = await getTestConnection();
  const [rows] = await conn.query(
    `SELECT id, status FROM checkin_logs
      WHERE student_id = ? AND session = ? AND check_date = CURDATE() ORDER BY id`,
    [STUDENT_ID, session]
  );
  await conn.end();
  return rows;
}

async function countEmergencies(detail) {
  const conn = await getTestConnection();
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM emergency_logs WHERE detail = ?', [detail]);
  await conn.end();
  return n;
}

beforeAll(async () => {
  driverToken = await login(DRIVER);
  schoolToken = await login(SCHOOL);
});

beforeEach(cleanup);
afterAll(cleanup);

describe('CS5-04 — check-in duplicate guard under real concurrency', () => {
  test('three SIMULTANEOUS identical check-ins create exactly ONE row', async () => {
    const results = await Promise.all([checkin('morning'), checkin('morning'), checkin('morning')]);
    const statuses = results.map(r => r.status);

    expect(statuses.filter(s => s === 201)).toHaveLength(1);
    expect(statuses.filter(s => s === 409)).toHaveLength(2);
    // No request may fail with anything other than the duplicate rejection.
    expect(statuses.every(s => s === 201 || s === 409)).toBe(true);

    const rows = await checkinLogs('morning');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('CHECKED_IN');
  });

  test('five SIMULTANEOUS identical check-ins create exactly ONE row', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => checkin('evening')));
    expect(results.filter(r => r.status === 201)).toHaveLength(1);
    expect(results.filter(r => r.status === 409)).toHaveLength(4);

    expect(await checkinLogs('evening')).toHaveLength(1);
  });

  test('driver check-in and school override fired together record ONE boarding', async () => {
    const [d, s] = await Promise.all([checkin('morning'), override('morning')]);
    const accepted = [d, s].filter(r => r.status === 201);

    expect(accepted).toHaveLength(1);
    expect(await checkinLogs('morning')).toHaveLength(1);
  });

  test('control — sequential double-tap still answers 201 then 409', async () => {
    const first = await checkin('morning');
    expect(first.status).toBe(201);
    const second = await checkin('morning');
    expect(second.status).toBe(409);
    expect(second.body.message).toBe('รายการนี้ถูกบันทึกไปแล้ว');

    expect(await checkinLogs('morning')).toHaveLength(1);
  });

  test('control — a check-OUT after the check-in is still a valid transition', async () => {
    expect((await checkin('morning')).status).toBe(201);
    const out = await request(app)
      .post('/api/driver/checkout')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: STUDENT_ID, session: 'morning' });
    expect(out.status).toBe(201);

    const rows = await checkinLogs('morning');
    expect(rows.map(r => r.status)).toEqual(['CHECKED_IN', 'CHECKED_OUT']);
  });
});

describe('CS5-04 — emergency double-tap guard under real concurrency', () => {
  test('three SIMULTANEOUS identical emergency reports create exactly ONE row', async () => {
    const results = await Promise.all([
      emergency(DETAIL_PARALLEL), emergency(DETAIL_PARALLEL), emergency(DETAIL_PARALLEL),
    ]);

    const created = results.filter(r => r.status === 201);
    const duplicates = results.filter(r => r.status === 200);
    expect(created).toHaveLength(1);
    expect(duplicates).toHaveLength(2);
    expect(created[0].body.data.duplicate).toBe(false);
    duplicates.forEach(r => {
      expect(r.body.data.duplicate).toBe(true);
      expect(r.body.data.id).toBe(created[0].body.data.id);
    });

    expect(await countEmergencies(DETAIL_PARALLEL)).toBe(1);
  });

  test('control — sequential repeats still collapse into the first report', async () => {
    const first = await emergency(DETAIL_SEQUENTIAL);
    expect(first.status).toBe(201);
    const second = await emergency(DETAIL_SEQUENTIAL);
    expect(second.status).toBe(200);
    expect(second.body.data.duplicate).toBe(true);
    expect(second.body.data.id).toBe(first.body.data.id);

    expect(await countEmergencies(DETAIL_SEQUENTIAL)).toBe(1);
  });

  test('control — a genuinely different report is still recorded', async () => {
    await emergency(DETAIL_SEQUENTIAL);
    const other = await emergency(DETAIL_PARALLEL);
    expect(other.status).toBe(201);
    expect(other.body.data.duplicate).toBe(false);
    expect(await countEmergencies(DETAIL_PARALLEL)).toBe(1);
  });
});
