'use strict';
// SB-B1-05: a failure while starting the check-in transaction must release
// the pooled connection (otherwise the pool slowly runs dry).
jest.mock('../src/services/term.service', () => ({ getCurrentTerm: jest.fn().mockResolvedValue('synthetic-term') }));
const service = require('../src/services/checkin.service');

test('correctTeacherCheckTime releases the connection when BEGIN fails', async () => {
  const err = Object.assign(new Error('synthetic connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
  const conn = {
    query: jest.fn().mockRejectedValue(err),
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
  };
  const pool = { getConnection: jest.fn().mockResolvedValue(conn), query: jest.fn() };
  await expect(service.correctTeacherCheckTime(pool, {
    userId: 1, schoolId: 'S1', logId: 5, time: '07:30',
  })).rejects.toBe(err);
  expect(conn.release).toHaveBeenCalledTimes(1);
});
