'use strict';

/**
 * studentTransfer.test.js  (Phase 10.13B-6)
 * Transfer request lifecycle: create/cancel scope, admin approve (Option B),
 * destination-conflict block, idempotency, stale, reject.
 */
const svc = require('../src/services/studentTransfer.service');

function makePool({ student, destSchool = { id: 'S2', name: 'ปลายทาง' }, pendingExists = false,
  request, reReadStudent, reReadDestDup = false } = {}) {
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => {
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
    query: async (sql, params) => {
      if (/FROM students WHERE id = \?/.test(sql)) return [student ? [student] : []];
      if (/FROM schools WHERE id = \? AND/.test(sql)) return [destSchool ? [destSchool] : []];
      if (/student_transfer_requests WHERE student_id = \? AND status = 'PENDING'/.test(sql)) return [pendingExists ? [{ id: 5 }] : []];
      if (/FROM student_transfer_requests WHERE id = \?/.test(sql)) return [request ? [request] : []];
      if (/INSERT INTO student_transfer_requests/.test(sql)) return [{ insertId: 42 }];
      return [{}];
    },
  };
}
const student = (o = {}) => ({ id: 100, school_id: 'S1', student_code: '500', prefix: 'ด.ช.', first_name: 'ก', last_name: 'ข', is_deleted: 0, ...o });

describe('createRequest (10.13B-6)', () => {
  test('own active student → PENDING', async () => {
    const out = await svc.createRequest(makePool({ student: student() }), { studentId: 100, schoolId: 'S1', userId: 1, destinationSchoolId: 'S2', reason: 'ย้าย' });
    expect(out.status).toBe('PENDING');
  });
  test('other school’s student → 403', async () => {
    await expect(svc.createRequest(makePool({ student: student({ school_id: 'OTHER' }) }), { studentId: 100, schoolId: 'S1', userId: 1, destinationSchoolId: 'S2' })).rejects.toMatchObject({ statusCode: 403 });
  });
  test('transfer to same school → 400', async () => {
    await expect(svc.createRequest(makePool({ student: student() }), { studentId: 100, schoolId: 'S1', userId: 1, destinationSchoolId: 'S1' })).rejects.toMatchObject({ statusCode: 400 });
  });
  test('duplicate pending request → 409', async () => {
    await expect(svc.createRequest(makePool({ student: student(), pendingExists: true }), { studentId: 100, schoolId: 'S1', userId: 1, destinationSchoolId: 'S2' })).rejects.toMatchObject({ statusCode: 409 });
  });
});

const pendingReq = (o = {}) => ({ id: 42, status: 'PENDING', student_id: 100, student_code: '500', source_school_id: 'S1', destination_school_id: 'S2', request_type: 'TRANSFER_TO_SCHOOL', ...o });

describe('approveAndApply — Option B (10.13B-6)', () => {
  test('eligible → APPLIED with a new destination student id', async () => {
    const out = await svc.approveAndApply(makePool({ request: pendingReq(), reReadStudent: student() }), { requestId: 42, adminUserId: 9 });
    expect(out.status).toBe('APPLIED');
    expect(out.applied_student_id).toBe(99001);
  });
  test('destination already has the student_code → FAILED (no duplicate created)', async () => {
    const out = await svc.approveAndApply(makePool({ request: pendingReq(), reReadStudent: student(), reReadDestDup: true }), { requestId: 42, adminUserId: 9 });
    expect(out.status).toBe('FAILED');
    expect(out.reason).toBe('DESTINATION_CODE_EXISTS');
  });
  test('already applied → ALREADY_APPLIED (idempotent)', async () => {
    const out = await svc.approveAndApply(makePool({ request: pendingReq({ status: 'APPLIED', applied_student_id: 77 }) }), { requestId: 42, adminUserId: 9 });
    expect(out.status).toBe('ALREADY_APPLIED');
  });
  test('source student changed/deleted since request → STALE_NEEDS_REVIEW', async () => {
    const out = await svc.approveAndApply(makePool({ request: pendingReq(), reReadStudent: student({ is_deleted: 1 }) }), { requestId: 42, adminUserId: 9 });
    expect(out.status).toBe('STALE_NEEDS_REVIEW');
  });
});

describe('cancel / reject (10.13B-6)', () => {
  test('requester cancels own pending → CANCELLED', async () => {
    const out = await svc.cancelRequest(makePool({ request: { id: 42, source_school_id: 'S1', status: 'PENDING' } }), { requestId: 42, schoolId: 'S1', userId: 1 });
    expect(out.status).toBe('CANCELLED');
  });
  test('other school cannot cancel → 403', async () => {
    await expect(svc.cancelRequest(makePool({ request: { id: 42, source_school_id: 'OTHER', status: 'PENDING' } }), { requestId: 42, schoolId: 'S1', userId: 1 })).rejects.toMatchObject({ statusCode: 403 });
  });
  test('admin reject pending → REJECTED', async () => {
    const out = await svc.reject(makePool({ request: { id: 42, status: 'PENDING' } }), { requestId: 42, adminUserId: 9, adminNote: 'ไม่ถูกต้อง' });
    expect(out.status).toBe('REJECTED');
  });
});
