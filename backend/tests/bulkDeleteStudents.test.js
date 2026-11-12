'use strict';

/**
 * bulkDeleteStudents.test.js — INTEGRATION (disposable lampang_bus_test DB;
 * tests/setup.js seeds __TSCH, __test_school, __TSCH's vehicle and pupil 99999).
 *
 * POST /api/school/students/bulk-delete (owner request 2026-11-12): schools that
 * test-imported many rows can withdraw several pupils at once. Same rule as the
 * single DELETE for every id; soft delete; one audit row per pupil; restorable.
 */

require('dotenv').config();
const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../src/app');
const { getTestConnection } = require('./dbHelper');

const SCHOOL = { username: '__test_school', password: 'testpass123' };
const TEACHER = { username: '__bulk_teacher_p1', password: 'Teach#Pass2569x' };
const BASE_ID = 99100;
const IDS = [BASE_ID, BASE_ID + 1, BASE_ID + 2, BASE_ID + 3]; // 0-1 ป.1, 2 ป.2, 3 other school
let schoolToken = '';
let teacherToken = '';

async function q(sql, params = []) {
  const conn = await getTestConnection();
  try { return (await conn.query(sql, params))[0]; } finally { await conn.end(); }
}

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data.access_token;
}

async function seedPupils() {
  await q(`DELETE FROM audit_logs WHERE entity_type = 'student' AND entity_id IN (${IDS.map(() => '?').join(',')})`, IDS.map(String));
  await q(`DELETE FROM students WHERE id IN (${IDS.map(() => '?').join(',')})`, IDS);
  const rows = [
    [IDS[0], 'ป.1', '__TSCH'], [IDS[1], 'ป.1', '__TSCH'], [IDS[2], 'ป.2', '__TSCH'], [IDS[3], 'ป.1', '__TSCHB'],
  ];
  for (const [id, grade, school] of rows) {
    await q(
      `INSERT INTO students (id, cid_hash, prefix, first_name, last_name, grade, classroom, school_id, vehicle_id,
                             morning_enabled, evening_enabled, term_id)
       VALUES (?, SHA2(?, 256), 'เด็กชาย', '__Bulk', ?, ?, '1', ?, ?, TRUE, TRUE, '2568-2')`,
      [id, `bulk-${id}`, `N${id}`, grade, school, school === '__TSCH' ? 'V-test000000ab' : null],
    );
  }
}

beforeAll(async () => {
  await q("INSERT IGNORE INTO schools (id, name, affiliation_id) VALUES ('__TSCHB', '__Bulk Other School', '__TAFF')");
  await q('DELETE FROM users WHERE username = ?', [TEACHER.username]);
  await q(
    `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name, grade_scope, is_active)
     VALUES (?, ?, 'school', 'SCHOOL', '__TSCH', 'bulk teacher', 'ป.1', TRUE)`,
    [TEACHER.username, await bcrypt.hash(TEACHER.password, 4)],
  );
  schoolToken = await login(SCHOOL);
  teacherToken = await login(TEACHER);
});

beforeEach(seedPupils);

afterAll(async () => {
  await q(`DELETE FROM audit_logs WHERE entity_type = 'student' AND entity_id IN (${IDS.map(() => '?').join(',')})`, IDS.map(String));
  await q(`DELETE FROM students WHERE id IN (${IDS.map(() => '?').join(',')})`, IDS);
  await q('DELETE FROM users WHERE username = ?', [TEACHER.username]);
  await q("DELETE FROM schools WHERE id = '__TSCHB'");
});

const bulk = (token, ids) => request(app).post('/api/school/students/bulk-delete')
  .set('Authorization', `Bearer ${token}`).send({ student_ids: ids });

async function deletedFlags() {
  const rows = await q(`SELECT id, is_deleted, vehicle_id FROM students WHERE id IN (${IDS.map(() => '?').join(',')}) ORDER BY id`, IDS);
  return Object.fromEntries(rows.map(r => [r.id, { del: Boolean(r.is_deleted), veh: r.vehicle_id }]));
}

test('main account: own-school pupils withdrawn, other school skipped untouched, one audit per pupil', async () => {
  const res = await bulk(schoolToken, [IDS[0], IDS[1], IDS[2], IDS[3]]);
  expect(res.status).toBe(200);
  expect(res.body.data.deleted).toBe(3);
  expect(res.body.data.skipped).toEqual([IDS[3]]);
  const f = await deletedFlags();
  expect(f[IDS[0]]).toEqual({ del: true, veh: null });
  expect(f[IDS[2]].del).toBe(true);
  expect(f[IDS[3]].del).toBe(false);
  const audits = await q(`SELECT entity_id FROM audit_logs WHERE entity_type = 'student' AND action = 'DELETE' AND entity_id IN (?, ?, ?, ?)`, IDS.map(String));
  expect(audits.map(a => Number(a.entity_id)).sort()).toEqual([IDS[0], IDS[1], IDS[2]]);
});

test('grade teacher: only their grade is withdrawn', async () => {
  const res = await bulk(teacherToken, [IDS[0], IDS[2]]);
  expect(res.status).toBe(200);
  expect(res.body.data.deleted).toBe(1);
  expect(res.body.data.skipped).toEqual([IDS[2]]);
  const f = await deletedFlags();
  expect(f[IDS[0]].del).toBe(true);
  expect(f[IDS[2]].del).toBe(false);
});

test('nothing eligible → 404 and nothing changes; already-deleted ids are skipped', async () => {
  const none = await bulk(schoolToken, [IDS[3]]);
  expect(none.status).toBe(404);
  await bulk(schoolToken, [IDS[0]]);
  const again = await bulk(schoolToken, [IDS[0], IDS[1]]);
  expect(again.body.data).toMatchObject({ deleted: 1, skipped: [IDS[0]] });
});

test('bad input is 400', async () => {
  expect((await bulk(schoolToken, [])).status).toBe(400);
  expect((await bulk(schoolToken, ['abc'])).status).toBe(400);
  expect((await bulk(schoolToken, Array.from({ length: 501 }, (_, i) => i + 1))).status).toBe(400);
});

test('a bulk-withdrawn pupil can be restored with the existing restore', async () => {
  await bulk(schoolToken, [IDS[1]]);
  const res = await request(app).post(`/api/school/students/${IDS[1]}/restore`)
    .set('Authorization', `Bearer ${schoolToken}`).send({});
  expect(res.status).toBe(200);
  expect((await deletedFlags())[IDS[1]].del).toBe(false);
});
