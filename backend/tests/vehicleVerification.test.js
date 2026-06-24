'use strict';

jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));

const fs = require('fs');
const path = require('path');

describe('shared vehicle verification migrations', () => {
  test('migration 038 defines the shared inspection workflow and its safety constraints', () => {
    const migration = fs.readFileSync(
      path.join(__dirname, '../migrations/038_shared_vehicle_verification.sql'),
      'utf8'
    );

    for (const table of [
      'vehicle_inspection_applications',
      'inspection_application_schools',
      'inspection_checklist_templates',
      'inspection_checklist_items',
      'inspection_attempts',
      'inspection_checklist_results',
    ]) {
      expect(migration).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i'));
    }

    expect(migration).toMatch(/qr_token\s+VARCHAR\(64\).*UNIQUE/i);
    expect(migration).toMatch(/active_request_key\s+VARCHAR\(100\).*UNIQUE/i);
    expect(migration).toMatch(/provider_type/i);
    expect(migration).toMatch(/version_no/i);
    expect(migration).toMatch(/superseded_by_id/i);
  });
});

describe('vehicle eligibility', () => {
  const { computeEligibility, buildTransportSnapshot, refreshVehicleEligibility } = require('../src/services/vehicleVerification.service');

  const validPass = { result: 'PASSED', expiry_date: '2099-12-31' };
  const expiredPass = { result: 'PASSED', expiry_date: '2020-01-01' };
  const validDocs = {
    insurance_expiry: '2099-12-31',
    registration_expiry: '2099-12-31',
    compulsory_insurance_expiry: '2099-12-31',
    tax_expiry: '2099-12-31',
  };

  test('returns ELIGIBLE when inspection, documents, capacity, and driver pool are valid', () => {
    expect(computeEligibility({
      inspection: validPass,
      documents: validDocs,
      capacity: 20,
      peakRiders: 18,
      validDriverCount: 2,
      today: '2026-06-22',
    })).toEqual({ status: 'ELIGIBLE', reasons: [] });
  });

  test('returns INELIGIBLE when inspection is expired', () => {
    expect(computeEligibility({
      inspection: expiredPass,
      documents: validDocs,
      capacity: 20,
      peakRiders: 18,
      validDriverCount: 2,
      today: '2026-06-22',
    })).toMatchObject({ status: 'INELIGIBLE', reasons: ['INSPECTION_EXPIRED'] });
  });

  test('returns capacity and driver reasons when safety requirements are not met', () => {
    const result = computeEligibility({
      inspection: validPass,
      documents: validDocs,
      capacity: 10,
      peakRiders: 18,
      validDriverCount: 0,
      today: '2026-06-22',
    });
    expect(result.status).toBe('INELIGIBLE');
    expect(result.reasons).toEqual(expect.arrayContaining(['CAPACITY_EXCEEDED', 'NO_VALID_DRIVER']));
  });

  test('transport snapshot excludes student and parent PII recursively', () => {
    const snapshot = buildTransportSnapshot({
      vehicle: { id: 'V-1', plate_no: 'นข 1 ลำปาง', certified_capacity: 20 },
      schools: [{ school_id: 'S1', school_name: 'โรงเรียนหนึ่ง', morning_rider_count: 9, evening_rider_count: 11 }],
      drivers: [{ driver_id: 4, driver_name: 'คนขับ', phone: '0811111111' }],
      routes: [{ pickup_area: 'เมืองลำปาง' }],
      students: [{ student_id: 99, student_name: 'ห้ามออก' }],
      parents: [{ parent_name: 'ห้ามออก' }],
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(/student|parent|0811111111|ห้ามออก/i);
    expect(snapshot).toMatchObject({ peak_rider_count: 11, total_schools: 1 });
  });

  test('eligibility is recalculated immediately after driver or document changes', async () => {
    const pool = { query: jest.fn(async (sql) => {
      if (/FROM vehicles\s+WHERE id/.test(sql)) return [[{
        id: 'V-1', certified_capacity: 20, insurance_expiry: '2099-12-31',
        registration_expiry: '2099-12-31', compulsory_insurance_expiry: '2099-12-31', tax_expiry: '2099-12-31',
      }]];
      if (/FROM inspection_attempts ia/.test(sql)) return [[{ result: 'PASSED', expiry_date: '2099-12-31' }]];
      if (/SUM\(CASE WHEN morning_enabled/.test(sql)) return [[{ morning_rider_count: 12, evening_rider_count: 14 }]];
      if (/COUNT\(\*\) AS valid_driver_count/.test(sql)) return [[{ valid_driver_count: 1 }]];
      if (/UPDATE vehicles/.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    }) };
    const result = await refreshVehicleEligibility(pool, 'V-1', { today: '2026-06-22', currentTerm: '2569-1' });
    expect(result).toEqual({ status: 'ELIGIBLE', reasons: [] });
    expect(pool.query.mock.calls.some(([sql]) => /UPDATE vehicles/.test(sql))).toBe(true);
  });
});

describe('consolidated school inspection applications', () => {
  const {
    createApplication,
    listSchoolApplications,
    getApplication,
    markReadyToPrint,
    cancelApplication,
  } = require('../src/services/vehicleVerification.service');

  function fakePool({ related = true, duplicate = null } = {}) {
    const vehicle = {
      id: 'V-1', plate_no: 'นข 1 ลำปาง', vehicle_type: 'รถตู้', certified_capacity: 20,
      insurance_expiry: '2099-12-31', registration_expiry: '2099-12-31',
      compulsory_insurance_expiry: '2099-12-31', tax_expiry: '2099-12-31',
    };
    const schools = [
      { school_id: 'S1', school_name: 'โรงเรียนหนึ่ง', morning_rider_count: 8, evening_rider_count: 10, source_updated_at: '2026-06-20' },
      { school_id: 'S2', school_name: 'โรงเรียนสอง', morning_rider_count: 5, evening_rider_count: 4, source_updated_at: '2026-06-21' },
    ];
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        if (/FROM vehicles v\s+WHERE v\.id = \?/.test(sql)) return [[vehicle]];
        if (/COUNT\(\*\) AS related/.test(sql)) return [[{ related: related ? 1 : 0 }]];
        if (/FROM vehicle_inspection_applications\s+WHERE active_request_key/.test(sql)) return [duplicate ? [duplicate] : []];
        if (/GROUP BY s\.school_id/.test(sql)) return [schools];
        if (/FROM driver_vehicle_assignments dva/.test(sql)) return [[{ driver_id: 4, driver_name: 'สมชาย', assignment_role: 'PRIMARY', qualification_status: 'VERIFIED' }]];
        if (/FROM pickup_points pp/.test(sql)) return [[{ pickup_area: 'เมืองลำปาง', session: 'both' }]];
        if (/INSERT INTO vehicle_inspection_applications/.test(sql)) return [{ insertId: 77 }];
        if (/INSERT INTO inspection_application_schools/.test(sql)) return [{ affectedRows: 1 }];
        return [[]];
      }),
    };
    return { getConnection: async () => conn, conn };
  }

  test('a related school creates one application with aggregate-only multi-school snapshot', async () => {
    const pool = fakePool();
    const result = await createApplication(pool, {
      vehicleId: 'V-1', issuingSchoolId: 'S1', userId: 9, currentTerm: '2569-1',
    });
    expect(result).toMatchObject({ id: 77, status: 'DRAFT', vehicle_id: 'V-1', total_schools: 2, peak_rider_count: 14 });
    expect(JSON.stringify(result)).not.toMatch(/student|parent|cid_hash/i);
    expect(pool.conn.commit).toHaveBeenCalled();
  });

  test('an unrelated school cannot create an application for the vehicle', async () => {
    const pool = fakePool({ related: false });
    await expect(createApplication(pool, {
      vehicleId: 'V-1', issuingSchoolId: 'OTHER', userId: 9, currentTerm: '2569-1',
    })).rejects.toMatchObject({ statusCode: 403 });
    expect(pool.conn.rollback).toHaveBeenCalled();
  });

  test('an active application is returned as a conflict instead of duplicated', async () => {
    const pool = fakePool({ duplicate: { id: 55, request_no: 'VIA-OLD', status: 'READY_TO_PRINT' } });
    await expect(createApplication(pool, {
      vehicleId: 'V-1', issuingSchoolId: 'S1', userId: 9, currentTerm: '2569-1',
    })).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'ACTIVE_APPLICATION_EXISTS', application_id: 55 }] });
  });

  test('a participating school can list and view the shared application without student PII', async () => {
    const application = {
      id: 77, request_no: 'VIA-1', vehicle_id: 'V-1', issuing_school_id: 'S1',
      plate_no: 'นข 1 ลำปาง', status: 'READY_TO_PRINT',
      vehicle_snapshot_json: JSON.stringify({ plate_no: 'นข 1 ลำปาง' }),
      rider_summary_json: JSON.stringify({ schools: [{ school_id: 'S1', school_name: 'โรงเรียนหนึ่ง', morning_rider_count: 8 }] }),
      route_summary_json: JSON.stringify({ routes: [{ pickup_area: 'เมืองลำปาง' }] }),
    };
    const pool = {
      query: jest.fn(async (sql) => {
        if (/JOIN inspection_application_schools access_school/.test(sql)) return [[application]];
        if (/FROM vehicle_inspection_applications a\s+JOIN vehicles/.test(sql)) return [[application]];
        if (/FROM inspection_application_schools aps/.test(sql)) return [[{ school_id: 'S1', school_name: 'โรงเรียนหนึ่ง', morning_rider_count: 8, evening_rider_count: 9 }]];
        if (/FROM inspection_attempts ia/.test(sql)) return [[]];
        return [[]];
      }),
    };

    const list = await listSchoolApplications(pool, { schoolId: 'S1' });
    const detail = await getApplication(pool, { applicationId: 77, viewer: { role: 'school', schoolId: 'S1' } });
    expect(list).toHaveLength(1);
    expect(detail).toMatchObject({ id: 77, plate_no: 'นข 1 ลำปาง', schools: [{ school_id: 'S1' }] });
    expect(JSON.stringify(detail)).not.toMatch(/student_id|student_name|parent|cid_hash/i);
  });

  test('a non-participating school cannot view the application', async () => {
    const pool = { query: jest.fn().mockResolvedValueOnce([[]]) };
    await expect(getApplication(pool, {
      applicationId: 77, viewer: { role: 'school', schoolId: 'OTHER' },
    })).rejects.toMatchObject({ statusCode: 404 });
  });

  test('issuing school can mark a draft ready and later cancel it', async () => {
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        if (/SELECT id, request_no, status, issuing_school_id/.test(sql)) {
          return [[{ id: 77, request_no: 'VIA-1', status: 'DRAFT', issuing_school_id: 'S1' }]];
        }
        if (/UPDATE vehicle_inspection_applications/.test(sql)) return [{ affectedRows: 1 }];
        return [[]];
      }),
    };
    const pool = { getConnection: async () => conn };
    const ready = await markReadyToPrint(pool, { applicationId: 77, schoolId: 'S1', userId: 9 });
    expect(ready).toMatchObject({ id: 77, status: 'READY_TO_PRINT' });

    conn.query.mockImplementation(async (sql) => {
      if (/SELECT id, request_no, status, issuing_school_id/.test(sql)) {
        return [[{ id: 77, request_no: 'VIA-1', status: 'READY_TO_PRINT', issuing_school_id: 'S1' }]];
      }
      if (/UPDATE vehicle_inspection_applications/.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    });
    const cancelled = await cancelApplication(pool, {
      applicationId: 77, schoolId: 'S1', userId: 9, reason: 'ข้อมูลรถเปลี่ยน',
    });
    expect(cancelled).toMatchObject({ id: 77, status: 'CANCELLED' });
  });
});

