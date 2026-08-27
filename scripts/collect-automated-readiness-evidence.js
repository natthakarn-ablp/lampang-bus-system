#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT_ROOT = path.join(ROOT, 'outputs', 'automated-readiness');
const DEFAULT_BASE_URL = 'https://schoolbuslampang.com';

let outRoot = DEFAULT_OUT_ROOT;
let runId = timestampBangkok();
let baseUrl = DEFAULT_BASE_URL;
let phase9Evidence = latestPack(path.join(ROOT, 'outputs', 'phase9-evidence'));
let uatEvidence = latestPack(path.join(ROOT, 'outputs', 'uat-evidence'));
let restoreEvidence = latestPack(path.join(ROOT, 'outputs', 'restore-drill'));
let operatorEvidence = latestPack(path.join(ROOT, 'outputs', 'operator-gates'));
let bundlePath = latestPack(path.join(ROOT, 'outputs', 'go-live-bundle'));
let closurePath = latestPack(path.join(ROOT, 'outputs', 'go-live-closure-status'));

function usage() {
  console.error('Usage: node scripts/collect-automated-readiness-evidence.js [--out-dir <dir>] [--run-id <id>] [--base-url <url>] [--phase9-evidence <dir>] [--uat-evidence <dir>] [--restore-drill <dir>] [--operator-gates <dir>] [--bundle <dir>] [--closure <dir>]');
}

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--out-dir' && args[i + 1]) {
    outRoot = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--run-id' && args[i + 1]) {
    runId = safeName(args[i + 1]);
    i += 1;
  } else if (arg === '--base-url' && args[i + 1]) {
    baseUrl = args[i + 1].replace(/\/+$/, '');
    i += 1;
  } else if (arg === '--phase9-evidence' && args[i + 1]) {
    phase9Evidence = normalizePack(args[i + 1]);
    i += 1;
  } else if (arg === '--uat-evidence' && args[i + 1]) {
    uatEvidence = normalizePack(args[i + 1]);
    i += 1;
  } else if (arg === '--restore-drill' && args[i + 1]) {
    restoreEvidence = normalizePack(args[i + 1]);
    i += 1;
  } else if (arg === '--operator-gates' && args[i + 1]) {
    operatorEvidence = normalizePack(args[i + 1]);
    i += 1;
  } else if (arg === '--bundle' && args[i + 1]) {
    bundlePath = normalizePack(args[i + 1]);
    i += 1;
  } else if (arg === '--closure' && args[i + 1]) {
    closurePath = normalizePack(args[i + 1]);
    i += 1;
  } else {
    usage();
    process.exit(2);
  }
}

const outDir = path.join(outRoot, runId);
const logsDir = path.join(outDir, 'logs');
fs.mkdirSync(logsDir, { recursive: true });

const generatedAt = new Date().toISOString();
const automated = [];
const humanActions = [];
const gitHead = git(['rev-parse', '--short', 'HEAD']).trim();
const gitStatus = git(['status', '--short']);

recordInline('git-status', 'source-state', gitStatus.trim() ? 'PENDING' : 'PASS', gitStatus.trim() ? 'worktree has source changes' : 'worktree clean', gitStatus || '(clean)');
recordSecretScan('secret-scan-head', 'git show --format= --patch HEAD', git(['show', '--format=', '--patch', 'HEAD']));
recordSecretScan('secret-scan-staged', 'git diff --cached', git(['diff', '--cached']));

