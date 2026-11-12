'use strict';

/**
 * homeroomTeachers.test.js — INTEGRATION (disposable lampang_bus_test DB;
 * tests/setup.js seeds __TSCH, __test_school, driver __TEST PLATE 9999 and
 * student 99999 in ป.1 / ห้อง 1 on V-test000000ab).
 *
 * Migration 061 + FEATURE_HOMEROOM_TEACHERS: the school main account lists the
 * homeroom teacher(s) of a room, and the names reach the four places the owner
 * chose (2026-11-12) — room check, student list, driver's list, parent status
 * (the last is covered DB-free in homeroomTeachers.unit.test.js).
 */

require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');
const { getTestConnection } = require('./dbHelper');

const SCHOOL = { username: '__test_school', password: 'testpass123' };
const DRIVER = { username: '__TEST PLATE 9999', password: 'testpass123' };

let schoolToken = '';
let driverToken = '';
let flagBefore;
let otherRowId;

async function q(sql, params = []) {
  const conn = await getTestConnection();
  try { return (await conn.query(sql, params))[0]; } finally { await conn.end(); }
}

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data.access_token;
}

const asSchool = (r) => r.set('Authorization', `Bearer ${schoolToken}`);
const asDriver = (r) => r.set('Authorization', `Bearer ${driverToken}`);

beforeAll(async () => {
  flagBefore = env.features.homeroomTeachers;
  env.features.homeroomTeachers = true;
  await q("DELETE FROM homeroom_teachers WHERE school_id IN ('__TSCH', '__TSCHH')");
  await q("INSERT IGNORE INTO schools (id, name, affiliation_id) VALUES ('__TSCHH', '__Other School', '__TAFF')");
  const r = await q(
    "INSERT INTO homeroom_teachers (school_id, grade, classroom, teacher_name) VALUES ('__TSCHH', 'ป.1', '1', 'ครูโรงเรียนอื่น')",
  );
  otherRowId = r.insertId;
  schoolToken = await login(SCHOOL);
  driverToken = await login(DRIVER);
});

afterAll(async () => {
  env.features.homeroomTeachers = flagBefore;
  await q("DELETE FROM homeroom_teachers WHERE school_id IN ('__TSCH', '__TSCHH')");
  await q("DELETE FROM schools WHERE id = '__TSCHH'");
});

let createdId;

test('the school sees its rooms, with the seeded pupil\'s room listed', async () => {
  const res = await asSchool(request(app).get('/api/school/homeroom-teachers'));
  expect(res.status).toBe(200);
  expect(res.body.data.can_edit).toBe(true);
  const room = res.body.data.rooms.find((r) => r.grade === 'ป.1' && r.classroom === '1');
  expect(room).toBeTruthy();
  expect(room.student_count).toBeGreaterThanOrEqual(1);
  // another school's teacher never shows up
  expect(JSON.stringify(res.body.data.rooms)).not.toContain('ครูโรงเรียนอื่น');
});

test('add a teacher with a phone (normalised), then it reaches the other pages', async () => {
  const res = await asSchool(request(app).post('/api/school/homeroom-teachers'))
    .send({ grade: 'ป.1', classroom: '1', teacher_name: 'ครูสมใจ ใจดี', phone: '081-234-5678' });
  expect(res.status).toBe(201);
  createdId = res.body.data.id;
  const [row] = await q('SELECT phone, school_id FROM homeroom_teachers WHERE id = ?', [createdId]);
  expect(row).toEqual({ phone: '0812345678', school_id: '__TSCH' });

  const list = await asSchool(request(app).get('/api/school/students?search=__Test'));
  const pupil = list.body.data.students.find((s) => s.id === 99999);
  expect(pupil.homeroom_teachers).toEqual([{ name: 'ครูสมใจ ใจดี', phone: '0812345678' }]);

  const roster = await asDriver(request(app).get('/api/driver/roster'));
  const onBus = roster.body.data.students.find((s) => s.id === 99999);
  expect(onBus.homeroom_teachers).toEqual([{ name: 'ครูสมใจ ใจดี', phone: '0812345678' }]);

  const check = await asSchool(request(app).get('/api/school/teacher-check?session=morning'));
  expect(check.status).toBe(200);
  expect(check.body.data.homerooms).toEqual(expect.arrayContaining([
    expect.objectContaining({ grade: 'ป.1', classroom: '1', teachers: [{ name: 'ครูสมใจ ใจดี', phone: '0812345678' }] }),
  ]));
});

test('bad input is 400; another school\'s row is 404 and untouched', async () => {
  expect((await asSchool(request(app).post('/api/school/homeroom-teachers')).send({ grade: 'ป.1', teacher_name: '' })).status).toBe(400);
  expect((await asSchool(request(app).post('/api/school/homeroom-teachers')).send({ grade: 'ป.1', teacher_name: 'x', phone: '12' })).status).toBe(400);
  expect((await asSchool(request(app).put(`/api/school/homeroom-teachers/${otherRowId}`)).send({ teacher_name: 'แก้' })).status).toBe(404);
  expect((await asSchool(request(app).delete(`/api/school/homeroom-teachers/${otherRowId}`))).status).toBe(404);
  const [row] = await q('SELECT teacher_name FROM homeroom_teachers WHERE id = ?', [otherRowId]);
  expect(row.teacher_name).toBe('ครูโรงเรียนอื่น');
});

test('a driver cannot write (403)', async () => {
  const res = await asDriver(request(app).post('/api/school/homeroom-teachers')).send({ grade: 'ป.1', teacher_name: 'x' });
  expect(res.status).toBe(403);
});

test('edit, then delete — both audited', async () => {
  const put = await asSchool(request(app).put(`/api/school/homeroom-teachers/${createdId}`)).send({ teacher_name: 'ครูสมใจ', phone: '' });
  expect(put.status).toBe(200);
  const [row] = await q('SELECT teacher_name, phone FROM homeroom_teachers WHERE id = ?', [createdId]);
  expect(row).toEqual({ teacher_name: 'ครูสมใจ', phone: null });

  expect((await asSchool(request(app).delete(`/api/school/homeroom-teachers/${createdId}`))).status).toBe(200);
  expect(await q('SELECT 1 FROM homeroom_teachers WHERE id = ?', [createdId])).toHaveLength(0);

  const audits = await q("SELECT action FROM audit_logs WHERE entity_type = 'homeroom_teacher' AND entity_id = ?", [String(createdId)]);
  expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['CREATE', 'UPDATE', 'DELETE']));
});

test('flag off: endpoints 404 and the student list carries no teacher field', async () => {
  env.features.homeroomTeachers = false;
  try {
    expect((await asSchool(request(app).get('/api/school/homeroom-teachers'))).status).toBe(404);
    const list = await asSchool(request(app).get('/api/school/students?search=__Test'));
    const pupil = list.body.data.students.find((s) => s.id === 99999);
    expect(pupil.homeroom_teachers).toBeUndefined();
  } finally {
    env.features.homeroomTeachers = true;
  }
});
