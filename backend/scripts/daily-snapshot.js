'use strict';

// Daily system-wide snapshot (daily_snapshots, run_type 'auto') — the same
// metrics as the admin "บันทึก snapshot" button (POST /api/admin/snapshots/run),
// now cron-ready so the research trend does not depend on someone pressing it.
// Logic: backend/src/services/dailySnapshot.service.js.
//
// Run from backend/ (env.js reads backend/.env from the working directory):
//   cd backend && node scripts/daily-snapshot.js                    # today (Asia/Bangkok)
//   cd backend && node scripts/daily-snapshot.js --date 2026-11-13  # a given date
//   cd backend && node scripts/daily-snapshot.js --dry-run          # compute + print, write nothing
//
// Idempotent: if any system snapshot already exists for the date (manual,
// baseline or auto) it does nothing. Run it after the evening round so the
// day's completion counts are final. Cron: docs/ops/automation-crons.md

require('../src/config/env');
const { pool } = require('../src/config/database');
const svc = require('../src/services/dailySnapshot.service');

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const di = args.indexOf('--date');
  const date = di >= 0 ? args[di + 1] : null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date must be YYYY-MM-DD');
  const r = await svc.runDailySnapshot(pool, { date, dryRun });
  const stamp = new Date().toISOString();
  if (r.status === 'EXISTS') {
    console.log(`[daily-snapshot] ${stamp} ${r.snapshotDate} already has a system snapshot (${r.existingRunType}) — nothing to do`);
  } else {
    console.log(`[daily-snapshot] ${stamp} ${r.status} ${r.snapshotDate} ${JSON.stringify(r.metrics)}`);
  }
  await pool.end();
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error('[daily-snapshot] error:', e.message);
    try { await pool.end(); } catch { /* ignore */ }
    process.exit(1);
  });
}
