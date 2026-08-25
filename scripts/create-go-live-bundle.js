#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_BUNDLE_ROOT = path.join(ROOT, 'outputs', 'go-live-bundle');
const PHASE9_EVIDENCE_ROOT = path.join(ROOT, 'outputs', 'phase9-evidence');
const UAT_EVIDENCE_ROOT = path.join(ROOT, 'outputs', 'uat-evidence');
const RESTORE_DRILL_EVIDENCE_ROOT = path.join(ROOT, 'outputs', 'restore-drill');
const OPERATOR_GATE_EVIDENCE_ROOT = path.join(ROOT, 'outputs', 'operator-gates');

let allowPending = false;
let evidencePath = null;
let uatEvidencePath = null;
let restoreDrillEvidencePath = null;
let operatorGateEvidencePath = null;
let bundleRoot = DEFAULT_BUNDLE_ROOT;
let runId = timestampBangkok();

function usage() {
  console.error('Usage: node scripts/create-go-live-bundle.js [--allow-pending] [--evidence <dir|manifest.json>] [--uat-evidence <dir|manifest.json>] [--restore-drill <dir|manifest.json>] [--operator-gates <dir|manifest.json>] [--out-dir <dir>] [--run-id <id>]');
}

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--allow-pending') {
    allowPending = true;
  } else if (arg === '--evidence' && args[i + 1]) {
    evidencePath = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--uat-evidence' && args[i + 1]) {
    uatEvidencePath = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--restore-drill' && args[i + 1]) {
    restoreDrillEvidencePath = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--operator-gates' && args[i + 1]) {
    operatorGateEvidencePath = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--out-dir' && args[i + 1]) {
    bundleRoot = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--run-id' && args[i + 1]) {
    runId = safeName(args[i + 1]);
    i += 1;
  } else {
    usage();
    process.exit(2);
  }
}

const bundleDir = path.join(bundleRoot, runId);
const logsDir = path.join(bundleDir, 'checks');
const readinessReportDir = path.join(bundleDir, 'readiness-report');
fs.mkdirSync(logsDir, { recursive: true });

const generatedAt = new Date().toISOString();
const selectedEvidence = normalizePackPath(evidencePath) || latestPack(PHASE9_EVIDENCE_ROOT);
const selectedUatEvidence = normalizePackPath(uatEvidencePath) || latestPack(UAT_EVIDENCE_ROOT);
const selectedRestoreDrillEvidence = normalizePackPath(restoreDrillEvidencePath) || latestPack(RESTORE_DRILL_EVIDENCE_ROOT);
const selectedOperatorGateEvidence = normalizePackPath(operatorGateEvidencePath) || latestPack(OPERATOR_GATE_EVIDENCE_ROOT);
const gitHead = git(['rev-parse', '--short', 'HEAD']);
const gitStatus = runGitStatus();

const phase9Validation = selectedEvidence
  ? runNode('phase9-evidence', 'scripts/validate-phase9-evidence.js', [selectedEvidence, '--require-mode', 'public'])
  : missingCheck('phase9-evidence', 'no Phase 9 evidence pack found');

const uatSafetyValidation = selectedUatEvidence
  ? runNode('uat-evidence-safety', 'scripts/scan-uat-evidence-safety.js', [
    selectedUatEvidence,
    '--out-dir',
    path.join(bundleDir, 'uat-safety'),
    '--run-id',
    'bundle',
  ])
  : missingCheck('uat-evidence-safety', 'no UAT evidence pack found');

const signoffDraftValidation = selectedUatEvidence
  ? runNode('go-live-signoff-draft', 'scripts/create-go-live-signoff-draft.js', [
    selectedUatEvidence,
    '--out-dir',
    path.join(bundleDir, 'signoff-draft'),
    '--run-id',
    'bundle',
  ])
  : missingCheck('go-live-signoff-draft', 'no UAT evidence pack found');

const opsSignoffDraftValidation = runNode('ops-signoff-draft', 'scripts/create-ops-signoff-draft.js', [
  ...(selectedEvidence ? ['--phase9-evidence', selectedEvidence] : []),
  ...(selectedRestoreDrillEvidence ? ['--restore-drill', selectedRestoreDrillEvidence] : []),
  ...(selectedOperatorGateEvidence ? ['--operator-gates', selectedOperatorGateEvidence] : []),
  '--out-dir',
  path.join(bundleDir, 'ops-signoff-draft'),
  '--run-id',
  'bundle',
]);

const restoreDrillValidation = selectedRestoreDrillEvidence
  ? runNode('restore-drill-evidence', 'scripts/validate-restore-drill-evidence.js', [
    selectedRestoreDrillEvidence,
    ...(allowPending ? ['--allow-pending'] : []),
  ])
  : missingCheck('restore-drill-evidence', 'no restore drill evidence pack found');

const operatorGateValidation = selectedOperatorGateEvidence
  ? runNode('operator-gate-evidence', 'scripts/validate-operator-gate-evidence.js', [
    selectedOperatorGateEvidence,
    ...(allowPending ? ['--allow-pending'] : []),
  ])
  : missingCheck('operator-gate-evidence', 'no operator production/postdeploy/monitor evidence pack found');

