'use strict';

require('dotenv').config();
const request = require('supertest');
const mysql   = require('mysql2/promise');
const app     = require('../src/app');

const DRIVER      = { username: '__TEST PLATE 9999', password: 'testpass123' };
const SCHOOL      = { username: '__test_school',      password: 'testpass123' };
const AFFILIATION = { username: '__test_affiliation', password: 'testpass123' };
const PROVINCE    = { username: '__test_province',    password: 'testpass123' };
const TEST_STUDENT_ID = 99999;

let driverToken = '', schoolToken = '', affToken = '', provToken = '';

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data.access_token;
}

beforeAll(async () => {
  driverToken = await login(DRIVER);
  schoolToken = await login(SCHOOL);
  affToken    = await login(AFFILIATION);
  provToken   = await login(PROVINCE);
});

afterAll(async () => {
  // Clean up phase 8 test data
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    database: process.env.DB_NAME || 'lampang_bus',
    user: process.env.DB_USER || 'lampang',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4',
  });
  await conn.query(`DELETE FROM student_leaves WHERE student_id = ?`, [TEST_STUDENT_ID]);
  await conn.query(`DELETE FROM roster_change_requests WHERE student_id = ?`, [TEST_STUDENT_ID]);
  await conn.end();
});

// ─── Driver Profile ──────────────────────────────────────────────────────────

describe('Driver Profile', () => {
  test('GET /api/driver/profile returns driver info', async () => {
    const res = await request(app)
      .get('/api/driver/profile')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('name');
    expect(res.body.data).toHaveProperty('plate_no');
    expect(res.body.data).toHaveProperty('vehicle_id');
  });

  test('PUT /api/driver/profile updates allowed fields', async () => {
    const res = await request(app)
      .put('/api/driver/profile')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ phone: '0999999999' });
    expect(res.status).toBe(200);
  });

  test('403 for school role on driver profile', async () => {
    const res = await request(app)
      .get('/api/driver/profile')
      .set('Authorization', `Bearer ${schoolToken}`);
    expect(res.status).toBe(403);
  });
});

// ─── Driver Leave ────────────────────────────────────────────────────────────

describe('Driver Leave', () => {
  let leaveId;

  test('POST /api/driver/leave creates a leave', async () => {
    const res = await request(app)
      .post('/api/driver/leave')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning', reason: 'ป่วย' });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('id');
    leaveId = res.body.data.id;
  });

  test('GET /api/driver/leaves returns leaves for today', async () => {
    const res = await request(app)
      .get('/api/driver/leaves')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('DELETE /api/driver/leave/:id cancels a leave', async () => {
    const res = await request(app)
      .delete(`/api/driver/leave/${leaveId}`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.cancelled).toBe(true);
  });

  test('validates session parameter', async () => {
    const res = await request(app)
      .post('/api/driver/leave')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'invalid' });
    expect(res.status).toBe(400);
  });
});

// ─── Driver Roster Requests ──────────────────────────────────────────────────

describe('Driver Roster Requests', () => {
  let requestId;

  test('POST /api/driver/roster-request creates a request', async () => {
    const res = await request(app)
      .post('/api/driver/roster-request')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, request_type: 'remove', reason: 'ย้ายบ้าน' });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.status).toBe('pending');
    requestId = res.body.data.id;
  });

  test('GET /api/driver/roster-requests lists requests', async () => {
    const res = await request(app)
      .get('/api/driver/roster-requests')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('validates request_type', async () => {
    const res = await request(app)
      .post('/api/driver/roster-request')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, request_type: 'invalid' });
    expect(res.status).toBe(400);
  });
});

// ─── School Approval Workflow ────────────────────────────────────────────────

