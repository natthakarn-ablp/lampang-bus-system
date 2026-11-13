'use strict';

/**
 * ops-watch (backup log + /health → in-app admin alert, no LINE) and the
 * cron-ready daily snapshot. DB-free.
 */

require('./loadTestEnv');
const ops = require('../src/services/opsWatch.service');
const snap = require('../src/services/dailySnapshot.service');

const NOW = new Date('2026-11-13T05:00:00Z');
const LOG_OK = [
  '[backup-db] 2026-11-12T02:30:01+00:00 start  db=lampang_bus host=localhost:3306',
  '[backup-db] OK   /home/schoolbus/backups/lampang-bus/lampang_bus_20261112_023001.sql.gz (2.1M)',
  '[backup-db] 2026-11-12T02:30:09+00:00 done',
  '[backup-db] 2026-11-13T02:30:01+00:00 start  db=lampang_bus host=localhost:3306',
  '[backup-db] 2026-11-13T02:30:08+00:00 done',
].join('\n');

describe('evaluateBackupLog', () => {
  test('fresh completed run → OK', () => {
    expect(ops.evaluateBackupLog(LOG_OK, { now: NOW })).toMatchObject({ status: 'OK', ageHours: 2 });
  });
  test('last done older than 26 h → STALE', () => {
    const log = LOG_OK.split('\n').slice(0, 3).join('\n');
    expect(ops.evaluateBackupLog(log, { now: NOW }).status).toBe('STALE');
    expect(ops.evaluateBackupLog(log, { now: NOW, maxAgeHours: 30 }).status).toBe('OK');
  });
  test('ERROR after the last start → FAILED, even if an older run succeeded', () => {
    const log = `${LOG_OK.split('\n').slice(0, 4).join('\n')}\n[backup-db] ERROR: mysqldump pipeline failed`;
    expect(ops.evaluateBackupLog(log, { now: NOW })).toMatchObject({ status: 'FAILED', detail: '[backup-db] ERROR: mysqldump pipeline failed' });
  });
  test('started > 2 h ago and never finished → FAILED; still running → judged on the last done', () => {
    const log = `${LOG_OK.split('\n').slice(0, 3).join('\n')}\n[backup-db] 2026-11-13T02:30:01+00:00 start db=x`;
    expect(ops.evaluateBackupLog(log, { now: NOW }).status).toBe('FAILED');
    const running = new Date('2026-11-13T02:40:00Z');
    expect(ops.evaluateBackupLog(log, { now: running }).status).toBe('OK');
  });
  test('an ERROR before a later successful run does not count', () => {
    const log = `[backup-db] 2026-11-12T02:30:01+00:00 start\n[backup-db] ERROR: x\n${LOG_OK.split('\n').slice(3).join('\n')}`;
    expect(ops.evaluateBackupLog(log, { now: NOW }).status).toBe('OK');
  });
  test('no log / empty log → MISSING', () => {
    expect(ops.evaluateBackupLog(null, { now: NOW }).status).toBe('MISSING');
    expect(ops.evaluateBackupLog('hello', { now: NOW }).status).toBe('MISSING');
  });
});

describe('checkHealth', () => {
  const resp = (ok, status, body) => async () => ({ ok, status, json: async () => body });
  test('success + DB connected → OK', async () => {
    expect(await ops.checkHealth('u', resp(true, 200, { success: true, data: { database: { connected: true } } }))).toEqual({ status: 'OK' });
  });
  test('DB down / HTTP error / network error → FAILED', async () => {
    expect((await ops.checkHealth('u', resp(true, 200, { success: true, data: { database: { connected: false } } }))).status).toBe('FAILED');
    expect(await ops.checkHealth('u', resp(false, 502, null))).toEqual({ status: 'FAILED', detail: 'HTTP 502' });
    expect((await ops.checkHealth('u', async () => { const e = new Error('x'); e.code = 'ECONNREFUSED'; throw e; })).detail).toBe('ECONNREFUSED');
  });
});

