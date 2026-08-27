'use strict';

/**
 * crossSchoolIsolation.test.js  (#1 — "different schools must not see each other's data")
 *
 * INTEGRATION — needs the disposable lampang_bus_test DB (globalSetup seeds
 * __TSCH + student 99999). Do NOT run on the prod box (no test DB). Run in CI:
 *   npm run test:ci   (or)   npx jest tests/crossSchoolIsolation.test.js
 *
 * The unit suite (schoolScope.unit.test.js) proves resolveSchoolId ignores a
 * spoofed ?school_id in isolation. This proves the WHOLE read path against a
 * real 2-school DB: a __TSCH token can never see __TSCH2's student / vehicle /
 * status via /students, /students?school_id=__TSCH2 (spoof), /vehicles or
 * /status-today. Closes the gap that school.test.js only ever used one school.
 *
 * Seeds a second school + its own exclusive student & vehicle, cleaned in afterAll.
 */

require('dotenv').config();
const request = require('supertest');
const { getTestConnection } = require('./dbHelper');
const app = require('../src/app');

const SCHOOL_A = { username: '__test_school', password: 'testpass123' }; // scope __TSCH
const OTHER_SCHOOL_ID = '__TSCH2';
const OTHER_STUDENT_ID = 99798;
const OTHER_VEHICLE_ID = 'V-testB0000001';
const OTHER_PLATE = '__TEST PLATE B01';

let tokenA = '';
const db = () => getTestConnection();
const login = async (creds) => (await request(app).post('/api/auth/login').send(creds)).body.data?.access_token || '';

async function cleanup(conn) {
  await conn.query('DELETE FROM daily_status WHERE student_id = ?', [OTHER_STUDENT_ID]);
  await conn.query('DELETE FROM students WHERE id = ?', [OTHER_STUDENT_ID]);
  await conn.query('DELETE FROM vehicles WHERE id = ?', [OTHER_VEHICLE_ID]);
  await conn.query('DELETE FROM schools WHERE id = ?', [OTHER_SCHOOL_ID]);
}

beforeAll(async () => {
  const conn = await db();
  await cleanup(conn);
  await conn.query(
    `INSERT INTO schools (id, name, affiliation_id) VALUES (?, '__Test School 2', '__TAFF')
     ON DUPLICATE KEY UPDATE name = VALUES(name)`, [OTHER_SCHOOL_ID]);
  await conn.query(
    `INSERT INTO vehicles (id, plate_no, normalized_plate, vehicle_type)
     VALUES (?, ?, '__testplateb01', 'รถตู้')
     ON DUPLICATE KEY UPDATE plate_no = VALUES(plate_no)`, [OTHER_VEHICLE_ID, OTHER_PLATE]);
  await conn.query(
    `INSERT INTO students
       (id, cid_hash, prefix, first_name, last_name, grade, classroom,
        school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
     VALUES (?, SHA2('2222222222222', 256), 'เด็กหญิง', '__OtherSchool', 'Pupil', 'ป.2', '1',
             ?, ?, TRUE, TRUE, '2568-2')
     ON DUPLICATE KEY UPDATE school_id = VALUES(school_id), vehicle_id = VALUES(vehicle_id)`,
    [OTHER_STUDENT_ID, OTHER_SCHOOL_ID, OTHER_VEHICLE_ID]);
  await conn.end();
  tokenA = await login(SCHOOL_A);
});

afterAll(async () => {
  const conn = await db();
  await cleanup(conn);
  await conn.end();
});

const idsOf = (arr) => (Array.isArray(arr) ? arr : []).map((x) => x.id ?? x.student_id);

describe('school A (__TSCH) cannot read school B (__TSCH2) data', () => {
  test('GET /students never returns school B\'s student', async () => {
    const res = await request(app).get('/api/school/students?per_page=500').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(idsOf(res.body.data)).not.toContain(OTHER_STUDENT_ID);
    for (const s of res.body.data || []) {
      if (s.school_id !== undefined) expect(s.school_id).toBe('__TSCH');
    }
  });

  test('GET /students?school_id=__TSCH2 (spoof) is IGNORED — still no school B student', async () => {
    const res = await request(app)
      .get(`/api/school/students?per_page=500&school_id=${OTHER_SCHOOL_ID}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(idsOf(res.body.data)).not.toContain(OTHER_STUDENT_ID);
  });

  test('GET /vehicles never returns school B\'s exclusive vehicle', async () => {
    const res = await request(app).get('/api/school/vehicles').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect((res.body.data || []).map((v) => v.id)).not.toContain(OTHER_VEHICLE_ID);
  });

  test('GET /status-today never lists school B\'s student', async () => {
    const res = await request(app).get('/api/school/status-today').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    const students = res.body.data?.students || res.body.data?.vehicles || [];
    expect(JSON.stringify(students)).not.toContain(String(OTHER_STUDENT_ID));
  });

  test('GET /dashboard?school_id=__TSCH2 (spoof) still reflects __TSCH, not __TSCH2', async () => {
    const res = await request(app)
      .get(`/api/school/dashboard?school_id=${OTHER_SCHOOL_ID}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    if (res.body.data?.school?.id) expect(res.body.data.school.id).toBe('__TSCH');
  });
});
