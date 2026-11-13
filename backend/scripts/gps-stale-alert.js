'use strict';

// LINE alert when a bus's GPS is stuck at one spot, or silent, for
// GPS_STALE_ALERT_MINUTES (default 20) during a round that still has children
// on board. Logic: backend/src/services/gpsStaleAlert.service.js.
//
// Run from backend/ — config/env.js loads .env from the working directory.
//
// Usage (from backend/):
//   node scripts/gps-stale-alert.js           # DRY-RUN (default): report only, sends and writes nothing
//   node scripts/gps-stale-alert.js --apply   # send to the LINE emergency group (needs FEATURE_GPS_STALE_ALERT=true)
//
// Cron (every 5 minutes; the script itself does nothing outside the GPS
// tracking windows, so the schedule does not need to know the server's UTC offset):
//   */5 * * * * cd /home/schoolbus/apps/lampang-bus-system/backend && node scripts/gps-stale-alert.js --apply >> /home/schoolbus/logs/gps-stale-alert.log 2>&1

const env = require('../src/config/env');
const { pool } = require('../src/config/database');
const { isWithinTrackingWindow, configuredWindows } = require('../src/utils/gpsTrackingWindow');
const svc = require('../src/services/gpsStaleAlert.service');

async function main() {
  const apply = process.argv.includes('--apply');
  const stamp = new Date().toISOString();

  if (apply && !env.features.gpsStaleAlert) {
    console.log(`[gps-stale-alert] ${stamp} FEATURE_GPS_STALE_ALERT is off — nothing sent`);
    await pool.end();
    return;
  }
  if (!isWithinTrackingWindow(new Date(), configuredWindows())) {
    if (!apply) console.log(`[gps-stale-alert] ${stamp} outside the GPS tracking windows — nothing to check`);
    await pool.end();
    return;
  }

  const r = await svc.runOnce({ apply });
  const sent = r.alerts.filter((a) => a.delivery === 'sent').length;
  const failed = r.alerts.filter((a) => a.delivery === 'failed').length;
  const errors = r.skipped.filter((s) => s.reason === 'ERROR');
  console.log(`[gps-stale-alert] ${stamp} ${apply ? 'APPLY' : 'DRY-RUN'} session=${r.session} rounds=${r.checked} alerts=${r.alerts.length} sent=${sent} failed=${failed} errors=${errors.length}`);
  for (const a of r.alerts) console.log(`  ${a.delivery} ${a.kind} ${a.vehicleId}`);
  for (const e of errors) console.log(`  error ${e.vehicleId}: ${e.error}`);
  if (!apply) {
    for (const a of r.alerts) console.log(`\n--- would send (${a.vehicleId}) ---\n${a.text}`);
    for (const s of r.skipped.filter((x) => x.reason !== 'ERROR')) console.log(`  skip ${s.vehicleId}: ${s.reason}`);
  }
  if (failed || errors.length) process.exitCode = 2;
  await pool.end();
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error('[gps-stale-alert] error:', e.message);
    try { await pool.end(); } catch { /* ignore */ }
    process.exit(1);
  });
}
