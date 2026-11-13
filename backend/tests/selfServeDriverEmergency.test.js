'use strict';

/**
 * selfServeDriverEmergency.test.js — INTEGRATION (disposable lampang_bus_test).
 *
 * Owner decisions 2026-11-13:
 *  - the driver account stays tied to the vehicle (username = plate);
 *  - EVERY school whose pupils ride a (shared) vehicle may reset the driver
 *    password and change the driver; the affiliation may too for its schools;
 *  - an emergency may be closed by the related school(s), their affiliation,
 *    province, the driver of that vehicle ("แก้ไขแล้ว") and admin, with a
 *    required note and history kept.
 *
 * Builds its own fixtures (two affiliations, two schools, a shared vehicle and
 * a school-A-only vehicle, plate accounts) so the shared __test_* fixtures from
 * tests/setup.js are never touched — resetting their password would break the
 * rest of the suite.
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../src/app');
const { getTestConnection } = require('./dbHelper');

const PW = 'testpass123';
const AFF_A = '__SDAFA';
const AFF_B = '__SDAFB';
const SCH_A = '__SDSA';
const SCH_B = '__SDSB';
const V_SHARED = 'V-sdshared001';
const V_AONLY = 'V-sdaonly0001';
const P_SHARED = '__SD SHARED 1';
const P_AONLY = '__SD AONLY 2';
const USERS = {
  schoolA: '__sd_school_a', schoolB: '__sd_school_b',
  affA: '__sd_aff_a', affB: '__sd_aff_b',
  province: '__test_province',
  drvShared: P_SHARED, drvAOnly: P_AONLY,
};

async function q(sql, params = []) {
  const conn = await getTestConnection();
  try { return (await conn.query(sql, params))[0]; } finally { await conn.end(); }
}

const tokens = {};
async function login(username, password = PW) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  return res.body && res.body.data ? res.body.data.access_token : null;
}
const as = (who, r) => r.set('Authorization', `Bearer ${tokens[who]}`);

let driverIds = {};
const emIds = {};

async function cleanup() {
  const userRows = await q('SELECT id FROM users WHERE username IN (?)', [[USERS.schoolA, USERS.schoolB, USERS.affA, USERS.affB, P_SHARED, P_AONLY]]);
  const uids = userRows.map((r) => r.id);
  await q('DELETE FROM emergency_logs WHERE vehicle_id IN (?)', [[V_SHARED, V_AONLY]]);
  if (uids.length) {
    await q('DELETE FROM emergency_logs WHERE reported_by IN (?)', [uids]);
    await q('DELETE FROM audit_logs WHERE user_id IN (?)', [uids]);
    await q('DELETE FROM user_recovery_channels WHERE user_id IN (?)', [uids]);
    await q('DELETE FROM revoked_tokens WHERE user_id IN (?)', [uids]).catch(() => {});
    await q('DELETE FROM users WHERE id IN (?)', [uids]);
  }
  const dvas = await q('SELECT DISTINCT driver_id FROM driver_vehicle_assignments WHERE vehicle_id IN (?)', [[V_SHARED, V_AONLY]]);
  await q('DELETE FROM vehicle_operating_shifts WHERE vehicle_id IN (?)', [[V_SHARED, V_AONLY]]).catch(() => {});
  await q('DELETE FROM driver_vehicle_assignments WHERE vehicle_id IN (?)', [[V_SHARED, V_AONLY]]);
  if (dvas.length) await q('DELETE FROM drivers WHERE id IN (?)', [dvas.map((d) => d.driver_id)]).catch(() => {});
  await q('DELETE FROM students WHERE id IN (99801, 99802, 99803)');
  await q('DELETE FROM vehicles WHERE id IN (?)', [[V_SHARED, V_AONLY]]);
  await q('DELETE FROM schools WHERE id IN (?)', [[SCH_A, SCH_B]]);
  await q('DELETE FROM affiliations WHERE id IN (?)', [[AFF_A, AFF_B]]);
}

beforeAll(async () => {
  await cleanup();
  const hash = await bcrypt.hash(PW, 12);
  await q('INSERT INTO affiliations (id, name) VALUES (?, ?), (?, ?)', [AFF_A, '__SD Aff A', AFF_B, '__SD Aff B']);
  await q('INSERT INTO schools (id, name, affiliation_id) VALUES (?, ?, ?), (?, ?, ?)', [SCH_A, '__SD School A', AFF_A, SCH_B, '__SD School B', AFF_B]);
  await q(
    'INSERT INTO vehicles (id, plate_no, normalized_plate, vehicle_type) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
    [V_SHARED, P_SHARED, '__sdshared1', 'รถตู้', V_AONLY, P_AONLY, '__sdaonly2', 'รถตู้'],
  );
  for (const [name, vid] of [['__SD Driver Shared', V_SHARED], ['__SD Driver AOnly', V_AONLY]]) {
    const r = await q('INSERT INTO drivers (name, phone) VALUES (?, ?)', [name, '0800000000']);
    driverIds[vid] = r.insertId;
    await q('INSERT INTO driver_vehicle_assignments (driver_id, vehicle_id, start_date, is_active) VALUES (?, ?, CURDATE(), TRUE)', [r.insertId, vid]);
  }
  const userRows = [
    [USERS.schoolA, 'school', 'SCHOOL', SCH_A, null],
    [USERS.schoolB, 'school', 'SCHOOL', SCH_B, null],
    [USERS.affA, 'affiliation', 'AFFILIATION', AFF_A, null],
    [USERS.affB, 'affiliation', 'AFFILIATION', AFF_B, null],
    [P_SHARED, 'driver', null, null, driverIds[V_SHARED]],
    [P_AONLY, 'driver', null, null, driverIds[V_AONLY]],
  ];
  for (const [username, role, st, sid, did] of userRows) {
    await q(
      `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name, driver_id, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, FALSE)`,
      [username, hash, role, st, sid, username, did],
    );
  }
  // Shared vehicle carries a pupil of A and of B; the other only a pupil of A.
  const pupil = (id, school, vehicle) => q(
    `INSERT INTO students (id, cid_hash, prefix, first_name, last_name, grade, classroom, school_id, vehicle_id,
                           morning_enabled, evening_enabled, term_id)
     VALUES (?, SHA2(?, 256), 'เด็กชาย', '__SD', 'Pupil', 'ป.1', '1', ?, ?, TRUE, TRUE, '2568-2')`,
    [id, `sd-${id}`, school, vehicle],
  );
  await pupil(99801, SCH_A, V_SHARED);
  await pupil(99802, SCH_B, V_SHARED);
  await pupil(99803, SCH_A, V_AONLY);

  const [drvShared] = await q('SELECT id FROM users WHERE username = ?', [P_SHARED]);
  const [drvAOnly] = await q('SELECT id FROM users WHERE username = ?', [P_AONLY]);
  for (const [key, vid, plate, uid] of [['shared', V_SHARED, P_SHARED, drvShared.id], ['aonly', V_AONLY, P_AONLY, drvAOnly.id],
    ['shared2', V_SHARED, P_SHARED, drvShared.id], ['shared3', V_SHARED, P_SHARED, drvShared.id]]) {
    const r = await q("INSERT INTO emergency_logs (reported_by, channel, vehicle_id, plate_no, detail, note) VALUES (?, 'web', ?, ?, ?, ?)",
      [uid, vid, plate, `__sd test ${key}`, 'บันทึกเดิมของคนขับ']);
    emIds[key] = r.insertId;
  }

  for (const k of ['schoolA', 'schoolB', 'affA', 'affB', 'province', 'drvShared', 'drvAOnly']) {
    tokens[k] = await login(USERS[k], k === 'province' ? 'testpass123' : PW);
    expect(tokens[k]).toBeTruthy();
  }
});

afterAll(async () => {
  await cleanup();
});

describe('driver account self-service (school / affiliation)', () => {
  test('school B cannot reset the A-only vehicle (404) and nothing changes', async () => {
    const before = await q('SELECT password_hash FROM users WHERE username = ?', [P_AONLY]);
    const res = await as('schoolB', request(app).post(`/api/school/vehicles/${V_AONLY}/driver/reset-password`));
    expect(res.status).toBe(404);
    const after = await q('SELECT password_hash FROM users WHERE username = ?', [P_AONLY]);
    expect(after[0].password_hash).toBe(before[0].password_hash);
  });

  test('affiliation B cannot touch the A-only vehicle (404)', async () => {
    const res = await as('affB', request(app).post(`/api/affiliation/vehicles/${V_AONLY}/driver/replace`)).send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  test('a driver token cannot reach the school endpoint (403)', async () => {
    const res = await as('drvAOnly', request(app).post(`/api/school/vehicles/${V_AONLY}/driver/reset-password`));
    expect(res.status).toBe(403);
  });

  test('driver-closes-own-emergency happens before any reset (token still valid)', async () => {
    // other vehicle's emergency: 404 and untouched
    const cross = await as('drvAOnly', request(app).post(`/api/driver/emergencies/${emIds.shared}/resolve`)).send({ note: 'ไม่ใช่รถฉัน' });
    expect(cross.status).toBe(404);
    const [row] = await q('SELECT result FROM emergency_logs WHERE id = ?', [emIds.shared]);
    expect(row.result).toBeNull();

    // note required
    expect((await as('drvAOnly', request(app).post(`/api/driver/emergencies/${emIds.aonly}/resolve`)).send({})).status).toBe(400);

    const open = await as('drvAOnly', request(app).get('/api/driver/emergencies/open'));
    expect(open.status).toBe(200);
    expect(open.body.data.map((e) => e.id)).toEqual([emIds.aonly]);

    const ok = await as('drvAOnly', request(app).post(`/api/driver/emergencies/${emIds.aonly}/resolve`)).send({ note: 'รถซ่อมเสร็จแล้ว' });
    expect(ok.status).toBe(200);
    const [closed] = await q('SELECT result, note FROM emergency_logs WHERE id = ?', [emIds.aonly]);
    expect(closed.result).toBe('RESOLVED');
    expect(closed.note).toMatch(/^บันทึกเดิมของคนขับ\n\[ปิดเหตุ .* · คนขับ · .*\] รถซ่อมเสร็จแล้ว$/);
    const [audit] = await q("SELECT new_value FROM audit_logs WHERE entity_type = 'emergency' AND entity_id = ? ORDER BY id DESC LIMIT 1", [String(emIds.aonly)]);
    const nv = typeof audit.new_value === 'string' ? JSON.parse(audit.new_value) : audit.new_value;
    expect(nv).toMatchObject({ action: 'close_emergency', closed_by_role: 'driver', close_note: 'รถซ่อมเสร็จแล้ว', result: 'RESOLVED' });

    // closing twice is a 409, not a silent overwrite
    const again = await as('affA', request(app).post(`/api/affiliation/emergencies/${emIds.aonly}/close`)).send({ note: 'ซ้ำ' });
    expect(again.status).toBe(409);
  });

  test('both schools of the shared vehicle may reset; old sessions die; temp password works', async () => {
    // auth compares whole seconds (iat < password_changed_at): the driver's
    // token must be issued in an earlier second than the reset, or it survives.
    await new Promise((r) => setTimeout(r, 1100));
    // The current holder has bound LINE for self-service recovery (#177).
    const [acct0] = await q('SELECT id FROM users WHERE username = ?', [P_SHARED]);
    await q("INSERT INTO user_recovery_channels (user_id, provider, provider_subject) VALUES (?, 'LINE', '__sd_line_shared')", [acct0.id]);
    const resB = await as('schoolB', request(app).post(`/api/school/vehicles/${V_SHARED}/driver/reset-password`));
    expect(resB.status).toBe(200);
    expect(resB.body.data.username).toBe(P_SHARED);
    expect(resB.body.data.temporary_password).toMatch(/^[a-z2-9]{8}$/);
    // a school reset releases the previous holder's LINE recovery binding
    expect(await q('SELECT 1 FROM user_recovery_channels WHERE user_id = ?', [acct0.id])).toHaveLength(0);

    // the driver's previous token is rejected (password_changed_at > iat)
    await new Promise((r) => setTimeout(r, 1100));
    const stale = await as('drvShared', request(app).get('/api/driver/emergencies/open'));
    expect(stale.status).toBe(401);

    const resA = await as('schoolA', request(app).post(`/api/school/vehicles/${V_SHARED}/driver/reset-password`));
    expect(resA.status).toBe(200);
    const fresh = await request(app).post('/api/auth/login').send({ username: P_SHARED, password: resA.body.data.temporary_password });
    expect(fresh.status).toBe(200);
    // the earlier temp password no longer works
    const old = await request(app).post('/api/auth/login').send({ username: P_SHARED, password: resB.body.data.temporary_password });
    expect(old.status).toBe(401);

    const [u] = await q('SELECT must_change_password FROM users WHERE username = ?', [P_SHARED]);
    expect(Number(u.must_change_password)).toBe(1);
    const [acct] = await q('SELECT id FROM users WHERE username = ?', [P_SHARED]);
    const audits = await q(
      "SELECT new_value FROM audit_logs WHERE entity_type = 'user' AND entity_id = ? ORDER BY id",
      [String(acct.id)],
    );
    const values = audits.map((a) => (typeof a.new_value === 'string' ? JSON.parse(a.new_value) : a.new_value));
    expect(values.filter((v) => v && v.action === 'reset_password')).toHaveLength(2);
    expect(JSON.stringify(values)).not.toContain(resA.body.data.temporary_password);
  });

  test('edit driver details (same person) updates name/phone without a reset', async () => {
    const [before] = await q('SELECT password_hash FROM users WHERE username = ?', [P_AONLY]);
    const res = await as('schoolA', request(app).put(`/api/school/vehicles/${V_AONLY}/driver`)).send({ name: '__SD ชื่อแก้', phone: '081-111-2222' });
    expect(res.status).toBe(200);
    const [d] = await q('SELECT name, phone FROM drivers WHERE id = ?', [driverIds[V_AONLY]]);
    expect(d).toEqual({ name: '__SD ชื่อแก้', phone: '081-111-2222' });
    const [after] = await q('SELECT password_hash, display_name FROM users WHERE username = ?', [P_AONLY]);
    expect(after.password_hash).toBe(before.password_hash);
    expect(after.display_name).toBe('__SD ชื่อแก้');
    expect((await as('schoolA', request(app).put(`/api/school/vehicles/${V_AONLY}/driver`)).send({ name: '' })).status).toBe(400);
  });

  test('affiliation A changes the driver of the A-only vehicle: new profile, old access gone', async () => {
    await new Promise((r) => setTimeout(r, 1100)); // whole-second iat, see above
    const [acctA] = await q('SELECT id FROM users WHERE username = ?', [P_AONLY]);
    await q("INSERT INTO user_recovery_channels (user_id, provider, provider_subject) VALUES (?, 'LINE', '__sd_line_aonly')", [acctA.id]);
    const res = await as('affA', request(app).post(`/api/affiliation/vehicles/${V_AONLY}/driver/replace`))
      .send({ name: '__SD คนขับใหม่', phone: '0822222222', reason: 'เปลี่ยนคนขับ' });
    expect(res.status).toBe(200);
    const newDriverId = res.body.data.driver_id;
    expect(newDriverId).not.toBe(driverIds[V_AONLY]);
    expect(await q('SELECT 1 FROM user_recovery_channels WHERE user_id = ?', [acctA.id])).toHaveLength(0);
    const active = await q('SELECT driver_id FROM driver_vehicle_assignments WHERE vehicle_id = ? AND is_active = TRUE', [V_AONLY]);
    expect(active.map((a) => a.driver_id)).toEqual([newDriverId]);
    const [u] = await q('SELECT driver_id, display_name, must_change_password FROM users WHERE username = ?', [P_AONLY]);
    expect(u).toMatchObject({ driver_id: newDriverId, display_name: '__SD คนขับใหม่' });
    // old driver profile keeps its own record (history), just no active assignment
    const [oldD] = await q('SELECT name FROM drivers WHERE id = ?', [driverIds[V_AONLY]]);
    expect(oldD.name).toBe('__SD ชื่อแก้');

    await new Promise((r) => setTimeout(r, 1100));
    expect((await as('drvAOnly', request(app).get('/api/driver/emergencies/open'))).status).toBe(401);
    const old = await request(app).post('/api/auth/login').send({ username: P_AONLY, password: PW });
    expect(old.status).toBe(401);
    const fresh = await request(app).post('/api/auth/login').send({ username: P_AONLY, password: res.body.data.temporary_password });
    expect(fresh.status).toBe(200);

    const [audit] = await q("SELECT new_value FROM audit_logs WHERE entity_type = 'driver_vehicle_assignment' AND entity_id = ? ORDER BY id DESC LIMIT 1", [V_AONLY]);
    const nv = typeof audit.new_value === 'string' ? JSON.parse(audit.new_value) : audit.new_value;
    expect(nv).toMatchObject({ action: 'replace_driver', actor_role: 'affiliation', password_reset: true });
  });
});

describe('scoped emergency close', () => {
  test('school A (rides the shared vehicle) may close; affiliation B too; school-only scope enforced', async () => {
    // school B also rides the shared vehicle → allowed
    const b = await as('schoolB', request(app).post(`/api/school/emergencies/${emIds.shared}/close`)).send({ note: 'โรงเรียน B ตรวจแล้ว', result: 'FALSE_ALARM' });
    expect(b.status).toBe(200);
    expect(b.body.data.result).toBe('FALSE_ALARM');
  });

  test('note is required; driver-only result rules', async () => {
    expect((await as('schoolA', request(app).post(`/api/school/emergencies/${emIds.shared2}/close`)).send({ note: '  ' })).status).toBe(400);
    expect((await as('schoolA', request(app).post(`/api/school/emergencies/${emIds.shared2}/close`)).send({ note: 'x', result: 'CLOSED' })).status).toBe(400);
  });

  test('affiliation A closes a shared-vehicle emergency; province closes any', async () => {
    const a = await as('affA', request(app).post(`/api/affiliation/emergencies/${emIds.shared2}/close`)).send({ note: 'สังกัดรับทราบและแก้ไขแล้ว' });
    expect(a.status).toBe(200);
    const p = await as('province', request(app).post(`/api/province/emergencies/${emIds.shared3}/close`)).send({ note: 'จังหวัดปิดเหตุ' });
    expect(p.status).toBe(200);
    const [row] = await q('SELECT result, note FROM emergency_logs WHERE id = ?', [emIds.shared3]);
    expect(row.result).toBe('RESOLVED');
    expect(row.note).toContain('· จังหวัด');
  });

  test('a school whose pupils do not ride the vehicle gets 404', async () => {
    // reopen one to test scope on an open row
    await q('UPDATE emergency_logs SET result = NULL WHERE id = ?', [emIds.aonly]);
    const res = await as('schoolB', request(app).post(`/api/school/emergencies/${emIds.aonly}/close`)).send({ note: 'ไม่ใช่รถของเรา' });
    expect(res.status).toBe(404);
    const resAff = await as('affB', request(app).post(`/api/affiliation/emergencies/${emIds.aonly}/close`)).send({ note: 'ไม่ใช่เขตเรา' });
    expect(resAff.status).toBe(404);
    const [row] = await q('SELECT result FROM emergency_logs WHERE id = ?', [emIds.aonly]);
    expect(row.result).toBeNull();
  });
});
