'use strict';

/**
 * Inspection dead ends (owner request 2026-11-13):
 *   - takeoverInspectionAttempt: another transport officer (or admin) takes an
 *     IN_PROGRESS attempt with a reason; audited with the previous inspector.
 *   - overrideCancelApplication: transport / the issuing school's affiliation
 *     cancel an application idle ≥3 days, with a reason; affiliation may not
 *     cut short an inspection in progress.
 * DB-free mock conn, same style as inspectionMgmt.unit.test.js.
 */

require('./loadTestEnv');
const svc = require('../src/services/vehicleVerification.service');

function makeConn({ attempt, application, ctx, openAttempts = [] } = {}) {
  const calls = [];
  const conn = {
    calls,
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM inspection_attempts ia\s+WHERE ia\.id = \?\s+FOR UPDATE/.test(sql)) return [[attempt]];
      if (/FROM vehicle_inspection_applications\s+WHERE id = \?\s+FOR UPDATE/.test(sql)) return [[application]];
      if (/TIMESTAMPDIFF\(SECOND, a\.updated_at/.test(sql)) return [[ctx]];
      if (/FROM inspection_attempts\s+WHERE application_id = \? AND result = 'IN_PROGRESS'/.test(sql)) return [openAttempts];
      if (/INSERT INTO audit_logs/.test(sql)) return [{ insertId: 1 }];
      if (/^\s*(UPDATE|DELETE)/.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    }),
  };
  return conn;
}
const poolOf = (conn) => ({ getConnection: jest.fn().mockResolvedValue(conn) });
const audits = (conn) => conn.calls.filter((c) => /INSERT INTO audit_logs/.test(c.sql)).map((c) => ({
  entityType: c.params[2], old: JSON.parse(c.params[4] || 'null'), next: JSON.parse(c.params[5] || 'null'),
}));

describe('takeoverInspectionAttempt', () => {
  test('another officer takes over with a reason → inspected_by moves, audit keeps the previous one', async () => {
    const conn = makeConn({ attempt: { id: 9, application_id: 5, inspected_by: 70, result: 'IN_PROGRESS' } });
    const out = await svc.takeoverInspectionAttempt(poolOf(conn), { attemptId: 9, actorUserId: 71, reason: 'ผู้ตรวจเดิมลาป่วย' });
    expect(out).toEqual({ attempt_id: 9, inspected_by: 71, previous_inspected_by: 70 });
    const upd = conn.calls.find((c) => /UPDATE inspection_attempts SET inspected_by/.test(c.sql));
    expect(upd.params).toEqual([71, 9]);
    const [a] = audits(conn);
    expect(a).toMatchObject({ entityType: 'inspection_attempt', old: { inspected_by: 70 }, next: { inspected_by: 71, takeover: true, reason: 'ผู้ตรวจเดิมลาป่วย' } });
    expect(conn.commit).toHaveBeenCalled();
  });

  test('reason is required', async () => {
    const conn = makeConn({ attempt: { id: 9, inspected_by: 70, result: 'IN_PROGRESS' } });
    await expect(svc.takeoverInspectionAttempt(poolOf(conn), { attemptId: 9, actorUserId: 71, reason: ' ' }))
      .rejects.toMatchObject({ statusCode: 400, errors: [{ code: 'REASON_REQUIRED' }] });
  });

  test('a finalized attempt cannot be taken over', async () => {
    const conn = makeConn({ attempt: { id: 9, inspected_by: 70, result: 'PASSED' } });
    await expect(svc.takeoverInspectionAttempt(poolOf(conn), { attemptId: 9, actorUserId: 71, reason: 'รับช่วงงาน' }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'ATTEMPT_ALREADY_FINALIZED' }] });
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('the current inspector gets a clear 409, not a silent no-op', async () => {
    const conn = makeConn({ attempt: { id: 9, inspected_by: 71, result: 'IN_PROGRESS' } });
    await expect(svc.takeoverInspectionAttempt(poolOf(conn), { attemptId: 9, actorUserId: 71, reason: 'รับช่วงงาน' }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'ALREADY_INSPECTOR' }] });
  });

  test('finalize still refuses a non-owner (takeover is the explicit path)', async () => {
    const conn = makeConn();
    conn.query.mockImplementation(async (sql) => {
      if (/FROM inspection_attempts ia\s+JOIN vehicle_inspection_applications a/.test(sql)) {
        return [[{ id: 9, application_id: 5, inspected_by: 70, result: 'IN_PROGRESS', checklist_template_id: 1 }]];
      }
      return [[]];
    });
    await expect(svc.finalizeInspection(poolOf(conn), { attemptId: 9, inspectorUserId: 71, result: 'FAILED', items: [] }))
      .rejects.toMatchObject({ statusCode: 403, errors: [{ code: 'INSPECTOR_MISMATCH' }] });
  });
});

