'use strict';

// Phase 10.13C (roadmap A-1) — automatic LINE notification dispatcher.
//
// checkin.service ALREADY queues a per-checkin/checkout push into `notifications`
// (sent=FALSE), but nothing was triggering the send automatically — parents never
// got them. This drains the queue. processUnsentNotifications() applies a recency
// window (default here 120m) so a stale backlog (e.g. months-old test rows, or a
// pile-up during a dispatcher outage) is NEVER blasted — only fresh check-in pushes
// go out. Failed sends retry up to 3x (retry_count) then stop, so a bad LINE id or
// an exhausted LINE quota degrades gracefully.
//
// Usage:
//   node backend/scripts/dispatch-notifications.js            # DRY-RUN (default): preview only, sends nothing
//   node backend/scripts/dispatch-notifications.js --apply    # actually send via LINE
//
// Cron (every minute, low-traffic-safe):
//   * * * * * cd /home/schoolbus/apps/lampang-bus-system && node backend/scripts/dispatch-notifications.js --apply >> /home/schoolbus/backups/dispatch.log 2>&1

const { pool } = require('../src/config/database');
const lineSvc = require('../src/services/line.service');

const MAX_AGE_MIN = 120; // only send check-in pushes from the last 2 hours
const BATCH = 50;
const MAX_BATCHES = 20;  // up to 1000 sends per run (covers a morning burst)

async function main() {
  const apply = process.argv.includes('--apply');

  if (!apply) {
    const [recent] = await pool.query(
      `SELECT id, target_line_user_id, notification_type, created_at
         FROM notifications
        WHERE sent = FALSE AND retry_count < 3 AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
        ORDER BY created_at ASC LIMIT ?`,
      [MAX_AGE_MIN, BATCH]
    );
    const [[stale]] = await pool.query(
      `SELECT COUNT(*) n FROM notifications
        WHERE sent = FALSE AND retry_count < 3 AND created_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [MAX_AGE_MIN]
    );
    console.log(`[dispatch] DRY-RUN · ${recent.length} recent unsent (≤${MAX_AGE_MIN}m) would be sent · ${stale.n} stale EXCLUDED (never sent)`);
    for (const r of recent) {
      const tgt = String(r.target_line_user_id || '').slice(0, 8);
      console.log(`  would send #${r.id} ${r.notification_type} → ${tgt}…`);
    }
    console.log('[dispatch] nothing was sent or modified. Re-run with --apply to send.');
    await pool.end();
    return;
  }

  let processed = 0, sent = 0, failed = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const r = await lineSvc.processUnsentNotifications(BATCH, MAX_AGE_MIN);
    processed += r.processed; sent += r.sent; failed += r.failed;
    if (r.processed < BATCH) break; // queue drained
  }
  console.log(`[dispatch] ${new Date().toISOString()} · processed=${processed} sent=${sent} failed=${failed}`);
  await pool.end();
}

if (require.main === module) {
  main().catch((e) => { console.error('[dispatch] error:', e.message); process.exit(1); });
}