runBashGate('local-gate', 'local full gate', ['scripts/production-readiness-gate.sh', 'local'], {});
runBashGate('public-gate', 'public external gate', ['scripts/production-readiness-gate.sh', 'public'], { BASE_URL: baseUrl });
runNode('phase9-evidence-public', 'Phase 9 public evidence validator', 'scripts/validate-phase9-evidence.js', [
  phase9Evidence,
  '--require-mode',
  'public',
]);
runNode('uat-evidence-structure', 'UAT evidence structure validator', 'scripts/validate-uat-evidence-pack.js', [
  uatEvidence,
  '--allow-pending',
]);
runNode('uat-evidence-safety', 'UAT evidence safety scan', 'scripts/scan-uat-evidence-safety.js', [
  uatEvidence,
  '--out-dir',
  path.join(outDir, 'uat-safety'),
  '--run-id',
  'scan',
]);
runNode('restore-drill-evidence-structure', 'Restore drill evidence validator', 'scripts/validate-restore-drill-evidence.js', [
  restoreEvidence,
  '--allow-pending',
]);
runNode('operator-gate-evidence-structure', 'Operator gate evidence validator', 'scripts/validate-operator-gate-evidence.js', [
  operatorEvidence,
  '--allow-pending',
]);
runNode('go-live-signoff-structure', 'Go-live sign-off validator', 'scripts/validate-go-live-signoff.js', ['--allow-pending']);
runNode('readiness-100-aggregate', '100% readiness aggregate verifier', 'scripts/verify-100-readiness.js', [
  '--allow-pending',
  '--evidence',
  phase9Evidence,
  '--restore-drill',
  restoreEvidence,
  '--operator-gates',
  operatorEvidence,
  '--no-report',
]);
runNode('go-live-bundle-structure', 'Go-live bundle validator', 'scripts/validate-go-live-bundle.js', [
  bundlePath,
  '--allow-pending',
]);
runNode('closure-status-structure', 'Closure status validator', 'scripts/validate-go-live-closure-status.js', [
  closurePath,
  '--allow-pending',
]);

capabilityAudit();

const totals = automated.reduce((acc, check) => {
  acc[check.status.toLowerCase()] = (acc[check.status.toLowerCase()] || 0) + 1;
  return acc;
}, { pass: 0, pending: 0, fail: 0 });

writeFile('automated-checks.json', `${JSON.stringify(automated, null, 2)}\n`);
writeFile('automated-checks.csv', csv(automated, ['id', 'category', 'status', 'detail', 'log']));
writeFile('human-actions.json', `${JSON.stringify(humanActions, null, 2)}\n`);
writeFile('human-actions.csv', csv(humanActions, ['id', 'owner', 'priority', 'action', 'reason', 'evidence']));
writeFile('summary.md', summary(totals));
writeFile('manifest.json', `${JSON.stringify({
  generated_at: generatedAt,
  run_id: runId,
  root: ROOT,
  git_head: gitHead || null,
  git_status_clean: !gitStatus.trim(),
  base_url: baseUrl,
  selected: {
    phase9_evidence: relOrNull(phase9Evidence),
    uat_evidence: relOrNull(uatEvidence),
    restore_drill: relOrNull(restoreEvidence),
    operator_gates: relOrNull(operatorEvidence),
    bundle: relOrNull(bundlePath),
    closure: relOrNull(closurePath),
  },
  totals,
  human_action_count: humanActions.length,
  safety: {
    calls_public_http: true,
    runs_local_validators: true,
    runs_deploy: false,
    runs_restore_drill: false,
    runs_migrations: false,
    runs_imports: false,
    runs_feature_flags: false,
    writes_production_db: false,
    writes_any_database: false,
    submits_signoff: false,
    fakes_approval: false,
  },
  files: ['summary.md', 'automated-checks.json', 'automated-checks.csv', 'human-actions.json', 'human-actions.csv', 'manifest.json'],
}, null, 2)}\n`);

console.log(`[automated-readiness] output: ${outDir}`);
console.log(`[automated-readiness] summary pass=${totals.pass} pending=${totals.pending} fail=${totals.fail} human_actions=${humanActions.length}`);
console.log('[automated-readiness] safety: no deploys, restore drills, migrations, imports, feature flags, sign-off, or DB writes');

if (totals.fail > 0) process.exit(1);

