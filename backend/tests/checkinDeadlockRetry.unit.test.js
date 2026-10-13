'use strict';
jest.mock('../src/services/term.service', () => ({ getCurrentTerm: jest.fn().mockResolvedValue('synthetic-term') }));
const service = require('../src/services/checkin.service');
const params = { userId: 11, vehicleId: 'synthetic-vehicle', plateNo: 'synthetic-plate', session: 'evening' };
const deadlock = Object.assign(new Error('synthetic deadlock'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 });

function connection(base, failStudent = null, duplicated = false, checkout = false) {
  return {
    beginTransaction: jest.fn().mockResolvedValue(), commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(), release: jest.fn(),
    query: jest.fn(async (sql, values = []) => {
      if (/FROM\s+students/.test(sql)) return [[{ id: values[0], cid_hash: 'synthetic-hash', first_name: 'Synthetic', last_name: 'Fixture' }]];
      if (/SELECT id, status FROM checkin_logs/.test(sql)) return [duplicated || checkout ? [{ id: 77, status: 'CHECKED_IN' }] : []];
      if (/INSERT INTO checkin_logs/.test(sql)) {
        if (values[3] === failStudent) throw deadlock;
        return [{ insertId: base + values[3] }];
      }
      if (/FROM\s+parent_student/.test(sql)) return [[{ line_user_id: 'synthetic-parent' }]];
      return [{ affectedRows: 1 }];
    })
  };
}
function poolFor(first, second) {
  return { query: jest.fn().mockResolvedValue([[{ id: 1 }, { id: 2 }]]),
    getConnection: jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) };
}
test.each(['processCheckinAll', 'processCheckoutAll'])('%s discards earlier successes after entire-transaction deadlock', async method => {
  const checkout = method === 'processCheckoutAll';
  const first = connection(100, 2, false, checkout), second = connection(200, null, false, checkout);
  const pool = poolFor(first, second), result = await service[method](pool, params);
  expect(result.succeeded.map(r => r.log_id)).toEqual([201, 202]);
  expect(result.failed).toEqual([]);
  expect(first.commit).not.toHaveBeenCalled();
  expect(first.rollback).toHaveBeenCalledTimes(1);
  expect(second.commit).toHaveBeenCalledTimes(1);
  // Only the successful transaction commits the two queued notifications.
  expect(second.query.mock.calls.filter(([sql]) => /INSERT INTO notifications/.test(sql))).toHaveLength(2);
});
test('single-student deadlock retries and commits one notification/audit transaction', async () => {
  const first = connection(100, 1), second = connection(200);
  const result = await service.processCheckin(poolFor(first, second), { ...params, studentId: 1 });
  expect(result.log_id).toBe(201);
  expect(first.commit).not.toHaveBeenCalled();
  expect(second.query.mock.calls.filter(([sql]) => /INSERT INTO notifications/.test(sql))).toHaveLength(1);
  expect(second.query.mock.calls.filter(([sql]) => /INSERT INTO audit_logs/.test(sql))).toHaveLength(1);
});
test('a competing committed boarding is still rejected as duplicate on retry', async () => {
  const first = connection(100, 1), second = connection(200, null, true);
  const pool = poolFor(first, second);
  await expect(service.processCheckin(pool, { ...params, studentId: 1 })).rejects.toMatchObject({ statusCode: 409 });
  expect(pool.getConnection).toHaveBeenCalledTimes(2);
  expect(second.commit).not.toHaveBeenCalled();
});
test('failed savepoint rollback aborts batch instead of returning unverified successes', async () => {
  const conn = connection(100);
  conn.query.mockImplementation(async sql => {
    if (/INSERT INTO checkin_logs/.test(sql)) throw new Error('synthetic row failure');
    if (/ROLLBACK TO SAVEPOINT/.test(sql)) throw new Error('savepoint disappeared');
    if (/FROM\s+students/.test(sql)) return [[{ id: 1, first_name: 'Synthetic', last_name: 'Fixture' }]];
    if (/SELECT id, status/.test(sql)) return [[]];
    return [{}];
  });
  await expect(service.processCheckinAll(poolFor(conn), params)).rejects.toThrow('savepoint disappeared');
  expect(conn.commit).not.toHaveBeenCalled();
  expect(conn.rollback).toHaveBeenCalledTimes(1);
});
