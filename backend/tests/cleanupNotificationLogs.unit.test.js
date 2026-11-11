'use strict';

// PERF-002 — DB-free checks of the opt-in notification/log retention script.
require('./loadTestEnv');
const s = require('../scripts/cleanup-notification-logs');

test('no default retention: both day counts are required', () => {
  expect(() => s.parseArgs([])).toThrow(/notifications-days=N is required/);
  expect(() => s.parseArgs(['--notifications-days=90'])).toThrow(/line-log-days=N is required/);
  expect(() => s.parseArgs(['--notifications-days=0', '--line-log-days=90'])).toThrow();
  expect(() => s.parseArgs(['--notifications-days=abc', '--line-log-days=90'])).toThrow();
});

test('dry-run unless --apply; batch is capped', () => {
  expect(s.parseArgs(['--notifications-days=90', '--line-log-days=30'])).toMatchObject({
    apply: false, notificationsDays: 90, lineLogDays: 30, batch: 1000, maxBatches: 50,
  });
  expect(s.parseArgs(['--notifications-days=90', '--line-log-days=30', '--apply']).apply).toBe(true);
  expect(() => s.parseArgs(['--notifications-days=90', '--line-log-days=30', '--batch=10000'])).toThrow(/1..5000/);
});

test('notifications predicate keeps pending, claimed and UNKNOWN rows', () => {
  const w = s.eligibleWhere(s.TARGETS.notifications, 90);
  expect(w).toMatch(/created_at < DATE_SUB\(NOW\(\), INTERVAL 90 DAY\)/);
  expect(w).toMatch(/created_at <= NOW\(\)/);
  expect(w).toMatch(/claim_token IS NULL/);
  expect(w).toMatch(/sent = TRUE OR \(retry_count >= 3 AND delivery_state IN \('FAILED','SKIPPED'\)\)/);
  expect(w).not.toMatch(/UNKNOWN/);
});

test('line_message_logs predicate is age only', () => {
  expect(s.eligibleWhere(s.TARGETS.line_message_logs, 30))
    .toBe('created_at < DATE_SUB(NOW(), INTERVAL 30 DAY) AND created_at <= NOW()');
});

test('days are validated before interpolation', () => {
  expect(() => s.eligibleWhere(s.TARGETS.line_message_logs, '1; DROP TABLE x')).toThrow();
});

test('dry-run never opens a write transaction', async () => {
  const db = {
    query: jest.fn().mockResolvedValue([[{ n: 5, oldest: null }]]),
    getConnection: jest.fn(),
  };
  const out = await s.run(db, { apply: false, notificationsDays: 90, lineLogDays: 30, batch: 10, maxBatches: 2 });
  expect(db.getConnection).not.toHaveBeenCalled();
  expect(out.map(o => [o.table, o.eligible, o.deleted])).toEqual([['notifications', 5, 0], ['line_message_logs', 5, 0]]);
});

test('apply stops at max-batches', async () => {
  const conn = {
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    query: jest.fn(async (sql) => (/^\s*SELECT/.test(sql)
      ? [[{ id: 1 }, { id: 2 }]] : [{ affectedRows: 2 }])),
  };
  const db = { query: jest.fn().mockResolvedValue([[{ n: 100, oldest: null }]]), getConnection: jest.fn().mockResolvedValue(conn) };
  const out = await s.run(db, { apply: true, notificationsDays: 90, lineLogDays: 30, batch: 2, maxBatches: 3, pauseMs: 0 });
  expect(out[0]).toMatchObject({ deleted: 6, batches: 3 });
  expect(out[1]).toMatchObject({ deleted: 6, batches: 3 });
  const deletes = conn.query.mock.calls.map(c => c[0]).filter(q => /^\s*DELETE/.test(q));
  expect(deletes.every(q => /AND created_at < DATE_SUB/.test(q))).toBe(true); // predicate re-checked
});