function runNode(id, category, script, argsForScript) {
  const filteredArgs = argsForScript.filter(Boolean);
  if (filteredArgs.length !== argsForScript.length) {
    recordInline(id, category, 'PENDING', `missing input for ${script}`, '');
    return;
  }
  const log = path.join(logsDir, `${id}.log`);
  const result = spawnSync(process.execPath, [path.join(ROOT, script), ...filteredArgs], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  fs.writeFileSync(log, output);
  const status = result.status === 0 ? statusFromOutput(output) : 'FAIL';
  record(id, category, status, detailFromOutput(output, result.status), log);
}

function runBashGate(id, category, commandArgs, env) {
  const bash = findBash();
  if (!bash) {
    recordInline(id, category, 'PENDING', 'bash is unavailable for gate runner', '');
    return;
  }
  const log = path.join(logsDir, `${id}.log`);
  const result = spawnSync(bash, commandArgs, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  fs.writeFileSync(log, output);
  const status = result.status === 0 ? 'PASS' : 'FAIL';
  const summaryLine = output.split(/\r?\n/).reverse().find((line) => line.startsWith('[gate] summary ')) || `exit=${result.status}`;
  record(id, category, status, summaryLine, log);
}

function recordSecretScan(id, category, text) {
  const matches = secretMatches(text);
  recordInline(id, category, matches.length > 0 ? 'FAIL' : 'PASS', matches.length > 0 ? `${matches.length} secret-like lines found` : 'no secret patterns found', matches.join('\n'));
}

function secretMatches(text) {
  const pattern = /(DB_PASSWORD|PASSWORD=|SECRET=|TOKEN=|Bearer |LINE_CHANNEL_SECRET|CHANNEL_ACCESS_TOKEN|mysql:\/\/|JWT_SECRET|[A-Za-z0-9_]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/;
  return String(text || '').split(/\r?\n/).filter((line) => {
    if (isScannerPatternSourceLine(line)) return false;
    return pattern.test(line);
  });
}

function isScannerPatternSourceLine(line) {
  if (line.includes("line.includes('DB_PASSWORD')")) return true;
  return line.includes('DB_PASSWORD') && (
    line.includes('const pattern') ||
    line.includes('isScannerPatternSourceLine')
  );
}

function capabilityAudit() {
  const onProductionServer = ROOT.replace(/\\/g, '/').startsWith('/home/schoolbus/apps/lampang-bus-system');
  const hasServerApproval = process.env.SCHOOLBUS_OPERATOR_APPROVED === 'true';
  const hasRestoreApproval = process.env.SCHOOLBUS_RESTORE_DRILL_APPROVED === 'true';
  const hasDeployApproval = process.env.SCHOOLBUS_DEPLOY_APPROVED === 'true';
  const hasRoleCredentials = Boolean(process.env.SCHOOLBUS_UAT_CREDENTIALS_FILE);

  if (!onProductionServer) {
    addHumanAction('production-read-only-gate', 'operator', 'P0', 'Run production read-only gate on the server and paste redacted logs into operator evidence.', `current checkout is ${ROOT}, not /home/schoolbus/apps/lampang-bus-system`, 'docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md');
    addHumanAction('postdeploy-gate-monitor', 'operator', 'P0', 'After approved deployment, run postdeploy gate and 30-60 minute monitor on the server.', 'requires server runtime, PM2/log access, and approved deployment', 'outputs/operator-gates/<timestamp>/');
  }
  if (!hasServerApproval) {
    addHumanAction('operator-approval', 'operator', 'P0', 'Approve the named production read-only, restore drill, deploy, and postdeploy scopes.', 'SCHOOLBUS_OPERATOR_APPROVED=true is not set and approval document is not signed', 'docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md');
  }
  if (!hasRestoreApproval || !onProductionServer) {
    addHumanAction('restore-drill', 'operator', 'P0', 'Run restore drill only after approval, against lampang_bus_restore_drill, using latest backup.', 'restore drill needs operator approval, server backup files, MySQL privileges, and isolated drill DB', 'outputs/restore-drill/<timestamp>/');
  }
  if (!hasDeployApproval) {
    addHumanAction('deploy-approved-commit', 'technical-owner', 'P0', `Approve and deploy commit ${gitHead || '(unknown)'} through the server runbook.`, 'SCHOOLBUS_DEPLOY_APPROVED=true is not set and deployment must not be faked', 'docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md');
  }
  if (!hasRoleCredentials) {
    addHumanAction('role-uat-evidence', 'uat-lead', 'P0', 'Run role UAT with real approved test accounts for admin/province/affiliation/school/driver/transport/parent/LINE/operator.', 'no SCHOOLBUS_UAT_CREDENTIALS_FILE is provided; role login/LINE evidence cannot be fabricated', 'outputs/uat-evidence/<timestamp>/');
  }
  addHumanAction('owner-dpo-signoff', 'project-owner', 'P0', 'Owner, technical owner, operator, and DPO/legal sign the final approval and UAT sign-off documents after evidence is real.', 'human legal/owner approval is required and must not be automated', 'docs/UAT_SIGNOFF_2026-08.md + docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md');
}

function addHumanAction(id, owner, priority, action, reason, evidence) {
  humanActions.push({ id, owner, priority, action, reason, evidence });
}

function statusFromOutput(output) {
  return /\bPENDING\b/.test(output) ? 'PENDING' : 'PASS';
}

function detailFromOutput(output, exitStatus) {
  const lines = String(output || '').split(/\r?\n/).filter(Boolean);
  const summary = lines.reverse().find((line) => /summary|PASS|PENDING|FAIL/.test(line));
  return summary || `exit=${exitStatus}`;
}

function record(id, category, status, detail, logPath) {
  automated.push({ id, category, status, detail, log: rel(logPath) });
}

function recordInline(id, category, status, detail, output) {
  const log = path.join(logsDir, `${id}.log`);
  fs.writeFileSync(log, output || '');
  record(id, category, status, detail, log);
}

function summary(totals) {
  const checkRows = automated.map((check) => `| ${check.id} | ${check.status} | ${escapeCell(check.detail)} | \`${check.log}\` |`).join('\n');
  const humanRows = humanActions.map((item) => `| ${item.priority} | ${item.owner} | ${escapeCell(item.action)} | ${escapeCell(item.reason)} | \`${item.evidence}\` |`).join('\n');
  return `# Automated Readiness Evidence

- Generated: ${generatedAt}
- Git HEAD: \`${gitHead || 'unknown'}\`
- Git status clean: ${gitStatus.trim() ? 'no' : 'yes'}
- Base URL: \`${baseUrl}\`
- PASS: ${totals.pass}
- PENDING: ${totals.pending}
- FAIL: ${totals.fail}
- Human/external actions: ${humanActions.length}

## Automated Checks Run

| Check | Status | Detail | Log |
|---|---|---|---|
${checkRows}

## Human/External Actions Still Required

| Priority | Owner | Action | Reason | Evidence |
|---|---|---|---|---|
${humanRows}

## Safety

This collector ran local validators and the public HTTP gate only. It did not deploy, run restore drills, write any database, run migrations/imports, change feature flags, submit sign-off, or fake approval.
`;
}

function latestPack(root) {
  if (!fs.existsSync(root)) return '';
  const packs = fs.readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((candidate) => fs.existsSync(path.join(candidate, 'manifest.json')))
    .map((candidate) => ({ path: candidate, mtimeMs: fs.statSync(path.join(candidate, 'manifest.json')).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return packs.length > 0 ? packs[0].path : '';
}

function normalizePack(value) {
  const resolved = path.resolve(value);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return path.dirname(resolved);
  return resolved;
}

function findBash() {
  const candidates = [
    process.env.BASH,
    'bash',
    'C:\\Program Files\\Git\\bin\\bash.exe',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (result.status === 0) return candidate;
  }
  return '';
}

function git(argsForGit) {
  const result = spawnSync('git', argsForGit, { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout || '') : '';
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

function writeFile(name, content) {
  fs.writeFileSync(path.join(outDir, name), content);
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function relOrNull(filePath) {
  return filePath ? rel(filePath) : null;
}

function safeName(value) {
  return String(value || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
}

function csv(rows, columns) {
  return `${[
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n')}\n`;
}

function csvCell(value) {
  return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
}

function escapeCell(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