const uatValidation = selectedUatEvidence
  ? runNode('uat-evidence', 'scripts/validate-uat-evidence-pack.js', [
    selectedUatEvidence,
    ...(allowPending ? ['--allow-pending'] : []),
  ])
  : missingCheck('uat-evidence', 'no UAT evidence pack found');

const signoffValidation = runNode('go-live-signoff', 'scripts/validate-go-live-signoff.js', [
  ...(allowPending ? ['--allow-pending'] : []),
]);

const readinessArgs = [
  ...(allowPending ? ['--allow-pending'] : []),
  ...(selectedEvidence ? ['--evidence', selectedEvidence] : []),
  ...(selectedRestoreDrillEvidence ? ['--restore-drill', selectedRestoreDrillEvidence] : []),
  ...(selectedOperatorGateEvidence ? ['--operator-gates', selectedOperatorGateEvidence] : []),
  '--report-dir',
  readinessReportDir,
];
const readinessValidation = runNode('readiness-100', 'scripts/verify-100-readiness.js', readinessArgs);
const readinessSummary = parseReadySummary(readinessValidation.output);
const readinessReport = parseReadyReport(readinessValidation.output);
const uatSafetyReport = parseToolOutputPath(uatSafetyValidation.output, '[uat-safety] output:');
const signoffDraftReport = parseToolOutputPath(signoffDraftValidation.output, '[signoff-draft] output:');
const opsSignoffDraftReport = parseToolOutputPath(opsSignoffDraftValidation.output, '[ops-signoff-draft] output:');

const docs = [
  '.gitignore',
  'docs/READINESS_SCORECARD_2026-08.md',
  'docs/UAT_SIGNOFF_2026-08.md',
  'docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md',
  'docs/PHASE9_PRODUCTION_GATE_2026-08.md',
  'docs/PRODUCTION_GOVERNANCE_CHECKLIST_2026-08.md',
  'docs/INCIDENT_PDPA_SOP_2026-08.md',
  'docs/TRAINING_PACK_2026-08.md',
  'docs/OPERATOR_RUNBOOK.md',
  'docs/operator-go-live-checklist.md',
];

const scripts = [
  'scripts/production-readiness-gate.sh',
  'scripts/collect-phase9-evidence.sh',
  'scripts/validate-phase9-evidence.js',
  'scripts/create-uat-evidence-pack.js',
  'scripts/validate-uat-evidence-pack.js',
  'scripts/summarize-uat-evidence.js',
  'scripts/scan-uat-evidence-safety.js',
  'scripts/create-go-live-signoff-draft.js',
  'scripts/create-ops-signoff-draft.js',
  'scripts/create-restore-drill-evidence-pack.js',
  'scripts/validate-restore-drill-evidence.js',
  'scripts/create-operator-gate-evidence-pack.js',
  'scripts/validate-operator-gate-evidence.js',
  'scripts/validate-go-live-signoff.js',
  'scripts/verify-100-readiness.js',
  'scripts/create-go-live-bundle.js',
];

const referencedFiles = [
  ...docs,
  ...scripts,
  selectedEvidence ? path.join(rel(selectedEvidence), 'summary.md') : null,
  selectedEvidence ? path.join(rel(selectedEvidence), 'manifest.json') : null,
  selectedUatEvidence ? path.join(rel(selectedUatEvidence), 'README.md') : null,
  selectedUatEvidence ? path.join(rel(selectedUatEvidence), 'manifest.json') : null,
  selectedRestoreDrillEvidence ? path.join(rel(selectedRestoreDrillEvidence), 'README.md') : null,
  selectedRestoreDrillEvidence ? path.join(rel(selectedRestoreDrillEvidence), 'restore-drill-result.md') : null,
  selectedRestoreDrillEvidence ? path.join(rel(selectedRestoreDrillEvidence), 'manifest.json') : null,
  selectedOperatorGateEvidence ? path.join(rel(selectedOperatorGateEvidence), 'README.md') : null,
  selectedOperatorGateEvidence ? path.join(rel(selectedOperatorGateEvidence), 'operator-gate-result.md') : null,
  selectedOperatorGateEvidence ? path.join(rel(selectedOperatorGateEvidence), 'production-gate.redacted.log') : null,
  selectedOperatorGateEvidence ? path.join(rel(selectedOperatorGateEvidence), 'postdeploy-gate.redacted.log') : null,
  selectedOperatorGateEvidence ? path.join(rel(selectedOperatorGateEvidence), 'monitor-pm2.redacted.log') : null,
  selectedOperatorGateEvidence ? path.join(rel(selectedOperatorGateEvidence), 'monitor-health-check.redacted.log') : null,
  selectedOperatorGateEvidence ? path.join(rel(selectedOperatorGateEvidence), 'monitor-offhost-sync.redacted.log') : null,
  selectedOperatorGateEvidence ? path.join(rel(selectedOperatorGateEvidence), 'manifest.json') : null,
  uatSafetyReport ? path.join(rel(uatSafetyReport), 'summary.md') : null,
  uatSafetyReport ? path.join(rel(uatSafetyReport), 'manifest.json') : null,
  signoffDraftReport ? path.join(rel(signoffDraftReport), 'summary.md') : null,
  signoffDraftReport ? path.join(rel(signoffDraftReport), 'UAT_SIGNOFF_DRAFT.md') : null,
  signoffDraftReport ? path.join(rel(signoffDraftReport), 'manifest.json') : null,
  opsSignoffDraftReport ? path.join(rel(opsSignoffDraftReport), 'summary.md') : null,
  opsSignoffDraftReport ? path.join(rel(opsSignoffDraftReport), 'OPS_SIGNOFF_DRAFT.md') : null,
  opsSignoffDraftReport ? path.join(rel(opsSignoffDraftReport), 'ops-transfer.csv') : null,
  opsSignoffDraftReport ? path.join(rel(opsSignoffDraftReport), 'manifest.json') : null,
  readinessReport ? rel(readinessReport) : null,
].filter(Boolean);