describe('overrideCancelApplication', () => {
  const app = { id: 5, request_no: 'VIA-1', status: 'INSPECTION_PENDING', issuing_school_id: 'S1' };
  const idle = (days, extra = {}) => ({ idle_s: days * 86400, affiliation_id: 'A1', open_attempts: 0, ...extra });

  test('transport cancels an application idle 4 days, with a reason, and aborts the open attempt', async () => {
    const conn = makeConn({ application: app, ctx: idle(4), openAttempts: [{ id: 33, inspected_by: 70, inspection_date: '2026-11-01' }] });
    const out = await svc.overrideCancelApplication(poolOf(conn), { applicationId: 5, userId: 71, role: 'transport', reason: 'โรงเรียนไม่ดำเนินการต่อ' });
    expect(out).toMatchObject({ id: 5, status: 'CANCELLED' });
    expect(conn.calls.some((c) => /DELETE FROM inspection_attempts/.test(c.sql))).toBe(true);
    const upd = conn.calls.find((c) => /UPDATE vehicle_inspection_applications/.test(c.sql));
    expect(upd.sql).toMatch(/active_request_key = CASE WHEN \? = 'CANCELLED' THEN NULL/);
    const [a] = audits(conn);
    expect(a.next).toMatchObject({ status: 'CANCELLED', reason: 'โรงเรียนไม่ดำเนินการต่อ', override_role: 'transport', issuing_school_id: 'S1' });
  });

  test('not stuck yet (idle < 3 days) → 409', async () => {
    const conn = makeConn({ application: app, ctx: idle(1) });
    await expect(svc.overrideCancelApplication(poolOf(conn), { applicationId: 5, userId: 71, role: 'transport', reason: 'ยกเลิกคำขอ' }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'NOT_STUCK_YET' }] });
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('affiliation: only its own area (404 otherwise)', async () => {
    const conn = makeConn({ application: app, ctx: idle(5, { affiliation_id: 'A2' }) });
    await expect(svc.overrideCancelApplication(poolOf(conn), { applicationId: 5, userId: 80, role: 'affiliation', affiliationId: 'A1', reason: 'ยกเลิกคำขอ' }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('affiliation may not cut short an inspection in progress', async () => {
    const conn = makeConn({ application: app, ctx: idle(5, { open_attempts: 1 }) });
    await expect(svc.overrideCancelApplication(poolOf(conn), { applicationId: 5, userId: 80, role: 'affiliation', affiliationId: 'A1', reason: 'ยกเลิกคำขอ' }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'INSPECTION_IN_PROGRESS' }] });
  });

  test('affiliation cancels a stuck one in its area', async () => {
    const conn = makeConn({ application: { ...app, status: 'NEEDS_FIX' }, ctx: idle(6) });
    const out = await svc.overrideCancelApplication(poolOf(conn), { applicationId: 5, userId: 80, role: 'affiliation', affiliationId: 'A1', reason: 'รถเลิกให้บริการแล้ว' });
    expect(out.status).toBe('CANCELLED');
  });

  test('reason required; finished applications are not cancellable', async () => {
    await expect(svc.overrideCancelApplication(poolOf(makeConn()), { applicationId: 5, userId: 71, role: 'transport', reason: '' }))
      .rejects.toMatchObject({ statusCode: 400 });
    const conn = makeConn({ application: { ...app, status: 'PASSED' }, ctx: idle(30) });
    await expect(svc.overrideCancelApplication(poolOf(conn), { applicationId: 5, userId: 71, role: 'transport', reason: 'ยกเลิกคำขอ' }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'INVALID_APPLICATION_STATUS' }] });
  });

  test('school role cannot use the override path', async () => {
    await expect(svc.overrideCancelApplication(poolOf(makeConn()), { applicationId: 5, userId: 1, role: 'school', reason: 'ยกเลิกคำขอ' }))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});
