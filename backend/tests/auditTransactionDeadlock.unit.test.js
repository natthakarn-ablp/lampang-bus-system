'use strict';
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../src/config/database');
const { logAudit } = require('../src/utils/audit');
const opts = { userId: 1, action: 'CREATE', entityType: 'synthetic', entityId: 'fixture' };
const error = Object.assign(new Error('synthetic deadlock'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 });
let log;
beforeEach(() => { jest.clearAllMocks(); log = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => log.mockRestore());
test('transaction-scoped deadlock propagates instead of pretending business transaction remains valid', async () => {
  const conn = { query: jest.fn().mockRejectedValue(error) };
  await expect(logAudit({ ...opts, conn })).rejects.toBe(error);
});
test('detached audit failure preserves existing best-effort behavior', async () => {
  pool.query.mockRejectedValue(error);
  await expect(logAudit(opts)).resolves.toBeUndefined();
});
test('other audit failures preserve existing best-effort behavior', async () => {
  const conn = { query: jest.fn().mockRejectedValue(new Error('synthetic audit unavailable')) };
  await expect(logAudit({ ...opts, conn })).resolves.toBeUndefined();
});
