'use strict';

/**
 * driver.test.js
 *
 * Integration tests for:
 *   GET  /api/driver/roster
 *   POST /api/driver/checkin
 *   POST /api/driver/checkout
 *   POST /api/driver/checkin-all
 *   POST /api/driver/emergency
 *   GET  /api/driver/status-today
 *
 * Requires a running MySQL instance with schema + test data from tests/setup.js.
 */

require('dotenv').config();
const request = require('supertest');
const mysql   = require('mysql2/promise');
const app     = require('../src/app');

// username = plate_no — matches the new vehicle-based resolution strategy
const DRIVER   = { username: '__TEST PLATE 9999', password: 'testpass123' };
const PROVINCE = { username: '__test_province',  password: 'testpass123' };
const TEST_STUDENT_ID = 99999;

let driverToken   = '';
let provinceToken = '';

// ─── helpers ─────────────────────────────────────────────────────────────────

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data?.access_token || '';
}

async function cleanupTodayLogs() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    database: process.env.DB_NAME || 'lampang_bus',
    user: process.env.DB_USER || 'lampang',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4',
  });
  await conn.query(`DELETE FROM checkin_logs WHERE vehicle_id = 'V-test000000ab' AND check_date = CURDATE()`);
  await conn.query(`DELETE FROM daily_status  WHERE vehicle_id = 'V-test000000ab' AND check_date = CURDATE()`);
  await conn.end();
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  driverToken   = await login(DRIVER);
  provinceToken = await login(PROVINCE);
});

afterEach(async () => {
  // Clean today's checkin records between tests so tests are independent
  await cleanupTodayLogs();
});

// ─── Auth enforcement ─────────────────────────────────────────────────────────

