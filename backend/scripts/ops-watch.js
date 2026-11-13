'use strict';

// Backup + health watch → in-app alert for admins (no LINE).
// Logic: backend/src/services/opsWatch.service.js.
//
// Run from backend/ (env.js reads backend/.env from the working directory):
//   cd backend && /usr/local/bin/node scripts/ops-watch.js            # check, record alerts
//   cd backend && /usr/local/bin/node scripts/ops-watch.js --dry-run  # check and print only
//
// Settings (backend/.env, all optional):
//   BACKUP_LOG=/home/schoolbus/backups/lampang-bus/backup.log  (where backup-db.sh's cron writes)
//   OPS_BACKUP_MAX_AGE_HOURS=26
//   HEALTH_URL=http://127.0.0.1:3000/health
//
// One alert per problem per Bangkok day, so running every 15 minutes is safe.
// Exit: 0 all OK · 1 a check failed (alert recorded or already recorded) ·
// 2 could not record (DB down — the cron log is then the only trace).
// Cron: docs/ops/automation-crons.md

require('../src/config/env');
const { pool } = require('../src/config/database');
const svc = require('../src/services/opsWatch.service');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const stamp = new Date().toISOString();
  const r = await svc.runOnce({ db: pool, dryRun });
  const b = r.checks.backup;
  const h = r.checks.health;
  console.log(`[ops-watch] ${stamp} ${dryRun ? 'DRY-RUN' : 'APPLY'} backup=${b.status}${b.detail ? ` (${b.detail})` : ''} `
    + `health=${h.status}${h.detail ? ` (${h.detail})` : ''} ${dryRun ? 'would_alert' : 'alerted'}=${r.created.length}`);
  for (const c of r.created) console.log(`  ${c.key} ${c.message}`);
  if (r.problems.length) process.exitCode = 1;
  await pool.end();
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error('[ops-watch] error:', e.message);
    try { await pool.end(); } catch { /* ignore */ }
    process.exit(2);
  });
}
