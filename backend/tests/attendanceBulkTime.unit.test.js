'use strict';
jest.mock('../src/services/checkin.service', () => ({ correctTeacherCheckTime: jest.fn() }));
jest.mock('../src/services/selfTravel.service', () => ({ correctSelfTravelTime: jest.fn() }));
const { correctTeacherCheckTime } = require('../src/services/checkin.service');
const { correctSelfTravelTime } = require('../src/services/selfTravel.service');
const { correctAttendanceTimes } = require('../src/services/attendanceBulkTime.service');
const entry = (id, kind = 'bus') => ({ id, kind, expected_at: '2026-11-17T01:00:00Z' });
let conn, pool;
const options = () => ({ schoolId: 'SCH1', gradeFilter: 'ป.4', userId: 7, session: 'morning', time: '08:00', entries: [entry(1), entry(2, 'self')] });
beforeEach(() => {
  jest.resetAllMocks();
  conn = { query: jest.fn().mockResolvedValue([[{ id: 1 }]]), beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
  pool = { getConnection: jest.fn().mockResolvedValue(conn) };
  correctTeacherCheckTime.mockResolvedValue({}); correctSelfTravelTime.mockResolvedValue({ unchanged: true });
});
test('one transaction delegates both event kinds with backend scope and snapshot', async () => {
  expect(await correctAttendanceTimes(pool, options())).toEqual({ updated: 1, unchanged: 1, total: 2 });
  expect(correctTeacherCheckTime).toHaveBeenCalledWith(pool, expect.objectContaining({ connection: conn, schoolId: 'SCH1', gradeFilter: 'ป.4', expectedAt: entry(1).expected_at, expectedSession: 'morning', logId: 1 }));
  expect(conn.query.mock.calls[1][1]).toEqual(['SCH1', expect.any(Array), [1], [2]]);
  expect(conn.commit).toHaveBeenCalledTimes(1); expect(conn.release).toHaveBeenCalledTimes(1);
});
test('failure of any row rolls back the whole batch', async () => {
  correctSelfTravelTime.mockRejectedValueOnce(Object.assign(new Error('stale'), { statusCode: 409 }));
  await expect(correctAttendanceTimes(pool, options())).rejects.toMatchObject({ statusCode: 409 });
  expect(conn.rollback).toHaveBeenCalledTimes(1); expect(conn.commit).not.toHaveBeenCalled(); expect(conn.release).toHaveBeenCalled();
});
test('empty authorized scope refuses without correcting any event', async () => {
  conn.query.mockResolvedValueOnce([]).mockResolvedValueOnce([[]]);
  await expect(correctAttendanceTimes(pool, options())).rejects.toMatchObject({ statusCode: 404 });
  expect(correctTeacherCheckTime).not.toHaveBeenCalled();
});
test.each([
  { entries: [] }, { entries: [entry(1), entry(1)] }, { entries: [entry('1')] },
  { entries: [{ ...entry(1), expected_at: 'bad' }] }, { entries: [entry(1, 'leave')] },
  { entries: Array.from({ length: 1001 }, (_, i) => entry(i + 1)) }, { session: 'both' }, { time: '24:00' },
])('invalid batch refused before acquiring DB', async invalid => {
  await expect(correctAttendanceTimes(pool, { ...options(), ...invalid })).rejects.toMatchObject({ statusCode: 400 });
  expect(pool.getConnection).not.toHaveBeenCalled();
});
