'use strict';

/**
 * Unit tests for cleanup-old-logs.js (automated log retention). DB-free.
 * Focus: the future-safe cutoff clause, archive-then-delete in a transaction,
 * daily_status hard-delete (no archive), and dry-run never mutating.
 */

require('./loadTestEnv');
const svc = require('../scripts/cleanup-old-logs');

const T_AUDIT = svc.TABLES.find((t) => t.table === 'audit_logs');
const T_DAILY = svc.TABLES.find((t) => t.table === 'daily_status');

describe('eligibleWhere (future-safe cutoff)', () => {
  test('audit_logs: DATE_SUB(NOW()) window AND never future-dated rows', () => {
    const w = svc.eligibleWhere(T_AUDIT, 365);
    expect(w).toMatch(/created_at < DATE_SUB\(NOW\(\), INTERVAL 365 DAY\)/);
    expect(w).toMatch(/created_at <= NOW\(\)/);
  });
  test('daily_status compares the DATE column to CURDATE()', () => {
    expect(svc.eligibleWhere(T_DAILY, 30)).toMatch(/check_date <= CURDATE\(\)/);
  });
});

function makeConn(handler) {
  const calls = [];
  return {
    calls,
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
    query: jest.fn(async (sql, p) => { calls.push([sql, p]); return handler(sql, p); }),
  };
}
const poolOf = (conn) => ({ getConnection: jest.fn().mockResolvedValue(conn) });

describe('purgeBatch', () => {
  test('archives then deletes one batch atomically (audit_logs)', async () => {
    const conn = makeConn((sql) => (/SELECT id FROM/.test(sql) ? [[{ id: 1 }, { id: 2 }]] : [{ affectedRows: 2 }]));
    const n = await svc.purgeBatch(poolOf(conn), T_AUDIT, 365, 5000);
    expect(n).toBe(2);
    expect(conn.calls.some(([s]) => /INSERT IGNORE INTO audit_logs_archive/.test(s))).toBe(true);
    expect(conn.calls.some(([s]) => /DELETE FROM audit_logs/.test(s))).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
  });

  test('daily_status has NO archive step — hard delete', async () => {
    const conn = makeConn((sql) => (/SELECT id FROM/.test(sql) ? [[{ id: 9 }]] : [{ affectedRows: 1 }]));
    const n = await svc.purgeBatch(poolOf(conn), T_DAILY, 30, 5000);
    expect(n).toBe(1);
    expect(conn.calls.some(([s]) => /INSERT IGNORE/.test(s))).toBe(false);
    expect(conn.calls.some(([s]) => /DELETE FROM daily_status/.test(s))).toBe(true);
  });

  test('empty batch → 0, commits, never deletes', async () => {
    const conn = makeConn(() => [[]]);
    const n = await svc.purgeBatch(poolOf(conn), T_AUDIT, 365, 5000);
    expect(n).toBe(0);
    expect(conn.calls.some(([s]) => /DELETE FROM/.test(s))).toBe(false);
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('runRetention', () => {
  test('dry-run counts only — never opens a transaction', async () => {
    const pool = {
      query: jest.fn(async () => [[{ n: 7 }]]),
      getConnection: jest.fn(() => { throw new Error('must not getConnection in dry-run'); }),
    };
    const summary = await svc.runRetention(pool, {
      apply: false, batch: 5000, days: { audit_logs: 365, checkin_logs: 730, daily_status: 30 },
    });
    expect(summary).toHaveLength(3);
    expect(summary.every((s) => s.eligible === 7 && s.deleted === 0)).toBe(true);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  test('apply purges each table (archive only where configured)', async () => {
    const conn = makeConn((sql) => (/SELECT id FROM/.test(sql) ? [[{ id: 1 }]] : [{ affectedRows: 1 }]));
    const pool = { query: jest.fn(async () => [[{ n: 1 }]]), getConnection: jest.fn().mockResolvedValue(conn) };
    const summary = await svc.runRetention(pool, {
      apply: true, batch: 5000, days: { audit_logs: 1, checkin_logs: 1, daily_status: 1 },
    });
    expect(summary.find((s) => s.table === 'audit_logs')).toMatchObject({ deleted: 1, archived: 1 });
    expect(summary.find((s) => s.table === 'daily_status')).toMatchObject({ deleted: 1, archived: 0 });
  });
});
