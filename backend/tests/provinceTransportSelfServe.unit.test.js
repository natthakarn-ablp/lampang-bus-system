'use strict';

/**
 * provinceTransportSelfServe.unit.test.js — DB-free (mock pool/conn).
 *
 * 2026-11-13: the province manages affiliation/transport accounts and the
 * organisation tree (affiliations, schools); transport (and the school that
 * uses a vehicle) keeps document expiry dates; transport/admin fix plate typos
 * together with the driver login. These pin scope, the FK guards and the
 * audit trail.
 */

require('./loadTestEnv');
const fs = require('fs');
const path = require('path');
const org = require('../src/services/orgEntities.service');
const provAdmin = require('../src/services/provinceAdmin.service');
const vehicleAdmin = require('../src/services/vehicleAdmin.service');
const docExpiry = require('../src/services/vehicleDocumentExpiry.service');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function makeConn(handler) {
  const calls = [];
  return {
    calls,
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
    query: jest.fn(async (sql, params) => { calls.push([sql, params]); return handler(sql, params); }),
  };
}
const poolOf = (conn) => ({ getConnection: jest.fn().mockResolvedValue(conn), query: conn.query });
const issued = (conn, re) => conn.calls.some(([s]) => re.test(s));
const callOf = (conn, re) => conn.calls.find(([s]) => re.test(s));
const dflt = (sql) => {
  if (/INSERT INTO/.test(sql)) return [{ insertId: 77 }];
  if (/^\s*(UPDATE|DELETE)/.test(sql)) return [{ affectedRows: 1 }];
  return [[]];
};
const auditRow = (conn) => {
  const c = callOf(conn, /INSERT INTO audit_logs/);
  return c ? { entity_type: c[1][2], entity_id: c[1][3], old: c[1][4], new: c[1][5] } : null;
};

