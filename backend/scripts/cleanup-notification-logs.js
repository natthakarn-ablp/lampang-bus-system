'use strict';

// PERF-002 — opt-in retention for `notifications` and `line_message_logs`
// (both hold children's names / LINE ids and grow without bound).
//
// SAFE BY DEFAULT:
//   * dry-run unless --apply is given;
//   * NO default retention period — the owner must pass both
//     --notifications-days=N and --line-log-days=N (PDPA decision, not ours);
//   * never deletes a notification that is still pending, being processed,
//     or parked UNKNOWN for human review;
//   * small batches (default 1000, max 5000) with a pause, and a cap on batches
//     per run (default 50), each batch in its own short transaction;
//   * never touches future-dated rows.
// It is deliberately NOT part of cleanup-old-logs.js, whose nightly --apply
// cron is already installed on production.
//
// Usage:
//   node backend/scripts/cleanup-notification-logs.js --notifications-days=N --line-log-days=N
//   node backend/scripts/cleanup-notification-logs.js --notifications-days=N --line-log-days=N --apply
// Requires migration 059 (dispatch columns); 060 makes the range scans indexed.

const { pool } = require('../src/config/database');

// A notification is deletable only when it is finished:
//   sent (LINE accepted it or dry-run), or terminally FAILED / SKIPPED.
// Pending (sent = FALSE AND retry_count < 3), claimed (claim_token set) and
// UNKNOWN rows are always kept.
const NOTIF_FINISHED =
  "claim_token IS NULL AND (sent = TRUE OR (retry_count >= 3 AND delivery_state IN ('FAILED','SKIPPED')))";

const TARGETS = {
  notifications: { table: 'notifications', extra: NOTIF_FINISHED },
  line_message_logs: { table: 'line_message_logs', extra: null },
};

function eligibleWhere(target, days) {
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1) throw new Error('days must be a positive integer');
  const age = `created_at < DATE_SUB(NOW(), INTERVAL ${n} DAY) AND created_at <= NOW()`;
  return target.extra ? `${age} AND ${target.extra}` : age;
}

function parseArgs(argv) {
  const get = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split('=')[1] : undefined;
  };
  const num = (v, def) => (v === undefined ? def : Number(v));
  const out = {
    apply: argv.includes('--apply'),
    notificationsDays: num(get('notifications-days'), undefined),
    lineLogDays: num(get('line-log-days'), undefined),
    batch: num(get('batch'), 1000),
    maxBatches: num(get('max-batches'), 50),
  };
  for (const k of ['notificationsDays', 'lineLogDays']) {
    if (!Number.isInteger(out[k]) || out[k] < 1) {
      throw new Error(`--${k === 'notificationsDays' ? 'notifications-days' : 'line-log-days'}=N is required (no default retention; owner decision)`);
    }
  }
  if (!Number.isInteger(out.batch) || out.batch < 1 || out.batch > 5000) throw new Error('--batch must be 1..5000');
  if (!Number.isInteger(out.maxBatches) || out.maxBatches < 1) throw new Error('--max-batches must be >= 1');
  return out;
}

async function countEligible(db, target, days) {
  const [[r]] = await db.query(`SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM ${target.table} WHERE ${eligibleWhere(target, days)}`);
  return { n: Number(r.n), oldest: r.oldest };
}

async function purgeBatch(db, target, days, batch) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id FROM ${target.table} WHERE ${eligibleWhere(target, days)}
        ORDER BY created_at, id LIMIT ${Number(batch)} FOR UPDATE SKIP LOCKED`);
    if (!rows.length) { await conn.commit(); return 0; }
    const ids = rows.map((r) => r.id);
    // Re-check the predicate in the DELETE so a row that changed state after
    // the SELECT (e.g. re-queued) is never removed.
    const [res] = await conn.query(
      `DELETE FROM ${target.table} WHERE id IN (?) AND ${eligibleWhere(target, days)}`, [ids]);
    await conn.commit();
    return Number(res.affectedRows);
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(db, opts) {
  const plan = [
    [TARGETS.notifications, opts.notificationsDays],
    [TARGETS.line_message_logs, opts.lineLogDays],
  ];
  const summary = [];
  for (const [target, days] of plan) {
    const { n, oldest } = await countEligible(db, target, days);
    let deleted = 0;
    let batches = 0;
    if (opts.apply) {
      while (batches < opts.maxBatches) {
        const k = await purgeBatch(db, target, days, opts.batch);
        batches++;
        deleted += k;
        if (k < opts.batch) break;
        await sleep(opts.pauseMs == null ? 200 : opts.pauseMs);
      }
    }
    summary.push({ table: target.table, days, eligible: n, oldest_eligible: oldest, deleted, batches });
  }
  return summary;
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) {
    console.error(`[cleanup-notification-logs] ${e.message}`);
    process.exit(2);
  }
  const mode = opts.apply ? 'APPLY' : 'DRY-RUN';
  console.log(`[cleanup-notification-logs] mode=${mode} notifications=${opts.notificationsDays}d line_message_logs=${opts.lineLogDays}d batch=${opts.batch} max_batches=${opts.maxBatches}`);
  const summary = await run(pool, opts);
  for (const s of summary) {
    console.log(`  [${s.table}] eligible=${s.eligible} oldest=${s.oldest_eligible ? new Date(s.oldest_eligible).toISOString() : '-'}${opts.apply ? ` deleted=${s.deleted} batches=${s.batches}` : ''}`);
  }
  await pool.end();
}

module.exports = { NOTIF_FINISHED, TARGETS, eligibleWhere, parseArgs, purgeBatch, run };

if (require.main === module) {
  main().catch((e) => { console.error('[cleanup-notification-logs] FATAL:', e.message); pool.end().catch(() => {}); process.exit(1); });
}
