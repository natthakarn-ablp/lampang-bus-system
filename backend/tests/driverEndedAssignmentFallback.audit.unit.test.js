'use strict';

/**
 * DP-01 regression — a driver account linked via users.driver_id whose
 * assignment has ended must NOT fall through to legacy plate resolution
 * (which would grant access to a vehicle now served by another driver).
 * Unlinked (driver_id NULL) legacy accounts keep the plate fallback.
 */
const { getDriverVehicle } = require('../src/services/checkin.service');

function makePool({ relational = [], legacyVehicle = [], legacyAsg = [{ driver_id: 2 }] } = {}) {
  const calls = [];
  const query = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (/driver_vehicle_assignments dva/.test(sql)) return [relational];
    if (/FROM\s+vehicles/.test(sql)) return [legacyVehicle];
    if (/driver_vehicle_assignments/.test(sql)) return [legacyAsg];
    return [[]];
  });
  return { query, calls };
}

describe('DP-01 ended assignment does not fall back to plate', () => {
  test('linked driver with no active assignment is rejected (403) and never queries by plate', async () => {
    const pool = makePool({ legacyVehicle: [{ vehicle_id: 'V-1', plate_no: 'DPAUD 1111' }] });
    await expect(getDriverVehicle(pool, { username: 'DPAUD 1111', driver_id: 10 }))
      .rejects.toMatchObject({ statusCode: 403, errors: [{ code: 'NO_ACTIVE_ASSIGNMENT' }] });
    expect(pool.calls.some(({ sql }) => /FROM\s+vehicles/.test(sql))).toBe(false);
  });

  test('unlinked legacy account (driver_id NULL) still resolves by plate', async () => {
    const pool = makePool({ legacyVehicle: [{ vehicle_id: 'V-1', plate_no: 'DPAUD 1111' }] });
    const res = await getDriverVehicle(pool, { username: 'DPAUD 1111', driver_id: null });
    expect(res.vehicle_id).toBe('V-1');
  });
});
