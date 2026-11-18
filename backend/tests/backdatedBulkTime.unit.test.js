'use strict';
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));
const { correctTeacherCheckTime } = require('../src/services/checkin.service');
const { correctSelfTravelTime } = require('../src/services/selfTravel.service');
const { logAudit } = require('../src/utils/audit');
let conn, pool;
const options = () => ({ schoolId: 'SCH1', gradeFilter: 'ป.4', userId: 7, time: '08:15', checkDate: '2026-11-17', expectedSession: 'morning', expectedAt: '2026-11-17T01:00:00Z' });
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-18T00:00:00Z'));
  jest.clearAllMocks();
  conn = { query: jest.fn(async (sql) => {
    if (sql.includes('SELECT student_id')) return [[{ student_id: 1 }]];
    if (sql.includes('FROM students')) return [[{ id: 1 }]];
    if (sql.includes('FROM checkin_logs WHERE id = ? FOR UPDATE')) return [[{ id: 10, student_id: 1, check_date: '2026-11-17', session: 'morning', status: 'CHECKED_OUT', checked_at: new Date('2026-11-17T01:00:00Z'), old_time: '08:00', old_local: '2026-11-17 08:00:00', is_today: 0 }]];
    if (sql.includes('FROM student_leaves WHERE id')) return [[{ id: 20, student_id: 1, leave_date: '2026-11-17', session: 'morning', created_at: new Date('2026-11-17T01:00:00Z'), old_time: '08:00', old_local: '2026-11-17 08:00:00' }]];
    if (sql.includes('CURTIME')) return [[{ now_hm: '07:00' }]];
    if (sql.includes('ORDER BY id DESC')) return [[{ id: 10 }]];
    return [[]];
  }), beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
  pool = { getConnection: jest.fn().mockResolvedValue(conn) };
});
afterEach(() => jest.useRealTimers());
test('past bus time can exceed current clock; updates selected historical day and audit only', async () => {
  await correctTeacherCheckTime(pool, { ...options(), logId: 10 });
  const writes = conn.query.mock.calls.filter(([sql]) => /UPDATE/.test(sql) && !/FOR UPDATE/.test(sql));
  expect(writes).toEqual(expect.arrayContaining([
    [expect.stringContaining('UPDATE checkin_logs'), ['2026-11-17 08:15:00', 10]],
    [expect.stringContaining('UPDATE daily_status'), ['2026-11-17 08:15:00', '2026-11-17', 1]],
  ]));
  expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ required: true, entityType: 'checkin_time' }));
  expect(conn.commit).toHaveBeenCalledTimes(1);
});
test('omitting past date preserves today-only bus restriction', async () => {
  await expect(correctTeacherCheckTime(pool, { ...options(), checkDate: null, logId: 10 })).rejects.toMatchObject({ statusCode: 409 });
  expect(conn.commit).not.toHaveBeenCalled();
});
test('bus date mismatch and stale snapshot are refused', async () => {
  for (const change of [{ checkDate: '2026-11-16' }, { expectedAt: '2026-11-17T02:00:00Z' }]) {
    await expect(correctTeacherCheckTime(pool, { ...options(), ...change, logId: 10 })).rejects.toMatchObject({ statusCode: 409 });
  }
  expect(logAudit).not.toHaveBeenCalled();
});
test('past SELF correction preserves record date/kind and audits', async () => {
  await correctSelfTravelTime(pool, { ...options(), id: 20 });
  expect(conn.query).toHaveBeenCalledWith(expect.stringContaining("leave_date = ? FOR UPDATE"), [20, 1, '2026-11-17']);
  expect(conn.query).toHaveBeenCalledWith('UPDATE student_leaves SET created_at = ? WHERE id = ?', ['2026-11-17 08:15:00', 20]);
  expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'self_travel_time' }));
});
test.each(['2026-11-18', '2026-11-19', '2026-11-10', '', 'bad'])('invalid past date %s denied before connection', async checkDate => {
  await expect(correctTeacherCheckTime(pool, { ...options(), checkDate, logId: 10 })).rejects.toMatchObject({ statusCode: 400 });
  await expect(correctSelfTravelTime(pool, { ...options(), checkDate, id: 20 })).rejects.toMatchObject({ statusCode: 400 });
  expect(pool.getConnection).not.toHaveBeenCalled();
});
