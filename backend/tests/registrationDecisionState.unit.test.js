'use strict';

// SCH-VEH-6 (school audit 2026-11-08): a school decision on a driver's
// registration needs a live application and a state it can move from; MATCHED
// cannot be set without a pupil.
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));

const svc = require('../src/services/vehicleRegistration.service');

function makePool({ approval = 'PENDING_SCHOOL_REVIEW', app = 'SUBMITTED', unresolved = 0 } = {}) {
  const calls = [];
  const conn = {
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    query: jest.fn(async (sql, params) => {
      calls.push([sql, params]);
      if (/FROM inspection_application_schools aps/.test(sql)) return [[{ approval_status: approval, application_status: app }]];
      if (/COUNT\(\*\) AS unresolved/.test(sql)) return [[{ unresolved }]];
      return [{ affectedRows: 1 }];
    }),
  };
  return { pool: { getConnection: async () => conn, query: conn.query }, calls };
}
const wrote = (calls) => calls.some(([sql]) => /UPDATE inspection_application_schools/.test(sql));
const args = { applicationId: 4, schoolId: 'SCH1', userId: 5 };

test('approve on a cancelled application: 409, nothing written', async () => {
  const { pool, calls } = makePool({ app: 'CANCELLED' });
  await expect(svc.approveRegistration(pool, args)).rejects.toMatchObject({ statusCode: 409, errors: [expect.objectContaining({ code: 'APPLICATION_INACTIVE' })] });
  expect(wrote(calls)).toBe(false);
});

test('approve twice / after send-back: 409 stale', async () => {
  for (const approval of ['APPROVED', 'NEEDS_REVISION']) {
    const { pool, calls } = makePool({ approval });
    await expect(svc.approveRegistration(pool, args)).rejects.toMatchObject({ statusCode: 409, errors: [expect.objectContaining({ code: 'STALE_APPROVAL_STATUS' })] });
    expect(wrote(calls)).toBe(false);
  }
});

test('approve from pending on a live application still works', async () => {
  const { pool, calls } = makePool();
  await expect(svc.approveRegistration(pool, args)).resolves.toMatchObject({ approval_status: 'APPROVED' });
  expect(wrote(calls)).toBe(true);
});

test('send back works from pending or approved, not from an inactive application', async () => {
  for (const approval of ['PENDING_SCHOOL_REVIEW', 'APPROVED']) {
    const { pool } = makePool({ approval });
    await expect(svc.rejectRegistration(pool, { ...args, reason: 'แก้ชื่อ' })).resolves.toMatchObject({ approval_status: 'NEEDS_REVISION' });
  }
  const { pool } = makePool({ app: 'EXPIRED' });
  await expect(svc.rejectRegistration(pool, { ...args, reason: 'x' })).rejects.toMatchObject({ statusCode: 409 });
});

test('a bare MATCHED patch (no pupil) is refused', async () => {
  const { pool } = makePool();
  await expect(svc.patchRosterStudent(pool, { applicationId: 4, schoolId: 'SCH1', rosterId: 2, fields: { match_status: 'MATCHED' }, userId: 5 }))
    .rejects.toMatchObject({ statusCode: 400, errors: [expect.objectContaining({ code: 'MATCH_NEEDS_STUDENT' })] });
});
