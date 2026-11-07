'use strict';

// DRV-DAILY-OPS-07: the driver leave path (no gradeScope) must refuse a leave
// for a student already checked in, or who does not use the session, today.
const mockGetConnection = jest.fn();
jest.mock('../src/config/database', () => ({ pool: { getConnection: (...a) => mockGetConnection(...a) } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn() }));

const { createLeave } = require('../src/services/leave.service');
const { todayBangkok } = require('../src/utils/thaiTime');

function makeConn({ student, checked }) {
  const inserts = [];
  const conn = {
    query: jest.fn(async (sql) => {
      if (/FROM students/.test(sql)) return [[student]];
      if (/attendance_kind = 'SELF'/.test(sql)) return [[]];
      if (/FROM checkin_logs/.test(sql)) return [[checked]];
      if (/INSERT INTO student_leaves/.test(sql)) { inserts.push(sql); return [{ insertId: 9 }]; }
      return [[]];
    }),
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
  };
  conn.inserts = inserts;
  return conn;
}
const base = { studentId: 1, vehicleId: 'V-1', session: 'morning', reason: 'x', userId: 1, userRole: 'driver' };
const student = { id: 1, school_id: 's', grade: 'ป.1', morning_enabled: 1, evening_enabled: 1 };

describe('driver createLeave (no gradeScope)', () => {
  beforeEach(() => mockGetConnection.mockReset());

  test('409 when the student is already checked in today', async () => {
    const conn = makeConn({ student, checked: { status: 'CHECKED_IN' } });
    mockGetConnection.mockResolvedValue(conn);
    await expect(createLeave({ ...base, leaveDate: todayBangkok() })).rejects.toMatchObject({ statusCode: 409 });
    expect(conn.inserts).toHaveLength(0);
  });

  test('409 when the student does not use the session today', async () => {
    const conn = makeConn({ student: { ...student, morning_enabled: 0 }, checked: undefined });
    mockGetConnection.mockResolvedValue(conn);
    await expect(createLeave({ ...base, leaveDate: todayBangkok() })).rejects.toMatchObject({ statusCode: 409 });
    expect(conn.inserts).toHaveLength(0);
  });

  test('still allows a normal leave for a pending student', async () => {
    const conn = makeConn({ student, checked: undefined });
    mockGetConnection.mockResolvedValue(conn);
    await expect(createLeave({ ...base, leaveDate: todayBangkok() })).resolves.toMatchObject({ id: 9 });
  });
});
