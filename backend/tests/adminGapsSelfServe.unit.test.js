'use strict';

/**
 * adminGapsSelfServe.unit.test.js — DB-free (mock pool/conn).
 *
 * 2026-11-13, the last admin-only gaps:
 *   1. province/admin deactivate + restore an affiliation (409 while it has
 *      active schools; its accounts close in the same tx; restore leaves them off)
 *   2. admin vehicle delete/merge UI reads a read-only impact preview
 *   3. admin PUT /vehicles/:id refuses a plate change (use fix-plate, which
 *      renames the driver login with it)
 *   4. a school/affiliation whose pupils ride the vehicle re-enables the
 *      admin-deactivated (not deleted) plate account, audited
 */

require('./loadTestEnv');
const fs = require('fs');
const path = require('path');
const org = require('../src/services/orgEntities.service');
const vehicleAdmin = require('../src/services/vehicleAdmin.service');
const driverAcct = require('../src/services/driverAccountSelfService.service');
const provAdmin = require('../src/services/provinceAdmin.service');

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
  return c ? { action: c[1][1], entity_type: c[1][2], entity_id: c[1][3], old: c[1][4], new: c[1][5] } : null;
};

// ─── 1. Affiliation deactivate / restore ────────────────────────────────────
describe('orgEntities.deactivateAffiliation — guard + accounts', () => {
  const aff = { id: 'A1', name: 'สังกัดทดสอบ' };
  const conn = ({ schools = 0, found = true } = {}) => makeConn((sql) => {
    if (/FROM affiliations WHERE id = \? AND is_deleted = FALSE FOR UPDATE/.test(sql)) return [found ? [aff] : []];
    if (/COUNT\(\*\) AS n FROM schools WHERE affiliation_id = \?/.test(sql)) return [[{ n: schools }]];
    if (/SELECT id FROM users/.test(sql)) return [[{ id: 31 }, { id: 32 }]];
    return dflt(sql);
  });

  test('409 AFFILIATION_IN_USE with a Thai message while active schools remain; nothing written', async () => {
    const c = conn({ schools: 2 });
    const e = await org.deactivateAffiliation(poolOf(c), { id: 'A1', actorId: 1 }).catch((x) => x);
    expect(e.statusCode).toBe(409);
    expect(e.message).toMatch(/ยังมีโรงเรียนที่ใช้งานอยู่ 2 โรงเรียน/);
    expect(e.errors).toEqual([expect.objectContaining({ code: 'AFFILIATION_IN_USE', active_schools: 2 })]);
    expect(issued(c, /UPDATE affiliations/)).toBe(false);
    expect(issued(c, /UPDATE users/)).toBe(false);
    expect(c.rollback).toHaveBeenCalled();
  });

  test('the school count only looks at live schools', async () => {
    const c = conn({ schools: 0 });
    await org.deactivateAffiliation(poolOf(c), { id: 'A1', actorId: 1 });
    expect(callOf(c, /FROM schools WHERE affiliation_id/)[0]).toMatch(/is_deleted = FALSE/);
  });

  test('404 for an unknown or already-closed affiliation', async () => {
    await expect(org.deactivateAffiliation(poolOf(conn({ found: false })), { id: 'A9', actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('no schools: soft-deletes, closes only its affiliation accounts, audits in the tx', async () => {
    const c = conn({ schools: 0 });
    const out = await org.deactivateAffiliation(poolOf(c), { id: 'A1', actorId: 1, reason: 'ยุบรวม' });
    expect(out).toMatchObject({ id: 'A1', is_deleted: true, accounts_deactivated: 2 });
    const sel = callOf(c, /SELECT id FROM users/);
    expect(sel[0]).toMatch(/role = 'affiliation' AND scope_type = 'AFFILIATION' AND scope_id = \?/);
    expect(sel[1]).toEqual(['A1']);
    expect(callOf(c, /UPDATE users SET is_active = FALSE WHERE id IN/)[1]).toEqual([[31, 32]]);
    expect(issued(c, /UPDATE affiliations SET is_deleted = TRUE, deleted_at = NOW\(\)/)).toBe(true);
    expect(issued(c, /DELETE FROM affiliations/)).toBe(false);
    const a = auditRow(c);
    expect(a).toMatchObject({ action: 'DELETE', entity_type: 'affiliation', entity_id: 'A1' });
    expect(JSON.parse(a.new)).toMatchObject({ is_deleted: true, reason: 'ยุบรวม', accounts_deactivated: [31, 32] });
    expect(c.commit).toHaveBeenCalled();
    // accounts closed before commit, inside the same transaction
    expect(c.beginTransaction).toHaveBeenCalledTimes(1);
  });

  test('restore reopens the affiliation but leaves its accounts off', async () => {
    const c = makeConn((sql) => {
      if (/FROM affiliations WHERE id = \? AND is_deleted = TRUE FOR UPDATE/.test(sql)) return [[aff]];
      return dflt(sql);
    });
    const out = await org.restoreAffiliation(poolOf(c), { id: 'A1', actorId: 1 });
    expect(out).toEqual({ id: 'A1', name: 'สังกัดทดสอบ', is_deleted: false });
    expect(issued(c, /UPDATE affiliations SET is_deleted = FALSE/)).toBe(true);
    expect(issued(c, /UPDATE users/)).toBe(false);
    expect(JSON.parse(auditRow(c).new)).toMatchObject({ action: 'restore', accounts_reopened: false });
  });

  test('restore 404 when the affiliation is not closed', async () => {
    await expect(org.restoreAffiliation(poolOf(makeConn(dflt)), { id: 'A1', actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('the province cannot reopen an affiliation account while its affiliation is closed', async () => {
    const c = makeConn((sql) => {
      if (/FROM users/.test(sql) && /role IN/.test(sql)) return [[{ id: 31, username: 'aff1', role: 'affiliation', scope_id: 'A1', is_active: 0 }]];
      if (/FROM affiliations WHERE id = \? AND is_deleted = FALSE/.test(sql)) return [[]];
      return dflt(sql);
    });
    await expect(provAdmin.updateUnitAccount(poolOf(c), { accountId: 31, isActive: true, actorId: 1 }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(issued(c, /UPDATE users/)).toBe(false);
  });

  test('moving a school into / restoring a school under an affiliation share-locks it', () => {
    const src = read('backend/src/services/orgEntities.service.js');
    expect((src.match(/FROM affiliations WHERE id = \? AND is_deleted = FALSE FOR SHARE/g) || []).length).toBe(2);
  });
});

// ─── 2. Impact preview (read-only) ──────────────────────────────────────────
describe('vehicleAdmin.vehicleImpact', () => {
  test('counts what a delete detaches and what a merge moves/clears, without writing', async () => {
    const c = makeConn((sql) => {
      if (/FROM vehicles WHERE id = \?/.test(sql)) return [[{ id: 'V-1', plate_no: 'นข 1 ลำปาง', vehicle_type: 'รถตู้', is_deleted: 0 }]];
      if (/COUNT\(\*\) AS n FROM students WHERE vehicle_id = \? AND is_deleted = FALSE/.test(sql)) return [[{ n: 4 }]];
      if (/COUNT\(\*\) AS n FROM driver_vehicle_assignments WHERE vehicle_id = \? AND is_active = TRUE/.test(sql)) return [[{ n: 1 }]];
      if (/COUNT\(\*\) AS n FROM students WHERE vehicle_id = \?$/.test(sql.trim())) return [[{ n: 5 }]];
      if (/COUNT\(\*\) AS n FROM checkin_logs/.test(sql)) return [[{ n: 120 }]];
      if (/COUNT\(\*\) AS n FROM driver_vehicle_assignments WHERE vehicle_id = \?$/.test(sql.trim())) return [[{ n: 2 }]];
      if (/COUNT\(\*\) AS n FROM vehicle_latest_locations/.test(sql)) return [[{ n: 1 }]];
      if (/JOIN drivers d/.test(sql)) return [[{ name: 'สมชาย' }]];
      if (/COUNT/.test(sql)) return [[{ n: 0 }]];
      return dflt(sql);
    });
    const out = await vehicleAdmin.vehicleImpact({ query: c.query }, 'V-1');
    expect(out).toMatchObject({
      active_students: 4, active_assignments: 1, driver_name: 'สมชาย',
      moves: { students: 5, checkin_logs: 120, driver_vehicle_assignments: 2 },
      cleared: { vehicle_latest_locations: 1 },
    });
    expect(c.calls.every(([s]) => /^\s*SELECT/.test(s))).toBe(true);
  });

  test('names the driver login a merge would close (username = this plate)', async () => {
    const c = makeConn((sql) => {
      if (/FROM vehicles WHERE id = \?/.test(sql)) return [[{ id: 'V-1', plate_no: 'นข 1 ลำปาง', vehicle_type: 'รถตู้', is_deleted: 0 }]];
      if (/FROM users\s+WHERE role = 'driver'/.test(sql)) return [[{ id: 41, username: 'นข1ลำปาง', is_active: 1 }]];
      if (/COUNT/.test(sql)) return [[{ n: 0 }]];
      return dflt(sql);
    });
    const out = await vehicleAdmin.vehicleImpact({ query: c.query }, 'V-1');
    expect(out.driver_login).toEqual({ id: 41, username: 'นข1ลำปาง', is_active: true });
    expect(c.calls.every(([s]) => /^\s*SELECT/.test(s))).toBe(true);
  });

  test('404 for an unknown vehicle', async () => {
    await expect(vehicleAdmin.vehicleImpact({ query: makeConn(dflt).query }, 'nope'))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

// ─── 3. Admin PUT cannot change the plate ───────────────────────────────────
describe('vehicleAdmin.correctVehicle — plate changes go through fixPlate', () => {
  const v = { id: 'V-1', plate_no: 'นข 1 ลำปาง', is_deleted: 0, vehicle_type: 'รถตู้' };
  const conn = () => makeConn((sql) => (/FROM vehicles WHERE id = \?/.test(sql) ? [[v]] : dflt(sql)));

  test('a changed plate is refused 400 USE_FIX_PLATE and nothing is written', async () => {
    const c = conn();
    const e = await vehicleAdmin.correctVehicle(poolOf(c), { vehicleId: 'V-1', actorId: 1, patch: { plate_no: 'นข 2 ลำปาง', vehicle_type: 'รถสองแถว' } })
      .catch((x) => x);
    expect(e.statusCode).toBe(400);
    expect(e.message).toMatch(/แก้ทะเบียน/);
    expect(e.errors).toEqual([{ field: 'plate_no', code: 'USE_FIX_PLATE' }]);
    expect(issued(c, /UPDATE vehicles/)).toBe(false);
    expect(issued(c, /UPDATE users/)).toBe(false);
    expect(c.rollback).toHaveBeenCalled();
  });

  test('sending the current plate unchanged is harmless', async () => {
    const c = conn();
    await vehicleAdmin.correctVehicle(poolOf(c), { vehicleId: 'V-1', actorId: 1, patch: { plate_no: ' นข 1 ลำปาง ', vehicle_type: 'รถสองแถว' } });
    const upd = callOf(c, /UPDATE vehicles SET/);
    expect(upd[0]).not.toMatch(/plate_no/);
    expect(upd[0]).toMatch(/vehicle_type = \?/);
  });
});

// ─── 4. School / affiliation re-enable a deactivated driver account ─────────
describe('driverAccountSelfService.reactivateDriverAccount', () => {
  const vehicle = { id: 'V-1', plate_no: 'นข 1 ลำปาง' };
  const actor = { id: 9, role: 'school', ip: '1.1.1.1', userAgent: 'jest' };
  const conn = ({ inScope = true, account = { id: 50, username: 'นข1ลำปาง', driver_id: 7, is_active: 0 }, linkedSibling = false } = {}) =>
    makeConn((sql) => {
      if (/FROM vehicles WHERE id = \? AND is_deleted = FALSE FOR UPDATE/.test(sql)) return [[vehicle]];
      if (/SELECT 1 AS ok FROM students/.test(sql)) return [inScope ? [{ ok: 1 }] : []];
      if (/FROM users\s+WHERE role = 'driver' AND is_deleted = FALSE/.test(sql)) return [account ? [account] : []];
      if (/driver_id IS NOT NULL/.test(sql)) return [linkedSibling ? [{ id: 49, n: 'นข1ลำปาง' }] : []];
      if (/SELECT id FROM vehicles WHERE is_deleted = FALSE/.test(sql)) return [[{ id: 'V-1' }]];
      return dflt(sql);
    });

  test('a school whose pupil rides the vehicle re-enables it; audited with actor scope; password untouched', async () => {
    const c = conn();
    const out = await driverAcct.reactivateDriverAccount(poolOf(c), { vehicleId: 'V-1', scope: { schoolId: 'S1' }, actor });
    expect(out).toMatchObject({ vehicle_id: 'V-1', user_id: 50, is_active: true });
    const scopeQ = callOf(c, /SELECT 1 AS ok FROM students/);
    expect(scopeQ[0]).toMatch(/is_deleted = FALSE/);
    expect(scopeQ[1]).toEqual(['V-1', 'S1']);
    expect(callOf(c, /UPDATE users SET is_active = TRUE/)[1]).toEqual([50]);
    expect(issued(c, /password_hash/)).toBe(false);
    const a = auditRow(c);
    expect(a).toMatchObject({ entity_type: 'user', entity_id: '50' });
    expect(JSON.parse(a.new)).toMatchObject({ action: 'reactivate', actor_role: 'school', actor_scope: { school_id: 'S1' }, vehicle_id: 'V-1' });
    expect(c.commit).toHaveBeenCalled();
  });

  test('affiliation scope goes through schools in that affiliation', async () => {
    const c = conn();
    await driverAcct.reactivateDriverAccount(poolOf(c), { vehicleId: 'V-1', scope: { affiliationId: 'A1' }, actor: { ...actor, role: 'affiliation' } });
    const scopeQ = callOf(c, /SELECT 1 AS ok FROM students s/);
    expect(scopeQ[0]).toMatch(/sc\.affiliation_id = \?/);
    expect(scopeQ[1]).toEqual(['V-1', 'A1']);
    expect(JSON.parse(auditRow(c).new).actor_scope).toEqual({ affiliation_id: 'A1' });
  });

  test('404 for a vehicle no pupil of the school rides (no write, no audit)', async () => {
    const c = conn({ inScope: false });
    await expect(driverAcct.reactivateDriverAccount(poolOf(c), { vehicleId: 'V-1', scope: { schoolId: 'S2' }, actor }))
      .rejects.toMatchObject({ statusCode: 404, errors: [{ code: 'VEHICLE_NOT_IN_SCOPE' }] });
    expect(issued(c, /UPDATE users/)).toBe(false);
    expect(issued(c, /audit_logs/)).toBe(false);
  });

  test('empty scope fails closed', async () => {
    const c = conn();
    await expect(driverAcct.reactivateDriverAccount(poolOf(c), { vehicleId: 'V-1', scope: {}, actor }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('a soft-deleted account is not found here (stays with the admin)', async () => {
    const c = conn({ account: null });
    const e = await driverAcct.reactivateDriverAccount(poolOf(c), { vehicleId: 'V-1', scope: { schoolId: 'S1' }, actor }).catch((x) => x);
    expect(e.statusCode).toBe(404);
    expect(callOf(c, /FROM users\s+WHERE role = 'driver'/)[0]).toMatch(/is_deleted = FALSE/);
    expect(issued(c, /UPDATE users/)).toBe(false);
  });

  test('409 when the account is already active', async () => {
    const c = conn({ account: { id: 50, username: 'นข1ลำปาง', driver_id: 7, is_active: 1 } });
    await expect(driverAcct.reactivateDriverAccount(poolOf(c), { vehicleId: 'V-1', scope: { schoolId: 'S1' }, actor }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'DRIVER_ACCOUNT_ALREADY_ACTIVE' }] });
  });

  test('409 when it is a dedupe duplicate of a linked canonical driver', async () => {
    const c = conn({ account: { id: 50, username: 'นข1ลำปาง', driver_id: null, is_active: 0 }, linkedSibling: true });
    await expect(driverAcct.reactivateDriverAccount(poolOf(c), { vehicleId: 'V-1', scope: { schoolId: 'S1' }, actor }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'DRIVER_REACTIVATION_BLOCKED' }] });
    expect(issued(c, /UPDATE users/)).toBe(false);
  });

  test('reactivate revokes earlier sessions (password_changed_at) and reopens the plate assignment', async () => {
    const c = conn();
    const out = await driverAcct.reactivateDriverAccount(poolOf(c), { vehicleId: 'V-1', scope: { schoolId: 'S1' }, actor });
    expect(callOf(c, /UPDATE users SET is_active = TRUE/)[0]).toMatch(/password_changed_at = NOW\(\)/);
    const ins = callOf(c, /INSERT INTO driver_vehicle_assignments/);
    expect(ins[1]).toEqual([7, 'V-1']);
    expect(out.assignment_restored).toBe(true);
    expect(JSON.parse(auditRow(c).new)).toMatchObject({ sessions_revoked: true, assignment_restored: true });
  });

  test('reactivate leaves assignments alone when the vehicle already has an active driver', async () => {
    const base = conn();
    const c2 = makeConn(async (sql, params) => {
      if (/FROM driver_vehicle_assignments WHERE vehicle_id = \? AND is_active = TRUE/.test(sql)) return [[{ id: 3 }]];
      return base.query(sql, params);
    });
    const out = await driverAcct.reactivateDriverAccount(poolOf(c2), { vehicleId: 'V-1', scope: { schoolId: 'S1' }, actor });
    expect(out.assignment_restored).toBe(false);
    expect(issued(c2, /INSERT INTO driver_vehicle_assignments/)).toBe(false);
  });
});

// ─── 4b. Reset / replace hand a switched-off plate account to a driver ──────
describe('driverAccountSelfService reset/replace on a switched-off account', () => {
  const vehicle = { id: 'V-1', plate_no: 'นข 1 ลำปาง' };
  const actor = { id: 9, role: 'school', ip: '1.1.1.1', userAgent: 'jest' };
  const conn = ({ account = { id: 50, username: 'นข1ลำปาง', driver_id: 7, is_active: 0 }, linkedSibling = false } = {}) =>
    makeConn((sql) => {
      if (/FROM vehicles WHERE id = \? AND is_deleted = FALSE FOR UPDATE/.test(sql)) return [[vehicle]];
      if (/SELECT 1 AS ok FROM students/.test(sql)) return [[{ ok: 1 }]];
      if (/FROM users\s+WHERE role = 'driver' AND is_deleted = FALSE/.test(sql)) return [account ? [account] : []];
      if (/driver_id IS NOT NULL/.test(sql)) return [linkedSibling ? [{ id: 49, n: 'นข1ลำปาง' }] : []];
      if (/SELECT id FROM vehicles WHERE is_deleted = FALSE/.test(sql)) return [[{ id: 'V-1' }]];
      return dflt(sql);
    });

  test('replace re-enables the account with the new password in the same UPDATE', async () => {
    const c = conn();
    await driverAcct.replaceDriver(poolOf(c), { vehicleId: 'V-1', scope: { schoolId: 'S1' }, actor, name: 'สมศักดิ์ ใจดี', phone: '0812345678' });
    const upd = callOf(c, /UPDATE users SET driver_id = \?/);
    expect(upd[0]).toMatch(/password_changed_at = NOW\(\), is_active = TRUE/);
    expect(issued(c, /UPDATE users SET is_active = TRUE/)).toBe(false);
    expect(c.commit).toHaveBeenCalled();
  });

  test('reset re-enables the account with the new password in the same UPDATE', async () => {
    const c = conn();
    await driverAcct.resetDriverPassword(poolOf(c), { vehicleId: 'V-1', scope: { schoolId: 'S1' }, actor });
    const upd = callOf(c, /UPDATE users SET password_hash = \?/);
    expect(upd[0]).toMatch(/is_active = TRUE/);
    expect(JSON.parse(auditRow(c).new)).toMatchObject({ action: 'reset_password', reactivated: true });
  });

  test('an active account keeps the plain UPDATE (no is_active write)', async () => {
    const c = conn({ account: { id: 50, username: 'นข1ลำปาง', driver_id: 7, is_active: 1 } });
    await driverAcct.resetDriverPassword(poolOf(c), { vehicleId: 'V-1', scope: { schoolId: 'S1' }, actor });
    expect(callOf(c, /UPDATE users SET password_hash = \?/)[0]).not.toMatch(/is_active/);
  });

  test('a dedupe duplicate stays off: replace and reset both 409 with no write', async () => {
    for (const fn of ['replaceDriver', 'resetDriverPassword']) {
      const c = conn({ account: { id: 50, username: 'นข1ลำปาง', driver_id: null, is_active: 0 }, linkedSibling: true });
      await expect(driverAcct[fn](poolOf(c), { vehicleId: 'V-1', scope: { schoolId: 'S1' }, actor, name: 'สมศักดิ์ ใจดี', phone: '0812345678' }))
        .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'DRIVER_REACTIVATION_BLOCKED' }] });
      expect(issued(c, /UPDATE users/)).toBe(false);
      expect(issued(c, /INSERT INTO drivers/)).toBe(false);
    }
  });
});

// ─── Route wiring ───────────────────────────────────────────────────────────
describe('route wiring', () => {
  test('province affiliation deactivate/restore sit behind the province/admin guard', () => {
    const src = read('backend/src/routes/province.routes.js');
    expect(src).toMatch(/router\.use\(authenticate, requireRole\('province', 'admin'\)\)/);
    expect(src).toMatch(/router\.post\('\/affiliations\/:id\/deactivate'/);
    expect(src).toMatch(/router\.post\('\/affiliations\/:id\/restore'/);
    expect(src).toMatch(/router\.get\('\/affiliations\/deactivated'/);
  });

  test('admin user edit will not re-enable an affiliation account of a closed affiliation', () => {
    const src = read('backend/src/routes/admin.routes.js');
    expect(src).toMatch(/reactivating && user\.role === 'affiliation'[\s\S]{0,300}FROM affiliations WHERE id = \? AND is_deleted = FALSE[\s\S]{0,300}AFFILIATION_INACTIVE[\s\S]{0,20}409/);
  });

  test('school reactivate needs the full school scope (not a grade teacher)', () => {
    const src = read('backend/src/routes/school.routes.js');
    expect(src).toMatch(/router\.post\('\/vehicles\/:id\/driver\/reactivate', requireFullSchoolScope/);
  });

  test('affiliation reactivate resolves the caller affiliation', () => {
    const src = read('backend/src/routes/affiliation.routes.js');
    expect(src).toMatch(/router\.post\('\/vehicles\/:id\/driver\/reactivate'[\s\S]{0,200}affDriverCtx\(req, res, resolveAffiliationId\(req\)\)/);
  });

  test('admin impact preview lives on the admin-only router', () => {
    const src = read('backend/src/routes/admin.routes.js');
    expect(src).toMatch(/router\.get\('\/vehicles\/:id\/impact'/);
  });
});
