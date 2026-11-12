'use strict';

/**
 * affiliationUserManagement.test.js — INTEGRATION (disposable lampang_bus_test DB;
 * tests/setup.js seeds __TAFF, its school __TSCH and __test_affiliation).
 *
 * Owner decision 2026-11-12: an affiliation manages the MAIN accounts of the
 * schools in its own affiliation (/api/affiliation/users). These tests pin the
 * scope as well as the happy paths:
 *   - a school main account in __TAFF: list, rename, deactivate, reset, delete, restore
 *   - a grade-teacher account of the same school: invisible and untouchable (404)
 *   - a school main account in ANOTHER affiliation: invisible and untouchable (404)
 *   - school / driver tokens: 403
 */

require('dotenv').config();
const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../src/app');
const { getTestConnection } = require('./dbHelper');

const AFF = { username: '__test_affiliation', password: 'testpass123' };
const SCHOOL = { username: '__test_school', password: 'testpass123' };
const OTHER_AFF = '__TAFF2';
const OTHER_SCHOOL = '__TSCH2';
const U_MAIN = '__aum_main';
const U_TEACHER = '__aum_teacher';
const U_OTHER = '__aum_other';

let affToken = '';
let schoolToken = '';
const ids = {};

async function q(sql, params = []) {
  const conn = await getTestConnection();
  try { return (await conn.query(sql, params))[0]; } finally { await conn.end(); }
}

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data.access_token;
}

const asAff = (r) => r.set('Authorization', `Bearer ${affToken}`);

async function cleanup() {
  await q('DELETE FROM audit_logs WHERE entity_type = ? AND entity_id IN (SELECT id FROM users WHERE username IN (?, ?, ?))',
    ['user', U_MAIN, U_TEACHER, U_OTHER]).catch(() => {});
  await q('DELETE FROM users WHERE username IN (?, ?, ?, ?)', [U_MAIN, U_TEACHER, U_OTHER, '123456']);
  await q('DELETE FROM schools WHERE id = ?', [OTHER_SCHOOL]);
  await q('DELETE FROM affiliations WHERE id = ?', [OTHER_AFF]);
}

beforeAll(async () => {
  await cleanup();
  await q("INSERT INTO affiliations (id, name) VALUES (?, '__Test Affiliation 2')", [OTHER_AFF]);
  await q("INSERT INTO schools (id, name, affiliation_id) VALUES (?, '__Test School 2', ?)", [OTHER_SCHOOL, OTHER_AFF]);
  const hash = await bcrypt.hash('Initial#Pass2569', 4);
  const add = async (username, schoolId, grade) => {
    const r = await q(
      `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name, grade_scope, is_active)
       VALUES (?, ?, 'school', 'SCHOOL', ?, ?, ?, TRUE)`,
      [username, hash, schoolId, username, grade],
    );
    return r.insertId;
  };
  ids.main = await add(U_MAIN, '__TSCH', null);
  ids.teacher = await add(U_TEACHER, '__TSCH', 'ป.1');
  ids.other = await add(U_OTHER, OTHER_SCHOOL, null);
  affToken = await login(AFF);
  schoolToken = await login(SCHOOL);
});

afterAll(cleanup);

describe('scope', () => {
  test('list shows main accounts of this affiliation only', async () => {
    const res = await asAff(request(app).get('/api/affiliation/users'));
    expect(res.status).toBe(200);
    const names = res.body.data.map((u) => u.username);
    expect(names).toContain(U_MAIN);
    expect(names).not.toContain(U_TEACHER);
    expect(names).not.toContain(U_OTHER);
    expect(res.body.data.every((u) => u.school_id)).toBe(true);
  });

  test.each([
    ['teacher sub-account', 'teacher'],
    ['another affiliation', 'other'],
  ])('%s: every write answers 404 and changes nothing', async (_label, key) => {
    const id = ids[key];
    expect((await asAff(request(app).put(`/api/affiliation/users/${id}`)).send({ display_name: 'x' })).status).toBe(404);
    expect((await asAff(request(app).post(`/api/affiliation/users/${id}/reset-password`)).send({ password: 'Strong#Pass2569x' })).status).toBe(404);
    expect((await asAff(request(app).delete(`/api/affiliation/users/${id}`))).status).toBe(404);
    const [row] = await q('SELECT display_name, is_deleted, must_change_password FROM users WHERE id = ?', [id]);
    expect(row.display_name).not.toBe('x');
    expect(Boolean(row.is_deleted)).toBe(false);
    expect(Boolean(row.must_change_password)).toBe(false);
  });

  test('a school token is refused (403)', async () => {
    const res = await request(app).get('/api/affiliation/users').set('Authorization', `Bearer ${schoolToken}`);
    expect(res.status).toBe(403);
  });
});

