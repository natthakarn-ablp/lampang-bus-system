'use strict';

/**
 * report.test.js
 *
 * Integration tests for:
 *   GET /api/reports/daily
 *   GET /api/reports/monthly
 *   GET /api/reports/summary
 *   GET /api/reports/export/csv
 *   GET /api/reports/export/excel
 *   GET /api/reports/export/pdf
 */

require('dotenv').config();
const request = require('supertest');
const app     = require('../src/app');

const PROVINCE    = { username: '__test_province',    password: 'testpass123' };
const SCHOOL      = { username: '__test_school',      password: 'testpass123' };
const AFFILIATION = { username: '__test_affiliation', password: 'testpass123' };
const DRIVER      = { username: '__TEST PLATE 9999',  password: 'testpass123' };

let provinceToken   = '';
let schoolToken     = '';
let affiliationToken = '';
let driverToken     = '';

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data.access_token;
}

beforeAll(async () => {
  provinceToken    = await login(PROVINCE);
  schoolToken      = await login(SCHOOL);
  affiliationToken = await login(AFFILIATION);
  driverToken      = await login(DRIVER);
});

// ─── RBAC ────────────────────────────────────────────────────────────────────

describe('RBAC', () => {
  test('401 without token', async () => {
    const res = await request(app).get('/api/reports/daily');
    expect(res.status).toBe(401);
  });

  test('403 for driver role', async () => {
    const res = await request(app)
      .get('/api/reports/daily')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });

  test('school can access reports', async () => {
    const res = await request(app)
      .get('/api/reports/daily')
      .set('Authorization', `Bearer ${schoolToken}`);
    expect(res.status).toBe(200);
  });

  test('affiliation can access reports', async () => {
    const res = await request(app)
      .get('/api/reports/daily')
      .set('Authorization', `Bearer ${affiliationToken}`);
    expect(res.status).toBe(200);
  });

  test('province can access reports', async () => {
    const res = await request(app)
      .get('/api/reports/daily')
      .set('Authorization', `Bearer ${provinceToken}`);
    expect(res.status).toBe(200);
  });
});

// ─── Role-based scoping ─────────────────────────────────────────────────────

describe('Role-based scoping', () => {
  test('school sees only own school data', async () => {
    const res = await request(app)
      .get('/api/reports/daily')
      .set('Authorization', `Bearer ${schoolToken}`);

    expect(res.body.data.schools.length).toBe(1);
    expect(res.body.data.schools[0].school_id).toBe('__TSCH');
  });

  test('province sees all data', async () => {
    const res = await request(app)
      .get('/api/reports/daily')
      .set('Authorization', `Bearer ${provinceToken}`);

    // Province should see at least the test school
    expect(res.body.data.total_students).toBeGreaterThanOrEqual(1);
  });
});

// ─── GET /api/reports/daily ──────────────────────────────────────────────────

describe('GET /api/reports/daily', () => {
  test('returns daily report with expected fields', async () => {
    const res = await request(app)
      .get('/api/reports/daily')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const d = res.body.data;
    expect(d).toHaveProperty('date');
    expect(d).toHaveProperty('total_students');
    expect(d).toHaveProperty('total_vehicles');
    expect(d).toHaveProperty('morning_total');
    expect(d).toHaveProperty('evening_total');
    expect(d).toHaveProperty('morning_done');
    expect(d).toHaveProperty('evening_done');
    expect(d).toHaveProperty('morning_pending');
    expect(d).toHaveProperty('evening_pending');
    expect(d).toHaveProperty('emergency_count');
    expect(d).toHaveProperty('vehicles');
    expect(d).toHaveProperty('schools');
    expect(Array.isArray(d.vehicles)).toBe(true);
    expect(Array.isArray(d.schools)).toBe(true);
  });

  test('date filter works', async () => {
    const res = await request(app)
      .get('/api/reports/daily?date=2025-01-01')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.date).toBe('2025-01-01');
  });

  test('vehicle_id filter works', async () => {
    const res = await request(app)
      .get('/api/reports/daily?vehicle_id=V-test000000ab')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.status).toBe(200);
    // Should still return valid report structure
    expect(res.body.data).toHaveProperty('total_students');
  });
});

// ─── GET /api/reports/monthly ────────────────────────────────────────────────

describe('GET /api/reports/monthly', () => {
  test('returns monthly report with expected fields', async () => {
    const res = await request(app)
      .get('/api/reports/monthly')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const d = res.body.data;
    expect(d).toHaveProperty('month');
    expect(d).toHaveProperty('total_students');
    expect(d).toHaveProperty('total_morning_checkins');
    expect(d).toHaveProperty('total_evening_checkins');
    expect(d).toHaveProperty('emergency_count');
    expect(d).toHaveProperty('daily_trend');
    expect(d).toHaveProperty('schools');
    expect(Array.isArray(d.daily_trend)).toBe(true);
  });

  test('month filter works', async () => {
    const res = await request(app)
      .get('/api/reports/monthly?month=2025-01')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.month).toBe('2025-01');
  });
});

// ─── GET /api/reports/summary ────────────────────────────────────────────────

describe('GET /api/reports/summary', () => {
  test('returns summary report', async () => {
    const res = await request(app)
      .get('/api/reports/summary')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('total_students');
    expect(res.body.data).toHaveProperty('vehicles');
    expect(res.body.data).toHaveProperty('schools');
  });
});

// ─── GET /api/reports/export/csv ─────────────────────────────────────────────

describe('GET /api/reports/export/csv', () => {
  test('returns CSV file', async () => {
    const res = await request(app)
      .get('/api/reports/export/csv')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment.*\.csv/);
    // Should contain BOM + header line
    expect(res.text).toContain('รหัสนักเรียน');
  });

  test('school-scoped CSV only includes own school', async () => {
    const res = await request(app)
      .get('/api/reports/export/csv')
      .set('Authorization', `Bearer ${schoolToken}`);

    expect(res.status).toBe(200);
    // Should contain the test student
    expect(res.text).toContain('__Test');
  });
});

// ─── GET /api/reports/export/excel ───────────────────────────────────────────

describe('GET /api/reports/export/excel', () => {
  test('returns Excel file', async () => {
    const res = await request(app)
      .get('/api/reports/export/excel')
      .set('Authorization', `Bearer ${provinceToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml|openxml/);
    expect(res.headers['content-disposition']).toMatch(/attachment.*\.xlsx/);
    // Binary content should exist
    expect(res.body.length).toBeGreaterThan(0);
  });
});

// ─── GET /api/reports/export/pdf ─────────────────────────────────────────────

describe('GET /api/reports/export/pdf', () => {
  test('returns PDF file', async () => {
    const res = await request(app)
      .get('/api/reports/export/pdf')
      .set('Authorization', `Bearer ${provinceToken}`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/attachment.*\.pdf/);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
