#!/usr/bin/env node
'use strict';

// Phase 10.13B-9 — daily integrity / operations monitor (read-only, no PII).
// Exit: 0=OK, 1=WARN, 2=CRITICAL. Flags: --json, --write-json <path>.
//   cd backend && node scripts/integrity-monitor.js
//   node backend/scripts/integrity-monitor.js --json
//   node scripts/integrity-monitor.js --write-json /home/schoolbus/logs/integrity-monitor-latest.json

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');
const { computeOperationsHealth } = require('../src/services/operationsHealth.service');
const { deliverOperationsAlert } = require('../src/services/operationsAlert.service');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const wi = args.indexOf('--write-json');
const writePath = wi >= 0 ? args[wi + 1] : null;

function writeSnapshot(p, report) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(report, null, 2), { mode: 0o640 });
  fs.renameSync(tmp, p);   // atomic replace
}

(async () => {
  const report = await computeOperationsHealth(pool);
  if (writePath) { try { writeSnapshot(writePath, report); } catch (e) { console.error('[integrity-monitor] snapshot write failed:', e.code || e.message); } }
  const alert = await deliverOperationsAlert(report).catch((e) => ({ delivered: false, reason: e.message }));

  if (jsonMode) {
    console.log(JSON.stringify(report));
  } else {
    console.log(`[integrity-monitor] ${report.timestamp}  status=${report.status}`);
    for (const c of report.checks) {
      const mark = c.severity === 'CRITICAL' ? 'CRIT' : c.severity === 'WARN' ? 'WARN' : c.severity === 'INFO' ? 'info' : ' ok ';
      console.log(`  [${mark}] ${String(c.key).padEnd(26)} ${String(c.value ?? '-').padEnd(9)} ${c.label}${c.detail ? ' — ' + c.detail : ''}`);
    }
    if ((report.status === 'WARN' || report.status === 'CRITICAL')) {
      console.log(`Alert: ${alert.delivered ? 'delivered' : alert.reason}`);
    }
    console.log(`Operations health: ${report.status}`);
  }
  await pool.end();
  process.exit(report.status === 'CRITICAL' ? 2 : report.status === 'WARN' ? 1 : 0);
})().catch(async (e) => {
  console.error('[integrity-monitor] ERROR:', e.message);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(2);
});
