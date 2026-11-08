'use strict';

// M1 parent leave via LINE (parent audit 2026-11-08, owner-approved).
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));
jest.mock('../src/config/env', () => ({
  features: {
    parentLeave: true, parentLeaveMorningCutoff: '06:00', parentLeaveEveningCutoff: '14:00',
    parentLeaveMaxDaysAhead: 14,
  },
}));

const { pool } = require('../src/config/database');
const { logAudit } = require('../src/utils/audit');
const svc = require('../src/services/parentLeave.service');

// Bangkok wall clock -> instant.
const at = (bkk) => new Date(`${bkk}+07:00`);

function makeConn({ student = { id: 7, vehicle_id: 'V-1', morning_enabled: 1, evening_enabled: 1 }, overlap = null, checked = null } = {}) {
  const conn = {
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    query: jest.fn(async (sql) => {
      if (/FROM students/.test(sql)) return [[student].filter(Boolean)];
      if (/FROM student_leaves/.test(sql)) return [[overlap].filter(Boolean)];
      if (/FROM checkin_logs/.test(sql)) return [[checked].filter(Boolean)];
      if (/INSERT INTO student_leaves/.test(sql)) return [{ insertId: 55 }];
      return [[]];
    }),
  };
  pool.getConnection.mockResolvedValue(conn);
  return conn;
}

beforeEach(() => { jest.clearAllMocks(); pool.query.mockReset(); });