describe('versioned inspection checklist', () => {
  const {
    validateChecklistResults,
    startInspection,
    finalizeInspection,
  } = require('../src/services/vehicleVerification.service');

  const templateItems = [
    { id: 1, item_code: 'BRAKES', is_required: 1, allows_na: 0, fail_severity: 'CRITICAL' },
    { id: 2, item_code: 'LIGHTS', is_required: 1, allows_na: 0, fail_severity: 'MAJOR' },
  ];

  test('requires every checklist item and rejects unknown item codes', () => {
    expect(() => validateChecklistResults(templateItems, [{ item_code: 'BRAKES', result: 'PASS' }]))
      .toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => validateChecklistResults(templateItems, [
      { item_code: 'BRAKES', result: 'PASS' },
      { item_code: 'UNKNOWN', result: 'PASS' },
    ])).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  test('requires notes for failed checks and prevents PASSED with a failed item', () => {
    expect(() => validateChecklistResults(templateItems, [
      { item_code: 'BRAKES', result: 'FAIL' },
      { item_code: 'LIGHTS', result: 'PASS' },
    ], 'FAILED')).toThrow(expect.objectContaining({
      errors: expect.arrayContaining([expect.objectContaining({ code: 'FAIL_NOTE_REQUIRED' })]),
    }));
    expect(() => validateChecklistResults(templateItems, [
      { item_code: 'BRAKES', result: 'FAIL', notes: 'แรงเบรกไม่สมดุล' },
      { item_code: 'LIGHTS', result: 'PASS' },
    ], 'PASSED')).toThrow(expect.objectContaining({
      errors: expect.arrayContaining([expect.objectContaining({ code: 'PASS_WITH_FAILED_CHECK' })]),
    }));
  });

  test('starting an inspection appends a new attempt and keeps prior attempts immutable', async () => {
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(), commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(), release: jest.fn(),
      query: jest.fn(async (sql) => {
        if (/FROM vehicle_inspection_applications/.test(sql)) return [[{ id: 77, status: 'READY_TO_PRINT' }]];
        if (/FROM inspection_checklist_templates/.test(sql)) return [[{ id: 5, version_no: 1 }]];
        if (/INSERT INTO inspection_attempts/.test(sql)) return [{ insertId: 91 }];
        if (/UPDATE vehicle_inspection_applications/.test(sql)) return [{ affectedRows: 1 }];
        return [[]];
      }),
    };
    const result = await startInspection({ getConnection: async () => conn }, {
      applicationId: 77, inspectorUserId: 12, inspectionDate: '2026-06-22',
    });
    expect(result).toEqual({ attempt_id: 91, application_id: 77, checklist_version: 1, status: 'IN_PROGRESS' });
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE inspection_attempts/.test(sql))).toBe(false);
  });

  test('finalizing a passing attempt writes immutable results, legacy summary, and eligibility', async () => {
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(), commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(), release: jest.fn(),
      query: jest.fn(async (sql) => {
        if (/FROM inspection_attempts ia/.test(sql)) return [[{
          id: 91, application_id: 77, checklist_template_id: 5, inspected_by: 12,
          result: 'IN_PROGRESS', vehicle_id: 'V-1',
          rider_summary_json: JSON.stringify({ peak_rider_count: 14 }),
        }]];
        if (/FROM inspection_checklist_items/.test(sql)) return [templateItems];
        if (/INSERT INTO inspection_checklist_results/.test(sql)) return [{ affectedRows: 1 }];
        if (/UPDATE inspection_attempts/.test(sql)) return [{ affectedRows: 1 }];
        if (/UPDATE vehicle_inspection_applications/.test(sql)) return [{ affectedRows: 1 }];
        if (/INSERT INTO vehicle_inspections/.test(sql)) return [{ insertId: 301 }];
        if (/FROM vehicles/.test(sql)) return [[{
          id: 'V-1', certified_capacity: 20, insurance_expiry: '2099-12-31',
          registration_expiry: '2099-12-31', compulsory_insurance_expiry: '2099-12-31', tax_expiry: '2099-12-31',
        }]];
        if (/COUNT\(\*\) AS valid_driver_count/.test(sql)) return [[{ valid_driver_count: 2 }]];
        if (/UPDATE vehicles/.test(sql)) return [{ affectedRows: 1 }];
        return [[]];
      }),
    };
    const result = await finalizeInspection({ getConnection: async () => conn }, {
      attemptId: 91, inspectorUserId: 12, result: 'PASSED', inspectionDate: '2026-06-22',
      expiryDate: '2027-06-22', notes: 'ผ่านครบทุกหัวข้อ',
      items: [
        { item_code: 'BRAKES', result: 'PASS' },
        { item_code: 'LIGHTS', result: 'PASS' },
      ],
    });
    expect(result).toMatchObject({ attempt_id: 91, application_status: 'PASSED', eligibility: { status: 'ELIGIBLE' } });
    expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO vehicle_inspections/.test(sql))).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
  });
});
