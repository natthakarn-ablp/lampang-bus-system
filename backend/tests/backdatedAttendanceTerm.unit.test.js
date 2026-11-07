'use strict';

// A backdated check must carry the term of the day being recorded, not the
// term of today (they differ across a term boundary).
jest.mock('../src/services/term.service', () => {
  const actual = jest.requireActual('../src/services/term.service');
  return { ...actual, getCurrentTerm: jest.fn(async () => '2569-2') };
});
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn(async () => {}) }));

const { recordBackdatedCheck } = require('../src/services/backdatedAttendance.service');

test('backdated row carries the term of the recorded day, not of today', async () => {
  const inserts = [];
  const conn = {
    query: jest.fn(async (sql, params) => {
      if (/FROM students s/.test(sql)) {
        return [[{ id: 5, school_id: 1, grade: 'ป.1', vehicle_id: 3, cid_hash: 'h',
          first_name: 'ก', last_name: 'ข', morning_enabled: 1, evening_enabled: 1,
          is_deleted: 0, plate_no: 'x' }]];
      }
      if (/INSERT INTO checkin_logs/.test(sql)) { inserts.push(params); return [{ insertId: 11 }]; }
      if (/FROM student_leaves|FROM checkin_logs|FROM daily_status/.test(sql)) return [[]];
      return [{}];
    }),
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
  };
  const pool = {
    getConnection: jest.fn(async () => conn),
    // term lookup by date: the recorded day (2026-10-10) falls in term 2569-1
    query: jest.fn(async () => [[{ id: '2569-1' }]]),
  };
  await recordBackdatedCheck(pool, {
    userId: 1, schoolId: 1, studentId: 5, checkDate: '2026-10-10', session: 'morning',
    status: 'CHECKED_IN', time: '07:15', reason: 'audit', now: new Date('2026-10-14T03:00:00Z'),
  });
  expect(inserts).toHaveLength(1);
  expect(inserts[0][0]).toBe('2569-1');
});
