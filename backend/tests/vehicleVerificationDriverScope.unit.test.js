'use strict';

/**
 * Regression — getApplication() must scope a DRIVER viewer to applications the
 * driver themselves submitted (WHERE a.requested_by = ?), mirroring
 * listDriverApplications.
 *
 * Security audit 2026-06-27 (HIGH#1): the driver branch previously ran
 * `WHERE a.id = ?` with no ownership filter, so any authenticated driver could
 * read every school's/driver's application by iterating sequential ids — an
 * IDOR leaking vehicle snapshots, per-school rider counts, pickup-area
 * summaries, and assigned-driver names + qualification/licence status.
 *
 * DB-free: drives the service with a mocked pool and asserts the generated SQL
 * + bound params, so it runs under `npm run test:unit` (no MySQL needed).
 */

require('./loadTestEnv');
const { getApplication } = require('../src/services/vehicleVerification.service');

const APP = {
  id: 77, request_no: 'VIA-1', vehicle_id: 'V-1', issuing_school_id: 'S1',
  requested_by: 5, plate_no: 'นข 1 ลำปาง', status: 'SUBMITTED',
  vehicle_snapshot_json: JSON.stringify({ plate_no: 'นข 1 ลำปาง' }),
  rider_summary_json: JSON.stringify({ schools: [] }),
  route_summary_json: JSON.stringify({ routes: [] }),
};

function makePool(mainRows) {
  return {
    query: jest.fn(async (sql) => {
      if (/FROM vehicle_inspection_applications a\s+JOIN vehicles/.test(sql)) return [mainRows];
      if (/FROM inspection_application_schools aps/.test(sql)) return [[]];
      if (/FROM inspection_attempts ia/.test(sql)) return [[]];
      if (/FROM driver_vehicle_assignments dva/.test(sql)) return [[]];
      return [[]];
    }),
  };
}

describe('getApplication — driver scope (IDOR fix)', () => {
  test('driver query is constrained by requested_by and bound to the driver user id', async () => {
    const pool = makePool([APP]);
    await getApplication(pool, {
      applicationId: 77,
      viewer: { role: 'driver', schoolId: null, userId: 5 },
    });

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE a\.id = \?\s+AND a\.requested_by = \?/);
    expect(params).toEqual([77, 5]);
    // a driver must NOT receive the participating-school access join
    expect(sql).not.toMatch(/inspection_application_schools access_school/);
  });

  test("another driver's application is not returned (404, no existence leak)", async () => {
    // The requested_by filter excludes it at the DB → empty rows → 404.
    const pool = makePool([]);
    await expect(getApplication(pool, {
      applicationId: 77,
      viewer: { role: 'driver', schoolId: null, userId: 999 },
    })).rejects.toMatchObject({ statusCode: 404 });
    // Ownership filter was actually present in the query that returned nothing.
    expect(pool.query.mock.calls[0][0]).toMatch(/a\.requested_by = \?/);
    expect(pool.query.mock.calls[0][1]).toEqual([77, 999]);
  });

  test('driver viewer without a user id is rejected, with no DB query (no unscoped fallback)', async () => {
    const pool = makePool([APP]);
    await expect(getApplication(pool, {
      applicationId: 77,
      viewer: { role: 'driver', schoolId: null },
    })).rejects.toMatchObject({
      statusCode: 403,
      errors: [{ code: 'DRIVER_SCOPE_REQUIRED' }],
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('school viewer still uses the participating-school access join (unchanged)', async () => {
    const pool = makePool([APP]);
    await getApplication(pool, {
      applicationId: 77,
      viewer: { role: 'school', schoolId: 'S1' },
    });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/inspection_application_schools access_school/);
    expect(params).toEqual(['S1', 77]);
    expect(sql).not.toMatch(/a\.requested_by/);
  });

  test('transport/admin viewer is unscoped by id only (unchanged)', async () => {
    const pool = makePool([APP]);
    await getApplication(pool, {
      applicationId: 77,
      viewer: { role: 'transport', schoolId: null },
    });
    const [sql, params] = pool.query.mock.calls[0];
    expect(params).toEqual([77]);
    expect(sql).not.toMatch(/a\.requested_by/);
    expect(sql).not.toMatch(/inspection_application_schools access_school/);
  });
});