describe('main account lifecycle', () => {
  test('rename', async () => {
    const res = await asAff(request(app).put(`/api/affiliation/users/${ids.main}`)).send({ display_name: '  ชื่อใหม่  ' });
    expect(res.status).toBe(200);
    const [row] = await q('SELECT display_name FROM users WHERE id = ?', [ids.main]);
    expect(row.display_name).toBe('ชื่อใหม่');
  });

  test('empty name and non-boolean is_active are 400', async () => {
    expect((await asAff(request(app).put(`/api/affiliation/users/${ids.main}`)).send({ display_name: '  ' })).status).toBe(400);
    expect((await asAff(request(app).put(`/api/affiliation/users/${ids.main}`)).send({ is_active: 'no' })).status).toBe(400);
    expect((await asAff(request(app).put(`/api/affiliation/users/${ids.main}`)).send({})).status).toBe(400);
  });

  test('deactivate then activate', async () => {
    expect((await asAff(request(app).put(`/api/affiliation/users/${ids.main}`)).send({ is_active: false })).status).toBe(200);
    expect(Boolean((await q('SELECT is_active FROM users WHERE id = ?', [ids.main]))[0].is_active)).toBe(false);
    expect((await asAff(request(app).put(`/api/affiliation/users/${ids.main}`)).send({ is_active: true })).status).toBe(200);
    expect(Boolean((await q('SELECT is_active FROM users WHERE id = ?', [ids.main]))[0].is_active)).toBe(true);
  });

  test('reset password: weak is refused, strong forces a change and ends sessions', async () => {
    expect((await asAff(request(app).post(`/api/affiliation/users/${ids.main}/reset-password`)).send({ password: '12345678' })).status).toBe(400);
    const res = await asAff(request(app).post(`/api/affiliation/users/${ids.main}/reset-password`)).send({ password: 'Strong#Pass2569x' });
    expect(res.status).toBe(200);
    const [row] = await q('SELECT must_change_password, password_changed_at FROM users WHERE id = ?', [ids.main]);
    expect(Boolean(row.must_change_password)).toBe(true);
    expect(row.password_changed_at).not.toBeNull();
  });

  test('delete → shows under deleted → restore comes back deactivated', async () => {
    expect((await asAff(request(app).delete(`/api/affiliation/users/${ids.main}`))).status).toBe(200);
    const active = await asAff(request(app).get('/api/affiliation/users'));
    expect(active.body.data.map((u) => u.username)).not.toContain(U_MAIN);
    const deleted = await asAff(request(app).get('/api/affiliation/users?status=deleted'));
    expect(deleted.body.data.map((u) => u.username)).toContain(U_MAIN);

    // writes on a deleted account are 404 until restored
    expect((await asAff(request(app).put(`/api/affiliation/users/${ids.main}`)).send({ is_active: true })).status).toBe(404);

    const res = await asAff(request(app).post(`/api/affiliation/users/${ids.main}/restore`));
    expect(res.status).toBe(200);
    const [row] = await q('SELECT is_deleted, is_active FROM users WHERE id = ?', [ids.main]);
    expect(Boolean(row.is_deleted)).toBe(false);
    expect(Boolean(row.is_active)).toBe(false);
  });

  test('every change is audited', async () => {
    const rows = await q("SELECT action FROM audit_logs WHERE entity_type = 'user' AND entity_id = ?", [String(ids.main)]);
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['UPDATE', 'DELETE']));
  });

  test('create: only for a school in this affiliation', async () => {
    const other = await asAff(request(app).post('/api/affiliation/users')).send({ school_id: OTHER_SCHOOL, username: '123456' });
    expect(other.status).toBe(403);
    const missing = await asAff(request(app).post('/api/affiliation/users')).send({ username: '123456' });
    expect(missing.status).toBe(400);
  });
});
