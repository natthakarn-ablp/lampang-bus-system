#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_ROOT = path.join(ROOT, 'outputs', 'restore-drill');

let outputRoot = DEFAULT_OUTPUT_ROOT;
let runId = timestampBangkok();
let targetDb = 'lampang_bus_restore_drill';
let productionDb = 'lampang_bus';

function usage() {
  console.error('Usage: node scripts/create-restore-drill-evidence-pack.js [--out-dir <dir>] [--run-id <id>] [--target-db <db>] [--production-db <db>]');
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
  } else if (arg === '--target-db' && args[i + 1]) {
    targetDb = args[i + 1].trim();
    i += 1;
  } else if (arg === '--production-db' && args[i + 1]) {
    productionDb = args[i + 1].trim();
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
  evidence: 'restore-drill-result.md',
  log: 'restore-drill-output.redacted.log',
  manifest: 'manifest.json',
};

write(files.readme, readme());
write(files.evidence, evidenceTemplate());
write(files.log, logTemplate());
write(files.manifest, `${JSON.stringify({
  generated_at: generatedAt,
  run_id: runId,
  root: ROOT,
  target_database: targetDb,
  production_database: productionDb,
  evidence_file: files.evidence,
  suggested_log_file: files.log,
  files: Object.values(files),
  safety: {
    calls_apis: false,
    creates_evidence_templates_only: true,
    runs_restore_drill: false,
    runs_deploy: false,
    runs_migrations: false,
    runs_imports: false,
    runs_feature_flags: false,
    writes_production_db: false,
    writes_any_database: false,
  },
}, null, 2)}\n`);

console.log(`[restore-drill-evidence] output: ${outDir}`);
console.log('[restore-drill-evidence] safety: template only; no APIs, DB writes, deploys, restore drills, imports, migrations, or feature flags');

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
  return `# Restore Drill Evidence Pack

- Generated: ${generatedAt}
- Target database: \`${targetDb}\`
- Production database: \`${productionDb}\`

This pack is a blank evidence template. Creating it does not run the restore drill, call APIs, write a database, deploy, run migrations/imports, or change feature flags.

## Operator Flow

Run only after \`docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md\` explicitly approves the restore drill scope.

\`\`\`bash
cd /home/schoolbus/apps/lampang-bus-system
mysql -e "CREATE DATABASE IF NOT EXISTS ${targetDb} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
set -o pipefail
RESTORE_DB=${targetDb} bash scripts/restore-drill-db.sh 2>&1 | tee outputs/restore-drill/<timestamp>/restore-drill-output.redacted.log
node scripts/validate-restore-drill-evidence.js outputs/restore-drill/<timestamp>
\`\`\`

After the command finishes, fill \`${files.evidence}\` and keep the redacted command log at \`${files.log}\`.

Do not paste passwords, tokens, raw student lists, full CID values, parent phone numbers, LINE user IDs, or unredacted screenshots into this pack.
`;
}

function evidenceTemplate() {
  return `# Restore Drill Result

- Operator:
- Operator role:
- Date/time (Asia/Bangkok):
- Approval evidence:
- Production database: ${productionDb}
- Restore target database: ${targetDb}
- Backup file:
- Restore log path: ${files.log}
- Production before evidence:
- Production after evidence:

## Result Checks

| Check | Result | Evidence | Notes |
|---|---|---|---|
| Approval signed before drill | PENDING | docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md | |
| Target database is ${targetDb} | PENDING | ${files.log} | |
| Backup sha256 verified | PENDING | ${files.log} | |
| Gzip integrity verified | PENDING | ${files.log} | |
| Restore command exit code 0 | PENDING | ${files.log} | |
| Restore completed | PENDING | ${files.log} | |
| Table count reviewed | PENDING | Row Count Review | |
| Key row counts reviewed | PENDING | Row Count Review | |
| Production aggregate counts unchanged | PENDING | before/after evidence | |
| No production writes outside drill DB | PENDING | command + before/after evidence | |
| Cleanup or retention decision recorded | PENDING | ${files.log} | |

## Row Count Review

| Table | Restored | Production | Result | Notes |
|---|---:|---:|---|---|
| _table_total | PENDING | PENDING | PENDING | |
| users | PENDING | PENDING | PENDING | |
| schools | PENDING | PENDING | PENDING | |
| students | PENDING | PENDING | PENDING | |
| vehicles | PENDING | PENDING | PENDING | |

## Sign-off

| Name | Result | Date/time | Signature/approval evidence |
|---|---|---|---|
| | PENDING | | |
`;
}

function logTemplate() {
  return `# Replace this file with redacted output from scripts/restore-drill-db.sh.
# Keep only non-secret operational evidence.
`;
}
