'use strict';

/**
 * transferAuditTrail.unit.test.js  (#5 — "student/vehicle transfers must have an audit trail")
 *
 * Locks in that EVERY state transition of a student-transfer request and a
 * vehicle request writes an audit_logs row via logAudit(). Before this suite
 * the terminal FAILED / STALE_NEEDS_REVIEW / ALREADY_APPLIED(restore) paths
 * wrote NO service-level audit — this test guards the fix and pins the actor,
 * action, entity and status of each row.
 *
 * DB-free: logAudit is jest.mock'd (so both conn- and pool-based audit calls
 * are captured regardless of transaction context) and the pool is a hand-rolled
 * fake, mirroring studentTransfer.test.js / vehicleRequest.test.js. Runs under
 * jest.unit.config.js.
 */

jest.mock('../src/utils/audit', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: ['CREATE', 'UPDATE', 'DELETE', 'EXPORT', 'LOGIN', 'IMPORT', 'APPROVE', 'VIEW'],
}));

const { logAudit } = require('../src/utils/audit');
const transferSvc = require('../src/services/studentTransfer.service');
const vehReqSvc = require('../src/services/vehicleRequest.service');

beforeEach(() => logAudit.mockClear());

const audits = () => logAudit.mock.calls.map((c) => c[0]);
const auditsWhere = (pred) => audits().filter(pred);

/* ─────────────────────────── student transfer ─────────────────────────── */

function stPool({ student, destSchool = { id: 'S2', name: 'ปลายทาง' }, pendingExists = false,
  request, reReadStudent, reReadDestDup = false } = {}) {
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql) => {
      if (/FROM student_transfer_requests WHERE id = \? FOR UPDATE/.test(sql)) return [request ? [request] : []];
      if (/FROM students WHERE id = \? FOR UPDATE/.test(sql)) return [reReadStudent ? [reReadStudent] : []];
      if (/FROM schools WHERE id = \? AND/.test(sql)) return [destSchool ? [destSchool] : []];
      if (/WHERE school_id = \? AND student_code = \? AND/.test(sql)) return [reReadDestDup ? [{ id: 7 }] : []];
      if (/FROM id_sequences/.test(sql)) return [[{ next_value: 99001 }]];
      if (/FROM parent_student WHERE student_id/.test(sql)) return [[{ parent_id: 3 }]];
      return [{}];
    },
  };
  return {
    getConnection: async () => conn,
    query: async (sql) => {
      if (/FROM students WHERE id = \?/.test(sql)) return [student ? [student] : []];
      if (/FROM schools WHERE id = \? AND/.test(sql)) return [destSchool ? [destSchool] : []];
      if (/student_transfer_requests WHERE student_id = \? AND status = 'PENDING'/.test(sql)) return [pendingExists ? [{ id: 5 }] : []];
      if (/FROM student_transfer_requests WHERE id = \?/.test(sql)) return [request ? [request] : []];
      if (/INSERT INTO student_transfer_requests/.test(sql)) return [{ insertId: 42 }];
      return [{ affectedRows: 1 }];
    },
  };
}
const stStudent = (o = {}) => ({ id: 100, school_id: 'S1', student_code: '500', prefix: 'ด.ช.', first_name: 'ก', last_name: 'ข', is_deleted: 0, ...o });
const stReq = (o = {}) => ({ id: 42, status: 'PENDING', student_id: 100, student_code: '500', source_school_id: 'S1', destination_school_id: 'S2', request_type: 'TRANSFER_TO_SCHOOL', ...o });