describe('RBAC — driver routes', () => {
  it('GET /roster returns 401 without token', async () => {
    const res = await request(app).get('/api/driver/roster');
    expect(res.status).toBe(401);
  });

  it('GET /roster returns 403 for non-driver role', async () => {
    const res = await request(app)
      .get('/api/driver/roster')
      .set('Authorization', `Bearer ${provinceToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('POST /emergency returns 401 without token', async () => {
    const res = await request(app).post('/api/driver/emergency').send({ detail: 'test' });
    expect(res.status).toBe(401);
  });
});

// ─── GET /roster ─────────────────────────────────────────────────────────────

describe('GET /api/driver/roster', () => {
  it('returns 200 with vehicle info and student list', async () => {
    const res = await request(app)
      .get('/api/driver/roster')
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('vehicle');
    expect(res.body.data.vehicle).toHaveProperty('plate_no', '__TEST PLATE 9999');
    expect(res.body.data).toHaveProperty('students');
    expect(Array.isArray(res.body.data.students)).toBe(true);
    expect(res.body.data.students.length).toBeGreaterThan(0);
  });

  it('students include expected fields (name, grade, classroom, status)', async () => {
    const res = await request(app)
      .get('/api/driver/roster')
      .set('Authorization', `Bearer ${driverToken}`);

    const student = res.body.data.students[0];
    expect(student).toHaveProperty('first_name');
    expect(student).toHaveProperty('last_name');
    expect(student).toHaveProperty('grade');
    expect(student).toHaveProperty('classroom');
    expect(student).toHaveProperty('morning_done');
    expect(student).toHaveProperty('evening_done');
    // cid_hash must NOT be exposed
    expect(student).not.toHaveProperty('cid');
  });

  it('?session=morning filters only morning-enabled students', async () => {
    const res = await request(app)
      .get('/api/driver/roster?session=morning')
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(200);
    // All returned students should have morning_enabled (the field is in response)
    res.body.data.students.forEach((s) => {
      expect(s.morning_enabled).toBe(1); // MySQL TINYINT(1) comes as 1
    });
  });

  it('?session=invalid returns 400', async () => {
    const res = await request(app)
      .get('/api/driver/roster?session=noon')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(400);
  });
});

// ─── POST /checkin ────────────────────────────────────────────────────────────

describe('POST /api/driver/checkin', () => {
  it('returns 400 when body is empty', async () => {
    const res = await request(app)
      .post('/api/driver/checkin')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid session', async () => {
    const res = await request(app)
      .post('/api/driver/checkin')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'afternoon' });
    expect(res.status).toBe(400);
  });

  it('checks in a student successfully', async () => {
    const res = await request(app)
      .post('/api/driver/checkin')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('log_id');
    expect(res.body.data.status).toBe('CHECKED_IN');
    expect(res.body.data.session).toBe('morning');
  });

  it('roster reflects CHECKED_IN status after checkin', async () => {
    await request(app)
      .post('/api/driver/checkin')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });

    const roster = await request(app)
      .get('/api/driver/roster?session=morning')
      .set('Authorization', `Bearer ${driverToken}`);

    const student = roster.body.data.students.find((s) => s.id === TEST_STUDENT_ID);
    expect(student).toBeDefined();
    expect(student.morning_done).toBe(1);
  });

  it('returns 404 when student not in driver vehicle', async () => {
    const res = await request(app)
      .post('/api/driver/checkin')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: 88888, session: 'morning' }); // non-existent student
    expect(res.status).toBe(404);
  });
});

// ─── POST /checkout ───────────────────────────────────────────────────────────

describe('POST /api/driver/checkout', () => {
  it('checks out a student successfully', async () => {
    const res = await request(app)
      .post('/api/driver/checkout')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('CHECKED_OUT');
  });
});

// ─── POST /checkin-all ────────────────────────────────────────────────────────

describe('POST /api/driver/checkin-all', () => {
  it('returns 400 when session is missing', async () => {
    const res = await request(app)
      .post('/api/driver/checkin-all')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('checks in all pending students', async () => {
    const res = await request(app)
      .post('/api/driver/checkin-all')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ session: 'morning' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('succeeded');
    expect(res.body.data).toHaveProperty('failed');
    expect(res.body.data.succeeded.length).toBeGreaterThan(0);
    expect(res.body.data.failed.length).toBe(0);
  });

  it('second checkin-all finds no pending students (all already done)', async () => {
    // First batch
    await request(app)
      .post('/api/driver/checkin-all')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ session: 'morning' });

    // Second batch — all should already be morning_done
    const res = await request(app)
      .post('/api/driver/checkin-all')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ session: 'morning' });

    expect(res.status).toBe(201);
    expect(res.body.data.succeeded.length).toBe(0);
  });
});

// ─── POST /emergency ──────────────────────────────────────────────────────────

describe('POST /api/driver/emergency', () => {
  it('returns 400 when detail is missing', async () => {
    const res = await request(app)
      .post('/api/driver/emergency')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('reports emergency successfully', async () => {
    const res = await request(app)
      .post('/api/driver/emergency')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ detail: 'รถเสีย', note: 'ยางแตก' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.plate_no).toBe('__TEST PLATE 9999');
  });
});

// ─── GET /status-today ────────────────────────────────────────────────────────

describe('GET /api/driver/status-today', () => {
  it('returns summary with correct structure', async () => {
    const res = await request(app)
      .get('/api/driver/status-today')
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('summary');
    expect(res.body.data).toHaveProperty('recent');
    expect(res.body.data.summary).toHaveProperty('total');
    expect(res.body.data.summary).toHaveProperty('morning_done');
    expect(res.body.data.summary).toHaveProperty('morning_pending');
  });

  it('morning_done increases after a checkin', async () => {
    const before = await request(app)
      .get('/api/driver/status-today')
      .set('Authorization', `Bearer ${driverToken}`);
    const doneBefore = parseInt(before.body.data.summary.morning_done, 10);

    await request(app)
      .post('/api/driver/checkin')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });

    const after = await request(app)
      .get('/api/driver/status-today')
      .set('Authorization', `Bearer ${driverToken}`);
    const doneAfter = parseInt(after.body.data.summary.morning_done, 10);

    expect(doneAfter).toBe(doneBefore + 1);
  });

  it('recent log appears after checkin', async () => {
    await request(app)
      .post('/api/driver/checkin')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });

    const res = await request(app)
      .get('/api/driver/status-today')
      .set('Authorization', `Bearer ${driverToken}`);

    const recent = res.body.data.recent;
    expect(recent.length).toBeGreaterThan(0);
    expect(recent[0]).toHaveProperty('student_name');
    expect(recent[0]).toHaveProperty('status');
  });
});

// ─── Standard response format ─────────────────────────────────────────────────

describe('Standard response format — driver routes', () => {
  it('all successful responses have success:true, message, data', async () => {
    const res = await request(app)
      .get('/api/driver/roster')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('data');
  });
});
