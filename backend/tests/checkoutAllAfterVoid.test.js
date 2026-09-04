'use strict';

/**
 * checkoutAllAfterVoid.test.js  (CS5-01 — regression)
 *
 * INTEGRATION — needs the disposable lampang_bus_test DB (globalSetup seeds the
 * __TEST driver + vehicle + student 99999). Never run on the prod box.
 *
 * Defect (docs/audit/core-scope-defect-hunt-2026-09-04.md §CS5-01): after a
 * check-in recorded against the WRONG child was voided, "ส่งนักเรียนทั้งหมด"
 * (POST /api/driver/checkout-all) still recorded that child as dropped off and
 * queued a checkout notification to their parent — the system told a parent
 * their child rode a bus after being told explicitly that the record was wrong.
 * Root cause: eligibility was read from checkin_logs only, which keeps the
 * original CHECKED_IN row after a void, while the void resets daily_status.
 *
 * These tests assert the observable end state (rows in checkin_logs /
 * daily_status), not just the HTTP body, and each has a control that proves the
 * un-voided path still works.
 */

require('dotenv').config();
const request = require('supertest');
const { getTestConnection, getTestPool } = require('./dbHelper');
const app = require('../src/app');
const { getNoShowStudents } = require('../src/services/checkin.service');

const DRIVER = { username: '__TEST PLATE 9999', password: 'testpass123' };
const VEHICLE_ID = 'V-test000000ab';
const STUDENT_ID = 99999;
const SCHOOL_ID = '__TSCH';

let token = '';
let pool;

const auth = (r) => r.set('Authorization', `Bearer ${token}`);
const checkin  = (session) => auth(request(app).post('/api/driver/checkin')).send({ student_id: STUDENT_ID, session });
const voidLog  = (logId)   => auth(request(app).post(`/api/driver/checkin/${logId}/void`)).send({ reason: 'บันทึกผิดคน ยกเลิกรายการ' });
const checkoutAll = (session) => auth(request(app).post('/api/driver/checkout-all')).send({ session });

async function cleanupToday() {
  const conn = await getTestConnection();
  await conn.query('DELETE FROM checkin_logs WHERE vehicle_id = ? AND check_date = CURDATE()', [VEHICLE_ID]);
  await conn.query('DELETE FROM daily_status  WHERE vehicle_id = ? AND check_date = CURDATE()', [VEHICLE_ID]);
  await conn.query('DELETE FROM notifications WHERE student_id = ?', [STUDENT_ID]);
  await conn.end();
}

async function logsToday() {
  const conn = await getTestConnection();
  const [rows] = await conn.query(
    'SELECT id, status, session FROM checkin_logs WHERE student_id = ? AND check_date = CURDATE() ORDER BY id',
    [STUDENT_ID]
  );
  const [[ds]] = await conn.query(
    'SELECT morning_done, evening_done FROM daily_status WHERE student_id = ? AND check_date = CURDATE()',
    [STUDENT_ID]
  );
  await conn.end();
  return { rows, ds: ds || null };
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

describe('CS5-01 — a voided check-in must not be droppable by checkout-all', () => {
  it('checkout-all skips a student whose boarding was voided', async () => {
    const inRes = await checkin('evening');
    expect(inRes.status).toBe(201);

    const vRes = await voidLog(inRes.body.data.log_id);
    expect(vRes.status).toBe(201);
    expect(vRes.body.data.status).toBe('CANCELLED');

    const coRes = await checkoutAll('evening');
    expect(coRes.status).toBe(201);
    expect(coRes.body.data.succeeded.map(s => s.student_id)).not.toContain(STUDENT_ID);

    // The end state is what matters: no CHECKED_OUT row was written and the
    // session flag the void reset stays reset.
    const { rows, ds } = await logsToday();
    expect(rows.map(r => r.status)).toEqual(['CHECKED_IN', 'CANCELLED']);
    expect(rows.some(r => r.status === 'CHECKED_OUT')).toBe(false);
    expect(!!ds?.evening_done).toBe(false);
  });

  it('control — a boarding that was NOT voided is still dropped by checkout-all', async () => {
    const inRes = await checkin('evening');
    expect(inRes.status).toBe(201);

    const coRes = await checkoutAll('evening');
    expect(coRes.status).toBe(201);
    expect(coRes.body.data.succeeded.map(s => s.student_id)).toContain(STUDENT_ID);

    const { rows } = await logsToday();
    expect(rows.map(r => r.status)).toEqual(['CHECKED_IN', 'CHECKED_OUT']);
  });

  it('control — a re-boarding after the void is droppable again', async () => {
    const first = await checkin('evening');
    await voidLog(first.body.data.log_id);
    const second = await checkin('evening');
    expect(second.status).toBe(201);

    const coRes = await checkoutAll('evening');
    expect(coRes.body.data.succeeded.map(s => s.student_id)).toContain(STUDENT_ID);
  });
});

describe('CS5-01 (same root cause) — no-show returns a student whose boarding was voided', () => {
  it('the student leaves the no-show list on check-in and returns after the void', async () => {
    const before = await getNoShowStudents(pool, { schoolId: SCHOOL_ID, session: 'evening' });
    expect(before.map(s => s.id)).toContain(STUDENT_ID);

    const inRes = await checkin('evening');
    const during = await getNoShowStudents(pool, { schoolId: SCHOOL_ID, session: 'evening' });
    expect(during.map(s => s.id)).not.toContain(STUDENT_ID);

    const vRes = await voidLog(inRes.body.data.log_id);
    expect(vRes.status).toBe(201);
    const after = await getNoShowStudents(pool, { schoolId: SCHOOL_ID, session: 'evening' });
    expect(after.map(s => s.id)).toContain(STUDENT_ID);
  });
});
