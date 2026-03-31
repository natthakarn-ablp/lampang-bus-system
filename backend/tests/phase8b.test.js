'use strict';

require('dotenv').config();
const request = require('supertest');
const app     = require('../src/app');

const DRIVER = { username: '__TEST PLATE 9999', password: 'testpass123' };
const SCHOOL = { username: '__test_school', password: 'testpass123' };

let driverToken = '', schoolToken = '';

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data.access_token;
}

beforeAll(async () => {
  driverToken = await login(DRIVER);
  schoolToken = await login(SCHOOL);
});

// ─── A1. Driver photo upload ─────────────────────────────────────────────────

describe('Driver photo upload', () => {
  test('POST /api/driver/profile/photo rejects non-image', async () => {
    const res = await request(app)
      .post('/api/driver/profile/photo')
      .set('Authorization', `Bearer ${driverToken}`)
      .attach('photo', Buffer.from('fake'), { filename: 'test.txt', contentType: 'text/plain' });
    // multer file filter rejects non-image → no file → 400
    expect(res.status).toBe(400);
  });

  test('POST /api/driver/profile/photo with no file returns 400', async () => {
    const res = await request(app)
      .post('/api/driver/profile/photo')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(400);
  });
});

// ─── A2. Driver password change ──────────────────────────────────────────────

describe('Driver password change', () => {
  test('POST /api/driver/change-password validates input', async () => {
    const res = await request(app)
      .post('/api/driver/change-password')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('rejects wrong current password', async () => {
    const res = await request(app)
      .post('/api/driver/change-password')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ current_password: 'wrongpassword', new_password: 'newpass' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('ไม่ถูกต้อง');
  });

  test('changes password successfully and reverts', async () => {
    // Change to temp password
    let res = await request(app)
      .post('/api/driver/change-password')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ current_password: 'testpass123', new_password: 'temppass456' });
    expect(res.status).toBe(200);

    // Change back
    const tempToken = await login({ username: DRIVER.username, password: 'temppass456' });
    res = await request(app)
      .post('/api/driver/change-password')
      .set('Authorization', `Bearer ${tempToken}`)
      .send({ current_password: 'temppass456', new_password: 'testpass123' });
    expect(res.status).toBe(200);
  });
});

// ─── A3. Driver profile editable fields ──────────────────────────────────────

describe('Driver profile edit', () => {
  test('PUT /api/driver/profile allows name and phone', async () => {
    const res = await request(app)
      .put('/api/driver/profile')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ name: '__Test Driver', phone: '0000000001' });
    expect(res.status).toBe(200);
  });

  test('rejects empty update', async () => {
    const res = await request(app)
      .put('/api/driver/profile')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ─── B1. School status-today plate search (data test) ────────────────────────

describe('School status-today', () => {
  test('GET /api/school/status-today returns data', async () => {
    const res = await request(app)
      .get('/api/school/status-today')
      .set('Authorization', `Bearer ${schoolToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('vehicles');
  });
});

// ─── B3. School add vehicle ──────────────────────────────────────────────────

describe('School add vehicle', () => {
  test('POST /api/school/vehicles creates vehicle', async () => {
    const res = await request(app)
      .post('/api/school/vehicles')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ plate_no: '__TEST BULK 0001', vehicle_type: 'รถตู้', driver_name: '__BulkDriver', driver_phone: '0000000000' });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('vehicle_id');
  });

  test('requires plate_no', async () => {
    const res = await request(app)
      .post('/api/school/vehicles')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// Cleanup
afterAll(async () => {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    database: process.env.DB_NAME || 'lampang_bus',
    user: process.env.DB_USER || 'lampang',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4',
  });
  await conn.query(`DELETE FROM driver_vehicle_assignments WHERE vehicle_id IN (SELECT id FROM vehicles WHERE plate_no = '__TEST BULK 0001')`).catch(() => {});
  await conn.query(`DELETE FROM users WHERE username = '__TEST BULK 0001'`).catch(() => {});
  await conn.query(`DELETE FROM drivers WHERE name = '__BulkDriver'`).catch(() => {});
  await conn.query(`DELETE FROM vehicles WHERE plate_no = '__TEST BULK 0001'`).catch(() => {});
  await conn.end();
});
