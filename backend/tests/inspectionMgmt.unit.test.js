'use strict';

/**
 * Unit tests for the new inspection-management capabilities (admin/operator
 * self-service so no manual DB script is needed):
 *   - cancelApplication: now rescues stuck states (INSPECTION_PENDING/NEEDS_FIX),
 *     aborts any IN_PROGRESS attempt, and supports an admin cross-scope override.
 *   - abortInspectionAttempt: transport (own attempt) / admin (override) abort of
 *     a stuck IN_PROGRESS attempt; guards against finalized attempts + foreign
 *     inspectors.
 *
 * DB-free: a mock `pool`/`conn` is passed straight into the service (the service
 * takes pool as its first arg), so no real connection is ever made. logAudit
 * runs against the same mock conn (executor = conn || pool).
 */

require('./loadTestEnv');
const svc = require('../src/services/vehicleVerification.service');

function makeConn(rows) {
  const calls = [];
  const conn = {
    calls,
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
    query: jest.fn(async (sql) => {
      calls.push(sql);
      // application row (transitionSchoolApplication)
      if (/FROM vehicle_inspection_applications\s+WHERE id = \?\s+FOR UPDATE/.test(sql)) {
        return [[rows.application]];
      }
      // open IN_PROGRESS attempts for an application (cancel path)
      if (/FROM inspection_attempts\s+WHERE application_id = \? AND result = 'IN_PROGRESS'/.test(sql)) {
        return [rows.openAttempts || []];
      }
      // single attempt + parent app (abortInspectionAttempt path)
      if (/FROM inspection_attempts ia\s+JOIN vehicle_inspection_applications/.test(sql)) {
        return [[rows.attempt]];
      }
      // eligibility recompute queries (abort happy path) — canned values
      if (/FROM vehicles\s+WHERE id/.test(sql)) return [[{ id: 'V1', certified_capacity: 30 }]];
      if (/FROM inspection_attempts ia\s+WHERE/.test(sql)) return [[]];
      if (/SUM\(CASE WHEN/.test(sql)) return [[{ morning_rider_count: 1, evening_rider_count: 1 }]];
      if (/COUNT\(\*\) AS valid_driver_count/.test(sql)) return [[{ valid_driver_count: 1 }]];
      if (/INSERT INTO audit_logs/.test(sql)) return [{ insertId: 1 }];
      if (/^\s*DELETE FROM/.test(sql)) return [{ affectedRows: 1 }];
      if (/^\s*UPDATE /.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    }),
  };
  return conn;
}
const makePool = (conn) => ({ getConnection: jest.fn().mockResolvedValue(conn) });
const issuedDelete = (conn) => conn.calls.some((s) => /DELETE FROM inspection_attempts/.test(s));

describe('cancelApplication — rescue stuck states + admin override', () => {
  test('cancels an INSPECTION_PENDING app and aborts its IN_PROGRESS attempt', async () => {
    const conn = makeConn({
      application: { id: 5, request_no: 'VIA-1', status: 'INSPECTION_PENDING', issuing_school_id: 'SCH1', active_request_key: 'k' },
      openAttempts: [{ id: 9, inspected_by: 7, inspection_date: '2026-06-25', started_at: '2026-06-25T10:00:00Z' }],
    });
    const out = await svc.cancelApplication(makePool(conn), { applicationId: 5, schoolId: 'SCH1', userId: 3 });
    expect(out.status).toBe('CANCELLED');
    expect(out.aborted_attempts).toEqual([expect.objectContaining({ attempt_id: 9 })]);
    expect(issuedDelete(conn)).toBe(true); // the open attempt was aborted in the same txn
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  test('admin override (isAdmin) cancels an app from ANOTHER school (no ISSUING_SCHOOL_REQUIRED)', async () => {
    const conn = makeConn({
      application: { id: 5, request_no: 'VIA-2', status: 'NEEDS_FIX', issuing_school_id: 'SCH_OTHER', active_request_key: 'k' },
      openAttempts: [],
    });
    const out = await svc.cancelApplication(makePool(conn), { applicationId: 5, schoolId: null, userId: 66, isAdmin: true });
    expect(out.status).toBe('CANCELLED');
    expect(conn.commit).toHaveBeenCalled();
  });

  test('non-admin canNOT cancel another school\'s app (ISSUING_SCHOOL_REQUIRED, rolled back)', async () => {
    const conn = makeConn({
      application: { id: 5, request_no: 'VIA-3', status: 'READY_TO_PRINT', issuing_school_id: 'SCH_OTHER', active_request_key: 'k' },
    });
    await expect(svc.cancelApplication(makePool(conn), { applicationId: 5, schoolId: 'SCH1', userId: 3 }))
      .rejects.toMatchObject({ statusCode: 403, errors: [{ code: 'ISSUING_SCHOOL_REQUIRED' }] });
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('abortInspectionAttempt — guards', () => {
  test('rejects a finalized (non IN_PROGRESS) attempt', async () => {
    const conn = makeConn({
      attempt: { id: 9, application_id: 5, inspected_by: 7, result: 'PASSED', vehicle_id: 'V1', application_status: 'INSPECTION_PENDING' },
    });
    await expect(svc.abortInspectionAttempt(makePool(conn), { attemptId: 9, actorUserId: 7, isAdmin: false }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'ATTEMPT_ALREADY_FINALIZED' }] });
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('non-admin transport user canNOT abort an attempt started by someone else (INSPECTOR_MISMATCH)', async () => {
    const conn = makeConn({
      attempt: { id: 9, application_id: 5, inspected_by: 7, result: 'IN_PROGRESS', vehicle_id: 'V1', application_status: 'INSPECTION_PENDING' },
    });
    await expect(svc.abortInspectionAttempt(makePool(conn), { attemptId: 9, actorUserId: 8, isAdmin: false }))
      .rejects.toMatchObject({ statusCode: 403, errors: [{ code: 'INSPECTOR_MISMATCH' }] });
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('admin override aborts an IN_PROGRESS attempt started by someone else + reverts app to READY_TO_PRINT', async () => {
    const conn = makeConn({
      attempt: { id: 9, application_id: 5, inspected_by: 7, result: 'IN_PROGRESS', vehicle_id: 'V1', application_status: 'INSPECTION_PENDING', inspection_date: '2026-06-25', started_at: '2026-06-25T10:00:00Z' },
    });
    const out = await svc.abortInspectionAttempt(makePool(conn), { attemptId: 9, actorUserId: 66, isAdmin: true });
    expect(out.application_status).toBe('READY_TO_PRINT');
    expect(issuedDelete(conn)).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
  });
});
