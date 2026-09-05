'use strict';

/**
 * One cheap, PII-free sample of the server-side numbers the closure plan's
 * Phase 9 asks a load test to record, and that a load-test client cannot see
 * from outside: DB pool utilisation and slow queries, CPU/RAM/swap, and the
 * LINE notification queue depth (master-project-closure-plan.md, Phase 9:
 * "เก็บ p50/p95/p99, throughput, error, DB pool/slow query, CPU/RAM/swap,
 * event-loop lag และ LINE queue").
 *
 * Served by GET /api/admin/operations/capacity-sample and polled by
 * backend/scripts/load-test.js every few seconds during a run. It has to stay
 * cheap because it is called *while the system is under load*: one SHOW
 * STATUS, one SHOW VARIABLES, one indexed COUNT, and in-process counters.
 * Nothing here scans a business table, and nothing here is personal data.
 *
 * Each section is computed independently and degrades to `{ error }` rather
 * than failing the whole sample — a host without /proc (this is read on the
 * Linux server, developed on Windows) still reports the pool and the queue.
 *
 * Not the same thing as operationsHealth.service.js: that one runs a dozen
 * integrity COUNTs and hashes the latest backup, which is exactly what must
 * not run every five seconds under load.
 */

const os = require('os');
const fs = require('fs');

const MB = 1024 * 1024;
const round1 = (n) => Math.round(n * 10) / 10;

/** The mysql2 promise wrapper keeps the core pool at `.pool`; both carry the queues. */
function corePool(pool) {
  return pool && pool.pool && pool.pool._allConnections ? pool.pool : pool;
}

/**
 * mysql2 keeps three queues on the core pool: every open connection, the idle
 * ones, and callers waiting for one. `queued > 0` is the signal the local
 * load test could only infer from the shape of the p95 curve
 * (docs/performance/load-test-local-2026-09-05.md §2.1).
 */
function poolStats(pool) {
  const p = corePool(pool);
  const limit = Number(p && p.config && (p.config.connectionLimit ?? (p.config.config && p.config.config.connectionLimit)));
  const open = p && p._allConnections ? p._allConnections.length : null;
  const free = p && p._freeConnections ? p._freeConnections.length : null;
  const queued = p && p._connectionQueue ? p._connectionQueue.length : null;
  if (open == null || free == null) return { error: 'pool internals unavailable' };
  const inUse = open - free;
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : null,
    open,
    free,
    in_use: inUse,
    queued,
    // Share of the configured limit that is busy right now. 1.0 with queued > 0
    // is saturation; the request is waiting in mysql2, not in MySQL.
    utilisation: Number.isFinite(limit) && limit > 0 ? Math.round((inUse / limit) * 1000) / 1000 : null,
  };
}

const STATUS_VARS = ['Threads_connected', 'Threads_running', 'Slow_queries', 'Max_used_connections', 'Questions', 'Uptime', 'Aborted_connects'];

async function dbServerStats(pool) {
  try {
    const placeholders = STATUS_VARS.map(() => '?').join(', ');
    const [status] = await pool.query(`SHOW GLOBAL STATUS WHERE Variable_name IN (${placeholders})`, STATUS_VARS);
    const [vars] = await pool.query("SHOW VARIABLES WHERE Variable_name IN ('max_connections', 'long_query_time', 'slow_query_log')");
    const s = {};
    for (const row of status) s[String(row.Variable_name).toLowerCase()] = row.Value;
    const v = {};
    for (const row of vars) v[String(row.Variable_name).toLowerCase()] = row.Value;
    return {
      threads_connected: Number(s.threads_connected),
      threads_running: Number(s.threads_running),
      // Cumulative since server start; the load test reports the delta over a stage.
      slow_queries: Number(s.slow_queries),
      slow_query_log: v.slow_query_log || null,
      long_query_time_sec: v.long_query_time != null ? Number(v.long_query_time) : null,
      max_used_connections: Number(s.max_used_connections),
      max_connections: v.max_connections != null ? Number(v.max_connections) : null,
      questions: Number(s.questions),
      aborted_connects: Number(s.aborted_connects),
      uptime_sec: Number(s.uptime),
    };
  } catch (err) {
    return { error: `unavailable: ${err.code || err.message}` };
  }
}

