'use strict';

// SCH-VEH-2 (school audit 2026-11-08): adding a vehicle must not attach the new
// plate's login to a driver profile of ANOTHER school just because the phone
// or name matches.
const { linkOrCreateDriverForVehicle } = require('../src/services/driverProfile.service');

function makeConn({ byPhone = [], byName = [], serves = false } = {}) {
  const query = jest.fn(async (sql) => {
    if (/FROM driver_vehicle_assignments dva\s+JOIN students s/.test(sql)) return [serves ? [{ ok: 1 }] : []];
    if (/FROM drivers WHERE is_deleted = FALSE\s+AND REGEXP_REPLACE/.test(sql)) return [byPhone];
    if (/FROM drivers WHERE is_deleted = FALSE AND TRIM\(name\)/.test(sql)) return [byName];
    if (/INSERT INTO drivers/.test(sql)) return [{ insertId: 900 }];
    if (/FROM users\b[\s\S]*role = 'driver'/.test(sql)) return [[]];
    if (/INSERT INTO users/.test(sql)) return [{ insertId: 1 }];
    if (/INSERT INTO driver_vehicle_assignments/.test(sql)) return [{ insertId: 1 }];
    return [[]];
  });
  return { query };
}
const userInsertDriverId = (conn) => {
  const call = conn.query.mock.calls.find(([sql]) => /INSERT INTO users/.test(sql));
  return call[1][3];
};
const BASE = { driverName: 'นายสมชาย ใจดี', driverPhone: '0812345678', normalizedPlate: 'นข9999ลำปาง', plateNo: 'นข 9999 ลำปาง', vehicleId: 'V-new', schoolId: 'SCH1' };

test('phone match of another school\'s driver: new profile, login NOT linked to them', async () => {
  const conn = makeConn({ byPhone: [{ id: 7 }], serves: false });
  await linkOrCreateDriverForVehicle(conn, BASE);
  expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO drivers/.test(sql))).toBe(true);
  expect(userInsertDriverId(conn)).toBe(900);
});

test('name-only match of another school\'s driver: new profile', async () => {
  const conn = makeConn({ byName: [{ id: 8 }], serves: false });
  await linkOrCreateDriverForVehicle(conn, { ...BASE, driverPhone: '' });
  expect(userInsertDriverId(conn)).toBe(900);
});

test('the school\'s own driver (already drives a bus with its pupils) is reused', async () => {
  const conn = makeConn({ byPhone: [{ id: 7 }], serves: true });
  await linkOrCreateDriverForVehicle(conn, BASE);
  expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO drivers/.test(sql))).toBe(false);
  expect(userInsertDriverId(conn)).toBe(7);
  const scope = conn.query.mock.calls.find(([sql]) => /JOIN students s/.test(sql));
  expect(scope[1]).toEqual(['SCH1', 7]);
});
