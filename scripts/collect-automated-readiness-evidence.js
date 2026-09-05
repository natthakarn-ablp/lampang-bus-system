#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const schema = require('./lib/closure-report-schema');
const { runCommand, gradeScan, gradeWorktreeStatus } = require('./lib/command-result');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT_ROOT = path.join(ROOT, 'outputs', 'automated-readiness');
const DEFAULT_BASE_URL = 'https://schoolbuslampang.com';

// Evidence roots are named as roots, never as `<timestamp>` children. A row that
// says `outputs/uat-evidence/<timestamp>/` cannot be checked by anything: the
// path does not exist, and no validator can tell an unresolved placeholder from
// a real directory. The root plus an instruction to create a timestamped run
// directory at execution time carries the same information, and it is checkable.
//
// The row schema, the gate grading rules and the evidence-existence rule live in
// scripts/lib/closure-report-schema.js, shared with the go-live bundle, the
// closure board and both validators.
const {
  ACTION_COLUMNS,
  EVIDENCE_ROOTS,
  UAT_SIGNOFF_DOC,
  OWNER_APPROVAL_DOC,
  TIMESTAMPED_RUN_DIR,
} = schema;

const AUTOMATED_COLUMNS = [
  'id',
  'category',
  'status',
  'detail',
  'log',
  'exit_code',
  'gate_pass',
  'gate_warn',
  'gate_fail',
  'gate_skip',
  'warning_count',
  'failure_count',
  'not_evaluated_count',
];

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
const headResult = git(['rev-parse', '--short', 'HEAD']);
const gitHead = headResult.ok ? headResult.text.trim() : '(git unavailable)';
const statusResult = git(['status', '--short']);
const gitStatus = statusResult.text;
const statusGrade = gradeWorktreeStatus(statusResult);
recordInline('git-status', 'source-state', statusGrade.status, statusGrade.detail, statusGrade.output);

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
writeFile('automated-checks.csv', csv(automatedCsvRows(), AUTOMATED_COLUMNS));
writeFile('human-actions.json', `${JSON.stringify(humanActions, null, 2)}\n`);
writeFile('human-actions.csv', csv(humanActions, ACTION_COLUMNS));
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
  automated_columns: AUTOMATED_COLUMNS,
  action_columns: ACTION_COLUMNS,
  evidence_roots: EVIDENCE_ROOTS,
  gate_grading: 'gate fail>0 => FAIL; gate warn>0 with fail=0 => PENDING; PASS only when warn=0 and fail=0',
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
  const exitCode = result.status == null ? 1 : result.status;
  // The reasons a validator printed belong in the row, not only in the log: a
  // FAIL row that reports zero failures contradicts its own status, and a
  // PENDING row whose detail is the trailing "PASS (pending allowed)" line tells
  // a reader the opposite of what happened.
  const graded = schema.gradeValidatorOutput(output, exitCode);
  record(id, category, graded.status, graded.detail, log, {
    exitCode,
    gateSummary: null,
    warnings: graded.warnings,
    failures: graded.failures,
    notEvaluated: graded.notEvaluated,
  });
}

/**
 * Gate grading lives in the shared schema module: fail > 0 is FAIL, warn > 0
 * with fail = 0 is PENDING, and PASS needs both at zero. The exit code alone is
 * not a verdict, because the gate exits 0 on a [warn] by design.
 */
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

  const exitCode = result.status == null ? 1 : result.status;
  const graded = schema.gradeGateOutput(output, exitCode);
  record(id, category, graded.status, graded.detail, log, {
    exitCode,
    gateSummary: graded.gateSummary,
    warnings: graded.warnings,
    failures: graded.failures,
    notEvaluated: graded.notEvaluated,
  });
}

/**
 * A scan that could not read its input is PENDING, never PASS. "no secret
 * patterns found" has to mean the patterns were looked for.
 *
 * @param {{ok: boolean, text: string, reason: string}} result  the git() output
 */
function recordSecretScan(id, category, result) {
  const grade = gradeScan(result, secretMatches);
  recordInline(id, category, grade.status, grade.detail, grade.output);
}