const fileHashes = referencedFiles.map((file) => fileRecord(file));
const checks = [gitStatus, phase9Validation, uatSafetyValidation, signoffDraftValidation, opsSignoffDraftValidation, restoreDrillValidation, operatorGateValidation, uatValidation, signoffValidation, readinessValidation];
const totals = checks.reduce((acc, check) => {
  acc[check.status.toLowerCase()] = (acc[check.status.toLowerCase()] || 0) + 1;
  return acc;
}, { pass: 0, pending: 0, fail: 0 });

const readinessDecision = decisionFromReadiness(readinessSummary, readinessValidation.status);
const pendingActionItems = actionItems();
const safety = {
  calls_apis: false,
  runs_restore_drill: false,
  runs_deploy: false,
  runs_migrations: false,
  runs_imports: false,
  runs_feature_flags: false,
  writes_production_db: false,
  copies_raw_uat_evidence: false,
};

writeFile('EXECUTIVE_BRIEF.md', executiveBrief(readinessDecision, readinessSummary));
writeFile('OPERATOR_COMMANDS.md', operatorCommands());
writeFile('SIGNOFF_INDEX.md', signoffIndex());
writeFile('SOURCE_STATE.md', sourceState());
writeFile('ACTION_PLAN.md', actionPlan());
writeFile('ACTION_ITEMS.csv', actionItemsCsv(pendingActionItems));
writeFile('ACTION_ITEMS.json', `${JSON.stringify(pendingActionItems, null, 2)}\n`);
writeFile('summary.md', summary(readinessDecision, readinessSummary, checks, fileHashes));
writeFile('manifest.json', `${JSON.stringify({
  generated_at: generatedAt,
  run_id: runId,
  root: ROOT,
  git_head: gitHead || null,
  allow_pending: allowPending,
  bundle_dir: rel(bundleDir),
  selected_evidence: selectedEvidence ? rel(selectedEvidence) : null,
  selected_uat_evidence: selectedUatEvidence ? rel(selectedUatEvidence) : null,
  selected_restore_drill_evidence: selectedRestoreDrillEvidence ? rel(selectedRestoreDrillEvidence) : null,
  selected_operator_gate_evidence: selectedOperatorGateEvidence ? rel(selectedOperatorGateEvidence) : null,
  readiness_report: readinessReport ? rel(readinessReport) : null,
  safety,
  bundle_files: [
    'EXECUTIVE_BRIEF.md',
    'OPERATOR_COMMANDS.md',
    'SIGNOFF_INDEX.md',
    'SOURCE_STATE.md',
    'ACTION_PLAN.md',
    'ACTION_ITEMS.csv',
    'ACTION_ITEMS.json',
    'summary.md',
    'manifest.json',
  ],
  checks: checks.map((check) => ({
    id: check.id,
    status: check.status,
    exit_code: check.exitCode,
    log: check.log ? rel(check.log) : null,
    detail: check.detail,
  })),
  totals,
  referenced_files: fileHashes,
}, null, 2)}\n`);

console.log(`[go-live-bundle] output: ${bundleDir}`);
console.log(`[go-live-bundle] readiness=${readinessDecision} pass=${readinessSummary.pass} pending=${readinessSummary.pending} fail=${readinessSummary.fail} allow_pending=${allowPending}`);
console.log('[go-live-bundle] safety: no APIs, DB writes, deploys, restore drills, imports, migrations, or feature flags');

if (totals.fail > 0) {
  process.exit(1);
}
if (!allowPending && (totals.pending > 0 || readinessSummary.pending > 0)) {
  process.exit(1);
}

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

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function normalizePackPath(input) {
  if (!input) return null;
  if (!fs.existsSync(input)) return input;
  const stat = fs.statSync(input);
  return stat.isDirectory() ? input : path.dirname(input);
}

