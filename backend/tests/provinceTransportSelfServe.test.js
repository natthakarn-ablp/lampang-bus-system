'use strict';

/**
 * provinceTransportSelfServe.test.js — INTEGRATION (disposable lampang_bus_test
 * DB; tests/setup.js seeds __TAFF, __TSCH with one active student, the test
 * vehicle and the __test_province / __test_school users).
 *
 * Pins, end to end through the real routers:
 *   - province: affiliation/transport accounts create → rename → close →
 *     delete → restore; school/admin/province accounts out of reach (404);
 *   - province: create/rename affiliation, rename/move a school, deactivate
 *     blocked (409) while it has students, allowed when empty, restore;
 *   - school / transport tokens cannot reach these province writes (403);
 *   - transport: document expiry + plate fix that renames the driver login;
 *   - school: document expiry only for a vehicle its pupils ride.
 */

require('dotenv').config();
const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../src/app');
const { getTestConnection } = require('./dbHelper');
const PI = require('../src/utils/plateIdentity');
const { normalizePlate } = require('../src/utils/vehiclePlate');

const PROVINCE = { username: '__test_province', password: 'testpass123' };
const SCHOOL = { username: '__test_school', password: 'testpass123' };
const TRANSPORT = { username: '__pss_transport', password: 'Pss#Transport2569' };
const NEW_AFF = '__PSSA';
const EMPTY_SCHOOL = '__PSSS';
const U_AFF = '__pss_aff_user';
const U_TRN = '__pss_trn_user';
const VEH = 'V-pssfixture01';
const OLD_PLATE = 'ฮฮ 9871 ลำปาง';
const NEW_PLATE = 'ฮฮ 9872 ลำปาง';
const OTHER_VEH = 'V-pssfixture02';

let provToken = '';
let schoolToken = '';
let trnToken = '';
const ids = {};

async function q(sql, params = []) {
  const conn = await getTestConnection();
  try { return (await conn.query(sql, params))[0]; } finally { await conn.end(); }
}

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data.access_token;
}

const as = (token) => (r) => r.set('Authorization', `Bearer ${token}`);

async function cleanup() {
  await q('DELETE FROM users WHERE username IN (?, ?, ?, ?, ?)', [U_AFF, U_TRN, TRANSPORT.username, OLD_PLATE, NEW_PLATE]);
  await q('DELETE FROM vehicles WHERE id IN (?, ?)', [VEH, OTHER_VEH]);
  await q('DELETE FROM schools WHERE id = ?', [EMPTY_SCHOOL]);
  await q('DELETE FROM affiliations WHERE id = ?', [NEW_AFF]);
  await q("UPDATE schools SET name = '__Test School', affiliation_id = '__TAFF', is_deleted = FALSE, deleted_at = NULL WHERE id = '__TSCH'");
}

async function addVehicle(id, plate) {
  await q(
    `INSERT INTO vehicles (id, plate_no, normalized_plate, canonical_plate, vehicle_type)
     VALUES (?, ?, ?, ?, 'รถตู้')`,
    [id, plate, normalizePlate(plate), PI.canonicalPlateForStorage(plate)],
  );
}

beforeAll(async () => {
  await cleanup();
  const hash = await bcrypt.hash(TRANSPORT.password, 4);
  await q(`INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, 'transport', 'PSS transport')`,
    [TRANSPORT.username, hash]);
  await q("INSERT INTO schools (id, name, affiliation_id) VALUES (?, '__PSS Empty School', '__TAFF')", [EMPTY_SCHOOL]);
  await addVehicle(VEH, OLD_PLATE);
  await addVehicle(OTHER_VEH, 'ฮฮ 9873 ลำปาง');
  const r = await q(`INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, 'driver', 'PSS driver')`,
    [OLD_PLATE, hash]);
  ids.driver = r.insertId;
  provToken = await login(PROVINCE);
  schoolToken = await login(SCHOOL);
  trnToken = await login(TRANSPORT);
});

afterAll(cleanup);