describe('School Approval Workflow', () => {
  let requestId;

  beforeAll(async () => {
    // Create a fresh request for approval test
    const res = await request(app)
      .post('/api/driver/roster-request')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, request_type: 'remove', reason: 'test approval' });
    requestId = res.body.data.id;
  });

  test('GET /api/school/roster-requests lists pending requests', async () => {
    const res = await request(app)
      .get('/api/school/roster-requests?status=pending')
      .set('Authorization', `Bearer ${schoolToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some(r => r.id === requestId)).toBe(true);
  });

  test('PUT /api/school/roster-requests/:id rejects a request', async () => {
    const res = await request(app)
      .put(`/api/school/roster-requests/${requestId}`)
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ status: 'rejected', review_note: 'ไม่อนุมัติ' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('rejected');
  });

  test('rejected request does not change roster', async () => {
    const res = await request(app)
      .get('/api/driver/roster')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.body.data.students.some(s => s.id === TEST_STUDENT_ID)).toBe(true);
  });

  test('validates status parameter', async () => {
    const res = await request(app)
      .put(`/api/school/roster-requests/${requestId}`)
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ status: 'invalid' });
    expect(res.status).toBe(400);
  });
});

// ─── School Missing ──────────────────────────────────────────────────────────

describe('School Missing Students', () => {
  test('GET /api/school/missing returns missing list', async () => {
    const res = await request(app)
      .get('/api/school/missing?session=morning')
      .set('Authorization', `Bearer ${schoolToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('students');
    expect(res.body.data).toHaveProperty('date');
  });

  test('leave removes student from missing list', async () => {
    // Mark leave
    await request(app)
      .post('/api/driver/leave')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning', reason: 'test' });

    const res = await request(app)
      .get('/api/school/missing?session=morning')
      .set('Authorization', `Bearer ${schoolToken}`);

    // Student should not be in the missing list
    const missing = res.body.data.students;
    expect(missing.some(s => s.id === TEST_STUDENT_ID)).toBe(false);
  });
});

// ─── School Leave ────────────────────────────────────────────────────────────

describe('School Leave', () => {
  test('POST /api/school/leave creates a leave', async () => {
    const res = await request(app)
      .post('/api/school/leave')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'evening', reason: 'ธุระ' });
    // May be 201 or 409 (duplicate if morning leave exists from previous test)
    expect([201, 409]).toContain(res.status);
  });

  test('GET /api/school/leaves returns school leaves', async () => {
    const res = await request(app)
      .get('/api/school/leaves')
      .set('Authorization', `Bearer ${schoolToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─── School Student Move ─────────────────────────────────────────────────────

describe('School Student Move', () => {
  test('POST /api/school/students/move moves student', async () => {
    const res = await request(app)
      .post('/api/school/students/move')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ student_id: TEST_STUDENT_ID, vehicle_id: 'V-test000000ab' });
    expect(res.status).toBe(200);
  });

  test('rejects non-school student', async () => {
    const res = await request(app)
      .post('/api/school/students/move')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ student_id: 999888, vehicle_id: 'V-test000000ab' });
    expect(res.status).toBe(404);
  });
});

// ─── Affiliation Missing ─────────────────────────────────────────────────────

describe('Affiliation Missing', () => {
  test('GET /api/affiliation/missing returns missing list', async () => {
    const res = await request(app)
      .get('/api/affiliation/missing?session=morning')
      .set('Authorization', `Bearer ${affToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('students');
  });
});

// ─── Affiliation School Accounts ─────────────────────────────────────────────

describe('Affiliation School Account Management', () => {
  test('GET /api/affiliation/school-accounts lists accounts', async () => {
    const res = await request(app)
      .get('/api/affiliation/school-accounts')
      .set('Authorization', `Bearer ${affToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('403 for driver role', async () => {
    const res = await request(app)
      .get('/api/affiliation/school-accounts')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });
});

// ─── Cross-scope Security ────────────────────────────────────────────────────

describe('Cross-scope Security', () => {
  test('driver cannot access school endpoints', async () => {
    const res = await request(app)
      .get('/api/school/missing')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });

  test('school cannot access affiliation endpoints', async () => {
    const res = await request(app)
      .get('/api/affiliation/school-accounts')
      .set('Authorization', `Bearer ${schoolToken}`);
    expect(res.status).toBe(403);
  });

  test('affiliation cannot access province endpoints', async () => {
    const res = await request(app)
      .get('/api/province/dashboard')
      .set('Authorization', `Bearer ${affToken}`);
    expect(res.status).toBe(403);
  });
});
