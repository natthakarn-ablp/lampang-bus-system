'use strict';

jest.mock('../src/config/database', () => ({ pool: {} }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));

const svc = require('../src/services/school.service');

function makeDb({ applied }) {
  const calls = [];
  const conn = {
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
    query: jest.fn(async (sql) => {
      calls.push(sql);
      if (/FROM students s\s+WHERE s\.id = \?/.test(sql)) {
        return [[{ id: 5, student_code: 'C1', first_name: 'a', last_name: 'b', grade: 'ป.5', classroom: '1', is_deleted: 1 }]];
      }
      if (/student_transfer_requests/.test(sql)) return [applied ? [{ id: 9 }] : []];
      if (/^\s*UPDATE students/.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    }),
  };
  return { db: { getConnection: async () => conn, query: jest.fn(async () => [[]]) }, conn, calls };
}

test('a pupil transferred out (APPLIED) cannot be restored at the source school', async () => {
  const { db, conn, calls } = makeDb({ applied: true });
  await expect(
    svc.restoreStudent(db, { schoolId: 'S1', studentId: 5, actorId: 1 })
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(calls.some((s) => /^\s*UPDATE students/.test(s))).toBe(false);
  expect(conn.rollback).toHaveBeenCalled();
});

test('a withdrawn pupil with no applied transfer is still restored', async () => {
  const { db } = makeDb({ applied: false });
  const r = await svc.restoreStudent(db, { schoolId: 'S1', studentId: 5, actorId: 1 });
  expect(r.status).not.toBe('ALREADY_ACTIVE');
});

test('searchDeletedStudents hides pupils closed by an applied transfer', async () => {
  const db = { query: jest.fn(async () => [[]]) };
  await svc.searchDeletedStudents(db, { schoolId: 'S1', q: 'ab' });
  expect(db.query.mock.calls[0][0]).toMatch(/student_transfer_requests[\s\S]*APPLIED/);
});
