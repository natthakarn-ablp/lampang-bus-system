'use strict';

/**
 * driverVehicleResolution.test.js  (Phase 10.13A-8)
 *
 * ISOLATED — getDriverVehicle takes `pool` as an argument, so we pass a mock
 * pool. No DB, no globalSetup. Verifies the driver's vehicle resolves by exact
 * plate OR normalized plate (username/plate spacing differences), while keeping
 * the soft-delete filter, active-assignment requirement, and a fail-safe on
 * ambiguous matches.
 */

const { getDriverVehicle } = require('../src/services/checkin.service');
const { normalizePlate } = require('../src/utils/vehiclePlate');

// Build a mock pool: vehicleRows = result of the vehicle lookup, asgRows = result
// of the assignment lookup. Records the calls so we can assert the SQL/params.
function makePool(vehicleRows, asgRows = [[{ ok: 1 }]]) {
  const calls = [];
  const query = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    return /driver_vehicle_assignments/.test(sql) ? asgRows : [vehicleRows];
  });
  return { query, calls };
}

describe('getDriverVehicle — normalized plate resolution', () => {
  test('1. exact plate_no == username still resolves, and passes [username, normalized]', async () => {
    const pool = makePool([{ vehicle_id: 'V-1', plate_no: 'นข4337 ลำปาง' }]);
    const res = await getDriverVehicle(pool, 'นข4337 ลำปาง');
    expect(res).toEqual({ vehicle_id: 'V-1', plate_no: 'นข4337 ลำปาง' });
    const { sql, params } = pool.calls[0];
    expect(sql).toMatch(/plate_no = \?/);
    expect(sql).toMatch(/normalized_plate = \?/);
    expect(sql).toMatch(/is_deleted = FALSE/);
    expect(params).toEqual(['นข4337 ลำปาง', normalizePlate('นข4337 ลำปาง')]);
  });

  test('2. username WITH spaces resolves (normalized passed = normalized_plate)', async () => {
    const pool = makePool([{ vehicle_id: 'V-2', plate_no: 'นข4337 ลำปาง' }]);
    const res = await getDriverVehicle(pool, 'นข 4337 ลำปาง'); // extra space after นข
    expect(res.vehicle_id).toBe('V-2');
    expect(pool.calls[0].params[1]).toBe('นข4337ลำปาง'); // normalized form
  });

  test('3. hyphen/spacing variant normalizes the same', async () => {
    const pool = makePool([{ vehicle_id: 'V-3', plate_no: 'นข1365ลำปาง' }]);
    await getDriverVehicle(pool, 'นข-1365-ลำปาง');
    expect(pool.calls[0].params[1]).toBe('นข1365ลำปาง');
  });

  test('4. soft-deleted vehicle still fails (query filters is_deleted=FALSE → 0 rows)', async () => {
    const pool = makePool([]); // simulates no active vehicle returned
    await expect(getDriverVehicle(pool, 'นข 4337 ลำปาง')).rejects.toMatchObject({ statusCode: 400 });
    await expect(getDriverVehicle(pool, 'นข 4337 ลำปาง')).rejects.toThrow(/Vehicle not found/);
  });

  test('5. no active assignment still fails as before', async () => {
    const pool = makePool([{ vehicle_id: 'V-5', plate_no: 'นข2833ลำปาง' }], [[]]); // no assignment
    await expect(getDriverVehicle(pool, 'นข 2833 ลำปาง')).rejects.toThrow(/No active driver assignment/);
  });

  test('6. multiple matching vehicles fails SAFELY (never guesses)', async () => {
    const pool = makePool([
      { vehicle_id: 'V-a', plate_no: 'x' },
      { vehicle_id: 'V-b', plate_no: 'y' },
    ]);
    await expect(getDriverVehicle(pool, 'นข 2833 ลำปาง')).rejects.toThrow(/Multiple vehicles match/);
  });

  test('7. error messages leak no PII (no hash/phone/token patterns)', async () => {
    const pool = makePool([]);
    try { await getDriverVehicle(pool, 'นข 4337 ลำปาง'); }
    catch (e) {
      expect(e.message).not.toMatch(/\$2[aby]\$/);
      expect(e.message).not.toMatch(/\d{10}/);
    }
  });

  test('8. the 3 real production usernames normalize to their vehicle normalized_plate', () => {
    expect(normalizePlate('นข 4337 ลำปาง')).toBe('นข4337ลำปาง');
    expect(normalizePlate('นข 1365 ลำปาง')).toBe('นข1365ลำปาง');
    expect(normalizePlate('นข 2833 ลำปาง')).toBe('นข2833ลำปาง');
  });
});