function secretMatches(text) {
  const pattern = /(DB_PASSWORD|PASSWORD=|SECRET=|TOKEN=|LINE_CHANNEL_SECRET|CHANNEL_ACCESS_TOKEN|mysql:\/\/|JWT_SECRET|[A-Za-z0-9_]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/;
  return String(text || '').split(/\r?\n/).filter((line) => {
    if (isScannerPatternSourceLine(line)) return false;
    if (pattern.test(line)) return true;
    return hasLiteralBearerToken(line);
  });
}

/**
 * `Bearer ` used to match on its own, which flagged every line that BUILDS an
 * Authorization header — `Bearer ${token}`, `startsWith('Bearer ')` — as a
 * leaked credential. A scanner that cries wolf on ordinary header code gets
 * ignored, which is worse than one narrow rule.
 *
 * A real leak is `Bearer ` followed by an actual token: a long run of token
 * characters, with no interpolation, placeholder or quote in between. A
 * template expression or a short/angle-bracketed placeholder is not one.
 */
function hasLiteralBearerToken(line) {
  const match = /Bearer\s+([^\s'"`)}\]]+)/.exec(line);
  if (!match) return false;
  const candidate = match[1];
  if (candidate.startsWith('${') || candidate.startsWith('<') || candidate.startsWith('$')) return false;
  if (candidate.includes('${')) return false;
  return /^[A-Za-z0-9._-]{16,}$/.test(candidate);
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
  const signoffDocs = `${UAT_SIGNOFF_DOC} + ${OWNER_APPROVAL_DOC}`;

  if (!onProductionServer) {
    addHumanAction({
      id: 'production-read-only-gate',
      category: 'operator-gate',
      owner: 'operator',
      priority: 'P0',
      source: `checkout-location check: repository root is ${ROOT}, not /home/schoolbus/apps/lampang-bus-system`,
      source_type: 'command',
      expected_evidence_root: EVIDENCE_ROOTS.operatorGates,
      evidence_instruction: `${TIMESTAMPED_RUN_DIR}; it must hold production-gate.redacted.log`,
      action: 'Run production read-only gate on the server and paste redacted logs into operator evidence.',
    });
    addHumanAction({
      id: 'postdeploy-gate-monitor',
      category: 'operator-gate',
      owner: 'operator',
      priority: 'P0',
      source: `checkout-location check: repository root is ${ROOT}, so no server runtime, PM2 or log access is reachable from here`,
      source_type: 'command',
      expected_evidence_root: EVIDENCE_ROOTS.operatorGates,
      evidence_instruction: `${TIMESTAMPED_RUN_DIR}; it must hold postdeploy-gate and monitor-* redacted logs`,
      action: 'After approved deployment, run postdeploy gate and 30-60 minute monitor on the server.',
    });
  }
  if (!hasServerApproval) {
    addHumanAction({
      id: 'operator-approval',
      category: 'approval-scope',
      owner: 'operator',
      priority: 'P0',
      source: 'environment check: SCHOOLBUS_OPERATOR_APPROVED is not set to "true"',
      source_type: 'environment',
      expected_evidence_root: OWNER_APPROVAL_DOC,
      evidence_instruction: 'sign the production read-only, restore drill, deploy and postdeploy approval rows in this document',
      action: 'Approve the named production read-only, restore drill, deploy, and postdeploy scopes.',
    });
  }
  if (!hasRestoreApproval || !onProductionServer) {
    addHumanAction({
      id: 'restore-drill',
      category: 'restore-drill',
      owner: 'operator',
      priority: 'P0',
      source: `environment check: SCHOOLBUS_RESTORE_DRILL_APPROVED=${process.env.SCHOOLBUS_RESTORE_DRILL_APPROVED === 'true' ? 'true' : 'not set'}, on_production_server=${onProductionServer}`,
      source_type: 'environment',
      expected_evidence_root: EVIDENCE_ROOTS.restoreDrill,
      evidence_instruction: `${TIMESTAMPED_RUN_DIR}; it must hold restore-drill-result.md and the redacted drill log`,
      action: 'Run restore drill only after approval, against lampang_bus_restore_drill, using latest backup.',
    });
  }
  if (!hasDeployApproval) {
    addHumanAction({
      id: 'deploy-approved-commit',
      category: 'approval-scope',
      owner: 'technical-owner',
      priority: 'P0',
      source: 'environment check: SCHOOLBUS_DEPLOY_APPROVED is not set to "true"',
      source_type: 'environment',
      expected_evidence_root: OWNER_APPROVAL_DOC,
      evidence_instruction: `record the approved commit (${gitHead || 'unknown'}) and sign the deploy approval row in this document`,
      action: `Approve and deploy commit ${gitHead || '(unknown)'} through the server runbook.`,
    });
  }
  if (!hasRoleCredentials) {
    addHumanAction({
      id: 'role-uat-evidence',
      category: 'uat-evidence',
      owner: 'uat-lead',
      priority: 'P0',
      source: 'environment check: SCHOOLBUS_UAT_CREDENTIALS_FILE is not provided, so role login/LINE evidence cannot be produced here',
      source_type: 'environment',
      expected_evidence_root: EVIDENCE_ROOTS.uat,
      evidence_instruction: `${TIMESTAMPED_RUN_DIR}; it must hold one completed file per role`,
      action: 'Run role UAT with real approved test accounts for admin/province/affiliation/school/driver/transport/parent/LINE/operator.',
    });
  }
  addHumanAction({
    id: 'owner-dpo-signoff',
    category: 'signoff',
    owner: 'project-owner',
    priority: 'P0',
    source: signoffDocs,
    source_type: 'document',
    expected_evidence_root: signoffDocs,
    evidence_instruction: 'human legal/owner approval must be signed in both documents; it must not be automated',
    action: 'Owner, technical owner, operator, and DPO/legal sign the final approval and UAT sign-off documents after evidence is real.',
  });
}

/**
 * Every action row carries `source` (what produced this status, checkable now)
 * and `expected_evidence_root` (where the closing evidence must land, possibly
 * not created yet) as separate fields. `evidence_status` is derived, never
 * asserted: a root directory that exists but holds no run directory with a
 * manifest is still MISSING, so an empty `outputs/uat-evidence/` can never read
 * as evidence that UAT happened.
 */
function addHumanAction(item) {
  humanActions.push(schema.actionRow(ROOT, item));
}

function automatedCsvRows() {
  return automated.map((check) => ({
    id: check.id,
    category: check.category,
    status: check.status,
    detail: check.detail,
    log: check.log,
    exit_code: check.exit_code == null ? '' : check.exit_code,
    gate_pass: check.gate_summary ? check.gate_summary.pass : '',
    gate_warn: check.gate_summary ? check.gate_summary.warn : '',
    gate_fail: check.gate_summary ? check.gate_summary.fail : '',
    gate_skip: check.gate_summary ? check.gate_summary.skip : '',
    warning_count: check.warnings.length,
    failure_count: check.failures.length,
    not_evaluated_count: check.not_evaluated.length,
  }));
}

function record(id, category, status, detail, logPath, extra) {
  const info = extra || {};
  automated.push({
    id,
    category,
    status,
    detail,
    log: rel(logPath),
    exit_code: info.exitCode === undefined ? null : info.exitCode,
    gate_summary: info.gateSummary === undefined ? null : info.gateSummary,
    warnings: info.warnings || [],
    failures: info.failures || [],
    not_evaluated: info.notEvaluated || [],
  });
}

function recordInline(id, category, status, detail, output) {
  const log = path.join(logsDir, `${id}.log`);
  fs.writeFileSync(log, output || '');
  record(id, category, status, detail, log, { notEvaluated: schema.notEvaluatedLines(output) });
}

function summary(totals) {
  const checkRows = automated.map((check) => {
    const counts = check.gate_summary
      ? `${check.gate_summary.pass}/${check.gate_summary.warn}/${check.gate_summary.fail}`
      : '-';
    return `| ${check.id} | ${check.status} | ${counts} | ${escapeCell(check.detail)} | \`${check.log}\` |`;
  }).join('\n');
  const humanRows = humanActions.map((item) => `| ${item.priority} | ${item.owner} | ${escapeCell(item.action)} | ${escapeCell(item.source)} | \`${item.expected_evidence_root}\` | ${item.evidence_status} | ${escapeCell(item.evidence_instruction)} |`).join('\n');
  return `# Automated Readiness Evidence

- Generated: ${generatedAt}
- Git HEAD: \`${gitHead || 'unknown'}\`
- Git status clean: ${statusResult.ok ? (gitStatus.trim() ? 'no' : 'yes') : 'NOT EVALUATED'}
- Base URL: \`${baseUrl}\`
- PASS: ${totals.pass}
- PENDING: ${totals.pending}
- FAIL: ${totals.fail}
- Human/external actions: ${humanActions.length}

## Automated Checks Run

| Check | Status | Gate pass/warn/fail | Detail | Log |
|---|---|---|---|---|
${checkRows}

## Human/External Actions Still Required

| Priority | Owner | Action | Status source | Expected evidence root | Evidence status | What to produce there |
|---|---|---|---|---|---|---|
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

/**
 * Run git and keep whether it ran, separate from what it printed.
 *
 * This used to return '' on failure, which every caller read as a real, empty
 * answer: an unreadable worktree became "worktree clean" and an unreadable diff
 * became "no secret patterns found". Both PASS, both having checked nothing.
 * The grading now lives in scripts/lib/command-result.js, where it is unit
 * tested without paying 35 seconds to run this whole collector.
 */
function git(argsForGit) {
  return runCommand(spawnSync, 'git', argsForGit, { cwd: ROOT });
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
