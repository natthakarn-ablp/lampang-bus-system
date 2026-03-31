'use strict';

/**
 * affiliation.test.js
 *
 * Integration tests for:
 *   GET /api/affiliation/dashboard
 *   GET /api/affiliation/schools
 *   GET /api/affiliation/students
 *   GET /api/affiliation/vehicles
 *   GET /api/affiliation/status-today
 *   GET /api/affiliation/emergencies
 *
 * Requires a running MySQL instance with schema + test data from tests/setup.js.
 */

require('dotenv').config();
const request = require('supertest');
const app     = require('../src/app');

const AFFILIATION = { username: '__test_affiliation', password: 'testpass123' };
const DRIVER      = { username: '__TEST PLATE 9999',  password: 'testpass123' };
const SCHOOL      = { username: '__test_school',      password: 'testpass123' };

let affToken    = '';
let driverToken = '';
let schoolToken = '';

// ─── helpers ─────────────────────────────────────────────────────────────────

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data.access_token;
}

// ─── setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  affToken    = await login(AFFILIATION);
  driverToken = await login(DRIVER);
  schoolToken = await login(SCHOOL);
});

// ─── RBAC ────────────────────────────────────────────────────────────────────

describe('RBAC', () => {
  test('401 without token', async () => {
    const res = await request(app).get('/api/affiliation/dashboard');
    expect(res.status).toBe(401);
  });

  test('403 for driver role', async () => {
    const res = await request(app)
      .get('/api/affiliation/dashboard')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });

  test('403 for school role', async () => {
    const res = await request(app)
      .get('/api/affiliation/dashboard')
      .set('Authorization', `Bearer ${schoolToken}`);
    expect(res.status).toBe(403);
  });
});

// ─── GET /api/affiliation/dashboard ──────────────────────────────────────────

