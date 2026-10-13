'use strict';
const { withDeadlockRetry } = require('../src/utils/transactionRetry');
const deadlock = () => Object.assign(new Error('synthetic deadlock'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 });
const connection = () => ({ beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() });

test('confirmed deadlock retries the complete transaction on a released fresh connection', async () => {
  const first = connection(), second = connection();
  const pool = { getConnection: jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) };
  const begin = jest.fn(c => c.beginTransaction());
  const work = jest.fn().mockRejectedValueOnce(deadlock()).mockResolvedValueOnce({ id: 22 });
  await expect(withDeadlockRetry(pool, begin, work)).resolves.toEqual({ id: 22 });
  expect(first.rollback).toHaveBeenCalledTimes(1);
  expect(first.commit).not.toHaveBeenCalled();
  expect(first.release).toHaveBeenCalledTimes(1);
  expect(second.commit).toHaveBeenCalledTimes(1);
  expect(second.release).toHaveBeenCalledTimes(1);
  expect(begin).toHaveBeenCalledTimes(2);
});
test('persistent deadlocks stop after four attempts and never commit', async () => {
  const connections = Array.from({ length: 4 }, connection);
  const pool = { getConnection: jest.fn() };
  connections.forEach(c => pool.getConnection.mockResolvedValueOnce(c));
  await expect(withDeadlockRetry(pool, c => c.beginTransaction(), async () => { throw deadlock(); })).rejects.toMatchObject({ errno: 1213 });
  expect(pool.getConnection).toHaveBeenCalledTimes(4);
  connections.forEach(c => { expect(c.commit).not.toHaveBeenCalled(); expect(c.release).toHaveBeenCalledTimes(1); });
});
test.each(['ER_LOCK_WAIT_TIMEOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_NO_REFERENCED_ROW_2'])('does not replay %s', async code => {
  const conn = connection(), error = Object.assign(new Error('synthetic failure'), { code });
  const pool = { getConnection: jest.fn().mockResolvedValue(conn) };
  await expect(withDeadlockRetry(pool, c => c.beginTransaction(), async () => { throw error; })).rejects.toBe(error);
  expect(pool.getConnection).toHaveBeenCalledTimes(1);
  expect(conn.commit).not.toHaveBeenCalled();
  expect(conn.rollback).toHaveBeenCalledTimes(1);
  expect(conn.release).toHaveBeenCalledTimes(1);
});
test('begin failure releases the connection and preserves the error', async () => {
  const conn = connection(), error = new Error('synthetic setup failure');
  const pool = { getConnection: jest.fn().mockResolvedValue(conn) };
  await expect(withDeadlockRetry(pool, async () => { throw error; }, jest.fn())).rejects.toBe(error);
  expect(conn.release).toHaveBeenCalledTimes(1);
});
test('ambiguous commit failure is not replayed', async () => {
  const conn = connection(), error = Object.assign(new Error('unknown commit outcome'), { code: 'PROTOCOL_CONNECTION_LOST' });
  conn.commit.mockRejectedValue(error);
  const pool = { getConnection: jest.fn().mockResolvedValue(conn) }, work = jest.fn().mockResolvedValue({ id: 1 });
  await expect(withDeadlockRetry(pool, c => c.beginTransaction(), work)).rejects.toBe(error);
  expect(work).toHaveBeenCalledTimes(1);
});
