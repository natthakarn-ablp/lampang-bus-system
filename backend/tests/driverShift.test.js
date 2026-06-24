'use strict';

jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));

const fs = require('fs');
const path = require('path');

describe('driver pool and operating-shift migration', () => {
  test('migration 039 removes one-driver-per-vehicle and enforces open shift exclusivity', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/039_driver_pool_and_shifts.sql'), 'utf8');
    expect(sql).toMatch(/DROP INDEX uq_dva_active_vehicle/i);
    expect(sql).toMatch(/assignment_role\s+ENUM\('PRIMARY','BACKUP'\)/i);
    expect(sql).toMatch(/authorization_status/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS driver_qualifications/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS vehicle_operating_shifts/i);
    expect(sql).toMatch(/UNIQUE KEY uq_open_shift_driver \(open_driver_id\)/i);
    expect(sql).toMatch(/UNIQUE KEY uq_open_shift_vehicle \(open_vehicle_id\)/i);
  });
});

describe('driver authorization and actual operating shifts', () => {
  const {
    listAuthorizedVehicles,
    startShift,
    getActiveShift,
    endShift,
    listDrivers,
    authorizeDriverForVehicle,
    verifyDriverQualification,
  } = require('../src/services/driverShift.service');

  function shiftPool({
    assignment = { id: 21, driver_id: 4, vehicle_id: 'V-1', assignment_role: 'BACKUP', authorization_status: 'AUTHORIZED', verification_status: 'ELIGIBLE' },
    qualification = { qualification_status: 'VERIFIED', license_expiry: '2099-12-31' },
    openShifts = [], insertId = 81, endingShift = null,
  } = {}) {
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(), commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(), release: jest.fn(),
      query: jest.fn(async (sql) => {
        if (/FROM drivers d\s+WHERE d\.id/.test(sql)) return [[{ id: 4, name: 'สมชาย' }]];
        if (/FROM driver_vehicle_assignments dva\s+JOIN vehicles/.test(sql)) return [assignment ? [assignment] : []];
        if (/FROM driver_qualifications/.test(sql)) return [qualification ? [qualification] : []];
        if (/FROM vehicle_operating_shifts\s+WHERE \(driver_id/.test(sql)) return [openShifts];
        if (/INSERT INTO vehicle_operating_shifts/.test(sql)) return [{ insertId }];
        if (/FROM vehicle_operating_shifts vos\s+WHERE vos\.id/.test(sql)) return [endingShift ? [endingShift] : []];
        if (/UPDATE vehicle_operating_shifts/.test(sql)) return [{ affectedRows: 1 }];
        return [[]];
      }),
    };
    return { getConnection: async () => conn, query: jest.fn(), conn };
  }

  test('an authorized backup driver may hold assignments to multiple vehicles', async () => {
    const rows = [
      { assignment_id: 21, vehicle_id: 'V-1', plate_no: 'กก 1 ลำปาง', assignment_role: 'BACKUP', authorization_status: 'AUTHORIZED', verification_status: 'ELIGIBLE', qualification_status: 'VERIFIED', license_expiry: '2099-12-31' },
      { assignment_id: 22, vehicle_id: 'V-2', plate_no: 'กก 2 ลำปาง', assignment_role: 'PRIMARY', authorization_status: 'AUTHORIZED', verification_status: 'EXPIRING', qualification_status: 'VERIFIED', license_expiry: '2099-12-31' },
    ];
    const pool = { query: jest.fn().mockResolvedValue([rows]) };
    const result = await listAuthorizedVehicles(pool, { driverId: 4, at: '2026-06-22' });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ assignment_role: 'BACKUP', can_start: true });
    expect(result[1]).toMatchObject({ can_start: true });
  });

  test('authorized backup can start a shift and actual driver is recorded', async () => {
    const pool = shiftPool();
    const result = await startShift(pool, { driverId: 4, vehicleId: 'V-1', session: 'MORNING', userId: 19, at: '2026-06-22' });
    expect(result).toMatchObject({ shift_id: 81, driver_id: 4, vehicle_id: 'V-1', assignment_role: 'BACKUP', status: 'OPEN' });
    expect(pool.conn.commit).toHaveBeenCalled();
  });

  test('unauthorized, expired-license, and ineligible-vehicle starts are blocked', async () => {
    await expect(startShift(shiftPool({ assignment: null }), { driverId: 4, vehicleId: 'V-1', session: 'MORNING', userId: 19, at: '2026-06-22' }))
      .rejects.toMatchObject({ statusCode: 403, errors: [{ code: 'DRIVER_NOT_AUTHORIZED' }] });
    await expect(startShift(shiftPool({ qualification: { qualification_status: 'VERIFIED', license_expiry: '2020-01-01' } }), { driverId: 4, vehicleId: 'V-1', session: 'MORNING', userId: 19, at: '2026-06-22' }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'DRIVER_LICENSE_EXPIRED' }] });
    await expect(startShift(shiftPool({ assignment: { id: 21, vehicle_id: 'V-1', assignment_role: 'PRIMARY', verification_status: 'INELIGIBLE' } }), { driverId: 4, vehicleId: 'V-1', session: 'MORNING', userId: 19, at: '2026-06-22' }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'VEHICLE_NOT_ELIGIBLE' }] });
  });

  test('one driver cannot open two vehicles and one vehicle cannot have two drivers', async () => {
    await expect(startShift(shiftPool({ openShifts: [{ id: 70, driver_id: 4, vehicle_id: 'V-OTHER' }] }), { driverId: 4, vehicleId: 'V-1', session: 'MORNING', userId: 19, at: '2026-06-22' }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'DRIVER_ALREADY_ON_SHIFT' }] });
    await expect(startShift(shiftPool({ openShifts: [{ id: 71, driver_id: 99, vehicle_id: 'V-1' }] }), { driverId: 4, vehicleId: 'V-1', session: 'MORNING', userId: 19, at: '2026-06-22' }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'VEHICLE_ALREADY_ON_SHIFT' }] });
  });

  test('active shift can be read and ending an already closed shift is idempotent', async () => {
    const pool = { query: jest.fn().mockResolvedValue([[{ id: 81, driver_id: 4, vehicle_id: 'V-1', status: 'OPEN' }]]) };
    expect(await getActiveShift(pool, { driverId: 4 })).toMatchObject({ id: 81, status: 'OPEN' });

    const closedPool = shiftPool({ endingShift: { id: 81, driver_id: 4, vehicle_id: 'V-1', status: 'CLOSED', ended_at: '2026-06-22 09:00:00' } });
    const ended = await endShift(closedPool, { driverId: 4, shiftId: 81, userId: 19 });
    expect(ended).toMatchObject({ shift_id: 81, status: 'CLOSED', already_closed: true });
    expect(closedPool.conn.query.mock.calls.some(([sql]) => /UPDATE vehicle_operating_shifts/.test(sql))).toBe(false);
  });

  test('transport can authorize a primary or backup driver without removing other drivers', async () => {
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(), commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(), release: jest.fn(),
      query: jest.fn(async (sql) => {
        if (/FROM drivers WHERE id/.test(sql)) return [[{ id: 4, name: 'สมชาย' }]];
        if (/FROM vehicles\s+WHERE id/.test(sql)) return [[{
          id: 'V-1', plate_no: 'กก 1 ลำปาง', certified_capacity: 20,
          insurance_expiry: '2099-12-31', registration_expiry: '2099-12-31',
          compulsory_insurance_expiry: '2099-12-31', tax_expiry: '2099-12-31',
        }]];
        if (/FROM driver_vehicle_assignments\s+WHERE driver_id/.test(sql)) return [[]];
        if (/INSERT INTO driver_vehicle_assignments/.test(sql)) return [{ insertId: 31 }];
        return [[]];
      }),
    };
    const result = await authorizeDriverForVehicle({ getConnection: async () => conn }, {
      driverId: 4, vehicleId: 'V-1', assignmentRole: 'BACKUP', validUntil: '2027-06-22', userId: 12,
    });
    expect(result).toMatchObject({ assignment_id: 31, driver_id: 4, vehicle_id: 'V-1', assignment_role: 'BACKUP', authorization_status: 'AUTHORIZED' });
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE.+is_active = FALSE/s.test(sql))).toBe(false);
  });

  test('qualification verification creates a new current record and driver list stays non-sensitive', async () => {
    const listPool = { query: jest.fn().mockResolvedValue([[{
      id: 4, name: 'สมชาย', qualification_status: 'VERIFIED', license_type: 'ท.2', license_expiry: '2027-06-22', authorized_vehicle_count: 2,
    }]]) };
    expect(await listDrivers(listPool, { search: 'สมชาย' })).toEqual([expect.objectContaining({ id: 4, authorized_vehicle_count: 2 })]);

    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(), commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(), release: jest.fn(),
      query: jest.fn(async (sql) => {
        if (/FROM drivers WHERE id/.test(sql)) return [[{ id: 4, name: 'สมชาย' }]];
        if (/UPDATE driver_qualifications/.test(sql)) return [{ affectedRows: 1 }];
        if (/INSERT INTO driver_qualifications/.test(sql)) return [{ insertId: 44 }];
        return [[]];
      }),
    };
    const verified = await verifyDriverQualification({ getConnection: async () => conn }, {
      driverId: 4, licenseNo: 'DLT-001', licenseType: 'ท.2', licenseExpiry: '2027-06-22',
      providerReference: 'LPG-2026-001', userId: 12,
    });
    expect(verified).toMatchObject({ qualification_id: 44, driver_id: 4, status: 'VERIFIED' });
    expect(conn.commit).toHaveBeenCalled();
  });
});
