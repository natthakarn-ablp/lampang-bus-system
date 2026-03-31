'use strict';

/**
 * province.test.js
 *
 * Integration tests for:
 *   GET /api/province/dashboard
 *   GET /api/province/affiliations
 *   GET /api/province/schools
 *   GET /api/province/students
 *   GET /api/province/vehicles
 *   GET /api/province/status-today
 *   GET /api/province/emergencies
 */

require('dotenv').config();
const request = require('supertest');
const app     = require('../src/app');

const PROVINCE = { username: '__test_province',    password: 'testpass123' };
const DRIVER   = { username: '__TEST PLATE 9999',  password: 'testpass123' };
const SCHOOL   = { username: '__test_school',      password: 'testpass123' };

let provinceToken = '';
let driverToken   = '';
let schoolToken   = '';

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data.access_token;
}

beforeAll(async () => {
  provinceToken = await login(PROVINCE);
  driverToken   = await login(DRIVER);
  schoolToken   = await login(SCHOOL);
});

// ─── RBAC ────────────────────────────────────────────────────────────────────

describe('RBAC', () => {
  test('401 without token', async () => {
    const res = await request(app).get('/api/province/dashboard');
    expect(res.status).toBe(401);
  });

  test('403 for driver role', async () => {
    const res = await request(app)
      .get('/api/province/dashboard')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });

  test('403 for school role', async () => {
    const res = await request(app)
      .get('/api/province/dashboard')
      .set('Authorization', `Bearer ${schoolToken}`);
    expect(res.status).toBe(403);
  });
});

// ─── GET /api/province/dashboard ─────────────────────────────────────────────

describe('GET /api/province/dashboard', () => {
  test('returns dashboard with all expected fields', async () => {
    const res = await request(app)
      .get('/api/province/dashboard')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const d = res.body.data;
    expect(d).toHaveProperty('date');
    expect(d).toHaveProperty('total_affiliations');
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
  });

  test('counts include test data', async () => {
    const res = await request(app)
      .get('/api/province/dashboard')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.body.data.total_affiliations).toBeGreaterThanOrEqual(1);
    expect(res.body.data.total_schools).toBeGreaterThanOrEqual(1);
    expect(res.body.data.total_students).toBeGreaterThanOrEqual(1);
    expect(res.body.data.total_vehicles).toBeGreaterThanOrEqual(1);
  });
});

// ─── GET /api/province/affiliations ──────────────────────────────────────────

describe('GET /api/province/affiliations', () => {
  test('returns affiliation list with counts', async () => {
    const res = await request(app)
      .get('/api/province/affiliations')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('each affiliation has expected fields', async () => {
    const res = await request(app)
      .get('/api/province/affiliations')
      .set('Authorization', `Bearer ${provinceToken}`);

    const a = res.body.data[0];
    expect(a).toHaveProperty('id');
    expect(a).toHaveProperty('name');
    expect(a).toHaveProperty('school_count');
    expect(a).toHaveProperty('student_count');
    expect(a).toHaveProperty('vehicle_count');
  });
});

// ─── GET /api/province/schools ───────────────────────────────────────────────

describe('GET /api/province/schools', () => {
  test('returns school list with pagination', async () => {
    const res = await request(app)
      .get('/api/province/schools')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('total');
  });

  test('each school has affiliation_name', async () => {
    const res = await request(app)
      .get('/api/province/schools')
      .set('Authorization', `Bearer ${provinceToken}`);

    const s = res.body.data.find(sc => sc.id === '__TSCH');
    expect(s).toBeDefined();
    expect(s).toHaveProperty('affiliation_name');
    expect(s).toHaveProperty('student_count');
    expect(s).toHaveProperty('vehicle_count');
  });

  test('affiliation_id filter works', async () => {
    const res = await request(app)
      .get('/api/province/schools?affiliation_id=__TAFF')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every(s => s.affiliation_id === '__TAFF')).toBe(true);
  });
});

// ─── GET /api/province/students ──────────────────────────────────────────────

describe('GET /api/province/students', () => {
  test('returns student list with pagination meta', async () => {
    const res = await request(app)
      .get('/api/province/students')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('page');
    expect(res.body.meta).toHaveProperty('per_page');
    expect(res.body.meta).toHaveProperty('total');
  });

  test('search filter finds test student', async () => {
    const res = await request(app)
      .get('/api/province/students?search=__Test')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.body.data.some(s => s.id === 99999)).toBe(true);
  });

  test('student includes school_name and affiliation_name', async () => {
    const res = await request(app)
      .get('/api/province/students?search=__Test')
      .set('Authorization', `Bearer ${provinceToken}`);

    const s = res.body.data.find(st => st.id === 99999);
    expect(s).toHaveProperty('school_name');
    expect(s).toHaveProperty('affiliation_name');
  });

  test('school_id filter works', async () => {
    const res = await request(app)
      .get('/api/province/students?school_id=__TSCH')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.body.data.every(s => s.school_id === '__TSCH')).toBe(true);
  });

  test('affiliation_id filter works', async () => {
    const res = await request(app)
      .get('/api/province/students?affiliation_id=__TAFF')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.status).toBe(200);
    // All returned students should belong to schools in __TAFF
    expect(res.body.data.every(s => s.affiliation_id === '__TAFF')).toBe(true);
  });

  test('pagination per_page limits results', async () => {
    const res = await request(app)
      .get('/api/province/students?per_page=1')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.body.data.length).toBeLessThanOrEqual(1);
    expect(res.body.meta.per_page).toBe(1);
  });
});

// ─── GET /api/province/vehicles ──────────────────────────────────────────────

describe('GET /api/province/vehicles', () => {
  test('returns vehicles with no duplicates', async () => {
    const res = await request(app)
      .get('/api/province/vehicles')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

    const ids = res.body.data.map(v => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('vehicle has expected fields', async () => {
    const res = await request(app)
      .get('/api/province/vehicles')
      .set('Authorization', `Bearer ${provinceToken}`);

    const v = res.body.data[0];
    expect(v).toHaveProperty('id');
    expect(v).toHaveProperty('plate_no');
    expect(v).toHaveProperty('student_count');
    expect(v).toHaveProperty('school_names');
  });
});

// ─── GET /api/province/status-today ──────────────────────────────────────────

describe('GET /api/province/status-today', () => {
  test('returns status grouped by affiliation → school → vehicle', async () => {
    const res = await request(app)
      .get('/api/province/status-today')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('date');
    expect(res.body.data).toHaveProperty('affiliations');
    expect(Array.isArray(res.body.data.affiliations)).toBe(true);
  });

  test('hierarchy has correct structure', async () => {
    const res = await request(app)
      .get('/api/province/status-today')
      .set('Authorization', `Bearer ${provinceToken}`);

    const affs = res.body.data.affiliations;
    if (affs.length > 0) {
      const a = affs[0];
      expect(a).toHaveProperty('affiliation_id');
      expect(a).toHaveProperty('affiliation_name');
      expect(a).toHaveProperty('schools');
      expect(Array.isArray(a.schools)).toBe(true);

      if (a.schools.length > 0) {
        const s = a.schools[0];
        expect(s).toHaveProperty('school_id');
        expect(s).toHaveProperty('school_name');
        expect(s).toHaveProperty('vehicles');

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
    }
  });
});

// ─── GET /api/province/emergencies ───────────────────────────────────────────

describe('GET /api/province/emergencies', () => {
  test('returns emergency list with pagination', async () => {
    const res = await request(app)
      .get('/api/province/emergencies')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('page');
    expect(res.body.meta).toHaveProperty('per_page');
    expect(res.body.meta).toHaveProperty('total');
  });
});
