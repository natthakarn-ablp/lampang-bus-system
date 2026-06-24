'use strict';

/**
 * driverOverrideIndicator.test.js — Phase 10.8F-B
 *
 * Verifies that GET /api/driver/roster exposes per-student/per-session
 * `*_override_by_school` booleans + `*_override_at` timestamps, sourced
 * from `audit_logs` rows with `entity_type='checkin_override'`. Reason
 * and actor identity are deliberately NOT in the response (PDPA).
 *
 * Uses the shared __TEST* fixture (driver = __TEST PLATE 9999, student
 * 99999). Seeds audit_logs rows directly via SQL; cleans up after each
 * test so cases don't leak into each other.
 */

require('dotenv').config();
const request = require('supertest');
const { getTestConnection } = require('./dbHelper');
const app     = require('../src/app');

const DRIVER          = { username: '__TEST PLATE 9999', password: 'testpass123' };
const TEST_STUDENT_ID = 99999;
let driverToken = '';
let schoolUserId = null;

// Guarded connection factory (defense-in-depth, issue #8): getTestConnection()
// asserts the disposable-test-DB guard before opening the socket. Returns a
// Promise<Connection>, so existing `await db()` call sites are unchanged.
function db() {
  return getTestConnection();
}

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data?.access_token || '';
}

