'use strict';

/**
 * school.test.js
 *
 * Integration tests for:
 *   GET /api/school/dashboard
 *   GET /api/school/students
 *   GET /api/school/vehicles
 *   GET /api/school/status-today
 *   GET /api/school/emergencies
 *
 * Requires a running MySQL instance with schema + test data from tests/setup.js.
 */

require('dotenv').config();
const request = require('supertest');
const app     = require('../src/index');

const SCHOOL   = { username: '__test_school',     password: 'testpass123' };
const DRIVER   = { username: '__TEST PLATE 9999', password: 'testpass123' };
const PROVINCE = { username: '__test_province',   password: 'testpass123' };

let schoolToken   = '';
let driverToken   = '';
let provinceToken = '';

// ─── helpers ─────────────────────────────────────────────────────────────────

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data.access_token;
}

// ─── setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  schoolToken   = await login(SCHOOL);
  driverToken   = await login(DRIVER);
  provinceToken = await login(PROVINCE);
});

// ─── RBAC ────────────────────────────────────────────────────────────────────

describe('RBAC', () => {
  test('401 without token', async () => {
    const res = await request(app).get('/api/school/dashboard');
    expect(res.status).toBe(401);
  });

  test('403 for driver role', async () => {
    const res = await request(app)
      .get('/api/school/dashboard')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });

  test('403 for province role (not school)', async () => {
    const res = await request(app)
      .get('/api/school/dashboard')
      .set('Authorization', `Bearer ${provinceToken}`);
    expect(res.status).toBe(403);
  });
});

// ─── GET /api/school/dashboard ───────────────────────────────────────────────

describe('GET /api/school/dashboard', () => {
  test('returns dashboard data with expected fields', async () => {
    const res = await request(app)
      .get('/api/school/dashboard')
      .set('Authorization', `Bearer ${schoolToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const d = res.body.data;
    expect(d).toHaveProperty('school');
    expect(d).toHaveProperty('total_students');
    expect(d).toHaveProperty('total_vehicles');
    expect(d).toHaveProperty('morning_total');
    expect(d).toHaveProperty('evening_total');
    expect(d).toHaveProperty('morning_done');
    expect(d).toHaveProperty('evening_done');
    expect(d).toHaveProperty('morning_pending');
    expect(d).toHaveProperty('evening_pending');
    expect(d).toHaveProperty('recent_emergencies');
    expect(d).toHaveProperty('date');
  });

  test('total_students includes the test student', async () => {
    const res = await request(app)
      .get('/api/school/dashboard')
      .set('Authorization', `Bearer ${schoolToken}`);

    expect(res.body.data.total_students).toBeGreaterThanOrEqual(1);
  });
});

// ─── GET /api/school/students ────────────────────────────────────────────────

describe('GET /api/school/students', () => {
  test('returns student list with pagination meta', async () => {
    const res = await request(app)
      .get('/api/school/students')
      .set('Authorization', `Bearer ${schoolToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('page');
    expect(res.body.meta).toHaveProperty('per_page');
    expect(res.body.meta).toHaveProperty('total');
  });

  test('search filter finds test student', async () => {
    const res = await request(app)
      .get('/api/school/students?search=__Test')
      .set('Authorization', `Bearer ${schoolToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.some(s => s.id === 99999)).toBe(true);
  });

  test('grade filter works', async () => {
    const res = await request(app)
      .get('/api/school/students?grade=ป.1')
      .set('Authorization', `Bearer ${schoolToken}`);

    expect(res.status).toBe(200);
    // Test student is grade ป.1
    expect(res.body.data.some(s => s.id === 99999)).toBe(true);
  });

  test('pagination per_page limits results', async () => {
    const res = await request(app)
      .get('/api/school/students?per_page=1')
      .set('Authorization', `Bearer ${schoolToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
    expect(res.body.meta.per_page).toBe(1);
  });
});

// ─── GET /api/school/vehicles ────────────────────────────────────────────────

describe('GET /api/school/vehicles', () => {
  test('returns vehicles serving this school', async () => {
    const res = await request(app)
      .get('/api/school/vehicles')
      .set('Authorization', `Bearer ${schoolToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    // Test vehicle should appear (student 99999 is assigned to it)
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('vehicle has expected fields', async () => {
    const res = await request(app)
      .get('/api/school/vehicles')
      .set('Authorization', `Bearer ${schoolToken}`);

    const v = res.body.data[0];
    expect(v).toHaveProperty('id');
    expect(v).toHaveProperty('plate_no');
    expect(v).toHaveProperty('student_count');
  });
});

// ─── GET /api/school/status-today ────────────────────────────────────────────

describe('GET /api/school/status-today', () => {
  test('returns status grouped by vehicle', async () => {
    const res = await request(app)
      .get('/api/school/status-today')
      .set('Authorization', `Bearer ${schoolToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('date');
    expect(res.body.data).toHaveProperty('vehicles');
    expect(Array.isArray(res.body.data.vehicles)).toBe(true);
  });

  test('vehicle group contains students with status fields', async () => {
    const res = await request(app)
      .get('/api/school/status-today')
      .set('Authorization', `Bearer ${schoolToken}`);

    const vehicles = res.body.data.vehicles;
    if (vehicles.length > 0) {
      const v = vehicles[0];
      expect(v).toHaveProperty('vehicle_id');
      expect(v).toHaveProperty('plate_no');
      expect(v).toHaveProperty('students');
      expect(Array.isArray(v.students)).toBe(true);

      if (v.students.length > 0) {
        const s = v.students[0];
        expect(s).toHaveProperty('morning_done');
        expect(s).toHaveProperty('evening_done');
      }
    }
  });
});

// ─── GET /api/school/emergencies ─────────────────────────────────────────────

describe('GET /api/school/emergencies', () => {
  test('returns emergency list with pagination', async () => {
    const res = await request(app)
      .get('/api/school/emergencies')
      .set('Authorization', `Bearer ${schoolToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('page');
    expect(res.body.meta).toHaveProperty('per_page');
    expect(res.body.meta).toHaveProperty('total');
  });
});