describe('student transfer — audit on every transition', () => {
  test('createRequest → CREATE audit on the request', async () => {
    await transferSvc.createRequest(stPool({ student: stStudent() }),
      { studentId: 100, schoolId: 'S1', userId: 1, destinationSchoolId: 'S2', reason: 'ย้าย' });
    expect(auditsWhere((a) => a.action === 'CREATE' && a.entityType === 'student_transfer_request' && a.entityId === '42')).toHaveLength(1);
  });

  test('cancelRequest → UPDATE audit status CANCELLED', async () => {
    await transferSvc.cancelRequest(stPool({ request: { id: 42, source_school_id: 'S1', status: 'PENDING' } }),
      { requestId: 42, schoolId: 'S1', userId: 1 });
    expect(auditsWhere((a) => a.entityType === 'student_transfer_request' && a.newValue?.status === 'CANCELLED')).toHaveLength(1);
  });

  test('reject → UPDATE audit status REJECTED', async () => {
    await transferSvc.reject(stPool({ request: { id: 42, status: 'PENDING' } }),
      { requestId: 42, adminUserId: 9, adminNote: 'ไม่อนุมัติ' });
    expect(auditsWhere((a) => a.newValue?.status === 'REJECTED' && a.userId === 9)).toHaveLength(1);
  });

  test('approveAndApply APPLIED → audit on the migrated student entity', async () => {
    const out = await transferSvc.approveAndApply(stPool({ request: stReq(), reReadStudent: stStudent() }),
      { requestId: 42, adminUserId: 9 });
    expect(out.status).toBe('APPLIED');
    expect(auditsWhere((a) => a.entityType === 'student' && a.newValue?.transfer === true && a.userId === 9)).toHaveLength(1);
  });

  test('approveAndApply STALE_NEEDS_REVIEW (student drifted) → audit records the stale transition', async () => {
    const out = await transferSvc.approveAndApply(
      stPool({ request: stReq(), reReadStudent: stStudent({ school_id: 'OTHER' }) }),
      { requestId: 42, adminUserId: 9 });
    expect(out.status).toBe('STALE_NEEDS_REVIEW');
    expect(auditsWhere((a) => a.entityType === 'student_transfer_request' && a.newValue?.status === 'STALE_NEEDS_REVIEW')).toHaveLength(1);
  });

  test('approveAndApply FAILED (destination missing) → audit records the failure', async () => {
    const out = await transferSvc.approveAndApply(
      stPool({ request: stReq(), reReadStudent: stStudent(), destSchool: null }),
      { requestId: 42, adminUserId: 9 });
    expect(out).toMatchObject({ status: 'FAILED', reason: 'DESTINATION_MISSING' });
    expect(auditsWhere((a) => a.newValue?.status === 'FAILED' && a.newValue?.reason === 'DESTINATION_MISSING')).toHaveLength(1);
  });

  test('approveAndApply FAILED (destination code exists) → audit records the failure', async () => {
    const out = await transferSvc.approveAndApply(
      stPool({ request: stReq(), reReadStudent: stStudent(), reReadDestDup: true }),
      { requestId: 42, adminUserId: 9 });
    expect(out).toMatchObject({ status: 'FAILED', reason: 'DESTINATION_CODE_EXISTS' });
    expect(auditsWhere((a) => a.newValue?.reason === 'DESTINATION_CODE_EXISTS')).toHaveLength(1);
  });

  test('approveAndApply ALREADY_APPLIED is a no-op → writes NO audit (documents intended behaviour)', async () => {
    const out = await transferSvc.approveAndApply(
      stPool({ request: stReq({ status: 'APPLIED', applied_student_id: 777 }) }),
      { requestId: 42, adminUserId: 9 });
    expect(out.status).toBe('ALREADY_APPLIED');
    expect(logAudit).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────── vehicle request ─────────────────────────── */

function vrPool({ vehicle, dupPending = false, request, reReadVehicle, activeSibling = false } = {}) {
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql) => {
      if (/FROM vehicle_requests WHERE id = \? FOR UPDATE/.test(sql)) return [request ? [request] : []];
      if (/FROM vehicles WHERE id = \? FOR UPDATE/.test(sql)) return [reReadVehicle ? [reReadVehicle] : []];
      if (/WHERE canonical_plate = \? AND is_deleted = FALSE AND id <> \?/.test(sql)) return [activeSibling ? [{ id: 'V-other' }] : []];
      return [{ affectedRows: 1 }];
    },
  };
  return {
    getConnection: async () => conn,
    query: async (sql) => {
      if (/FROM vehicles WHERE id = \?/.test(sql)) return [vehicle ? [vehicle] : []];
      if (/FROM vehicles WHERE canonical_plate = \? AND is_deleted = TRUE/.test(sql)) return [vehicle ? [vehicle] : []];
      if (/vehicle_requests WHERE school_id = \? AND canonical_plate = \? AND request_type = \? AND status = 'PENDING'/.test(sql)) return [dupPending ? [{ id: 3 }] : []];
      if (/FROM vehicle_requests WHERE id = \?/.test(sql)) return [request ? [request] : []];
      if (/INSERT INTO vehicle_requests/.test(sql)) return [{ insertId: 55 }];
      return [{ affectedRows: 1 }];
    },
  };
}
const softVeh = (o = {}) => ({ id: 'V-x', plate_no: 'นข 4031 ลำปาง', vehicle_type: 'รถตู้', is_deleted: 1, ...o });
const restoreReq = (o = {}) => ({ id: 55, status: 'PENDING', request_type: 'RESTORE_SOFT_DELETED_VEHICLE', vehicle_id: 'V-x', canonical_plate: 'นข4031ลำปาง', ...o });

describe('vehicle request — audit on every transition', () => {
  test('createVehicleRequest → CREATE audit', async () => {
    await vehReqSvc.createVehicleRequest(vrPool({ vehicle: softVeh() }),
      { schoolId: 'S1', userId: 1, requestType: 'RESTORE_SOFT_DELETED_VEHICLE', vehicleId: 'V-x', reason: 'ต้องใช้' });
    expect(auditsWhere((a) => a.action === 'CREATE' && a.entityType === 'vehicle_request')).toHaveLength(1);
  });

  test('cancelVehicleRequest → UPDATE CANCELLED', async () => {
    await vehReqSvc.cancelVehicleRequest(vrPool({ request: { id: 55, school_id: 'S1', status: 'PENDING' } }),
      { requestId: 55, schoolId: 'S1', userId: 1 });
    expect(auditsWhere((a) => a.newValue?.status === 'CANCELLED')).toHaveLength(1);
  });

  test('rejectVehicleRequest → UPDATE REJECTED', async () => {
    await vehReqSvc.rejectVehicleRequest(vrPool({ request: { id: 55, status: 'PENDING' } }),
      { requestId: 55, adminUserId: 9, adminNote: 'ไม่อนุมัติ' });
    expect(auditsWhere((a) => a.newValue?.status === 'REJECTED')).toHaveLength(1);
  });

  test('approveVehicleRequest RESTORE APPLIED → audit on the vehicle entity', async () => {
    const out = await vehReqSvc.approveVehicleRequest(vrPool({ request: restoreReq(), reReadVehicle: softVeh() }),
      { requestId: 55, adminUserId: 9 });
    expect(out.status).toBe('APPLIED');
    expect(auditsWhere((a) => a.entityType === 'vehicle' && a.newValue?.restored === true)).toHaveLength(1);
  });

  test('approveVehicleRequest FAILED (vehicle missing) → audit records the failure', async () => {
    const out = await vehReqSvc.approveVehicleRequest(vrPool({ request: restoreReq(), reReadVehicle: undefined }),
      { requestId: 55, adminUserId: 9 });
    expect(out).toMatchObject({ status: 'FAILED', reason: 'VEHICLE_MISSING' });
    expect(auditsWhere((a) => a.newValue?.reason === 'VEHICLE_MISSING')).toHaveLength(1);
  });

  test('approveVehicleRequest ALREADY_APPLIED (vehicle already active) → audit records the resolution', async () => {
    const out = await vehReqSvc.approveVehicleRequest(vrPool({ request: restoreReq(), reReadVehicle: softVeh({ is_deleted: 0 }) }),
      { requestId: 55, adminUserId: 9 });
    expect(out.status).toBe('ALREADY_APPLIED');
    expect(auditsWhere((a) => a.newValue?.status === 'ALREADY_APPLIED')).toHaveLength(1);
  });

  test('approveVehicleRequest FAILED (active canonical sibling) → audit records the conflict', async () => {
    const out = await vehReqSvc.approveVehicleRequest(vrPool({ request: restoreReq(), reReadVehicle: softVeh(), activeSibling: true }),
      { requestId: 55, adminUserId: 9 });
    expect(out).toMatchObject({ status: 'FAILED', reason: 'ACTIVE_CANONICAL_CONFLICT' });
    expect(auditsWhere((a) => a.newValue?.reason === 'ACTIVE_CANONICAL_CONFLICT')).toHaveLength(1);
  });

  test('approveVehicleRequest informational APPLIED (USE_EXISTING) → APPROVE audit on the request', async () => {
    const out = await vehReqSvc.approveVehicleRequest(
      vrPool({ request: { id: 55, status: 'PENDING', request_type: 'USE_EXISTING_SHARED_VEHICLE', vehicle_id: 'V-x', canonical_plate: 'x' } }),
      { requestId: 55, adminUserId: 9 });
    expect(out).toMatchObject({ status: 'APPLIED', informational: true });
    expect(auditsWhere((a) => a.action === 'APPROVE' && a.entityType === 'vehicle_request')).toHaveLength(1);
  });

  test('approveVehicleRequest ALREADY_APPLIED at entry (no state change) → NO audit', async () => {
    const out = await vehReqSvc.approveVehicleRequest(vrPool({ request: { id: 55, status: 'APPLIED', vehicle_id: 'V-x' } }),
      { requestId: 55, adminUserId: 9 });
    expect(out.status).toBe('ALREADY_APPLIED');
    expect(logAudit).not.toHaveBeenCalled();
  });
});
