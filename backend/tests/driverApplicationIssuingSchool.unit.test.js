'use strict';

/**
 * DRV-INSPECTION-05 — createDriverApplication() used to pick the issuing school
 * as schools[0] of an ORDER BY sc.name list, i.e. the alphabetically first
 * school among those with riders on a shared vehicle. Only the issuing school
 * may review, so the application could stall at a school that does not manage
 * the vehicle. Now: the driver may name the issuing school (must be one of the
 * schools with riders), otherwise the school with the most riders is used.
 *
 * DB-free: mocked pool/connection.
 */

require('./loadTestEnv');
const { createDriverApplication } = require('../src/services/vehicleVerification.service');

const SCHOOLS = [
  { school_id: 'SCH_A', school_name: 'ก โรงเรียน', morning_rider_count: 1, evening_rider_count: 1, source_updated_at: null },
  { school_id: 'SCH_B', school_name: 'ข โรงเรียน', morning_rider_count: 9, evening_rider_count: 8, source_updated_at: null },
];

function makeDeps() {
  const inserts = [];
  const conn = {
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
    query: jest.fn(async (sql, params) => {
      if (/FROM vehicles v/.test(sql)) return [[{ id: 'V-1', plate_no: 'นข 1 ลำปาง' }]];
      if (/SELECT dva\.id, dva\.assignment_role/.test(sql)) return [[{ id: 1 }]];
      if (/FROM students s/.test(sql)) return [SCHOOLS];
      if (/INSERT INTO vehicle_inspection_applications/.test(sql)) {
        inserts.push(params);
        return [{ insertId: 10 }];
      }
      if (/^\s*INSERT/.test(sql)) return [{ insertId: 1 }];
      return [[]];
    }),
  };
  const pool = {
    getConnection: jest.fn(async () => conn),
    query: jest.fn(async () => [[{ id: '2569-2', is_current: 1, term_id: '2569-2' }]]),
  };
  return { pool, conn, inserts };
}

describe('createDriverApplication — issuing school', () => {
  test('defaults to the school with the most riders, not the alphabetically first', async () => {
    const { pool, inserts } = makeDeps();
    const res = await createDriverApplication(pool, { vehicleId: 'V-1', driverUserId: 5 });
    expect(res.issuing_school_id).toBe('SCH_B');
    expect(inserts[0][2]).toBe('SCH_B');
  });

  test('honours an explicit issuing school that has riders on the vehicle', async () => {
    const { pool, inserts } = makeDeps();
    const res = await createDriverApplication(pool, {
      vehicleId: 'V-1', driverUserId: 5, issuingSchoolId: 'SCH_A',
    });
    expect(res.issuing_school_id).toBe('SCH_A');
    expect(inserts[0][2]).toBe('SCH_A');
  });

  test('rejects a school that has no riders on the vehicle', async () => {
    const { pool } = makeDeps();
    await expect(createDriverApplication(pool, {
      vehicleId: 'V-1', driverUserId: 5, issuingSchoolId: 'SCH_X',
    })).rejects.toMatchObject({ statusCode: 400 });
  });
});