// ─── School deactivation FK guard ───────────────────────────────────────────
describe('orgEntities.deactivateSchool — FK guard', () => {
  const school = { id: 'S1', name: 'โรงเรียนทดสอบ', affiliation_id: 'A1' };
  const conn = (deps) => makeConn((sql) => {
    if (/FROM schools WHERE id = \? AND is_deleted = FALSE FOR UPDATE/.test(sql)) return [[school]];
    if (/FROM students WHERE school_id = \?/.test(sql)) return [[{ students: deps.students, vehicles: deps.vehicles }]];
    if (/FROM vehicle_inspection_applications/.test(sql)) return [[{ n: deps.apps }]];
    if (/SELECT id FROM users/.test(sql)) return [[{ id: 11 }, { id: 12 }]];
    return dflt(sql);
  });

  test('409 SCHOOL_IN_USE with a Thai message while active students remain', async () => {
    const c = conn({ students: 3, vehicles: 1, apps: 0 });
    await expect(org.deactivateSchool(poolOf(c), { schoolId: 'S1', actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 409, errors: [expect.objectContaining({ code: 'SCHOOL_IN_USE', active_students: 3, vehicles_in_use: 1 })] });
    expect(issued(c, /UPDATE schools SET is_deleted = TRUE/)).toBe(false);
    expect(c.rollback).toHaveBeenCalled();
  });

  test('409 while an inspection application of the school is still open', async () => {
    const c = conn({ students: 0, vehicles: 0, apps: 2 });
    const e = await org.deactivateSchool(poolOf(c), { schoolId: 'S1', actorId: 1 }).catch((x) => x);
    expect(e.statusCode).toBe(409);
    expect(e.message).toMatch(/คำขอตรวจสภาพรถ/);
    const appQuery = callOf(c, /FROM vehicle_inspection_applications/);
    expect(appQuery[1][1]).toEqual(expect.arrayContaining(['DRAFT', 'SUBMITTED', 'NEEDS_FIX']));
    expect(appQuery[1][1]).not.toContain('PASSED');
  });

  test('no dependencies: soft-deletes, closes the school accounts, audits in the tx', async () => {
    const c = conn({ students: 0, vehicles: 0, apps: 0 });
    const out = await org.deactivateSchool(poolOf(c), { schoolId: 'S1', actorId: 1, reason: 'ยุบรวม' });
    expect(out).toMatchObject({ id: 'S1', is_deleted: true, accounts_deactivated: 2 });
    expect(issued(c, /UPDATE users SET is_active = FALSE WHERE id IN/)).toBe(true);
    expect(issued(c, /UPDATE schools SET is_deleted = TRUE, deleted_at = NOW\(\)/)).toBe(true);
    expect(issued(c, /DELETE FROM schools/)).toBe(false);
    const a = auditRow(c);
    expect(a.entity_type).toBe('school');
    expect(JSON.parse(a.new)).toMatchObject({ is_deleted: true, accounts_deactivated: [11, 12], reason: 'ยุบรวม' });
    expect(c.commit).toHaveBeenCalled();
  });

  test('restore refuses when the school\'s affiliation is itself closed', async () => {
    const c = makeConn((sql) => {
      if (/FROM schools WHERE id = \? AND is_deleted = TRUE FOR UPDATE/.test(sql)) return [[school]];
      if (/FROM affiliations/.test(sql)) return [[]];
      return dflt(sql);
    });
    await expect(org.restoreSchool(poolOf(c), { schoolId: 'S1', actorId: 1 })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('orgEntities — affiliation + school edits', () => {
  test('createAffiliation validates the code and refuses a duplicate (also a closed one)', async () => {
    await expect(org.createAffiliation(poolOf(makeConn(dflt)), { id: 'bad id!', name: 'x', actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 400 });
    const dup = makeConn((sql) => (/FROM affiliations WHERE id = \? FOR UPDATE/.test(sql) ? [[{ id: 'A9', is_deleted: 1 }]] : dflt(sql)));
    await expect(org.createAffiliation(poolOf(dup), { id: 'A9', name: 'สังกัดใหม่', actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  test('createAffiliation inserts and audits', async () => {
    const c = makeConn(dflt);
    const out = await org.createAffiliation(poolOf(c), { id: 'A9', name: ' สังกัดใหม่ ', actorId: 1 });
    expect(out).toEqual({ id: 'A9', name: 'สังกัดใหม่' });
    expect(auditRow(c)).toMatchObject({ entity_type: 'affiliation', entity_id: 'A9' });
  });

  test('moving a school needs a live target affiliation', async () => {
    const c = makeConn((sql) => {
      if (/FROM schools WHERE id = \?/.test(sql)) return [[{ id: 'S1', name: 'ก', affiliation_id: 'A1' }]];
      if (/FROM affiliations/.test(sql)) return [[]];
      return dflt(sql);
    });
    await expect(org.updateSchool(poolOf(c), { schoolId: 'S1', affiliationId: 'A2', actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(issued(c, /UPDATE schools/)).toBe(false);
  });

  test('moving a school updates affiliation_id and audits old/new', async () => {
    const c = makeConn((sql) => {
      if (/FROM schools WHERE id = \?/.test(sql)) return [[{ id: 'S1', name: 'ก', affiliation_id: 'A1' }]];
      if (/FROM affiliations/.test(sql)) return [[{ id: 'A2', name: 'ข' }]];
      return dflt(sql);
    });
    const out = await org.updateSchool(poolOf(c), { schoolId: 'S1', affiliationId: 'A2', actorId: 1 });
    expect(out).toMatchObject({ affiliation_id: 'A2', changed: true });
    const a = auditRow(c);
    expect(JSON.parse(a.old)).toEqual({ name: 'ก', affiliation_id: 'A1' });
    expect(JSON.parse(a.new)).toEqual({ affiliation_id: 'A2' });
  });
});

// ─── Province account management scope ──────────────────────────────────────
describe('provinceAdmin — affiliation/transport accounts only', () => {
  test.each(['school', 'admin', 'province', 'driver'])('cannot create a %s account', async (role) => {
    const c = makeConn(dflt);
    await expect(provAdmin.createUnitAccount(poolOf(c), { role, username: 'abc123', actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(issued(c, /INSERT INTO users/)).toBe(false);
  });

  test('an affiliation account needs a live affiliation', async () => {
    const c = makeConn(dflt);
    await expect(provAdmin.createUnitAccount(poolOf(c), { role: 'affiliation', username: 'aff_x', scopeId: 'NOPE', actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('create returns a one-time temporary password that is never audited', async () => {
    const c = makeConn(dflt);
    const out = await provAdmin.createUnitAccount(poolOf(c), { role: 'transport', username: 'dlt_officer', actorId: 1 });
    expect(out.temporary_password).toMatch(/^[A-Za-z0-9]{8}$/);
    const ins = callOf(c, /INSERT INTO users/);
    expect(ins[1]).toEqual(expect.arrayContaining(['dlt_officer', 'transport', null]));
    expect(ins[0]).toMatch(/must_change_password\)\s*VALUES \(\?, \?, \?, \?, \?, \?, TRUE\)/);
    const a = auditRow(c);
    expect(a.new).not.toContain(out.temporary_password);
    expect(JSON.parse(a.new)).toMatchObject({ role: 'transport', by_role: 'province' });
  });

  test('a taken username (even soft-deleted) is 409', async () => {
    const c = makeConn((sql) => (/SELECT id, is_deleted FROM users WHERE username/.test(sql) ? [[{ id: 5, is_deleted: 1 }]] : dflt(sql)));
    await expect(provAdmin.createUnitAccount(poolOf(c), { role: 'transport', username: 'dlt_officer', actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  test('update / delete / restore look the target up with role IN (affiliation, transport) and 404 otherwise', async () => {
    const c = makeConn(dflt);
    const p = poolOf(c);
    await expect(provAdmin.updateUnitAccount(p, { accountId: 9, isActive: false, actorId: 1 })).rejects.toMatchObject({ statusCode: 404 });
    await expect(provAdmin.deleteUnitAccount(p, { accountId: 9, actorId: 1 })).rejects.toMatchObject({ statusCode: 404 });
    await expect(provAdmin.restoreUnitAccount(p, { accountId: 9, actorId: 1 })).rejects.toMatchObject({ statusCode: 404 });
    const lookups = c.calls.filter(([s]) => /WHERE id = \? AND role IN \(\?\) AND is_deleted = \?/.test(s));
    expect(lookups).toHaveLength(3);
    for (const [, params] of lookups) expect(params[1]).toEqual(['affiliation', 'transport']);
  });

  test('delete is soft, releases recovery bindings and audits', async () => {
    const c = makeConn((sql) => (/role IN \(\?\) AND is_deleted = \?/.test(sql)
      ? [[{ id: 9, username: 'aff_x', role: 'affiliation', scope_id: 'A1', is_active: 1 }]] : dflt(sql)));
    const out = await provAdmin.deleteUnitAccount(poolOf(c), { accountId: 9, actorId: 1 });
    expect(out.username).toBe('aff_x');
    expect(issued(c, /DELETE FROM user_recovery_channels/)).toBe(true);
    expect(issued(c, /UPDATE users SET is_deleted = TRUE/)).toBe(true);
    expect(auditRow(c)).toMatchObject({ entity_type: 'user' });
  });
});

// ─── Plate typo fix + driver login rename ───────────────────────────────────
describe('vehicleAdmin.fixPlate', () => {
  const veh = { id: 'V-1', plate_no: 'กข 1234 ลำปง', normalized_plate: 'กข1234ลำปง', canonical_plate: null, is_deleted: 0 };
  const conn = ({ drivers = [], taken = null } = {}) => makeConn((sql) => {
    if (/FROM vehicles WHERE id = \? FOR UPDATE/.test(sql)) return [[veh]];
    if (/role = 'driver'/.test(sql)) return [drivers];
    if (/SELECT id FROM users WHERE username = \? AND id NOT IN/.test(sql)) return [taken ? [taken] : []];
    return dflt(sql);
  });

  test('requires a reason', async () => {
    await expect(vehicleAdmin.fixPlate(poolOf(conn()), { vehicleId: 'V-1', newPlate: 'กข 1234 ลำปาง', actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('renames the vehicle and the driver login named after the old plate, in one audited tx', async () => {
    const c = conn({ drivers: [{ id: 50, username: 'กข 1234 ลำปง' }] });
    const out = await vehicleAdmin.fixPlate(poolOf(c), { vehicleId: 'V-1', newPlate: 'กข 1234 ลำปาง', reason: 'พิมพ์ผิด', actorId: 1, actorRole: 'transport' });
    expect(out.plate_no).toBe('กข 1234 ลำปาง');
    expect(out.driver_usernames).toEqual([{ user_id: 50, old_username: 'กข 1234 ลำปง', new_username: 'กข 1234 ลำปาง' }]);
    const userUpd = callOf(c, /UPDATE users SET username = \? WHERE id = \?/);
    expect(userUpd[1]).toEqual(['กข 1234 ลำปาง', 50]);
    // the driver lookup uses the OLD plate's normalized form
    expect(callOf(c, /role = 'driver'/)[1]).toEqual(['กข1234ลำปง']);
    const a = JSON.parse(auditRow(c).new);
    expect(a).toMatchObject({ action: 'fix_plate', by_role: 'transport', reason: 'พิมพ์ผิด' });
    expect(c.commit).toHaveBeenCalled();
  });

  test('409 and no change when the new username is already taken', async () => {
    const c = conn({ drivers: [{ id: 50, username: 'กข 1234 ลำปง' }], taken: { id: 99 } });
    await expect(vehicleAdmin.fixPlate(poolOf(c), { vehicleId: 'V-1', newPlate: 'กข 1234 ลำปาง', reason: 'x', actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'DRIVER_USERNAME_TAKEN' }] });
    expect(issued(c, /UPDATE vehicles SET plate_no/)).toBe(false);
    expect(c.rollback).toHaveBeenCalled();
  });

  test('no driver login: only the vehicle changes', async () => {
    const c = conn();
    const out = await vehicleAdmin.fixPlate(poolOf(c), { vehicleId: 'V-1', newPlate: 'กข 1234 ลำปาง', reason: 'x', actorId: 1 });
    expect(out.driver_usernames).toEqual([]);
    expect(issued(c, /UPDATE users SET username/)).toBe(false);
  });
});

// ─── Document expiry ────────────────────────────────────────────────────────
describe('vehicleDocumentExpiry', () => {
  test('only the three document dates are accepted; insurance is ignored', () => {
    expect(docExpiry.parseExpiryPatch({ tax_expiry: '2027-01-31', insurance_expiry: '2027-01-01', plate_no: 'x' }))
      .toEqual({ tax_expiry: '2027-01-31' });
    expect(() => docExpiry.parseExpiryPatch({ insurance_expiry: '2027-01-01' })).toThrow(/ไม่มีข้อมูล/);
  });

  test('rejects an impossible date and clears on empty', () => {
    expect(() => docExpiry.parseExpiryPatch({ registration_expiry: '2027-02-30' })).toThrow();
    expect(docExpiry.parseExpiryPatch({ registration_expiry: '' })).toEqual({ registration_expiry: null });
  });

  test('updates, recomputes eligibility and audits old/new in the tx', async () => {
    const c = makeConn((sql) => {
      if (/FROM vehicles WHERE id = \? AND is_deleted = FALSE FOR UPDATE/.test(sql)) {
        return [[{ id: 'V-1', plate_no: 'p', registration_expiry: null, compulsory_insurance_expiry: null, tax_expiry: '2026-01-01' }]];
      }
      if (/SELECT id, certified_capacity/.test(sql)) return [[{ id: 'V-1', verification_status: 'UNVERIFIED' }]];
      if (/SUM\(CASE/.test(sql)) return [[{ morning_rider_count: 0, evening_rider_count: 0 }]];
      if (/COUNT\(\*\) AS valid_driver_count/.test(sql)) return [[{ valid_driver_count: 0 }]];
      return dflt(sql);
    });
    const out = await docExpiry.updateDocumentExpiry(poolOf(c), { vehicleId: 'V-1', body: { tax_expiry: '2027-01-31' }, actorId: 3, actorRole: 'transport' });
    expect(out).toMatchObject({ id: 'V-1', tax_expiry: '2027-01-31' });
    expect(callOf(c, /UPDATE vehicles SET tax_expiry = \? WHERE id = \?/)[1]).toEqual(['2027-01-31', 'V-1']);
    expect(issued(c, /SET verification_status = \?/)).toBe(true);
    const a = auditRow(c);
    expect(JSON.parse(a.old)).toEqual({ tax_expiry: '2026-01-01' });
    expect(JSON.parse(a.new)).toMatchObject({ action: 'document_expiry', tax_expiry: '2027-01-31', by_role: 'transport' });
  });
});

// ─── Route wiring / scope ───────────────────────────────────────────────────
describe('route wiring', () => {
  const province = read('backend/src/routes/province.routes.js');
  const transport = read('backend/src/routes/transport.routes.js');
  const school = read('backend/src/routes/school.routes.js');

  test('province write routes sit behind the province/admin guard', () => {
    expect(province).toMatch(/router\.use\(authenticate, requireRole\('province', 'admin'\)\)/);
    for (const r of [
      /router\.post\('\/unit-accounts'/, /router\.put\('\/unit-accounts\/:id'/, /router\.delete\('\/unit-accounts\/:id'/,
      /router\.post\('\/unit-accounts\/:id\/restore'/, /router\.post\('\/affiliations'/, /router\.put\('\/affiliations\/:id'/,
      /router\.put\('\/schools\/:id'/, /router\.post\('\/schools\/:id\/deactivate'/, /router\.post\('\/schools\/:id\/restore'/,
    ]) expect(province).toMatch(r);
    // the static path must be registered before nothing captures it as :id
    expect(province.indexOf("'/schools/deactivated'")).toBeGreaterThan(-1);
  });

  test('transport routes are behind the transport/admin guard', () => {
    expect(transport).toMatch(/router\.use\(authenticate, requireRole\('transport', 'admin'\)\)/);
    expect(transport).toMatch(/router\.put\('\/vehicles\/:id\/document-expiry'/);
    expect(transport).toMatch(/router\.post\('\/vehicles\/:id\/fix-plate'/);
  });

  test('schools have no document-expiry write (SCH-VEH-3 reasoning)', () => {
    expect(school).not.toMatch(/document-expiry/);
  });
});
