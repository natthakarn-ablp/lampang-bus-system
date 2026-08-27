#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_ROOT = path.join(ROOT, 'outputs', 'operator-gates');

let outputRoot = DEFAULT_OUTPUT_ROOT;
let runId = timestampBangkok();
let baseUrl = 'http://127.0.0.1:3000';

function usage() {
  console.error('Usage: node scripts/create-operator-gate-evidence-pack.js [--out-dir <dir>] [--run-id <id>] [--base-url <url>]');
}

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--out-dir' && args[i + 1]) {
    outputRoot = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--run-id' && args[i + 1]) {
    runId = safeName(args[i + 1]);
    i += 1;
  } else if (arg === '--base-url' && args[i + 1]) {
    baseUrl = args[i + 1].trim().replace(/\/+$/, '');
    i += 1;
  } else {
    usage();
    process.exit(2);
  }
}

const outDir = path.join(outputRoot, runId);
fs.mkdirSync(outDir, { recursive: true });

const generatedAt = new Date().toISOString();
const files = {
  readme: 'README.md',
  evidence: 'operator-gate-result.md',
  productionLog: 'production-gate.redacted.log',
  postdeployLog: 'postdeploy-gate.redacted.log',
  pm2Log: 'monitor-pm2.redacted.log',
  healthLog: 'monitor-health-check.redacted.log',
  offhostLog: 'monitor-offhost-sync.redacted.log',
  manifest: 'manifest.json',
};

write(files.readme, readme());
write(files.evidence, evidenceTemplate());
write(files.productionLog, logTemplate('production-readiness-gate.sh production'));
write(files.postdeployLog, logTemplate('production-readiness-gate.sh postdeploy'));
write(files.pm2Log, logTemplate('pm2 logs schoolbus-backend --lines 100 --nostream'));
write(files.healthLog, logTemplate('tail -n 100 /home/schoolbus/backups/lampang-bus/health-check.log'));
write(files.offhostLog, logTemplate('tail -n 100 /home/schoolbus/logs/offhost-sync.log'));
write(files.manifest, `${JSON.stringify({
  generated_at: generatedAt,
  run_id: runId,
  root: ROOT,
  base_url: baseUrl,
  evidence_file: files.evidence,
  files: Object.values(files),
  safety: {
    calls_apis: false,
    creates_evidence_templates_only: true,
    runs_production_gate: false,
    runs_postdeploy_gate: false,
    runs_deploy: false,
    runs_restore_drill: false,
    runs_migrations: false,
    runs_imports: false,
    runs_feature_flags: false,
    writes_production_db: false,
    writes_any_database: false,
  },
}, null, 2)}\n`);

console.log(`[operator-gate-evidence] output: ${outDir}`);
console.log('[operator-gate-evidence] safety: template only; no APIs, DB writes, deploys, gates, restore drills, imports, migrations, or feature flags');

function timestampBangkok() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

function safeName(value) {
  return String(value || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
}

function write(name, content) {
  fs.writeFileSync(path.join(outDir, name), content);
}

function readme() {
  return `# Operator Gate Evidence Pack

- Generated: ${generatedAt}
- Base URL: \`${baseUrl}\`

This pack is a blank evidence template. Creating it does not run production gates, deploy, call APIs, write a database, run restore drills, run migrations/imports, or change feature flags.

## Operator Flow

Run only after \`docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md\` approves the matching scope.

\`\`\`bash
cd /home/schoolbus/apps/lampang-bus-system
node scripts/create-operator-gate-evidence-pack.js --base-url ${baseUrl}

set -o pipefail
BASE_URL=${baseUrl} bash scripts/production-readiness-gate.sh production 2>&1 | tee outputs/operator-gates/<timestamp>/${files.productionLog}

# After approved deploy/restart only:
BASE_URL=${baseUrl} bash scripts/production-readiness-gate.sh postdeploy 2>&1 | tee outputs/operator-gates/<timestamp>/${files.postdeployLog}

pm2 logs schoolbus-backend --lines 100 --nostream > outputs/operator-gates/<timestamp>/${files.pm2Log} 2>&1
tail -n 100 /home/schoolbus/backups/lampang-bus/health-check.log > outputs/operator-gates/<timestamp>/${files.healthLog} 2>&1
tail -n 100 /home/schoolbus/logs/offhost-sync.log > outputs/operator-gates/<timestamp>/${files.offhostLog} 2>&1

node scripts/validate-operator-gate-evidence.js outputs/operator-gates/<timestamp>
\`\`\`

After commands finish, fill \`${files.evidence}\` and keep redacted logs in this folder.

Do not paste passwords, tokens, LINE secrets, raw student lists, full CID values, parent phone numbers, LINE user IDs, or unredacted screenshots into this pack.
`;
}

function evidenceTemplate() {
  return `# Operator Gate Result

- Operator:
- Operator role:
- Date/time (Asia/Bangkok):
- Approval evidence:
- Approved commit/worktree:
- Deployed commit:
- Base URL: ${baseUrl}
- Production gate log path: ${files.productionLog}
- Postdeploy gate log path: ${files.postdeployLog}
- PM2 monitor log path: ${files.pm2Log}
- Health monitor log path: ${files.healthLog}
- Off-host monitor log path: ${files.offhostLog}
- Monitor start (Asia/Bangkok):
- Monitor end (Asia/Bangkok):

## Result Checks

| Check | Result | Evidence | Notes |
|---|---|---|---|
| Production read-only gate approval signed | PENDING | docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md | |
| Production read-only gate mode=production | PENDING | ${files.productionLog} | |
| Production read-only gate fail=0 | PENDING | ${files.productionLog} | |
| Deployment approval signed | PENDING | docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md | |
| Postdeploy gate mode=postdeploy | PENDING | ${files.postdeployLog} | |
| Postdeploy gate fail=0 | PENDING | ${files.postdeployLog} | |
| Runtime commit matches git HEAD | PENDING | ${files.postdeployLog} | |
| PM2 monitor reviewed with no new application errors | PENDING | ${files.pm2Log} | |
| Health monitor reviewed with no new failures | PENDING | ${files.healthLog} | |
| Off-host sync monitor reviewed with no new backup errors | PENDING | ${files.offhostLog} | |
| 30-60 minute monitor completed | PENDING | monitor start/end | |
| Rollback plan still valid | PENDING | docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md | |
| No production DB writes outside approved gates | PENDING | production/postdeploy logs | |
| No feature flag changes | PENDING | operator note | |

## Sign-off

| Name | Result | Date/time | Signature/approval evidence |
|---|---|---|---|
| | PENDING | | |
`;
}

function logTemplate(command) {
  return `# Replace this file with redacted output from:
# ${command}
# Keep only non-secret operational evidence.
`;
}
