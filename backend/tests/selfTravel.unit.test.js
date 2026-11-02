'use strict';
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn() }));
jest.mock('node:fs', () => ({ existsSync: jest.fn(() => false) }));
const { existsSync } = require('node:fs');
const { logAudit } = require('../src/utils/audit');
const { recordSelfTravel, undoSelfTravel } = require('../src/services/selfTravel.service');
let conn, pool, pupil, log, exception;
const input = { studentId: 12, session: 'morning', schoolId: 'SCH1', gradeFilter: 'ป.5', userId: 7 };
beforeEach(() => {
  jest.clearAllMocks();
  existsSync.mockReturnValue(false);
  pupil = { id: 12, vehicle_id: 'V1', morning_enabled: 1, evening_enabled: 1 };
  log = null; exception = null;
  logAudit.mockResolvedValue();
  conn = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    query: jest.fn(async sql => {
      if (sql.includes('FROM students')) return [[pupil].filter(Boolean)];
      if (sql.includes('FROM checkin_logs')) return [[log].filter(Boolean)];
      if (sql.includes('FROM student_leaves')) return [[exception].filter(Boolean)];
      if (sql.includes('INSERT INTO student_leaves')) return [{ insertId: 9 }];
      return [[]];
    }) };
  pool = { getConnection: jest.fn(async () => conn) };
});
test.each(['morning', 'evening'])('records independent %s travel with required transactional audit', async session => {
  expect(await recordSelfTravel(pool, { ...input, session })).toMatchObject({ attendance_kind: 'SELF', session });
  expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ conn, required: true,
    newValue: expect.objectContaining({ session, school_id: 'SCH1' }) }));
  expect(conn.commit).toHaveBeenCalledTimes(1);
  expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO (checkin_logs|daily_status)/.test(sql))).toBe(false);
  expect(conn.release).toHaveBeenCalledTimes(1);
});
test('locks pupil within authenticated school and equivalent grades', async () => {
  await recordSelfTravel(pool, input);
  const [sql, args] = conn.query.mock.calls.find(([sql]) => sql.includes('FROM students'));
  expect(sql).toMatch(/school_id = .*grade IN.*FOR UPDATE/s);
  expect(args.slice(0, 2)).toEqual([12, 'SCH1']);
  expect(args[2]).toContain('ป.5');
});
test('scope loss while waiting for the lock denies without writing', async () => {
  pupil = null;
  await expect(recordSelfTravel(pool, input)).rejects.toMatchObject({ statusCode: 404 });
  expect(conn.query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(false);
  expect(conn.rollback).toHaveBeenCalled();
});
test.each(['CHECKED_IN', 'CHECKED_OUT'])('cannot replace %s bus evidence', async status => {
  log = { status };
  await expect(recordSelfTravel(pool, input)).rejects.toMatchObject({ statusCode: 409 });
  expect(conn.commit).not.toHaveBeenCalled();
});
test.each(['SELF', 'LEAVE'])('cannot overlap existing %s including both-session exclusion', async attendance_kind => {
  exception = { id: 1, attendance_kind };
  await expect(recordSelfTravel(pool, input)).rejects.toMatchObject({ statusCode: 409 });
  expect(conn.query.mock.calls.find(([sql]) => sql.includes('FROM student_leaves'))[0]).toContain("'both'");
});
test('audit failure rolls back instead of publishing unaudited state', async () => {
  logAudit.mockRejectedValue(new Error('audit unavailable'));
  await expect(recordSelfTravel(pool, input)).rejects.toThrow('audit unavailable');
  expect(conn.rollback).toHaveBeenCalled();
  expect(conn.commit).not.toHaveBeenCalled();
});
test.each([{ session: 'both' }, { studentId: '12' }, { schoolId: null }, { userId: null }])('rejects invalid input before DB acquisition %j', async invalid => {
  await expect(recordSelfTravel(pool, { ...input, ...invalid })).rejects.toMatchObject({ statusCode: 400 });
  expect(pool.getConnection).not.toHaveBeenCalled();
});
test('deployment lock rejects the first SELF write before obtaining a DB connection', async () => {
  existsSync.mockReturnValue(true);
  await expect(recordSelfTravel(pool, input)).rejects.toMatchObject({ statusCode: 503 });
  expect(pool.getConnection).not.toHaveBeenCalled();
});
describe('undo independent travel', () => {
  const undo = { id: 9, schoolId: 'SCH1', gradeFilter: 'ป.5', userId: 7 };
  beforeEach(() => {
    conn.query.mockImplementation(async sql => {
      if (sql.includes('SELECT student_id')) return [[{ student_id: 12 }]];
      if (sql.includes('FROM students')) return [[pupil].filter(Boolean)];
      if (sql.includes('SELECT id, reported_by')) return [[{ id: 9, reported_by: 7 }]];
      return [[]];
    });
  });
  test('requires own-school lock and transactional audit for cancellation', async () => {
    await expect(undoSelfTravel(pool, undo)).resolves.toEqual({ id: 9, cancelled: true });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ conn, required: true, action: 'UPDATE' }));
    const locked = conn.query.mock.calls.find(([sql]) => sql.includes('FROM students'));
    expect(locked[0]).toMatch(/school_id = .*grade IN.*FOR UPDATE/s);
    expect(locked[1].slice(0, 2)).toEqual([12, 'SCH1']);
  });
  test('grade teacher cannot cancel another actor record', async () => {
    await expect(undoSelfTravel(pool, { ...undo, userId: 8 })).rejects.toMatchObject({ statusCode: 404 });
    expect(conn.commit).not.toHaveBeenCalled();
  });
  test('missing current scope rolls back without cancellation', async () => {
    pupil = null;
    await expect(undoSelfTravel(pool, undo)).rejects.toMatchObject({ statusCode: 404 });
    expect(conn.query.mock.calls.some(([sql]) => sql.includes('UPDATE student_leaves'))).toBe(false);
  });
  test('audit failure rolls back cancellation', async () => {
    logAudit.mockRejectedValue(new Error('audit unavailable'));
    await expect(undoSelfTravel(pool, undo)).rejects.toThrow('audit unavailable');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });
});