async function seedOverrideAudit(conn, { studentId, session, status = 'CHECKED_IN', userId, checkinLogId }) {
  const newValue = JSON.stringify({
    school_id: '__TSCH',
    student_id: studentId,
    student_name: '__Test Student',
    vehicle_id: 'V-test000000ab',
    plate_no: '__TEST PLATE 9999',
    session,
    status,
    reason: 'private — should not surface to driver',
    confirmed_by_user_id: userId,
    confirmed_by_role: 'school',
    confirmed_by_display_name: '__test_school',
    override_checkin_log_id: checkinLogId,
    timestamp_utc: new Date().toISOString(),
  });
  const oldValue = JSON.stringify({ morning_done: false, evening_done: false, morning_ts: null, evening_ts: null });
  const [r] = await conn.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value)
     VALUES (?, 'UPDATE', 'checkin_override', ?, ?, ?)`,
    [userId, String(studentId), oldValue, newValue]
  );
  return r.insertId;
}

async function cleanupOverrideAudit(conn) {
  await conn.query(
    `DELETE FROM audit_logs
     WHERE entity_type = 'checkin_override'
       AND entity_id IN (?, ?)`,
    [String(TEST_STUDENT_ID), '99998']
  );
}

beforeAll(async () => {
  driverToken = await login(DRIVER);
  const conn = await db();
  const [[u]] = await conn.query(
    `SELECT id FROM users WHERE username = '__test_school' LIMIT 1`
  );
  schoolUserId = u?.id || 1;
  await cleanupOverrideAudit(conn);
  await conn.end();
});

afterEach(async () => {
  const conn = await db();
  await cleanupOverrideAudit(conn);
  await conn.end();
});

// ─── 1. Field shape on a non-overridden student ──────────────────────────────

describe('GET /api/driver/roster — override indicator field shape', () => {
  test('non-overridden student returns both booleans=false and timestamps=null', async () => {
    const res = await request(app)
      .get('/api/driver/roster')
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(200);
    const s = res.body.data.students.find(x => x.id === TEST_STUDENT_ID);
    expect(s).toBeDefined();
    expect(s).toHaveProperty('morning_override_by_school', false);
    expect(s).toHaveProperty('evening_override_by_school', false);
    expect(s.morning_override_at).toBeNull();
    expect(s.evening_override_at).toBeNull();
  });
});

// ─── 2. Morning override only ─────────────────────────────────────────────────

describe('GET /api/driver/roster — morning override sets morning flag only', () => {
  test('morning override → morning=true, evening=false', async () => {
    const conn = await db();
    await seedOverrideAudit(conn, {
      studentId: TEST_STUDENT_ID, session: 'morning', userId: schoolUserId, checkinLogId: 99000001,
    });
    await conn.end();

    const res = await request(app)
      .get('/api/driver/roster')
      .set('Authorization', `Bearer ${driverToken}`);

    const s = res.body.data.students.find(x => x.id === TEST_STUDENT_ID);
    expect(s.morning_override_by_school).toBe(true);
    expect(s.evening_override_by_school).toBe(false);
    expect(s.morning_override_at).not.toBeNull();
    expect(s.evening_override_at).toBeNull();
  });
});

// ─── 3. Evening override only ────────────────────────────────────────────────

describe('GET /api/driver/roster — evening override sets evening flag only', () => {
  test('evening override → evening=true, morning=false', async () => {
    const conn = await db();
    await seedOverrideAudit(conn, {
      studentId: TEST_STUDENT_ID, session: 'evening', status: 'CHECKED_OUT',
      userId: schoolUserId, checkinLogId: 99000002,
    });
    await conn.end();

    const res = await request(app)
      .get('/api/driver/roster')
      .set('Authorization', `Bearer ${driverToken}`);

    const s = res.body.data.students.find(x => x.id === TEST_STUDENT_ID);
    expect(s.evening_override_by_school).toBe(true);
    expect(s.morning_override_by_school).toBe(false);
    expect(s.evening_override_at).not.toBeNull();
    expect(s.morning_override_at).toBeNull();
  });
});

// ─── 4. Duplicate audit rows do not duplicate roster row ─────────────────────

describe('GET /api/driver/roster — multiple audit rows do not duplicate student row', () => {
  test('two morning override audits → still one roster row, morning=true', async () => {
    const conn = await db();
    await seedOverrideAudit(conn, {
      studentId: TEST_STUDENT_ID, session: 'morning', userId: schoolUserId, checkinLogId: 99000003,
    });
    await seedOverrideAudit(conn, {
      studentId: TEST_STUDENT_ID, session: 'morning', userId: schoolUserId, checkinLogId: 99000004,
    });
    await conn.end();

    const res = await request(app)
      .get('/api/driver/roster')
      .set('Authorization', `Bearer ${driverToken}`);

    const matches = res.body.data.students.filter(x => x.id === TEST_STUDENT_ID);
    expect(matches.length).toBe(1);
    expect(matches[0].morning_override_by_school).toBe(true);
  });
});

// ─── 5. Driver cannot see override for a student outside their vehicle ──────

describe('GET /api/driver/roster — scope isolation', () => {
  test('override on student NOT in driver vehicle does not appear in driver roster', async () => {
    // Use an unrelated student id (99998 — does not exist in __TEST vehicle)
    const conn = await db();
    await seedOverrideAudit(conn, {
      studentId: 99998, session: 'morning', userId: schoolUserId, checkinLogId: 99000005,
    });
    await conn.end();

    const res = await request(app)
      .get('/api/driver/roster')
      .set('Authorization', `Bearer ${driverToken}`);

    const allIds = res.body.data.students.map(x => x.id);
    expect(allIds).not.toContain(99998);

    // Test student 99999 (no audit row) must still report both flags false
    const own = res.body.data.students.find(x => x.id === TEST_STUDENT_ID);
    expect(own.morning_override_by_school).toBe(false);
    expect(own.evening_override_by_school).toBe(false);
  });
});

// ─── 6. Response does not expose reason / actor name ─────────────────────────

describe('GET /api/driver/roster — privacy: no reason / no actor name', () => {
  test('roster row carries only booleans + timestamps, no override metadata leaks', async () => {
    const conn = await db();
    await seedOverrideAudit(conn, {
      studentId: TEST_STUDENT_ID, session: 'morning', userId: schoolUserId, checkinLogId: 99000006,
    });
    await conn.end();

    const res = await request(app)
      .get('/api/driver/roster')
      .set('Authorization', `Bearer ${driverToken}`);

    const s = res.body.data.students.find(x => x.id === TEST_STUDENT_ID);
    expect(s).not.toHaveProperty('reason');
    expect(s).not.toHaveProperty('override_reason');
    expect(s).not.toHaveProperty('confirmed_by_display_name');
    expect(s).not.toHaveProperty('confirmed_by_user_id');
    expect(s).not.toHaveProperty('confirmed_by_role');

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('private — should not surface to driver');
    expect(serialized).not.toContain('confirmed_by_user_id');
    expect(serialized).not.toContain('confirmed_by_display_name');
  });
});

// ─── 7. Yesterday's override does NOT mark today ─────────────────────────────

describe('GET /api/driver/roster — only today counts', () => {
  test('audit row from yesterday is ignored', async () => {
    const conn = await db();
    const newValue = JSON.stringify({
      student_id: TEST_STUDENT_ID, session: 'morning', status: 'CHECKED_IN',
      reason: 'old', confirmed_by_user_id: schoolUserId,
      override_checkin_log_id: 99000007, timestamp_utc: '2026-05-18T07:00:00Z',
    });
    await conn.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value, created_at)
       VALUES (?, 'UPDATE', 'checkin_override', ?, ?, DATE_SUB(CURDATE(), INTERVAL 1 DAY))`,
      [schoolUserId, String(TEST_STUDENT_ID), newValue]
    );
    await conn.end();

    const res = await request(app)
      .get('/api/driver/roster')
      .set('Authorization', `Bearer ${driverToken}`);

    const s = res.body.data.students.find(x => x.id === TEST_STUDENT_ID);
    expect(s.morning_override_by_school).toBe(false);
    expect(s.evening_override_by_school).toBe(false);
  });
});