describe('province — affiliation + transport accounts', () => {
  test('create an affiliation account; temporary password shown once', async () => {
    const res = await as(provToken)(request(app).post('/api/province/unit-accounts'))
      .send({ role: 'affiliation', username: U_AFF, scope_id: '__TAFF' });
    expect(res.status).toBe(201);
    expect(res.body.data.temporary_password).toMatch(/^[A-Za-z0-9]{8}$/);
    ids.aff = res.body.data.id;
    const [row] = await q('SELECT role, scope_type, scope_id, must_change_password FROM users WHERE id = ?', [ids.aff]);
    expect(row).toMatchObject({ role: 'affiliation', scope_type: 'AFFILIATION', scope_id: '__TAFF' });
    expect(Boolean(row.must_change_password)).toBe(true);
    const [audit] = await q("SELECT new_value FROM audit_logs WHERE entity_type = 'user' AND entity_id = ? AND action = 'CREATE'", [String(ids.aff)]);
    expect(JSON.stringify(audit.new_value)).not.toContain(res.body.data.temporary_password);
  });

  test('create a transport account', async () => {
    const res = await as(provToken)(request(app).post('/api/province/unit-accounts'))
      .send({ role: 'transport', username: U_TRN, display_name: 'ขนส่งทดสอบ' });
    expect(res.status).toBe(201);
    ids.trn = res.body.data.id;
  });

  test('cannot create a school or admin account', async () => {
    for (const role of ['school', 'admin', 'province']) {
      const res = await as(provToken)(request(app).post('/api/province/unit-accounts'))
        .send({ role, username: `__pss_${role}`, scope_id: '__TSCH' });
      expect(res.status).toBe(400);
    }
  });

  test('rename, close, delete, restore (comes back closed)', async () => {
    let res = await as(provToken)(request(app).put(`/api/province/unit-accounts/${ids.trn}`)).send({ display_name: 'ขนส่งใหม่' });
    expect(res.status).toBe(200);
    res = await as(provToken)(request(app).put(`/api/province/unit-accounts/${ids.trn}`)).send({ is_active: false });
    expect(res.status).toBe(200);
    res = await as(provToken)(request(app).delete(`/api/province/unit-accounts/${ids.trn}`));
    expect(res.status).toBe(200);
    res = await as(provToken)(request(app).get('/api/province/unit-accounts/deleted'));
    expect(res.body.data.map((u) => u.id)).toContain(ids.trn);
    res = await as(provToken)(request(app).post(`/api/province/unit-accounts/${ids.trn}/restore`));
    expect(res.status).toBe(200);
    const [row] = await q('SELECT display_name, is_active, is_deleted FROM users WHERE id = ?', [ids.trn]);
    expect(row).toMatchObject({ display_name: 'ขนส่งใหม่' });
    expect(Boolean(row.is_active)).toBe(false);
    expect(Boolean(row.is_deleted)).toBe(false);
  });

  test('a school account is out of reach (404)', async () => {
    const [school] = await q("SELECT id FROM users WHERE username = '__test_school'");
    const res = await as(provToken)(request(app).put(`/api/province/unit-accounts/${school.id}`)).send({ is_active: false });
    expect(res.status).toBe(404);
    const del = await as(provToken)(request(app).delete(`/api/province/unit-accounts/${school.id}`));
    expect(del.status).toBe(404);
  });

  test('school and transport tokens are refused (403)', async () => {
    for (const token of [schoolToken, trnToken]) {
      const res = await as(token)(request(app).post('/api/province/unit-accounts')).send({ role: 'transport', username: '__pss_x' });
      expect(res.status).toBe(403);
      const s = await as(token)(request(app).post(`/api/province/schools/${EMPTY_SCHOOL}/deactivate`));
      expect(s.status).toBe(403);
    }
  });
});

