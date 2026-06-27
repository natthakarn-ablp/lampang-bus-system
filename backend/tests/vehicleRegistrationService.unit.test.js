'use strict';

/**
 * vehicleRegistrationService.unit.test.js — Phase 10.14
 *
 * DB-free service-flow tests using a mock pool (same approach as
 * vehicleRequest.test.js). Exercises the real service logic — scope guards,
 * approval preconditions, reopen-on-add, eligibility — without a database.
 */

const svc = require('../src/services/vehicleRegistration.service');

// Ordered [regex, response] pairs. First match wins. Default = empty rows.
function mockPool(pairs = []) {
  const run = async (sql) => {
    for (const [re, resp] of pairs) {
      if (re.test(sql)) return typeof resp === 'function' ? resp(sql) : resp;
    }
    return [[]];
  };
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: run,
  };
  return { getConnection: async () => conn, query: run };
}

describe('addRosterStudent — validation', () => {
  test('missing name → 400', async () => {
    await expect(svc.addRosterStudent(mockPool(), {
      vehicleId: 'V1', driverUserId: 1, raw_student_name: '  ', school_id: 'SCH1',
    })).rejects.toMatchObject({ statusCode: 400 });
  });
  test('missing school → 400', async () => {
    await expect(svc.addRosterStudent(mockPool(), {
      vehicleId: 'V1', driverUserId: 1, raw_student_name: 'เด็กชายสมชาย',
    })).rejects.toMatchObject({ statusCode: 400 });
  });
  test('missing vehicle → 400', async () => {
    await expect(svc.addRosterStudent(mockPool(), {
      driverUserId: 1, raw_student_name: 'เด็กชายสมชาย', school_id: 'SCH1',
    })).rejects.toMatchObject({ statusCode: 400 });
  });
  test('school not found → 404', async () => {
    const pool = mockPool([[/FROM schools WHERE id = \?/, [[]]]]);
    await expect(svc.addRosterStudent(pool, {
      vehicleId: 'V1', driverUserId: 1, raw_student_name: 'เด็กชายสมชาย', school_id: 'NOPE',
    })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('addRosterStudent — happy path (creates application + roster)', () => {
  test('returns UNMATCHED roster row with new application id', async () => {
    const pool = mockPool([
      [/FROM schools WHERE id = \?/,                          [[{ id: 'SCH1' }]]],
      [/active_request_key = \? LIMIT 1 FOR UPDATE/,          [[]]],            // no existing app
      [/SELECT id, plate_no, vehicle_type FROM vehicles/,     [[{ id: 'V1', plate_no: 'นข 1 ลำปาง', vehicle_type: 'ตู้' }]]],
      [/INSERT INTO vehicle_inspection_applications/,         [{ insertId: 10 }]],
      [/INSERT INTO registration_roster_students/,            [{ insertId: 99 }]],
      [/SUM\(CASE WHEN pickup_type/,                          [[{ morning: 1, evening: 0 }]]],
      [/INSERT INTO inspection_application_schools/,          [{}]],
      [/UPDATE inspection_application_schools/,               [{}]],
      [/INSERT INTO audit_logs/,                              [{}]],
    ]);
    const out = await svc.addRosterStudent(pool, {
      vehicleId: 'V1', driverUserId: 7, raw_student_name: 'เด็กชายสมชาย ใจดี',
      school_id: 'SCH1', pickup_type: 'MORNING',
    });
    expect(out).toMatchObject({ id: 99, application_id: 10, school_id: 'SCH1', match_status: 'UNMATCHED' });
  });
});

describe('approveRegistration — scope + preconditions', () => {
  const base = (apsRows, unresolved) => mockPool([
    [/SELECT approval_status FROM inspection_application_schools/, apsRows],
    [/COUNT\(\*\) AS unresolved FROM registration_roster_students/, [[{ unresolved }]]],
    [/UPDATE inspection_application_schools/, [{}]],
    [/INSERT INTO audit_logs/, [{}]],
    [/SELECT submitted_by_driver FROM inspection_application_schools/, [[{ submitted_by_driver: null }]]],
  ]);

  test('not part of this school → 403', async () => {
    await expect(svc.approveRegistration(base([[]], 0), { applicationId: 10, schoolId: 'SCH9', userId: 1 }))
      .rejects.toMatchObject({ statusCode: 403 });
  });
  test('still has UNMATCHED riders → 400', async () => {
    await expect(svc.approveRegistration(base([[{ approval_status: 'PENDING_SCHOOL_REVIEW' }]], 2), { applicationId: 10, schoolId: 'SCH1', userId: 1 }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
  test('all reconciled → APPROVED', async () => {
    const out = await svc.approveRegistration(base([[{ approval_status: 'PENDING_SCHOOL_REVIEW' }]], 0), { applicationId: 10, schoolId: 'SCH1', userId: 1 });
    expect(out).toMatchObject({ approval_status: 'APPROVED', school_id: 'SCH1' });
  });
});

describe('rejectRegistration', () => {
  test('reason required → 400', async () => {
    await expect(svc.rejectRegistration(mockPool(), { applicationId: 10, schoolId: 'SCH1', userId: 1, reason: '  ' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
  test('happy → NEEDS_REVISION', async () => {
    const pool = mockPool([
      [/SELECT approval_status FROM inspection_application_schools/, [[{ approval_status: 'PENDING_SCHOOL_REVIEW' }]]],
      [/UPDATE inspection_application_schools/, [{}]],
      [/INSERT INTO audit_logs/, [{}]],
      [/SELECT submitted_by_driver FROM inspection_application_schools/, [[{ submitted_by_driver: null }]]],
    ]);
    const out = await svc.rejectRegistration(pool, { applicationId: 10, schoolId: 'SCH1', userId: 1, reason: 'ชื่อไม่ตรง' });
    expect(out).toMatchObject({ approval_status: 'NEEDS_REVISION' });
  });
});

describe('matchRosterStudent — scope', () => {
  test('roster row not in this application/school → 404', async () => {
    const pool = mockPool([[/FROM registration_roster_students WHERE id = \? FOR UPDATE/, [[{ id: 99, application_id: 10, school_id: 'OTHER' }]]]]);
    await expect(svc.matchRosterStudent(pool, { applicationId: 10, schoolId: 'SCH1', rosterId: 99, matchedStudentId: 5, userId: 1 }))
      .rejects.toMatchObject({ statusCode: 404 });
  });
  test('student not in this school → 400', async () => {
    const pool = mockPool([
      [/FROM registration_roster_students WHERE id = \? FOR UPDATE/, [[{ id: 99, application_id: 10, school_id: 'SCH1' }]]],
      [/SELECT id FROM students WHERE id = \? AND school_id = \?/, [[]]],
    ]);
    await expect(svc.matchRosterStudent(pool, { applicationId: 10, schoolId: 'SCH1', rosterId: 99, matchedStudentId: 5, userId: 1 }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
  test('happy → MATCHED', async () => {
    const pool = mockPool([
      [/FROM registration_roster_students WHERE id = \? FOR UPDATE/, [[{ id: 99, application_id: 10, school_id: 'SCH1' }]]],
      [/SELECT id FROM students WHERE id = \? AND school_id = \?/, [[{ id: 5 }]]],
      [/UPDATE registration_roster_students SET matched_student_id/, [{}]],
      [/INSERT INTO audit_logs/, [{}]],
    ]);
    const out = await svc.matchRosterStudent(pool, { applicationId: 10, schoolId: 'SCH1', rosterId: 99, matchedStudentId: 5, userId: 1 });
    expect(out).toMatchObject({ match_status: 'MATCHED', matched_student_id: 5 });
  });
});

describe('isVehicleEligible — reuses verification_status', () => {
  test('no active application → false', async () => {
    const pool = mockPool([[/FROM vehicle_inspection_applications\s+WHERE vehicle_id = \?/, [[]]]]);
    expect(await svc.isVehicleEligible(pool, 'V1')).toBe(false);
  });
  test('all schools approved AND inspection ELIGIBLE → true', async () => {
    const pool = mockPool([
      [/FROM vehicle_inspection_applications\s+WHERE vehicle_id = \?/, [[{ id: 10 }]]],
      [/SELECT approval_status FROM inspection_application_schools WHERE application_id = \?/, [[{ approval_status: 'APPROVED' }, { approval_status: 'APPROVED' }]]],
      [/SELECT verification_status FROM vehicles/, [[{ verification_status: 'ELIGIBLE' }]]],
    ]);
    expect(await svc.isVehicleEligible(pool, 'V1')).toBe(true);
  });
  test('one school not approved → false', async () => {
    const pool = mockPool([
      [/FROM vehicle_inspection_applications\s+WHERE vehicle_id = \?/, [[{ id: 10 }]]],
      [/SELECT approval_status FROM inspection_application_schools WHERE application_id = \?/, [[{ approval_status: 'APPROVED' }, { approval_status: 'PENDING_SCHOOL_REVIEW' }]]],
      [/SELECT verification_status FROM vehicles/, [[{ verification_status: 'ELIGIBLE' }]]],
    ]);
    expect(await svc.isVehicleEligible(pool, 'V1')).toBe(false);
  });
  test('approved but inspection not eligible → false', async () => {
    const pool = mockPool([
      [/FROM vehicle_inspection_applications\s+WHERE vehicle_id = \?/, [[{ id: 10 }]]],
      [/SELECT approval_status FROM inspection_application_schools WHERE application_id = \?/, [[{ approval_status: 'APPROVED' }]]],
      [/SELECT verification_status FROM vehicles/, [[{ verification_status: 'UNVERIFIED' }]]],
    ]);
    expect(await svc.isVehicleEligible(pool, 'V1')).toBe(false);
  });
});
