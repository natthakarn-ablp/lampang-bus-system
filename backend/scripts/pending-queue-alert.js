'use strict';

// In-app alerts for requests that have waited too long (owner request
// 2026-11-13). For every item waiting PENDING_OVERDUE_DAYS (default 3) it
// records ONE alert for the approver; after PENDING_ESCALATE_DAYS (default 7)
// ONE more for the level above (school → affiliation, affiliation/transport →
// province). Alerts are audit_logs rows (entity_type 'pending_alert') shown on
// the badge/page of GET /api/<role>/pending-summary. Nothing is sent to LINE.
// Logic: backend/src/services/pendingQueue.service.js.
//
// Run from backend/ (env.js reads backend/.env from the working directory):
//   cd backend && /usr/local/bin/node scripts/pending-queue-alert.js            # write alerts
//   cd backend && /usr/local/bin/node scripts/pending-queue-alert.js --dry-run  # report only
//
// Idempotent: each alert's dedupe key is its audit entity_id, so re-running
// the same day (or every hour) creates nothing new. Cron: docs/ops/automation-crons.md

require('../src/config/env');
const { pool } = require('../src/config/database');
const svc = require('../src/services/pendingQueue.service');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const stamp = new Date().toISOString();
  const r = await svc.runOnce({ db: pool, dryRun });
  console.log(`[pending-queue-alert] ${stamp} ${dryRun ? 'DRY-RUN' : 'APPLY'} overdue=${r.cfg.overdueDays}d escalate=${r.cfg.escalateDays}d `
    + `considered=${r.considered} ${dryRun ? 'would_create' : 'created'}=${r.created.length} existing=${r.skipped_existing}`);
  for (const a of r.created) {
    console.log(`  ${a.kind} ${a.queue}#${a.item_id} → ${a.target.role}${a.target.scopeId ? ':' + a.target.scopeId : ''} (${a.age_days}d)`);
  }
  await pool.end();
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error('[pending-queue-alert] error:', e.message);
    try { await pool.end(); } catch { /* ignore */ }
    process.exit(1);
  });
}