describe('province — affiliations and schools', () => {
  test('create + rename an affiliation; duplicate code is 409', async () => {
    let res = await as(provToken)(request(app).post('/api/province/affiliations')).send({ id: NEW_AFF, name: 'สังกัดทดสอบ' });
    expect(res.status).toBe(201);
    res = await as(provToken)(request(app).post('/api/province/affiliations')).send({ id: NEW_AFF, name: 'ซ้ำ' });
    expect(res.status).toBe(409);
    res = await as(provToken)(request(app).put(`/api/province/affiliations/${NEW_AFF}`)).send({ name: 'สังกัดทดสอบใหม่' });
    expect(res.status).toBe(200);
    const [row] = await q('SELECT name FROM affiliations WHERE id = ?', [NEW_AFF]);
    expect(row.name).toBe('สังกัดทดสอบใหม่');
  });

  test('rename + move a school to the new affiliation', async () => {
    const res = await as(provToken)(request(app).put(`/api/province/schools/${EMPTY_SCHOOL}`))
      .send({ name: '__PSS Renamed', affiliation_id: NEW_AFF });
    expect(res.status).toBe(200);
    const [row] = await q('SELECT name, affiliation_id FROM schools WHERE id = ?', [EMPTY_SCHOOL]);
    expect(row).toEqual({ name: '__PSS Renamed', affiliation_id: NEW_AFF });
  });

  test('deactivating a school with active students is 409 (FK guard)', async () => {
    const res = await as(provToken)(request(app).post('/api/province/schools/__TSCH/deactivate'));
    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('SCHOOL_IN_USE');
    expect(res.body.message).toMatch(/ปิดใช้งานโรงเรียนไม่ได้/);
    const [row] = await q("SELECT is_deleted FROM schools WHERE id = '__TSCH'");
    expect(Boolean(row.is_deleted)).toBe(false);
  });

  test('an empty school deactivates and restores', async () => {
    let res = await as(provToken)(request(app).post(`/api/province/schools/${EMPTY_SCHOOL}/deactivate`)).send({ reason: 'ทดสอบ' });
    expect(res.status).toBe(200);
    res = await as(provToken)(request(app).get('/api/province/schools/deactivated'));
    expect(res.body.data.map((s) => s.id)).toContain(EMPTY_SCHOOL);
    res = await as(provToken)(request(app).post(`/api/province/schools/${EMPTY_SCHOOL}/restore`));
    expect(res.status).toBe(200);
    const audits = await q("SELECT action FROM audit_logs WHERE entity_type = 'school' AND entity_id = ?", [EMPTY_SCHOOL]);
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['UPDATE', 'DELETE']));
  });
});

describe('transport — document expiry and plate fix', () => {
  test('transport updates the expiry dates (audited)', async () => {
    const res = await as(trnToken)(request(app).put(`/api/transport/vehicles/${VEH}/document-expiry`))
      .send({ registration_expiry: '2027-03-31', tax_expiry: '2027-04-30' });
    expect(res.status).toBe(200);
    const [row] = await q("SELECT DATE_FORMAT(registration_expiry, '%Y-%m-%d') AS r, DATE_FORMAT(tax_expiry, '%Y-%m-%d') AS t FROM vehicles WHERE id = ?", [VEH]);
    expect(row).toEqual({ r: '2027-03-31', t: '2027-04-30' });
  });

  test('a bad date is 400', async () => {
    const res = await as(trnToken)(request(app).put(`/api/transport/vehicles/${VEH}/document-expiry`)).send({ tax_expiry: '2027-02-30' });
    expect(res.status).toBe(400);
  });

  test('school cannot edit a vehicle its pupils do not ride (404) but can edit its own', async () => {
    let res = await as(schoolToken)(request(app).put(`/api/school/vehicles/${VEH}/document-expiry`)).send({ tax_expiry: '2027-05-01' });
    expect(res.status).toBe(404);
    res = await as(schoolToken)(request(app).put('/api/school/vehicles/V-test000000ab/document-expiry')).send({ tax_expiry: '2027-05-01' });
    expect(res.status).toBe(200);
  });

  test('plate fix renames the driver login in the same transaction', async () => {
    const res = await as(trnToken)(request(app).post(`/api/transport/vehicles/${VEH}/fix-plate`))
      .send({ plate_no: NEW_PLATE, reason: 'พิมพ์ผิด' });
    expect(res.status).toBe(200);
    const [veh] = await q('SELECT plate_no FROM vehicles WHERE id = ?', [VEH]);
    expect(veh.plate_no).toBe(NEW_PLATE);
    const [drv] = await q('SELECT username FROM users WHERE id = ?', [ids.driver]);
    expect(drv.username).toBe(NEW_PLATE);
  });

  test('plate fix onto another active vehicle plate is 409', async () => {
    const res = await as(trnToken)(request(app).post(`/api/transport/vehicles/${VEH}/fix-plate`))
      .send({ plate_no: 'ฮฮ 9873 ลำปาง', reason: 'x' });
    expect(res.status).toBe(409);
  });

  test('school token cannot use the transport plate fix (403)', async () => {
    const res = await as(schoolToken)(request(app).post(`/api/transport/vehicles/${VEH}/fix-plate`))
      .send({ plate_no: OLD_PLATE, reason: 'x' });
    expect(res.status).toBe(403);
  });
});
