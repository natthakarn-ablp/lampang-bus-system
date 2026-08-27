'use strict';

// Automated log retention — archive then purge old audit_logs + checkin_logs, and
// hard-delete ephemeral daily_status. Cron-driven so no admin has to clean tables
// by hand. Dry-run by DEFAULT; --apply is required to mutate. Archive tables come
// from migration 047. Each batch is archived + deleted inside ONE transaction,
// future-dated rows are never touched, and batches are chunked so the nightly run
// never holds a long table lock.
//
// Usage:
//   node backend/scripts/cleanup-old-logs.js                      (dry-run)
//   node backend/scripts/cleanup-old-logs.js --apply
//   node backend/scripts/cleanup-old-logs.js --apply \
//        --audit-retention-days=365 --checkin-retention-days=730 \
//        --daily-status-days=30 --batch=5000
//
// Suggested cron — DO NOT enable --apply on prod until the retention windows are
// signed off against PDPA + provincial reporting needs (run dry-run first):
//   45 3 * * * cd /home/schoolbus/apps/lampang-bus-system/backend && \
//     /usr/bin/node scripts/cleanup-old-logs.js --apply >> /home/schoolbus/logs/cleanup-old-logs.log 2>&1

const { pool } = require('../src/config/database');
const { logAudit } = require('../src/utils/audit');
const env = require('../src/config/env');

// nowExpr is NOW() for TIMESTAMP columns, CURDATE() for DATE columns. archive=null
// means hard-delete (no copy). days defaults are PLACEHOLDERS — tune via flags.
const TABLES = [
  { table: 'audit_logs',   archive: 'audit_logs_archive',  dateCol: 'created_at', nowExpr: 'NOW()',     key: 'audit_logs',   def: 365 },
  { table: 'checkin_logs', archive: 'checkin_logs_archive', dateCol: 'check_date', nowExpr: 'CURDATE()', key: 'checkin_logs', def: 730 },
  { table: 'daily_status', archive: null,                   dateCol: 'check_date', nowExpr: 'CURDATE()', key: 'daily_status', def: 30 },
  // vehicle_location_history (migration 040) — append-only raw GPS trail that
  // otherwise grows without bound. It is location PII, so PDPA wants it bounded:
  // hard-delete (no archive) rows older than LOCATION_HISTORY_RETENTION_DAYS,
  // matched on the indexed received_at column (idx_vlh_received).
  { table: 'vehicle_location_history', archive: null, dateCol: 'received_at', nowExpr: 'NOW()', key: 'vehicle_location_history', def: 30 },
];

function intArg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return def;
  const n = parseInt(hit.split('=')[1], 10);
  return Number.isInteger(n) && n > 0 ? n : def;
}

// `days`/`batch` are integers (never user input) — coerced with Number() so they
// can be safely interpolated; all id values go through parameter binding.
function eligibleWhere(t, days) {
  return `${t.dateCol} < DATE_SUB(${t.nowExpr}, INTERVAL ${Number(days)} DAY) AND ${t.dateCol} <= ${t.nowExpr}`;
}

async function countEligible(db, t, days) {
  const [[r]] = await db.query(`SELECT COUNT(*) AS n FROM ${t.table} WHERE ${eligibleWhere(t, days)}`);
  return r.n;
}

// Archive (if configured) + delete one batch atomically. Returns rows handled.
async function purgeBatch(db, t, days, batch) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id FROM ${t.table} WHERE ${eligibleWhere(t, days)} ORDER BY id LIMIT ${Number(batch)}`
    );
    if (rows.length === 0) { await conn.commit(); return 0; }
    const ids = rows.map((r) => r.id);
    if (t.archive) {
      await conn.query(`INSERT IGNORE INTO ${t.archive} SELECT * FROM ${t.table} WHERE id IN (?)`, [ids]);
    }
    await conn.query(`DELETE FROM ${t.table} WHERE id IN (?)`, [ids]);
    await conn.commit();
    return ids.length;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runRetention(db, { apply, batch, days }) {
  const summary = [];
  for (const t of TABLES) {
    const d = days[t.key];
    const eligible = await countEligible(db, t, d);
    let handled = 0;
    if (apply) {
      // Loop batches until a short (< batch) batch signals we drained the tail.
      for (;;) {
        const n = await purgeBatch(db, t, d, batch);
        handled += n;
        if (n < batch) break;
        await sleep(100);
      }
    }
    summary.push({ table: t.table, eligible, archived: t.archive ? handled : 0, deleted: handled, days: d });
  }
  return summary;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const batch = intArg('batch', 5000);
  const days = {
    audit_logs: intArg('audit-retention-days', 365),
    checkin_logs: intArg('checkin-retention-days', 730),
    daily_status: intArg('daily-status-days', 30),
    // Default from the (formerly unused) LOCATION_HISTORY_RETENTION_DAYS knob.
    vehicle_location_history: intArg('location-history-days', env.tracking.locationHistoryRetentionDays),
  };
  const mode = apply ? 'APPLY' : 'DRY-RUN';
  console.log(`[cleanup-logs] mode=${mode} · audit=${days.audit_logs}d checkin=${days.checkin_logs}d daily=${days.daily_status}d location=${days.vehicle_location_history}d batch=${batch}`);

  const summary = await runRetention(pool, { apply, batch, days });
  let purged = 0; let eligibleTotal = 0;
  for (const s of summary) {
    purged += s.deleted; eligibleTotal += s.eligible;
    if (apply) console.log(`  [${s.table}] archived ${s.archived} · deleted ${s.deleted} (older than ${s.days}d)`);
    else console.log(`  [${s.table}] would archive/delete ${s.eligible} (older than ${s.days}d)`);
  }

  if (apply && purged > 0) {
    // A run record (the cron log is the primary trail; this keeps it in-band too).
    await logAudit({
      action: 'DELETE', entityType: 'log_retention', entityId: 'cron',
      newValue: { batch, days, summary: summary.map((s) => ({ table: s.table, deleted: s.deleted })) },
    });
  }
  console.log(`[cleanup-logs] ${mode} done · ${apply ? purged + ' purged' : eligibleTotal + ' eligible'}`);
  console.log('[cleanup-logs] suggested cron: 45 3 * * *  node scripts/cleanup-old-logs.js --apply');
  await pool.end();
}

module.exports = { TABLES, eligibleWhere, countEligible, purgeBatch, runRetention };

if (require.main === module) {
  main().catch((e) => { console.error('[cleanup-logs] FATAL:', e.message); pool.end().catch(() => {}); process.exit(1); });
}