/**
 * The LINE dispatcher (line.service.js processUnsentNotifications) drains
 * rows with sent = FALSE and retry_count < 3, oldest first. "Depth" is the
 * number of rows waiting for it; "exhausted" is rows it has given up on.
 */
async function lineQueueStats(pool) {
  try {
    const [[row]] = await pool.query(
      `SELECT
         SUM(sent = FALSE AND retry_count < 3)  AS pending,
         SUM(sent = FALSE AND retry_count >= 3) AS exhausted,
         TIMESTAMPDIFF(SECOND, MIN(CASE WHEN sent = FALSE AND retry_count < 3 THEN created_at END), NOW()) AS oldest_pending_age_sec
       FROM notifications
       WHERE sent = FALSE`
    );
    return {
      pending: Number(row.pending) || 0,
      exhausted: Number(row.exhausted) || 0,
      oldest_pending_age_sec: row.oldest_pending_age_sec == null ? null : Number(row.oldest_pending_age_sec),
    };
  } catch (err) {
    return { error: `unavailable: ${err.code || err.message}` };
  }
}

function processStats() {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  return {
    pid: process.pid,
    uptime_sec: Math.round(process.uptime()),
    rss_mb: round1(mem.rss / MB),
    heap_used_mb: round1(mem.heapUsed / MB),
    heap_total_mb: round1(mem.heapTotal / MB),
    external_mb: round1(mem.external / MB),
    // Cumulative CPU time; the sampler turns consecutive samples into a rate.
    cpu_user_ms: Math.round(cpu.user / 1000),
    cpu_system_ms: Math.round(cpu.system / 1000),
  };
}

/** Linux only. Returns null elsewhere, and the caller says so. */
function readMeminfo(readFile = fs.readFileSync) {
  try {
    const text = readFile('/proc/meminfo', 'utf8');
    const kb = (key) => {
      const m = text.match(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm'));
      return m ? Number(m[1]) : null;
    };
    return {
      mem_available_mb: kb('MemAvailable') != null ? Math.round(kb('MemAvailable') / 1024) : null,
      swap_total_mb: kb('SwapTotal') != null ? Math.round(kb('SwapTotal') / 1024) : null,
      swap_free_mb: kb('SwapFree') != null ? Math.round(kb('SwapFree') / 1024) : null,
    };
  } catch {
    return null;
  }
}

function hostStats(readFile) {
  const meminfo = readMeminfo(readFile);
  const load = os.loadavg();
  return {
    platform: process.platform,
    cpu_count: os.cpus().length,
    // os.loadavg() is always [0,0,0] on Windows; null is more honest than 0.
    load_avg_1m: process.platform === 'win32' ? null : round1(load[0]),
    load_avg_5m: process.platform === 'win32' ? null : round1(load[1]),
    mem_total_mb: Math.round(os.totalmem() / MB),
    mem_free_mb: Math.round(os.freemem() / MB),
    mem_available_mb: meminfo ? meminfo.mem_available_mb : null,
    swap_total_mb: meminfo ? meminfo.swap_total_mb : null,
    swap_free_mb: meminfo ? meminfo.swap_free_mb : null,
    swap_used_mb: meminfo && meminfo.swap_total_mb != null && meminfo.swap_free_mb != null
      ? meminfo.swap_total_mb - meminfo.swap_free_mb
      : null,
    swap_note: meminfo ? null : 'swap/available memory need /proc/meminfo (Linux); not readable on this host',
  };
}

async function computeCapacitySample(pool, { readFile } = {}) {
  const [db_server, line_queue] = await Promise.all([dbServerStats(pool), lineQueueStats(pool)]);
  return {
    schema_version: '1.0',
    sampled_at: new Date().toISOString(),
    db_pool: poolStats(pool),
    db_server,
    line_queue,
    process: processStats(),
    host: hostStats(readFile),
    note: 'ตัวอย่างค่าฝั่ง server ณ เวลาเดียว ไม่มีข้อมูลส่วนบุคคล; slow_queries และ cpu_*_ms เป็นค่าสะสม ให้ดูผลต่างระหว่างสองตัวอย่าง',
  };
}

module.exports = {
  computeCapacitySample,
  poolStats,
  dbServerStats,
  lineQueueStats,
  processStats,
  hostStats,
  readMeminfo,
  STATUS_VARS,
};
