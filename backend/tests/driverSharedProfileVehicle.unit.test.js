'use strict';

// One driver profile shared by several plate accounts (a school added a second
// vehicle with the same driver name/phone, so driverProfile reused the profile
// and the driver ended up with two active vehicles). Every one of those
// accounts used to be locked out with MULTIPLE_ACTIVE_DRIVER_ASSIGNMENTS.
// The login is the plate, so it picks the vehicle — but only among the
// vehicles the driver is actively assigned to.
const env = require('../src/config/env');
const { getDriverVehicle, resolveVehicleForEmergency } = require('../src/services/checkin.service');

function makePool(relational) {
  const calls = [];
  const query = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (/driver_vehicle_assignments dva/.test(sql)) return [relational];
    return [[]];
  });
  return { query, calls };
}

const TWO = [
  { vehicle_id: 'V-93', plate_no: 'นข 9001 ลำปาง' },
  { vehicle_id: 'V-95', plate_no: 'นข 9002 ลำปาง' },
];

describe('linked driver with several active vehicles — resolve by the plate login', () => {
  let flagBefore;
  beforeAll(() => { flagBefore = env.features.driverShiftSelection; env.features.driverShiftSelection = false; });
  afterAll(() => { env.features.driverShiftSelection = flagBefore; });

  test('each plate account gets its own vehicle', async () => {
    await expect(getDriverVehicle(makePool(TWO), { username: 'นข 9001 ลำปาง', driver_id: 7 }))
      .resolves.toEqual({ vehicle_id: 'V-93', plate_no: 'นข 9001 ลำปาง', driver_id: 7, shift_id: null });
    await expect(getDriverVehicle(makePool(TWO), { username: 'นข 9002 ลำปาง', driver_id: 7 }))
      .resolves.toEqual({ vehicle_id: 'V-95', plate_no: 'นข 9002 ลำปาง', driver_id: 7, shift_id: null });
  });

  test('spacing, dashes and letter case in the login do not matter', async () => {
    const res = await getDriverVehicle(makePool(TWO), { username: ' นข-9002  ลำปาง ', driver_id: 7 });
    expect(res.vehicle_id).toBe('V-95');
  });

  test('the emergency path resolves the same way', async () => {
    const res = await resolveVehicleForEmergency(makePool(TWO), { username: 'นข 9001 ลำปาง', driver_id: 7 });
    expect(res.vehicle_id).toBe('V-93');
  });

  test('a login that names none of the assigned vehicles still fails closed', async () => {
    const pool = makePool(TWO);
    await expect(getDriverVehicle(pool, { username: 'นข 9003 ลำปาง', driver_id: 7 }))
      .rejects.toMatchObject({ statusCode: 400, errors: [{ code: 'MULTIPLE_ACTIVE_DRIVER_ASSIGNMENTS' }] });
    // never falls back to a plate lookup outside the driver's own assignments
    expect(pool.calls.some(({ sql }) => /FROM\s+vehicles\b/.test(sql))).toBe(false);
  });

  test('an empty login never matches', async () => {
    await expect(getDriverVehicle(makePool(TWO), { username: '', driver_id: 7 }))
      .rejects.toMatchObject({ errors: [{ code: 'MULTIPLE_ACTIVE_DRIVER_ASSIGNMENTS' }] });
  });

  test('two assigned vehicles with the same normalized plate are still ambiguous', async () => {
    const dup = [{ vehicle_id: 'V-1', plate_no: 'นข 1 ลำปาง' }, { vehicle_id: 'V-2', plate_no: 'นข-1-ลำปาง' }];
    await expect(getDriverVehicle(makePool(dup), { username: 'นข 1 ลำปาง', driver_id: 5 }))
      .rejects.toMatchObject({ errors: [{ code: 'MULTIPLE_ACTIVE_DRIVER_ASSIGNMENTS' }] });
  });

  test('a single assigned vehicle is unchanged: resolved by driver_id whatever the login', async () => {
    const res = await getDriverVehicle(makePool([TWO[0]]), { username: 'anything', driver_id: 7 });
    expect(res.vehicle_id).toBe('V-93');
  });
});