describe('ops-watch runOnce', () => {
  function fakeDb(existing = []) {
    const calls = [];
    return {
      calls,
      query: jest.fn(async (sql, params) => {
        calls.push({ sql, params });
        if (/SELECT 1 FROM audit_logs/.test(sql)) return [existing.includes(params[1]) ? [{ 1: 1 }] : []];
        return [{ insertId: 1 }];
      }),
    };
  }
  const healthy = async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { database: { connected: true } } }) });
  const down = async () => ({ ok: false, status: 503, json: async () => null });

  test('all OK → no alert', async () => {
    const db = fakeDb();
    const r = await ops.runOnce({ db, now: NOW, readLog: () => LOG_OK, fetchImpl: healthy });
    expect(r.problems).toEqual([]);
    expect(db.calls.some((c) => /INSERT/.test(c.sql))).toBe(false);
  });

  test('stale backup + failed health → one admin alert each, keyed per Bangkok day', async () => {
    const db = fakeDb();
    const r = await ops.runOnce({ db, now: NOW, readLog: () => null, fetchImpl: down });
    expect(r.created.map((c) => c.key)).toEqual(['backup:MISSING:20261113', 'health:FAILED:20261113']);
    const inserts = db.calls.filter((c) => /INSERT INTO audit_logs/.test(c.sql));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].params[2]).toBe('ops_alert');
    expect(JSON.parse(inserts[0].params[5])).toMatchObject({ target_role: 'admin', kind: 'backup', status: 'MISSING' });
  });

  test('same problem again the same day → nothing new; dry-run writes nothing', async () => {
    const db = fakeDb(['health:FAILED:20261113']);
    const r = await ops.runOnce({ db, now: NOW, readLog: () => LOG_OK, fetchImpl: down });
    expect(r.created).toEqual([]);
    const db2 = fakeDb();
    const r2 = await ops.runOnce({ db: db2, now: NOW, dryRun: true, readLog: () => LOG_OK, fetchImpl: down });
    expect(r2.created).toHaveLength(1);
    expect(db2.calls.some((c) => /INSERT/.test(c.sql))).toBe(false);
  });
});

describe('daily snapshot (cron)', () => {
  function fakeDb({ existing = [] } = {}) {
    const calls = [];
    return {
      calls,
      query: jest.fn(async (sql, params) => {
        calls.push({ sql, params });
        if (/FROM daily_snapshots\s+WHERE snapshot_date = \?/.test(sql)) return [existing];
        if (/FROM students WHERE is_deleted = FALSE/.test(sql) && /with_vehicle/.test(sql)) return [[{ total: 10, with_vehicle: 7 }]];
        if (/FROM parent_student/.test(sql)) return [[{ cnt: 6 }]];
        if (/FROM vehicles WHERE is_deleted/.test(sql)) return [[{ total: 3, with_insurance: 2 }]];
        if (/vehicle_inspections/.test(sql)) return [[{ inspected: 2, passed: 1 }]];
        if (/m_total/.test(sql)) return [[{ m_total: 9, m_done: 8, e_total: 9, e_done: 7 }]];
        if (/FROM users WHERE is_deleted/.test(sql)) return [[{ total: 5, active: 4 }]];
        if (/emergency_logs/.test(sql)) return [[{ cnt: 0 }]];
        return [{ insertId: 1, affectedRows: 1 }];
      }),
    };
  }

  test('takes today\'s (Bangkok) snapshot as run_type auto and audits it', async () => {
    const db = fakeDb();
    // 2026-11-12 18:00 UTC = 2026-11-13 01:00 Bangkok
    const r = await snap.runDailySnapshot(db, { now: new Date('2026-11-12T18:00:00Z') });
    expect(r).toMatchObject({ status: 'CREATED', snapshotDate: '2026-11-13' });
    const ins = db.calls.find((c) => /REPLACE INTO daily_snapshots/.test(c.sql));
    expect(ins.params[0]).toBe('2026-11-13');
    expect(ins.params.slice(1, 15)).toEqual([10, 7, 6, 3, 2, 2, 1, 9, 8, 9, 7, 0, 4, 5]);
    expect(ins.params.slice(15)).toEqual([false, null, 'auto', null, null]);
    expect(db.calls.some((c) => /INSERT INTO audit_logs/.test(c.sql))).toBe(true);
  });

  test('a snapshot already taken that day (manual/baseline/auto) is never overwritten', async () => {
    const db = fakeDb({ existing: [{ id: 1, run_type: 'baseline' }] });
    const r = await snap.runDailySnapshot(db, { date: '2026-11-13' });
    expect(r).toEqual({ status: 'EXISTS', snapshotDate: '2026-11-13', existingRunType: 'baseline' });
    expect(db.calls.some((c) => /REPLACE INTO/.test(c.sql))).toBe(false);
  });

  test('dry-run computes but writes nothing', async () => {
    const db = fakeDb();
    const r = await snap.runDailySnapshot(db, { date: '2026-11-13', dryRun: true });
    expect(r.status).toBe('DRY_RUN');
    expect(r.metrics).toMatchObject({ total_students: 10, morning_done: 8 });
    expect(db.calls.some((c) => /REPLACE INTO|INSERT INTO/.test(c.sql))).toBe(false);
  });
});