function latestPack(root) {
  if (!fs.existsSync(root)) return null;
  const dirs = fs.readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((candidate) => fs.existsSync(path.join(candidate, 'manifest.json')))
    .map((candidate) => ({
      path: candidate,
      mtimeMs: fs.statSync(path.join(candidate, 'manifest.json')).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dirs.length > 0 ? dirs[0].path : null;
}

function git(argsForGit) {
  const result = spawnSync('git', argsForGit, { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function runGitStatus() {
  const check = run('git-status', 'git', ['status', '--short'], { expectedStatuses: [0] });
  if (check.status !== 'PASS') return check;

  const changed = check.output.split(/\r?\n/).filter((line) => line.trim()).length;
  if (changed === 0) {
    return { ...check, detail: 'working tree clean' };
  }

  return {
    ...check,
    status: 'PENDING',
    detail: `working tree has ${changed} changed/untracked entries; final deploy approval should reference a committed/approved source state`,
  };
}

function runNode(id, script, argsForScript) {
  return run(id, process.execPath, [path.join(ROOT, script), ...argsForScript], { expectedStatuses: [0] });
}

function run(id, command, argsForCommand, options = {}) {
  const logPath = path.join(logsDir, `${id}.log`);
  const result = spawnSync(command, argsForCommand, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const exitCode = result.status == null ? 1 : result.status;
  const expected = options.expectedStatuses || [0];
  const status = classifyStatus(output, exitCode, expected);
  fs.writeFileSync(logPath, output || `(no output, exit ${exitCode})\n`);
  return {
    id,
    status,
    exitCode,
    log: logPath,
    output,
    detail: firstSummaryLine(output) || `exit=${exitCode}`,
  };
}

function missingCheck(id, detail) {
  const logPath = path.join(logsDir, `${id}.log`);
  fs.writeFileSync(logPath, `${detail}\n`);
  return {
    id,
    status: 'PENDING',
    exitCode: 1,
    log: logPath,
    output: detail,
    detail,
  };
}

function classifyStatus(output, exitCode, expectedStatuses) {
  if (/pending=[1-9]\d*/i.test(output) && /fail=0/i.test(output)) return 'PENDING';
  if (allowPending && /PENDING/i.test(output) && !/FAIL:/i.test(output)) return 'PENDING';
  return expectedStatuses.includes(exitCode) ? 'PASS' : 'FAIL';
}

function firstSummaryLine(output) {
  return String(output || '').split(/\r?\n/).find((line) => /summary|PASS \(pending allowed\)|PASS$/i.test(line)) || '';
}

function parseReadySummary(output) {
  const match = String(output || '').match(/\[ready-100\] summary pass=(\d+) pending=(\d+) fail=(\d+)/);
  if (!match) return { pass: 0, pending: 0, fail: 1 };
  return {
    pass: Number(match[1]),
    pending: Number(match[2]),
    fail: Number(match[3]),
  };
}

function parseReadyReport(output) {
  const match = String(output || '').match(/\[ready-100\] report: (.+)/);
  return match ? match[1].trim() : null;
}

function parseToolOutputPath(output, prefix) {
  const line = String(output || '').split(/\r?\n/).find((candidate) => candidate.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : null;
}

function decisionFromReadiness(ready, checkStatus) {
  if (ready.fail > 0 || checkStatus === 'FAIL') return 'FAIL';
  if (ready.pending > 0 || checkStatus === 'PENDING') return 'PENDING';
  return 'PASS';
}

function sha256File(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

function fileRecord(file) {
  const absPath = path.isAbsolute(file) ? file : path.join(ROOT, file);
  const exists = fs.existsSync(absPath);
  return {
    path: path.isAbsolute(file) ? rel(file) : file.replace(/\\/g, '/'),
    exists,
    sha256: exists && fs.statSync(absPath).isFile() ? sha256File(absPath) : null,
  };
}

function writeFile(name, content) {
  fs.writeFileSync(path.join(bundleDir, name), content);
}

function statusRows(checksForRows) {
  return checksForRows.map((check) => `| ${check.id} | ${check.status} | ${check.detail.replace(/\|/g, '\\|')} | \`${rel(check.log)}\` |`).join('\n');
}

function hashRows(files) {
  return files.map((file) => `| \`${file.path}\` | ${file.exists ? 'yes' : 'no'} | ${file.sha256 ? `\`${file.sha256}\`` : ''} |`).join('\n');
}

function executiveBrief(decision, ready) {
  const statusText = decision === 'PASS'
    ? 'Ready for final go-live declaration after current evidence is accepted.'
    : decision === 'PENDING'
      ? 'Controlled rollout materials are ready; final 100% declaration is pending human/operator gates.'
      : 'Not ready for go-live declaration; fix failed checks first.';

  return `# Go-live Executive Brief

- Generated: ${generatedAt}
- Current status: ${decision}
- Summary: ${statusText}
- Readiness verifier: PASS ${ready.pass}, PENDING ${ready.pending}, FAIL ${ready.fail}
- Branch/commit: \`${gitHead || 'unknown'}\`

## Ready Now

- Local and public evidence can be reviewed from existing evidence packs.
- UAT role templates and sign-off documents are prepared.
- Operator commands for production read-only gate, restore drill, deploy, postdeploy gate, monitor, and evidence validation are indexed in this bundle.
- The bundle does not copy raw UAT screenshots or sensitive evidence; it references paths and hashes files.

## Still Required Before 100%

- Complete role UAT and fill \`docs/UAT_SIGNOFF_2026-08.md\`.
- Complete owner/operator/DPO approval in \`docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md\`.
- Run approved production read-only gate, restore drill to \`lampang_bus_restore_drill\`, deployment, postdeploy gate, monitor, and both operator evidence validators.
- Run \`node scripts/verify-100-readiness.js\` without \`--allow-pending\` and get PASS.
`;
}

function operatorCommands() {
  return `# Operator Commands

Run these only after the matching approval row is signed in \`docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md\`.

## Public Evidence

\`\`\`bash
BASE_URL=https://schoolbuslampang.com bash scripts/production-readiness-gate.sh public
BASE_URL=https://schoolbuslampang.com bash scripts/collect-phase9-evidence.sh public
node scripts/validate-phase9-evidence.js outputs/phase9-evidence/<timestamp> --require-mode public
\`\`\`

## Production Read-only Gate

\`\`\`bash
cd /home/schoolbus/apps/lampang-bus-system
node scripts/create-operator-gate-evidence-pack.js --base-url http://127.0.0.1:3000
set -o pipefail
BASE_URL=http://127.0.0.1:3000 bash scripts/production-readiness-gate.sh production 2>&1 | tee outputs/operator-gates/<timestamp>/production-gate.redacted.log
\`\`\`

## Restore Drill

\`\`\`bash
cd /home/schoolbus/apps/lampang-bus-system
node scripts/create-restore-drill-evidence-pack.js
mysql -e "CREATE DATABASE IF NOT EXISTS lampang_bus_restore_drill CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
set -o pipefail
RESTORE_DB=lampang_bus_restore_drill bash scripts/restore-drill-db.sh 2>&1 | tee outputs/restore-drill/<timestamp>/restore-drill-output.redacted.log
node scripts/validate-restore-drill-evidence.js outputs/restore-drill/<timestamp>
\`\`\`

Confirm backup checksum/gzip PASS, restore target is \`lampang_bus_restore_drill\`, key row counts are correct or explained, production aggregate counts are unchanged, and the restore drill evidence validator passes.

## Postdeploy Gate And Monitor

\`\`\`bash
cd /home/schoolbus/apps/lampang-bus-system
set -o pipefail
BASE_URL=http://127.0.0.1:3000 bash scripts/production-readiness-gate.sh postdeploy 2>&1 | tee outputs/operator-gates/<timestamp>/postdeploy-gate.redacted.log
pm2 logs schoolbus-backend --lines 100 --nostream > outputs/operator-gates/<timestamp>/monitor-pm2.redacted.log 2>&1
tail -n 100 /home/schoolbus/backups/lampang-bus/health-check.log > outputs/operator-gates/<timestamp>/monitor-health-check.redacted.log 2>&1
tail -n 100 /home/schoolbus/logs/offhost-sync.log > outputs/operator-gates/<timestamp>/monitor-offhost-sync.redacted.log 2>&1
node scripts/validate-operator-gate-evidence.js outputs/operator-gates/<timestamp>
\`\`\`

## Final Verification

\`\`\`bash
node scripts/validate-uat-evidence-pack.js outputs/uat-evidence/<timestamp>
node scripts/summarize-uat-evidence.js outputs/uat-evidence/<timestamp>
node scripts/scan-uat-evidence-safety.js outputs/uat-evidence/<timestamp>
node scripts/create-go-live-signoff-draft.js outputs/uat-evidence/<timestamp>
node scripts/create-ops-signoff-draft.js --phase9-evidence outputs/phase9-evidence/<timestamp> --restore-drill outputs/restore-drill/<timestamp> --operator-gates outputs/operator-gates/<timestamp>
node scripts/validate-restore-drill-evidence.js outputs/restore-drill/<timestamp>
node scripts/validate-operator-gate-evidence.js outputs/operator-gates/<timestamp>
node scripts/validate-go-live-signoff.js
node scripts/verify-100-readiness.js --evidence outputs/phase9-evidence/<timestamp> --restore-drill outputs/restore-drill/<timestamp> --operator-gates outputs/operator-gates/<timestamp>
node scripts/create-go-live-bundle.js --evidence outputs/phase9-evidence/<timestamp> --uat-evidence outputs/uat-evidence/<timestamp> --restore-drill outputs/restore-drill/<timestamp> --operator-gates outputs/operator-gates/<timestamp>
\`\`\`
`;
}

function signoffIndex() {
  return `# Sign-off Index

## Primary Documents

- \`docs/READINESS_SCORECARD_2026-08.md\`
- \`docs/UAT_SIGNOFF_2026-08.md\`
- \`docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md\`
- \`docs/PHASE9_PRODUCTION_GATE_2026-08.md\`

## Evidence Selected By This Bundle

- Phase 9 evidence: ${selectedEvidence ? `\`${rel(selectedEvidence)}\`` : 'not found'}
- UAT evidence: ${selectedUatEvidence ? `\`${rel(selectedUatEvidence)}\`` : 'not found'}
- Restore drill evidence: ${selectedRestoreDrillEvidence ? `\`${rel(selectedRestoreDrillEvidence)}\`` : 'not found'}
- Operator gate evidence: ${selectedOperatorGateEvidence ? `\`${rel(selectedOperatorGateEvidence)}\`` : 'not found'}
- UAT safety report: ${uatSafetyReport ? `\`${rel(uatSafetyReport)}\`` : 'not generated'}
- Sign-off draft: ${signoffDraftReport ? `\`${rel(signoffDraftReport)}\`` : 'not generated'}
- Ops sign-off draft: ${opsSignoffDraftReport ? `\`${rel(opsSignoffDraftReport)}\`` : 'not generated'}
- Readiness report: ${readinessReport ? `\`${rel(readinessReport)}\`` : 'not generated'}

## Safety

- Do not attach passwords, tokens, LINE secrets, raw student lists, full CID, or unredacted parent/student screenshots.
- This bundle keeps references and hashes only; raw role evidence remains in the selected UAT evidence folder.
`;
}

function sourceState() {
  const entries = parseGitStatus(gitStatus.output);
  const sourceCandidates = entries.filter((entry) => !isLocalEvidencePath(entry.path));
  const localEvidence = entries.filter((entry) => isLocalEvidencePath(entry.path));
  const sourceRows = sourceCandidates.length > 0
    ? sourceCandidates.map((entry) => `| \`${entry.status}\` | \`${entry.path}\` |`).join('\n')
    : '| clean | none |';
  const localRows = localEvidence.length > 0
    ? localEvidence.map((entry) => `| \`${entry.status}\` | \`${entry.path}\` |`).join('\n')
    : '| ignored or clean | outputs/, task_plan.md, notes.md |';
  const gitAddCommand = sourceCandidates.length > 0
    ? `git add ${sourceCandidates.map((entry) => shellQuote(entry.path)).join(' ')}`
    : '# no source files to stage';

  return `# Source State Approval

- Generated: ${generatedAt}
- Branch HEAD: \`${gitHead || 'unknown'}\`
- Git status: ${gitStatus.status}
- Source candidate count: ${sourceCandidates.length}
- Local evidence/planning count: ${localEvidence.length}

## Purpose

This file separates deployable source changes from local evidence output. It does not stage, commit, deploy, run migrations, write production DB, or change feature flags.

## Source Candidates For Review

| Status | Path |
|---|---|
${sourceRows}

## Local Evidence Or Planning Files

These files are intentionally local and should not be deployed or committed as source.

| Status | Path |
|---|---|
${localRows}

## Suggested Approval Flow

1. Review every source candidate above.
2. Confirm no secret, raw UAT screenshot, full student/parent PII, or environment-specific file is included.
3. Run the local and public gates again.
4. Stage and commit only after owner/technical-owner approval.

## Suggested Stage Command

\`\`\`bash
${gitAddCommand}
\`\`\`

After staging, run:

\`\`\`bash
git diff --cached --check
git status --short
\`\`\`

Do not deploy until the approved commit hash is recorded in the owner/operator approval packet.
`;
}

function actionPlan() {
  const uatRoles = summarizeUatPending(uatValidation.output);
  const signoffSections = summarizeSignoffPending(signoffValidation.output);
  const readinessPending = extractPending(readinessValidation.output, '[ready-100]');
  const approvalScopes = extractMatchingPending(signoffValidation.output, /^\[go-live-signoff\] PENDING: Approval scope (.+?) approval missing$/);

  const uatRows = uatRoles.length > 0
    ? uatRoles.map((role) => `| ${role.role} | ${role.total} | ${role.tester} | ${role.route} | ${role.checks} | ${role.signoff} |`).join('\n')
    : '| none | 0 | 0 | 0 | 0 | 0 |';

  const signoffRows = signoffSections.length > 0
    ? signoffSections.map((section) => `| ${section.section} | ${section.total} |`).join('\n')
    : '| none | 0 |';

  const readinessBullets = readinessPending.length > 0
    ? readinessPending.map((line) => `- ${line}`).join('\n')
    : '- No readiness pending lines found';

  const scopeBullets = approvalScopes.length > 0
    ? approvalScopes.map((scope) => `- ${scope}`).join('\n')
    : '- No approval scopes pending';

  return `# Phase 9 Action Plan

- Generated: ${generatedAt}
- Status: ${readinessDecision}
- Source state: ${gitStatus.detail}
- Phase 9 evidence: ${selectedEvidence ? `\`${rel(selectedEvidence)}\`` : 'not found'}
- UAT evidence: ${selectedUatEvidence ? `\`${rel(selectedUatEvidence)}\`` : 'not found'}
- Restore drill evidence: ${selectedRestoreDrillEvidence ? `\`${rel(selectedRestoreDrillEvidence)}\`` : 'not found'}
- Operator gate evidence: ${selectedOperatorGateEvidence ? `\`${rel(selectedOperatorGateEvidence)}\`` : 'not found'}
- Source state file: \`SOURCE_STATE.md\`
- Action items: \`ACTION_ITEMS.csv\`, \`ACTION_ITEMS.json\`
- Action item rows: ${pendingActionItems.length}

## Close These Before 100%

1. Finish all role UAT evidence files in the selected UAT evidence pack.
2. Generate and review the UAT and Ops sign-off drafts, then transfer approved PASS results and evidence links into \`docs/UAT_SIGNOFF_2026-08.md\`.
3. Fill owner/operator/DPO approval fields in \`docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md\`.
4. Commit or otherwise approve the exact source state that will be deployed.
5. Run the approved production read-only gate, restore drill, restore evidence validator, deploy, postdeploy gate, 30-60 minute monitor, and operator gate evidence validator.
6. Update the scorecard to Overall 100% only after every strict validator passes.

## UAT Evidence Pending By Role

| Role | Total pending | Tester info | Route smoke | Role checks | Sign-off |
|---|---:|---:|---:|---:|---:|
${uatRows}

## Sign-off Pending By Section

| Section | Pending fields |
|---|---:|
${signoffRows}

## Approval Scopes Still Blank

${scopeBullets}

## Readiness Verifier Pending

${readinessBullets}

## Exact Final Commands

\`\`\`bash
node scripts/validate-uat-evidence-pack.js outputs/uat-evidence/<timestamp>
node scripts/summarize-uat-evidence.js outputs/uat-evidence/<timestamp>
node scripts/scan-uat-evidence-safety.js outputs/uat-evidence/<timestamp>
node scripts/create-go-live-signoff-draft.js outputs/uat-evidence/<timestamp>
node scripts/create-ops-signoff-draft.js --phase9-evidence outputs/phase9-evidence/<timestamp> --restore-drill outputs/restore-drill/<timestamp> --operator-gates outputs/operator-gates/<timestamp>
node scripts/validate-go-live-signoff.js
node scripts/validate-restore-drill-evidence.js outputs/restore-drill/<timestamp>
node scripts/validate-operator-gate-evidence.js outputs/operator-gates/<timestamp>
node scripts/verify-100-readiness.js --evidence outputs/phase9-evidence/<timestamp> --restore-drill outputs/restore-drill/<timestamp> --operator-gates outputs/operator-gates/<timestamp>
node scripts/create-go-live-bundle.js --evidence outputs/phase9-evidence/<timestamp> --uat-evidence outputs/uat-evidence/<timestamp> --restore-drill outputs/restore-drill/<timestamp> --operator-gates outputs/operator-gates/<timestamp>
\`\`\`

All final commands must pass without \`--allow-pending\` before the system can be called 100%.
`;
}

function actionItems() {
  const items = [];
  const selectedUat = selectedUatEvidence ? rel(selectedUatEvidence) : '';
  const selectedPhase9 = selectedEvidence ? rel(selectedEvidence) : '';

  if (gitStatus.status === 'PENDING') {
    items.push({
      id: 'source-state-approval',
      category: 'source-state',
      owner: 'technical-owner',
      priority: 'P1',
      pending_count: 1,
      source: 'git status --short',
      evidence: 'SOURCE_STATE.md',
      action: 'Commit or otherwise approve the exact source state that will be deployed.',
    });
  }

  for (const role of summarizeUatPending(uatValidation.output)) {
    items.push({
      id: `uat-${role.role}`,
      category: 'uat-evidence',
      owner: role.role,
      priority: 'P1',
      pending_count: role.total,
      source: `${selectedUat}/${role.role}.md`,
      evidence: `${selectedUat}/${role.role}.md`,
      action: `Complete tester info, route smoke, role checks, and sign-off for ${role.role}.`,
    });
  }

  for (const section of summarizeSignoffPending(signoffValidation.output)) {
    const source = section.section === 'Approval scope' || section.section === 'Owner/operator approval'
      ? 'docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md'
      : 'docs/UAT_SIGNOFF_2026-08.md';
    items.push({
      id: `signoff-${safeName(section.section).toLowerCase()}`,
      category: 'signoff',
      owner: sectionOwner(section.section),
      priority: 'P1',
      pending_count: section.total,
      source,
      evidence: source,
      action: `Fill PASS/evidence/date/name/signature fields for ${section.section}.`,
    });
  }

  for (const scope of extractMatchingPending(signoffValidation.output, /^\[go-live-signoff\] PENDING: Approval scope (.+?) approval missing$/)) {
    items.push({
      id: `approval-${safeName(scope).toLowerCase()}`,
      category: 'approval-scope',
      owner: approvalOwner(scope),
      priority: 'P0',
      pending_count: 1,
      source: 'docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md',
      evidence: 'docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md',
      action: `Owner/operator must explicitly approve: ${scope}.`,
    });
  }

  for (const pending of extractPending(readinessValidation.output, '[ready-100]')) {
    items.push({
      id: `readiness-${safeName(pending).toLowerCase()}`,
      category: 'readiness-verifier',
      owner: readinessOwner(pending),
      priority: 'P0',
      pending_count: 1,
      source: selectedPhase9 || 'outputs/phase9-evidence/<timestamp>',
      evidence: readinessValidation.log ? rel(readinessValidation.log) : '',
      action: pending,
    });
  }

  return items;
}

function sectionOwner(section) {
  if (/LINE/i.test(section)) return 'line-uat-lead';
  if (/Ops|Approval|Owner\/operator/i.test(section)) return 'operator';
  if (/Report/i.test(section)) return 'report-uat-lead';
  if (/Role|Common|UAT sign-off/i.test(section)) return 'uat-lead';
  return 'project-owner';
}

function approvalOwner(scope) {
  if (/restore/i.test(scope)) return 'operator';
  if (/deploy|postdeploy|monitor/i.test(scope)) return 'technical-owner';
  if (/production read-only gate/i.test(scope)) return 'operator';
  return 'project-owner';
}

function readinessOwner(pending) {
  if (/uat-evidence/i.test(pending)) return 'uat-lead';
  if (/restore-drill/i.test(pending)) return 'operator';
  if (/operator-gate|production\/postdeploy|monitor/i.test(pending)) return 'operator';
  if (/signoff|approval/i.test(pending)) return 'project-owner';
  if (/scorecard/i.test(pending)) return 'technical-owner';
  return 'operator';
}

function actionItemsCsv(items) {
  const columns = ['id', 'category', 'owner', 'priority', 'pending_count', 'source', 'evidence', 'action'];
  const rows = [
    columns.join(','),
    ...items.map((item) => columns.map((column) => csvCell(item[column])).join(',')),
  ];
  return `${rows.join('\n')}\n`;
}

function csvCell(value) {
  const text = String(value == null ? '' : value);
  return `"${text.replace(/"/g, '""')}"`;
}

function summary(decision, ready, checksForSummary, fileHashRecords) {
  return `# Go-live Bundle Summary

- Generated: ${generatedAt}
- Run ID: \`${runId}\`
- Status: ${decision}
- Allow pending: ${allowPending}
- Git HEAD: \`${gitHead || 'unknown'}\`
- Phase 9 evidence: ${selectedEvidence ? `\`${rel(selectedEvidence)}\`` : 'not found'}
- UAT evidence: ${selectedUatEvidence ? `\`${rel(selectedUatEvidence)}\`` : 'not found'}
- Restore drill evidence: ${selectedRestoreDrillEvidence ? `\`${rel(selectedRestoreDrillEvidence)}\`` : 'not found'}
- Operator gate evidence: ${selectedOperatorGateEvidence ? `\`${rel(selectedOperatorGateEvidence)}\`` : 'not found'}
- Ops sign-off draft: ${opsSignoffDraftReport ? `\`${rel(opsSignoffDraftReport)}\`` : 'not generated'}
- Readiness report: ${readinessReport ? `\`${rel(readinessReport)}\`` : 'not generated'}
- Source state: \`SOURCE_STATE.md\`
- Action plan: \`ACTION_PLAN.md\`
- Action items: \`ACTION_ITEMS.csv\`, \`ACTION_ITEMS.json\`
- Action item rows: ${pendingActionItems.length}

## Readiness Verifier

- PASS: ${ready.pass}
- PENDING: ${ready.pending}
- FAIL: ${ready.fail}

## Checks

| Check | Status | Detail | Log |
|---|---|---|---|
${statusRows(checksForSummary)}

## Referenced Files

| File | Exists | SHA-256 |
|---|---|---|
${hashRows(fileHashRecords)}

## Safety

- This bundle does not call APIs, write production DB, deploy, run restore drills, run migrations/imports, or change feature flags.
- It does not copy raw UAT screenshots or sensitive evidence. It records paths and hashes so reviewers can verify the same files locally.
- Keep secrets and student/parent PII out of attached evidence.

## Final Rule

Do not call the system 100% complete until \`node scripts/verify-100-readiness.js\` passes without \`--allow-pending\`, the scorecard is updated to Overall 100%, production/postdeploy gates pass, restore drill passes, and owner/operator/DPO sign-off is complete.
`;
}

function extractPending(output, prefix) {
  const marker = `${prefix} PENDING: `;
  return String(output || '').split(/\r?\n/)
    .filter((line) => line.startsWith(marker))
    .map((line) => line.slice(marker.length).trim())
    .filter(Boolean);
}

function extractMatchingPending(output, pattern) {
  return String(output || '').split(/\r?\n/)
    .map((line) => {
      const match = line.match(pattern);
      return match ? match[1].trim() : '';
    })
    .filter(Boolean);
}

function summarizeUatPending(output) {
  const roleOrder = ['admin', 'province', 'affiliation', 'school-full', 'school-teacher', 'driver', 'transport', 'parent-line', 'operator'];
  const roleMap = new Map(roleOrder.map((role) => [role, {
    role,
    total: 0,
    tester: 0,
    route: 0,
    checks: 0,
    signoff: 0,
  }]));

  for (const line of extractPending(output, '[uat-evidence]')) {
    const role = roleOrder.find((candidate) => line.startsWith(`${candidate} `));
    if (!role) continue;
    const bucket = roleMap.get(role);
    bucket.total += 1;
    if (/Tester name|Tester role|Date\/time/.test(line)) bucket.tester += 1;
    else if (/\broute\b/.test(line)) bucket.route += 1;
    else if (/\bcheck\b/.test(line)) bucket.checks += 1;
    else if (/sign-off/.test(line)) bucket.signoff += 1;
  }

  return Array.from(roleMap.values()).filter((role) => role.total > 0);
}

function summarizeSignoffPending(output) {
  const sections = [
    'Common checks',
    'Role checks',
    'Report checks',
    'LINE checks',
    'Ops checks',
    'UAT sign-off',
    'Approval scope',
    'Owner/operator approval',
  ];
  const counts = new Map(sections.map((section) => [section, 0]));

  for (const line of extractPending(output, '[go-live-signoff]')) {
    const section = sections.find((candidate) => line.startsWith(`${candidate} `));
    if (section) counts.set(section, counts.get(section) + 1);
  }

  return sections.map((section) => ({
    section,
    total: counts.get(section) || 0,
  })).filter((section) => section.total > 0);
}

function parseGitStatus(output) {
  return String(output || '').split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim() || line.slice(0, 2),
      path: line.slice(3).trim(),
    }))
    .filter((entry) => entry.path);
}

function isLocalEvidencePath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  return normalized === 'task_plan.md'
    || normalized === 'notes.md'
    || normalized === 'outputs'
    || normalized.startsWith('outputs/');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\"'\"'")}'`;
}
