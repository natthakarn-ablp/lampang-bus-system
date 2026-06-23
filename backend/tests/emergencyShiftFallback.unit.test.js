'use strict';

/**
 * emergencyShiftFallback.unit.test.js  (FIX 1, HIGH)
 *
 * DB-free — mock pool, no DB / globalSetup (runs under jest.unit.config.js).
 *
 * Verifies that the emergency vehicle resolver is SHIFT-INDEPENDENT: with
 * FEATURE_DRIVER_SHIFT_SELECTION on and the driver holding NO open shift,
 * resolveVehicleForEmergency still yields a vehicle instead of throwing
 * ACTIVE_SHIFT_REQUIRED (which getDriverVehicle does throw in that state).
 *
 * Emergency reporting must NEVER be gated on having opened a shift.
 */

const {
  resolveVehicleForEmergency,
  getDriverVehicle,
} = require('../src/services/checkin.service');
const env = require('../src/config/env');

// Dispatch by SQL shape, mirroring driverVehicleByDriverId.test.js:
//   - vehicle_operating_shifts  → shift lookup (shift-feature path)
//   - driver_vehicle_assignments dva → relational (driver_id) resolution
//   - FROM vehicles             → legacy plate lookup
//   - driver_vehicle_assignments → legacy assignment confirmation
function makePool({ activeShift = [], relational = [], legacyVehicle = [], legacyAsg = [[{ ok: 1 }]] } = {}) {
  const calls = [];
  const query = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (/vehicle_operating_shifts/.test(sql)) return [activeShift];
    if (/driver_vehicle_assignments dva/.test(sql)) return [relational];
    if (/FROM\s+vehicles/.test(sql)) return [legacyVehicle];
    if (/driver_vehicle_assignments/.test(sql)) return legacyAsg;
    return [[]];
  });
  return { query, calls };
}
const ran = (pool, re) => pool.calls.some(({ sql }) => re.test(sql));

describe('resolveVehicleForEmergency — shift-independent (FIX 1)', () => {
  const ON = () => { env.features.driverShiftSelection = true; };
  afterEach(() => { env.features.driverShiftSelection = false; });

  test('baseline: getDriverVehicle THROWS ACTIVE_SHIFT_REQUIRED with no open shift', async () => {
    ON();
    const pool = makePool({ activeShift: [] }); // no open shift
    await expect(getDriverVehicle(pool, { username: 'นข 4031 ลำปาง', driver_id: 121 }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'ACTIVE_SHIFT_REQUIRED' }] });
  });

  test('emergency resolver yields the vehicle via the relational link (shift ON, no shift)', async () => {
    ON();
    const pool = makePool({
      activeShift: [],                                                // driver has NO open shift
      relational: [{ vehicle_id: 'V-real', plate_no: 'นข 4031 ลำปาง' }],
    });

    const res = await resolveVehicleForEmergency(pool, { username: 'login-name', driver_id: 121 });

    expect(res).toMatchObject({ vehicle_id: 'V-real', plate_no: 'นข 4031 ลำปาง', driver_id: 121 });
    // It must NOT consult shifts at all — emergency is never shift-gated.
    expect(ran(pool, /vehicle_operating_shifts/)).toBe(false);
    expect(ran(pool, /driver_vehicle_assignments dva/)).toBe(true);
  });

  test('emergency resolver falls back to legacy plate when no relational link (shift ON)', async () => {
    ON();
    const pool = makePool({
      activeShift: [],
      relational: [],                                                 // no active assignment
      legacyVehicle: [{ vehicle_id: 'V-leg', plate_no: 'นข 4337 ลำปาง' }],
    });

    const res = await resolveVehicleForEmergency(pool, { username: 'นข 4337 ลำปาง', driver_id: 500 });

    expect(res.vehicle_id).toBe('V-leg');
    expect(ran(pool, /driver_vehicle_assignments dva/)).toBe(true);   // tried relational first
    expect(ran(pool, /FROM\s+vehicles/)).toBe(true);                  // then legacy plate
    expect(ran(pool, /vehicle_operating_shifts/)).toBe(false);        // never shift-gated
  });

  test('emergency resolver works for an unlinked (driver_id NULL) legacy driver', async () => {
    ON();
    const pool = makePool({
      legacyVehicle: [{ vehicle_id: 'V-leg', plate_no: 'นข1365ลำปาง' }],
    });

    const res = await resolveVehicleForEmergency(pool, { username: 'นข 1365 ลำปาง', driver_id: null });

    expect(res.vehicle_id).toBe('V-leg');
    expect(ran(pool, /driver_vehicle_assignments dva/)).toBe(false);  // relational skipped (no driver_id)
  });

  test('multiple active assigned vehicles still fails closed (never guesses)', async () => {
    ON();
    const pool = makePool({
      relational: [{ vehicle_id: 'V-a', plate_no: 'a' }, { vehicle_id: 'V-b', plate_no: 'b' }],
    });
    await expect(resolveVehicleForEmergency(pool, { username: 'x', driver_id: 7 }))
      .rejects.toMatchObject({ statusCode: 400, errors: [{ code: 'MULTIPLE_ACTIVE_DRIVER_ASSIGNMENTS' }] });
  });
});
