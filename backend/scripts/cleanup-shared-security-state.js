'use strict';

// Prune the three shared security-state tables added by migration 051 (A1-9).
// Same shape as cleanup-revoked-tokens.js: dry-run by DEFAULT, --apply deletes.
// Cron (Bangkok): `15 3 * * *  node scripts/cleanup-shared-security-state.js --apply`
//
// WHY THE INTERVALS ARE WIDER THAN THE TTLs THE CODE ENFORCES
// The login window is 15 minutes and the bind lockout is 30, but a row is only
// removed after an hour (a day for bind lockouts). A row deleted while still in
// force releases a lockout early, so the margin absorbs any clock difference
// between the app host and the database. Deleting late costs a few stale rows;
// deleting early hands an attacker a fresh budget.
//
// WHY line_webhook_events_seen KEEPS 7 DAYS
// It is the memory that stops a redelivered LINE event being processed twice.
// LINE retries for far less than a day, so a week is generous — but the cost of
// keeping a row too long is nothing, and the cost of dropping one too early is
// a duplicate notification and a duplicate row.

const { pool } = require('../src/config/database');

/** table -> the predicate that makes a row safe to delete. */
const TARGETS = [
  {
    table: 'login_lockouts',
    where: 'window_start < DATE_SUB(NOW(), INTERVAL 1 HOUR)',
    note: 'failed-login counters whose 15-minute window is long past',
  },
  {
    table: 'line_webhook_events_seen',
    where: 'seen_at < DATE_SUB(NOW(), INTERVAL 7 DAY)',
    note: 'handled LINE event ids older than any retry window',
  },
  {
    table: 'line_bind_lockouts',
    where: `window_start < DATE_SUB(NOW(), INTERVAL 1 DAY)
            AND (locked_until IS NULL OR locked_until < NOW())`,
    note: 'binding lockouts that are both stale and no longer in force',
  },
];

async function main() {
  const apply = process.argv.includes('--apply');
  let total = 0;
  for (const t of TARGETS) {
    const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM ${t.table} WHERE ${t.where}`);
    total += n;
    if (!apply) {
      console.log(`[cleanup-shared-state] DRY-RUN · ${t.table}: ${n} row(s) eligible — ${t.note}`);
    } else {
      const [r] = await pool.query(`DELETE FROM ${t.table} WHERE ${t.where}`);
      console.log(`[cleanup-shared-state] APPLY · ${t.table}: deleted ${r.affectedRows}`);
    }
  }
  if (!apply) console.log(`[cleanup-shared-state] ${total} row(s) total (run with --apply to delete)`);
  await pool.end();
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[cleanup-shared-state] FATAL:', e.message);
    pool.end().catch(() => {});
    process.exit(1);
  });
}

module.exports = { main, TARGETS };