describe('createParentLeave', () => {
  const base = { lineUserId: 'U_p', studentId: 7, session: 'morning' };

  test('writes a parent row for a future day, audited', async () => {
    const conn = makeConn();
    const r = await svc.createParentLeave({ ...base, leaveDate: '2026-11-10', reason: ' ไม่สบาย ' }, at('2026-11-09T20:00:00'));
    expect(r).toEqual({ id: 55, student_id: 7, leave_date: '2026-11-10', session: 'morning' });
    const ins = conn.query.mock.calls.find(c => /INSERT INTO student_leaves/.test(c[0]));
    expect(ins[0]).toMatch(/NULL, 'parent', \?/);
    expect(ins[1]).toEqual([7, 'V-1', '2026-11-10', 'morning', 'ไม่สบาย', 'U_p', 1, 1]);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', entityType: 'leave', required: true }));
    expect(conn.commit).toHaveBeenCalled();
  });

  test('same-day morning before 06:00 is accepted, from 06:00 refused', async () => {
    makeConn();
    await expect(svc.createParentLeave({ ...base, leaveDate: '2026-11-09' }, at('2026-11-09T05:59:00'))).resolves.toBeTruthy();
    await expect(svc.createParentLeave({ ...base, leaveDate: '2026-11-09' }, at('2026-11-09T06:00:00')))
      .rejects.toMatchObject({ statusCode: 409, code: 'PARENT_LEAVE_CUTOFF' });
  });

  test('same-day evening allowed until 14:00; both follows the morning cut-off', async () => {
    makeConn();
    await expect(svc.createParentLeave({ ...base, session: 'evening', leaveDate: '2026-11-09' }, at('2026-11-09T13:59:00'))).resolves.toBeTruthy();
    await expect(svc.createParentLeave({ ...base, session: 'evening', leaveDate: '2026-11-09' }, at('2026-11-09T14:00:00'))).rejects.toMatchObject({ statusCode: 409 });
    await expect(svc.createParentLeave({ ...base, session: 'both', leaveDate: '2026-11-09' }, at('2026-11-09T07:00:00'))).rejects.toMatchObject({ statusCode: 409 });
  });

  test('past date, beyond 14 days, bad session are 400', async () => {
    makeConn();
    const now = at('2026-11-09T05:00:00');
    await expect(svc.createParentLeave({ ...base, leaveDate: '2026-11-08' }, now)).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.createParentLeave({ ...base, leaveDate: '2026-11-24' }, now)).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.createParentLeave({ ...base, leaveDate: '2026-11-23' }, now)).resolves.toBeTruthy();
    await expect(svc.createParentLeave({ ...base, session: 'x', leaveDate: '2026-11-10' }, now)).rejects.toMatchObject({ statusCode: 400 });
  });

  test('no vehicle, round not used, overlap, already checked are 409 and roll back', async () => {
    const now = at('2026-11-09T05:00:00');
    const conn = makeConn({ student: { id: 7, vehicle_id: null, morning_enabled: 1, evening_enabled: 1 } });
    await expect(svc.createParentLeave({ ...base, leaveDate: '2026-11-10' }, now)).rejects.toMatchObject({ statusCode: 409 });
    expect(conn.rollback).toHaveBeenCalled();
    makeConn({ student: { id: 7, vehicle_id: 'V-1', morning_enabled: 0, evening_enabled: 1 } });
    await expect(svc.createParentLeave({ ...base, leaveDate: '2026-11-10' }, now)).rejects.toMatchObject({ statusCode: 409 });
    makeConn({ overlap: { id: 1 } });
    await expect(svc.createParentLeave({ ...base, leaveDate: '2026-11-10' }, now)).rejects.toMatchObject({ statusCode: 409 });
    makeConn({ checked: { id: 9 } });
    await expect(svc.createParentLeave({ ...base, leaveDate: '2026-11-09' }, now)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('cancelParentLeave', () => {
  test('only this LINE account, before the cut-off', async () => {
    pool.query.mockImplementation(async (sql, params) => {
      if (/SELECT id, student_id/.test(sql)) {
        return [params[1] === 'U_p' ? [{ id: 3, student_id: 7, leave_date: '2026-11-09', session: 'evening' }] : []];
      }
      return [{ affectedRows: 1 }];
    });
    await expect(svc.cancelParentLeave({ lineUserId: 'U_other', leaveId: 3 }, at('2026-11-09T10:00:00'))).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.cancelParentLeave({ lineUserId: 'U_p', leaveId: 3 }, at('2026-11-09T14:30:00'))).rejects.toMatchObject({ statusCode: 409 });
    await expect(svc.cancelParentLeave({ lineUserId: 'U_p', leaveId: 3 }, at('2026-11-09T10:00:00'))).resolves.toEqual({ id: 3, cancelled: true });
    expect(pool.query.mock.calls[0][0]).toMatch(/reported_role = 'parent' AND reported_line_user_id = \?/);
  });
});

describe('listParentLeaves', () => {
  test('marks own rows and cancellability; never returns another LINE id', async () => {
    pool.query.mockResolvedValue([[
      { id: 1, leave_date: '2026-11-09', session: 'morning', attendance_kind: 'LEAVE', reason: null, reported_role: 'parent', reported_line_user_id: 'U_p' },
      { id: 2, leave_date: '2026-11-10', session: 'evening', attendance_kind: 'LEAVE', reason: null, reported_role: 'parent', reported_line_user_id: 'U_other' },
      { id: 3, leave_date: '2026-11-11', session: 'both', attendance_kind: 'SELF', reason: null, reported_role: 'school', reported_line_user_id: null },
      { id: 4, leave_date: '2026-11-12', session: 'evening', attendance_kind: 'LEAVE', reason: null, reported_role: 'parent', reported_line_user_id: 'U_p' },
    ]]);
    const out = await svc.listParentLeaves({ lineUserId: 'U_p', studentId: 7 }, at('2026-11-09T07:00:00'));
    expect(out.map(l => [l.id, l.reported_by, l.can_cancel, l.kind])).toEqual([
      [1, 'me', false, 'LEAVE'], [2, 'parent', false, 'LEAVE'], [3, 'school', false, 'SELF'], [4, 'me', true, 'LEAVE'],
    ]);
    expect(JSON.stringify(out)).not.toContain('U_other');
  });
});
