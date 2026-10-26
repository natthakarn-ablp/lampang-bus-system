'use strict';

/**
 * capacitySample.service.js — the server-side numbers Phase 9 asks the load
 * test to record (DB pool, slow queries, CPU/RAM/swap, LINE queue), sampled
 * cheaply enough to be polled under load. DB-free: the pool is a fake with
 * the same internals mysql2 exposes, and /proc/meminfo is a string.
 */

const svc = require('../src/services/capacitySample.service');

/** A fake mysql2 promise pool: `.pool` is the core pool with its three queues. */
function fakePool({ open = 3, free = 1, queued = 0, limit = 10, status = {}, vars = {}, notif = {}, fail = {} } = {}) {
  const core = {
    config: { connectionLimit: limit },
    _allConnections: { length: open },
    _freeConnections: { length: free },
    _connectionQueue: { length: queued },
  };
  return {
    pool: core,
    query: async (sql) => {
      if (/SHOW GLOBAL STATUS/.test(sql)) {
        if (fail.status) throw Object.assign(new Error('denied'), { code: 'ER_SPECIFIC_ACCESS_DENIED_ERROR' });
        const defaults = { Threads_connected: '5', Threads_running: '2', Slow_queries: '7', Max_used_connections: '12', Questions: '999', Uptime: '3600', Aborted_connects: '1' };
        return [Object.entries({ ...defaults, ...status }).map(([Variable_name, Value]) => ({ Variable_name, Value }))];
      }
      if (/SHOW VARIABLES/.test(sql)) {
        const defaults = { max_connections: '151', long_query_time: '10.000000', slow_query_log: 'OFF' };
        return [Object.entries({ ...defaults, ...vars }).map(([Variable_name, Value]) => ({ Variable_name, Value }))];
      }
      if (/FROM notifications/.test(sql)) {
        if (fail.notif) throw Object.assign(new Error('gone'), { code: 'ER_NO_SUCH_TABLE' });
        return [[{ pending: '4', exhausted: '1', oldest_pending_age_sec: 42, ...notif }]];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

describe('poolStats', () => {
  it('reads the three mysql2 queues and the configured limit', () => {
    expect(svc.poolStats(fakePool({ open: 10, free: 0, queued: 7, limit: 10 })))
      .toEqual({ limit: 10, open: 10, free: 0, in_use: 10, queued: 7, utilisation: 1 });
  });

  it('utilisation is in-use over the limit, not over open connections', () => {
    // 2 of 3 open connections busy is not "67% of the pool" when the pool can grow to 10.
    expect(svc.poolStats(fakePool({ open: 3, free: 1, limit: 10 })).utilisation).toBe(0.2);
  });

  it('degrades to an error object, not a throw, when the internals are missing', () => {
    expect(svc.poolStats({ query: async () => [[]] })).toEqual({ error: 'pool internals unavailable' });
    expect(svc.poolStats(null)).toEqual({ error: 'pool internals unavailable' });
  });
});

describe('dbServerStats', () => {
  it('parses SHOW STATUS / SHOW VARIABLES into numbers', async () => {
    const out = await svc.dbServerStats(fakePool({ status: { Slow_queries: '42' }, vars: { slow_query_log: 'ON', long_query_time: '1.500000' } }));
    expect(out).toEqual({
      threads_connected: 5, threads_running: 2, slow_queries: 42, slow_query_log: 'ON', long_query_time_sec: 1.5,
      max_used_connections: 12, max_connections: 151, questions: 999, aborted_connects: 1, uptime_sec: 3600,
    });
  });

  it('asks only for the named variables (no SHOW STATUS without a WHERE)', async () => {
    const seen = [];
    const pool = fakePool();
    const orig = pool.query;
    pool.query = async (sql, params) => { seen.push({ sql, params }); return orig(sql, params); };
    await svc.dbServerStats(pool);
    const status = seen.find((q) => /SHOW GLOBAL STATUS/.test(q.sql));
    expect(status.sql).toMatch(/WHERE Variable_name IN \(\?(, \?)*\)/);
    expect(status.params).toEqual(svc.STATUS_VARS);
  });

  it('reports the failure instead of failing the sample', async () => {
    expect(await svc.dbServerStats(fakePool({ fail: { status: true } })))
      .toEqual({ error: 'unavailable: ER_SPECIFIC_ACCESS_DENIED_ERROR' });
  });
});

describe('lineQueueStats', () => {
  it('counts what the dispatcher would still pick up, and what it has given up on', async () => {
    expect(await svc.lineQueueStats(fakePool())).toEqual({ pending: 4, exhausted: 1, oldest_pending_age_sec: 42 });
  });

  it('is zeros and null on an empty queue', async () => {
    expect(await svc.lineQueueStats(fakePool({ notif: { pending: null, exhausted: null, oldest_pending_age_sec: null } })))
      .toEqual({ pending: 0, exhausted: 0, oldest_pending_age_sec: null });
  });

  it('uses the dispatcher\'s own definition of pending (sent = FALSE AND retry_count < 3)', async () => {
    let sql = '';
    const pool = fakePool();
    const orig = pool.query;
    pool.query = async (q, p) => { if (/notifications/.test(q)) sql = q; return orig(q, p); };
    await svc.lineQueueStats(pool);
    expect(sql).toMatch(/sent = FALSE AND retry_count < 3/);
    expect(sql).toMatch(/retry_count >= 3/);
  });

  it('reports the failure instead of failing the sample', async () => {
    expect(await svc.lineQueueStats(fakePool({ fail: { notif: true } }))).toEqual({ error: 'unavailable: ER_NO_SUCH_TABLE' });
  });
});

describe('readMeminfo / hostStats', () => {
  const MEMINFO = [
    'MemTotal:       16303384 kB',
    'MemFree:         1206072 kB',
    'MemAvailable:   10485760 kB',
    'SwapTotal:       2097148 kB',
    'SwapFree:        1048574 kB',
    '',
  ].join('\n');

  it('parses the Linux meminfo fields it needs', () => {
    expect(svc.readMeminfo(() => MEMINFO)).toEqual({ mem_available_mb: 10240, swap_total_mb: 2048, swap_free_mb: 1024 });
  });

  it('returns null where /proc/meminfo cannot be read, and hostStats explains', () => {
    expect(svc.readMeminfo(() => { throw new Error('ENOENT'); })).toBeNull();
    const host = svc.hostStats(() => { throw new Error('ENOENT'); });
    expect(host.swap_used_mb).toBeNull();
    expect(host.swap_note).toMatch(/\/proc\/meminfo/);
    expect(typeof host.cpu_count).toBe('number');
    expect(host.mem_total_mb).toBeGreaterThan(0);
  });

  it('computes swap used from the two meminfo figures', () => {
    const host = svc.hostStats(() => MEMINFO);
    expect(host.swap_used_mb).toBe(1024);
    expect(host.mem_available_mb).toBe(10240);
    expect(host.swap_note).toBeNull();
  });
});

describe('computeCapacitySample', () => {
  it('assembles every section and never contains personal data', async () => {
    const s = await svc.computeCapacitySample(fakePool(), { readFile: () => { throw new Error('no proc'); } });
    expect(Object.keys(s).sort()).toEqual(['db_pool', 'db_server', 'host', 'line_queue', 'note', 'process', 'sampled_at', 'schema_version'].sort());
    expect(s.db_pool.limit).toBe(10);
    expect(s.db_server.slow_queries).toBe(7);
    expect(s.line_queue.pending).toBe(4);
    expect(s.process.rss_mb).toBeGreaterThan(0);
    expect(typeof s.process.cpu_user_ms).toBe('number');
    const text = JSON.stringify(s);
    for (const forbidden of ['line_user_id', 'student', 'phone', 'cid', 'username', 'message_json']) {
      expect(`contains ${forbidden}: ${text.includes(forbidden)}`).toBe(`contains ${forbidden}: false`);
    }
  });

  it('keeps the other sections when one of them fails', async () => {
    const s = await svc.computeCapacitySample(fakePool({ fail: { status: true } }));
    expect(s.db_server.error).toMatch(/unavailable/);
    expect(s.db_pool.limit).toBe(10);
    expect(s.line_queue.pending).toBe(4);
  });
});
