'use strict';
// AUTH-03: PUT /api/admin/users/:id must validate scope on role change, like POST.
require('dotenv').config();
const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../src/app');
const { pool } = require('../src/config/database');

const PW = 'Probe-Pass-2026x';
async function mk(username, role, st, sid) {
  await pool.query('DELETE FROM users WHERE username = ?', [username]);
  const [r] = await pool.query(
    `INSERT INTO users (username,password_hash,role,scope_type,scope_id,display_name) VALUES (?,?,?,?,?,?)`,
    [username, await bcrypt.hash(PW, 4), role, st, sid, username]);
  return r.insertId;
}
let uid; let auth;
beforeAll(async () => {
  await mk('__au3_admin', 'admin', null, null);
  uid = await mk('__au3_u', 'province', 'PROVINCE', 'LPG');
  const a = (await request(app).post('/api/auth/login').send({ username: '__au3_admin', password: PW })).body.data;
  auth = { Authorization: 'Bearer ' + a.access_token };
});
afterAll(async () => {
  await pool.query("DELETE FROM users WHERE username IN ('__au3_admin','__au3_u')");
  await pool.end();
});

test('PUT rejects a scoped role with no scope_id', async () => {
  const r = await request(app).put('/api/admin/users/' + uid).set(auth).send({ role: 'school' });
  expect(r.status).toBe(400);
});

test('PUT rejects a nonexistent affiliation scope_id', async () => {
  const r = await request(app).put('/api/admin/users/' + uid).set(auth).send({ role: 'affiliation', scope_id: 'DOES-NOT-EXIST' });
  expect(r.status).toBe(400);
});

test('PUT rejects a nonexistent school scope_id', async () => {
  const r = await request(app).put('/api/admin/users/' + uid).set(auth).send({ role: 'school', scope_id: 'NOPE' });
  expect(r.status).toBe(400);
});

test('PUT still allows province scope and non-scoped role change', async () => {
  const r1 = await request(app).put('/api/admin/users/' + uid).set(auth).send({ role: 'province', scope_id: 'LPG' });
  expect(r1.status).toBe(200);
  const r2 = await request(app).put('/api/admin/users/' + uid).set(auth).send({ role: 'transport' });
  expect(r2.status).toBe(200);
});
