'use strict';

/**
 * driverOnboardingLink.test.js  (Phase 10.13A-18)
 *
 * ISOLATED — drives linkOrCreateDriverForVehicle() with a mocked transaction
 * `conn` (no DB, no globalSetup). Verifies: driver profile dedup, users.driver_id
 * linking (incl. legacy NULL backfill for the onboarded user only), 409 on a
 * conflicting link, and no duplicate active assignment.
 */

const { linkOrCreateDriverForVehicle } = require('../src/services/driverProfile.service');

// Build a conn whose query() responds by SQL shape. `r` overrides result rows.
function makeConn(r = {}) {
  const query = jest.fn(async (sql) => {
    if (/FROM drivers WHERE is_deleted = FALSE\s+AND REGEXP_REPLACE/.test(sql)) return [r.profileByPhone || []];
    if (/FROM drivers WHERE is_deleted = FALSE AND TRIM\(name\)/.test(sql)) return [r.profileByName || []];
    if (/INSERT INTO drivers/.test(sql)) return [{ insertId: r.newDriverId || 900 }];
    if (/FROM users\b[\s\S]*role = 'driver'/.test(sql)) return [r.user || []];
    if (/UPDATE users SET driver_id/.test(sql)) return [{ affectedRows: 1 }];
    if (/INSERT INTO users/.test(sql)) return [{ insertId: 1 }];
    if (/FROM driver_vehicle_assignments[\s\S]*driver_id = \? AND vehicle_id/.test(sql)) return [r.assignment || []];
    if (/INSERT INTO driver_vehicle_assignments/.test(sql)) return [{ insertId: 1 }];
    return [[]];
  });
  return { query };
}
const calls = (conn) => conn.query.mock.calls;
const ran = (conn, re) => calls(conn).some(([sql]) => re.test(sql));
const paramsOf = (conn, re) => (calls(conn).find(([sql]) => re.test(sql)) || [])[1];

const BASE = { driverName: 'นายสมชาย ใจดี', driverPhone: '081-234-5678', normalizedPlate: 'นข9999ลำปาง', plateNo: 'นข 9999 ลำปาง', vehicleId: 'V-new' };

describe('linkOrCreateDriverForVehicle — driver onboarding link (10.13A-18)', () => {
  test('1. new driver + new user: creates profile, user WITH driver_id, assignment', async () => {
    const conn = makeConn({ profileByPhone: [], profileByName: [], user: [], newDriverId: 900 });
    const res = await linkOrCreateDriverForVehicle(conn, BASE);
    expect(res).toEqual({ driverId: 900, userCreated: true });
    expect(ran(conn, /INSERT INTO drivers/)).toBe(true);
    const up = paramsOf(conn, /INSERT INTO users/);
    expect(up).toContain(900);              // users.driver_id set to the new profile id
    expect(ran(conn, /INSERT INTO driver_vehicle_assignments/)).toBe(true);
  });

  test('2. existing profile by PHONE is reused — no new drivers row', async () => {
    const conn = makeConn({ profileByPhone: [{ id: 50 }], user: [] });
    const res = await linkOrCreateDriverForVehicle(conn, BASE);
    expect(res.driverId).toBe(50);
    expect(ran(conn, /INSERT INTO drivers/)).toBe(false);
    expect(paramsOf(conn, /INSERT INTO users/)).toContain(50);
  });

  test('3. existing user with driver_id NULL is LINKED (UPDATE), not duplicated', async () => {
    const conn = makeConn({ profileByPhone: [{ id: 50 }], user: [{ id: 7, driver_id: null }] });
    const res = await linkOrCreateDriverForVehicle(conn, BASE);
    expect(res).toEqual({ driverId: 50, userCreated: false });
    expect(paramsOf(conn, /UPDATE users SET driver_id/)).toEqual([50, 7]);
    expect(ran(conn, /INSERT INTO users/)).toBe(false);
  });

  test('4. existing user already linked to SAME profile: no update, no insert', async () => {
    const conn = makeConn({ profileByPhone: [{ id: 50 }], user: [{ id: 7, driver_id: 50 }] });
    const res = await linkOrCreateDriverForVehicle(conn, BASE);
    expect(res.userCreated).toBe(false);
    expect(ran(conn, /UPDATE users SET driver_id/)).toBe(false);
    expect(ran(conn, /INSERT INTO users/)).toBe(false);
  });

  test('5. existing user linked to a DIFFERENT profile → 409 DRIVER_USER_PROFILE_CONFLICT', async () => {
    const conn = makeConn({ profileByPhone: [{ id: 50 }], user: [{ id: 7, driver_id: 99 }] });
    await expect(linkOrCreateDriverForVehicle(conn, BASE)).rejects.toMatchObject({ statusCode: 409 });
    try { await linkOrCreateDriverForVehicle(makeConn({ profileByPhone: [{ id: 50 }], user: [{ id: 7, driver_id: 99 }] }), BASE); }
    catch (e) { expect(e.errors[0].code).toBe('DRIVER_USER_PROFILE_CONFLICT'); }
    // no write happens on conflict
    const conn2 = makeConn({ profileByPhone: [{ id: 50 }], user: [{ id: 7, driver_id: 99 }] });
    await linkOrCreateDriverForVehicle(conn2, BASE).catch(() => {});
    expect(ran(conn2, /UPDATE users/)).toBe(false);
    expect(ran(conn2, /INSERT INTO (users|driver_vehicle_assignments)/)).toBe(false);
  });

  test('6. existing active assignment for driver+vehicle → no duplicate assignment', async () => {
    const conn = makeConn({ profileByPhone: [{ id: 50 }], user: [{ id: 7, driver_id: 50 }], assignment: [{ id: 3 }] });
    await linkOrCreateDriverForVehicle(conn, BASE);
    expect(ran(conn, /INSERT INTO driver_vehicle_assignments/)).toBe(false);
  });

  test('7. no phone → dedup by NAME (phone query skipped)', async () => {
    const conn = makeConn({ profileByName: [{ id: 60 }], user: [] });
    const res = await linkOrCreateDriverForVehicle(conn, { ...BASE, driverPhone: '' });
    expect(res.driverId).toBe(60);
    expect(ran(conn, /REGEXP_REPLACE/)).toBe(false);        // phone lookup skipped
    expect(ran(conn, /TRIM\(name\)/)).toBe(true);
    expect(paramsOf(conn, /INSERT INTO users/)).toContain(60);
  });

  test('8. returns only non-sensitive fields', async () => {
    const conn = makeConn({ profileByPhone: [{ id: 50 }], user: [{ id: 7, driver_id: 50 }] });
    const res = await linkOrCreateDriverForVehicle(conn, BASE);
    expect(Object.keys(res).sort()).toEqual(['driverId', 'userCreated']);
  });
});
