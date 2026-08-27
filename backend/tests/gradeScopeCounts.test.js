'use strict';

/**
 * gradeScopeCounts.test.js  (grade-filter divergence fix — end-to-end)
 *
 * INTEGRATION — needs the disposable lampang_bus_test DB (globalSetup seeds
 * __TSCH). Do NOT run on the prod box. Run in CI: `npx jest tests/gradeScopeCounts.test.js`.
 *
 * Proves the fix for the tolerant-vs-exact grade divergence: a student whose
 * grade is stored in a VARIANT form ('มัธยมศึกษาปีที่ 6', not canonical 'ม.6')
 * must be counted identically by the student LIST (getStudents, always tolerant)
 * and by the DASHBOARD / STATUS-TODAY counts (previously exact `= ?`, now
 * `IN (gradeEquivalents)`). Before the fix, dashboard.total_students would be 0
 * while the list showed 1 — this test would fail.
 *
 * Uses a grade-scoped teacher pinned to ม.6 so the only ม.6 student in __TSCH is
 * our variant one, making the counts unambiguous.
 */

require('dotenv').config();
const request = require('supertest');
const bcrypt = require('bcrypt');
const { getTestConnection } = require('./dbHelper');
const app = require('../src/app');

const TEACHER = { username: '__test_grade_teacher_m6', password: 'testpass123' };
const GRADE_CANONICAL = 'ม.6';
const GRADE_STORED = 'มัธยมศึกษาปีที่ 6'; // variant form; normalizes to ม.6
const VARIANT_STUDENT_ID = 99697;

let token = '';
const db = () => getTestConnection();
const login = async (creds) => (await request(app).post('/api/auth/login').send(creds)).body.data?.access_token || '';

async function cleanup(conn) {
  await conn.query('DELETE FROM daily_status WHERE student_id = ?', [VARIANT_STUDENT_ID]);
  await conn.query('DELETE FROM students WHERE id = ?', [VARIANT_STUDENT_ID]);
  await conn.query('DELETE FROM users WHERE username = ?', [TEACHER.username]);
}

beforeAll(async () => {
  const conn = await db();
  await cleanup(conn);
  const hash = await bcrypt.hash(TEACHER.password, 12);
  await conn.query(
    `INSERT INTO users (username, password_hash, role, scope_type, scope_id, grade_scope, display_name)
     VALUES (?, ?, 'school', 'SCHOOL', '__TSCH', ?, '__ครู ม.6')
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), grade_scope = VALUES(grade_scope)`,
    [TEACHER.username, hash, GRADE_CANONICAL]
  );
  // A student whose grade is stored in a VARIANT (non-canonical) form.
  await conn.query(
    `INSERT INTO students
       (id, cid_hash, prefix, first_name, last_name, grade, classroom,
        school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
     VALUES (?, SHA2('3333333333333', 256), 'นาย', '__Variant', 'Grade', ?, '1',
             '__TSCH', 'V-test000000ab', TRUE, TRUE, '2568-2')
     ON DUPLICATE KEY UPDATE grade = VALUES(grade), school_id = VALUES(school_id)`,
    [VARIANT_STUDENT_ID, GRADE_STORED]
  );
  await conn.end();
  token = await login(TEACHER);
});

afterAll(async () => {
  const conn = await db();
  await cleanup(conn);
  await conn.end();
});

const auth = (r) => r.set('Authorization', `Bearer ${token}`);

describe('grade-scoped counts include variant-form grades (list == dashboard)', () => {
  test('student LIST returns the variant-grade student', async () => {
    const res = await auth(request(app).get('/api/school/students?per_page=200'));
    expect(res.status).toBe(200);
    const ids = (res.body.data || []).map((s) => s.id);
    expect(ids).toContain(VARIANT_STUDENT_ID);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  test('DASHBOARD total_students matches the list total (no under-count of the variant)', async () => {
    const list = await auth(request(app).get('/api/school/students?per_page=200'));
    const dash = await auth(request(app).get('/api/school/dashboard'));
    expect(dash.status).toBe(200);
    // The teacher is pinned to ม.6, so both numbers scope to ม.6 only.
    expect(dash.body.data.total_students).toBe(list.body.meta.total);
    expect(dash.body.data.total_students).toBeGreaterThanOrEqual(1);
  });

  test('STATUS-TODAY lists the variant-grade student', async () => {
    const res = await auth(request(app).get('/api/school/status-today'));
    expect(res.status).toBe(200);
    const allIds = (res.body.data.vehicles || []).flatMap((v) => (v.students || []).map((s) => s.id));
    expect(allIds).toContain(VARIANT_STUDENT_ID);
  });
});