describe('GET /api/affiliation/dashboard', () => {
  test('returns dashboard data with expected fields', async () => {
    const res = await request(app)
      .get('/api/affiliation/dashboard')
      .set('Authorization', `Bearer ${affToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const d = res.body.data;
    expect(d).toHaveProperty('affiliation');
    expect(d).toHaveProperty('total_schools');
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
      .get('/api/affiliation/dashboard')
      .set('Authorization', `Bearer ${affToken}`);

    expect(res.body.data.total_students).toBeGreaterThanOrEqual(1);
  });

  test('total_schools includes the test school', async () => {
    const res = await request(app)
      .get('/api/affiliation/dashboard')
      .set('Authorization', `Bearer ${affToken}`);

    expect(res.body.data.total_schools).toBeGreaterThanOrEqual(1);
  });
});

// ─── GET /api/affiliation/schools ────────────────────────────────────────────

describe('GET /api/affiliation/schools', () => {
  test('returns school list with counts', async () => {
    const res = await request(app)
      .get('/api/affiliation/schools')
      .set('Authorization', `Bearer ${affToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('each school has expected fields', async () => {
    const res = await request(app)
      .get('/api/affiliation/schools')
      .set('Authorization', `Bearer ${affToken}`);

    const s = res.body.data[0];
    expect(s).toHaveProperty('id');
    expect(s).toHaveProperty('name');
    expect(s).toHaveProperty('student_count');
    expect(s).toHaveProperty('vehicle_count');
  });

  test('test school appears in list', async () => {
    const res = await request(app)
      .get('/api/affiliation/schools')
      .set('Authorization', `Bearer ${affToken}`);

    expect(res.body.data.some(s => s.id === '__TSCH')).toBe(true);
  });
});

// ─── GET /api/affiliation/students ───────────────────────────────────────────

describe('GET /api/affiliation/students', () => {
  test('returns student list with pagination meta', async () => {
    const res = await request(app)
      .get('/api/affiliation/students')
      .set('Authorization', `Bearer ${affToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('page');
    expect(res.body.meta).toHaveProperty('per_page');
    expect(res.body.meta).toHaveProperty('total');
  });

  test('search filter finds test student', async () => {
    const res = await request(app)
      .get('/api/affiliation/students?search=__Test')
      .set('Authorization', `Bearer ${affToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.some(s => s.id === 99999)).toBe(true);
  });

  test('school_id filter works', async () => {
    const res = await request(app)
      .get('/api/affiliation/students?school_id=__TSCH')
      .set('Authorization', `Bearer ${affToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every(s => s.school_id === '__TSCH')).toBe(true);
  });

  test('grade filter works', async () => {
    const res = await request(app)
      .get('/api/affiliation/students?grade=ป.1')
      .set('Authorization', `Bearer ${affToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.some(s => s.id === 99999)).toBe(true);
  });

  test('pagination per_page limits results', async () => {
    const res = await request(app)
      .get('/api/affiliation/students?per_page=1')
      .set('Authorization', `Bearer ${affToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
    expect(res.body.meta.per_page).toBe(1);
  });

  test('student includes school_name field', async () => {
    const res = await request(app)
      .get('/api/affiliation/students?search=__Test')
      .set('Authorization', `Bearer ${affToken}`);

    expect(res.body.data[0]).toHaveProperty('school_name');
  });
});

// ─── GET /api/affiliation/vehicles ───────────────────────────────────────────

describe('GET /api/affiliation/vehicles', () => {
  test('returns vehicles serving this affiliation', async () => {
    const res = await request(app)
      .get('/api/affiliation/vehicles')
      .set('Authorization', `Bearer ${affToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('vehicle has expected fields', async () => {
    const res = await request(app)
      .get('/api/affiliation/vehicles')
      .set('Authorization', `Bearer ${affToken}`);

    const v = res.body.data[0];
    expect(v).toHaveProperty('id');
    expect(v).toHaveProperty('plate_no');
    expect(v).toHaveProperty('student_count');
    expect(v).toHaveProperty('school_names');
  });

  test('no duplicate vehicles', async () => {
    const res = await request(app)
      .get('/api/affiliation/vehicles')
      .set('Authorization', `Bearer ${affToken}`);

    const ids = res.body.data.map(v => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── GET /api/affiliation/status-today ───────────────────────────────────────

describe('GET /api/affiliation/status-today', () => {
  test('returns status grouped by school and vehicle', async () => {
    const res = await request(app)
      .get('/api/affiliation/status-today')
      .set('Authorization', `Bearer ${affToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('date');
    expect(res.body.data).toHaveProperty('schools');
    expect(Array.isArray(res.body.data.schools)).toBe(true);
  });

  test('school group contains vehicles with students', async () => {
    const res = await request(app)
      .get('/api/affiliation/status-today')
      .set('Authorization', `Bearer ${affToken}`);

    const schools = res.body.data.schools;
    if (schools.length > 0) {
      const s = schools[0];
      expect(s).toHaveProperty('school_id');
      expect(s).toHaveProperty('school_name');
      expect(s).toHaveProperty('vehicles');
      expect(Array.isArray(s.vehicles)).toBe(true);

      if (s.vehicles.length > 0) {
        const v = s.vehicles[0];
        expect(v).toHaveProperty('vehicle_id');
        expect(v).toHaveProperty('plate_no');
        expect(v).toHaveProperty('students');

        if (v.students.length > 0) {
          expect(v.students[0]).toHaveProperty('morning_done');
          expect(v.students[0]).toHaveProperty('evening_done');
        }
      }
    }
  });
});

// ─── GET /api/affiliation/emergencies ────────────────────────────────────────

describe('GET /api/affiliation/emergencies', () => {
  test('returns emergency list with pagination', async () => {
    const res = await request(app)
      .get('/api/affiliation/emergencies')
      .set('Authorization', `Bearer ${affToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('page');
    expect(res.body.meta).toHaveProperty('per_page');
    expect(res.body.meta).toHaveProperty('total');
  });
});
