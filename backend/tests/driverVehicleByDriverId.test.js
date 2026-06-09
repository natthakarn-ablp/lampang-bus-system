'use strict';

/**
 * driverVehicleByDriverId.test.js  (Phase 10.13A-20)
 *
 * ISOLATED — mock pool, no DB/globalSetup. Verifies getDriverVehicle prefers the
 * relational link (users.driver_id → assignment → vehicle) for LINKED users and
 * falls back to legacy plate resolution for unlinked (YELLOW) users and when a
 * linked user has no active assignment.
 */

const { getDriverVehicle } = require('../src/services/checkin.service');

// Dispatch by SQL shape: relational (driver_id), legacy vehicle, legacy assignment.
function makePool({ relational = [], legacyVehicle = [], legacyAsg = [[{ ok: 1 }]] } = {}) {
  const calls = [];
  const query = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (/driver_vehicle_assignments dva/.test(sql)) return [relational];      // relational (driver_id path)
    if (/FROM\s+vehicles/.test(sql)) return [legacyVehicle];                  // legacy vehicle lookup
    if (/driver_vehicle_assignments/.test(sql)) return legacyAsg;             // legacy assignment check
    return [[]];
  });
  return { query, calls };
}
const ran = (pool, re) => pool.calls.some(({ sql }) => re.test(sql));

describe('getDriverVehicle — prefer users.driver_id (10.13A-20)', () => {
  test('1. linked user + one active assignment resolves by driver_id (not username)', async () => {
    const pool = makePool({ relational: [{ vehicle_id: 'V-real', plate_no: 'ออ 7332 กทม' }] });
    const res = await getDriverVehicle(pool, { username: 'ออ 7332 กทม', driver_id: 121 });
    expect(res).toEqual({ vehicle_id: 'V-real', plate_no: 'ออ 7332 กทม' });
    expect(pool.calls[0].params).toEqual([121]);       // resolved via driver_id
    expect(ran(pool, /FROM\s+vehicles/)).toBe(false);  // legacy path not used
  });

  test('2. linked user resolves even if the login username no longer matches the plate', async () => {
    const pool = makePool({ relational: [{ vehicle_id: 'V-real', plate_no: 'นข 4031 ลำปาง' }] });
    const res = await getDriverVehicle(pool, { username: 'totally-different-text', driver_id: 122 });
    expect(res.vehicle_id).toBe('V-real');             // driver_id authoritative
    expect(ran(pool, /FROM\s+vehicles/)).toBe(false);
  });

  test('3. linked user with username matching NOTHING still resolves by driver_id', async () => {
    const pool = makePool({ relational: [{ vehicle_id: 'V-x', plate_no: 'p' }] });
    const res = await getDriverVehicle(pool, { username: '', driver_id: 999 });
    expect(res.vehicle_id).toBe('V-x');
  });

  test('4. linked user with NO active assignment falls back to legacy plate resolution', async () => {
    const pool = makePool({ relational: [], legacyVehicle: [{ vehicle_id: 'V-leg', plate_no: 'นข 4337 ลำปาง' }] });
    const res = await getDriverVehicle(pool, { username: 'นข 4337 ลำปาง', driver_id: 500 });
    expect(res.vehicle_id).toBe('V-leg');
    expect(ran(pool, /driver_vehicle_assignments dva/)).toBe(true);  // tried relational first
    expect(ran(pool, /FROM\s+vehicles/)).toBe(true);                 // then fell back
  });

  test('5. linked user with MULTIPLE active assigned vehicles fails closed', async () => {
    const pool = makePool({ relational: [{ vehicle_id: 'V-a', plate_no: 'a' }, { vehicle_id: 'V-b', plate_no: 'b' }] });
    await expect(getDriverVehicle(pool, { username: 'x', driver_id: 7 }))
      .rejects.toMatchObject({ statusCode: 400 });
    try { await getDriverVehicle(pool, { username: 'x', driver_id: 7 }); }
    catch (e) { expect(e.errors?.[0]?.code).toBe('MULTIPLE_ACTIVE_DRIVER_ASSIGNMENTS'); }
    expect(ran(pool, /FROM\s+vehicles/)).toBe(false);   // never guesses via legacy
  });

  test('6. unlinked user (driver_id NULL) resolves by normalized plate (legacy unchanged)', async () => {
    const pool = makePool({ legacyVehicle: [{ vehicle_id: 'V-leg', plate_no: 'นข1365ลำปาง' }] });
    const res = await getDriverVehicle(pool, { username: 'นข 1365 ลำปาง', driver_id: null });
    expect(res.vehicle_id).toBe('V-leg');
    expect(ran(pool, /driver_vehicle_assignments dva/)).toBe(false); // relational skipped
    expect(pool.calls[0].params[1]).toBe('นข1365ลำปาง');             // normalized form passed
  });

  test('7. unlinked user, spacing/province variant follows existing safe behavior', async () => {
    const pool = makePool({ legacyVehicle: [{ vehicle_id: 'V-z', plate_no: 'นข-2833-ลำปาง' }] });
    const res = await getDriverVehicle(pool, { username: 'นข-2833-ลำปาง', driver_id: null });
    expect(res.vehicle_id).toBe('V-z');
  });

  test('8. deleted vehicle never returned (relational empty → legacy empty → not found)', async () => {
    const pool = makePool({ relational: [], legacyVehicle: [] });
    await expect(getDriverVehicle(pool, { username: 'นข 4337 ลำปาง', driver_id: 500 }))
      .rejects.toThrow(/Vehicle not found/);
  });

  test('9. legacy multiple plate match still fails safely', async () => {
    const pool = makePool({ legacyVehicle: [{ vehicle_id: 'V-a', plate_no: 'a' }, { vehicle_id: 'V-b', plate_no: 'b' }] });
    await expect(getDriverVehicle(pool, { username: 'x', driver_id: null }))
      .rejects.toThrow(/Multiple vehicles match/);
  });

  test('10. errors leak no PII (no hash/phone/token)', async () => {
    const pool = makePool({ relational: [{ vehicle_id: 'V-a', plate_no: 'a' }, { vehicle_id: 'V-b', plate_no: 'b' }] });
    try { await getDriverVehicle(pool, { username: 'x', driver_id: 7 }); }
    catch (e) {
      expect(e.message).not.toMatch(/\$2[aby]\$/);
      expect(e.message).not.toMatch(/\d{10}/);
    }
  });
});
