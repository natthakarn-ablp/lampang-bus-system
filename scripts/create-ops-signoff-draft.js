#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT_ROOT = path.join(ROOT, 'outputs', 'ops-signoff-draft');
const PHASE9_EVIDENCE_ROOT = path.join(ROOT, 'outputs', 'phase9-evidence');
const RESTORE_DRILL_ROOT = path.join(ROOT, 'outputs', 'restore-drill');
const OPERATOR_GATE_ROOT = path.join(ROOT, 'outputs', 'operator-gates');

let phase9Path = null;
let restorePath = null;
let operatorPath = null;
let outRoot = DEFAULT_OUT_ROOT;
let runId = timestampBangkok();

function usage() {
  console.error('Usage: node scripts/create-ops-signoff-draft.js [--phase9-evidence <dir|manifest.json>] [--restore-drill <dir|manifest.json>] [--operator-gates <dir|manifest.json>] [--out-dir <dir>] [--run-id <id>]');
}

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--phase9-evidence' && args[i + 1]) {
    phase9Path = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--restore-drill' && args[i + 1]) {
    restorePath = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--operator-gates' && args[i + 1]) {
    operatorPath = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--out-dir' && args[i + 1]) {
    outRoot = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--run-id' && args[i + 1]) {
    runId = safeName(args[i + 1]);
    i += 1;
  } else {
    usage();
    process.exit(2);
  }
}

const selectedPhase9 = normalizePackPath(phase9Path) || latestPack(PHASE9_EVIDENCE_ROOT);
const selectedRestore = normalizePackPath(restorePath) || latestPack(RESTORE_DRILL_ROOT);
const selectedOperator = normalizePackPath(operatorPath) || latestPack(OPERATOR_GATE_ROOT);

const phase9 = selectedPhase9
  ? runValidation('phase9-evidence', 'scripts/validate-phase9-evidence.js', [selectedPhase9, '--require-mode', 'public'], /\[phase9-evidence\] PASS/)
  : missingValidation('phase9-evidence', 'no Phase 9 public evidence pack found');
const restore = selectedRestore
  ? runValidation('restore-drill-evidence', 'scripts/validate-restore-drill-evidence.js', [selectedRestore], /\[restore-drill-evidence\] summary ok=(\d+) pending=(\d+) fail=(\d+)/)
  : missingValidation('restore-drill-evidence', 'no restore drill evidence pack found');
const operator = selectedOperator
  ? runValidation('operator-gate-evidence', 'scripts/validate-operator-gate-evidence.js', [selectedOperator], /\[operator-gate-evidence\] summary ok=(\d+) pending=(\d+) fail=(\d+)/)
  : missingValidation('operator-gate-evidence', 'no operator gate evidence pack found');

const rows = opsRows();
const totals = rows.reduce((acc, row) => {
  acc[row.result.toLowerCase()] = (acc[row.result.toLowerCase()] || 0) + 1;
  return acc;
}, { pass: 0, pending: 0, fail: 0 });
const status = totals.fail > 0 ? 'FAIL' : totals.pending > 0 ? 'PENDING' : 'PASS';

const outputDir = path.join(outRoot, runId);
fs.mkdirSync(outputDir, { recursive: true });

const files = [];
files.push(writeFile('summary.md', summaryMarkdown()));
files.push(writeFile('ops-transfer.csv', opsTransferCsv()));
files.push(writeFile('OPS_SIGNOFF_DRAFT.md', opsSignoffDraftMarkdown()));
files.push(writeFile('manifest.json', `${JSON.stringify({
  generated_at: new Date().toISOString(),
  run_id: runId,
  root: ROOT,
  status,
  selected_phase9_evidence: selectedPhase9 ? rel(selectedPhase9) : null,
  selected_restore_drill_evidence: selectedRestore ? rel(selectedRestore) : null,
  selected_operator_gate_evidence: selectedOperator ? rel(selectedOperator) : null,
  totals,
  validations: [phase9, restore, operator].map((item) => ({
    id: item.id,
    status: item.status,
    detail: item.detail,
    source: item.source,
  })),
  safety: {
    calls_apis: false,
    runs_production_gate: false,
    runs_postdeploy_gate: false,
    runs_restore_drill: false,
    runs_deploy: false,
    runs_migrations: false,
    runs_imports: false,
    runs_feature_flags: false,
    writes_production_db: false,
    copies_raw_evidence: false,
  },
  files,
}, null, 2)}\n`));

console.log(`[ops-signoff-draft] output: ${outputDir}`);
console.log(`[ops-signoff-draft] summary pass=${totals.pass} pending=${totals.pending} fail=${totals.fail} status=${status}`);
console.log('[ops-signoff-draft] safety: no APIs, DB writes, deploys, gates, restore drills, imports, migrations, feature flags, or raw evidence copying');

if (status === 'FAIL') process.exit(1);

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

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeFile(name, content) {
  const filePath = path.join(outputDir, name);
  fs.writeFileSync(filePath, content);
  return {
    path: rel(filePath),
    sha256: sha256(content),
  };
}

function runValidation(id, script, argsForScript, summaryPattern) {
  const result = spawnSync(process.execPath, [path.join(ROOT, script), ...argsForScript], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const source = argsForScript[0] ? rel(path.resolve(argsForScript[0])) : '';
  const summary = output.match(summaryPattern);
  if (result.status === 0) {
    return { id, status: 'PASS', detail: firstSummaryLine(output) || 'validator PASS', source };
  }
  if (summary && Number(summary[3]) === 0 && Number(summary[2]) > 0) {
    return { id, status: 'PENDING', detail: `${summary[2]} evidence fields pending`, source };
  }
  return { id, status: 'FAIL', detail: lastLines(output), source };
}

function missingValidation(id, detail) {
  return { id, status: 'PENDING', detail, source: '' };
}

function firstSummaryLine(output) {
  return String(output || '').split(/\r?\n/).find((line) => /summary|PASS$/i.test(line)) || '';
}

function lastLines(output) {
  return String(output || '').split(/\r?\n/).filter(Boolean).slice(-4).join(' | ') || 'validator failed';
}

function pickStatus(...checks) {
  if (checks.some((check) => check.status === 'FAIL')) return 'FAIL';
  if (checks.some((check) => check.status === 'PENDING')) return 'PENDING';
  return 'PASS';
}

function evidenceList(...items) {
  return items.filter(Boolean).join(' ; ');
}

function opsRows() {
  const operatorEvidence = selectedOperator ? rel(selectedOperator) : '';
  const restoreEvidence = selectedRestore ? rel(selectedRestore) : '';
  const phase9Evidence = selectedPhase9 ? rel(selectedPhase9) : '';
  const operatorStatus = operator.status;
  const restoreStatus = restore.status;
  const phase9Status = phase9.status;
  const gateRunnerStatus = pickStatus(phase9, operator);
  const evidencePackStatus = pickStatus(phase9, restore, operator);

  return [
    {
      id: 'O1',
      item: 'Health',
      expected: '/health success true และ DB connected',
      result: operatorStatus,
      evidence: evidenceList(operatorEvidence, 'production/postdeploy gate logs'),
      note: 'Fill PASS only after operator gate validator proves health checks in production/postdeploy logs.',
    },
    {
      id: 'O2',
      item: 'PM2',
      expected: 'backend online, restart count ไม่เพิ่มระหว่าง UAT',
      result: operatorStatus,
      evidence: evidenceList(operatorEvidence, 'monitor-pm2.redacted.log'),
      note: 'Requires PM2 monitor review in operator gate evidence.',
    },
    {
      id: 'O3',
      item: 'Local backup',
      expected: 'latest backup < 24h, gzip/sha256 OK',
      result: operatorStatus,
      evidence: evidenceList(operatorEvidence, 'production gate backup checks'),
      note: 'Production gate includes latest backup verification.',
    },
    {
      id: 'O4',
      item: 'Off-host backup',
      expected: 'checker ผ่าน หรือ log sync ล่าสุดมีไฟล์บน remote',
      result: operatorStatus,
      evidence: evidenceList(operatorEvidence, 'production gate off-host checks'),
      note: 'Production gate includes read-only off-host config/log checks.',
    },
    {
      id: 'O5',
      item: 'Restore drill',
      expected: 'restore ล่าสุดลง test DB และ production counts ไม่เปลี่ยน',
      result: restoreStatus,
      evidence: evidenceList(restoreEvidence, 'restore-drill-result.md'),
      note: 'Fill PASS only after restore drill evidence validator passes strictly.',
    },
    {
      id: 'O6',
      item: 'Audit review',
      expected: 'export/action สำคัญมี audit row',
      result: 'PENDING',
      evidence: '',
      note: 'Requires UAT lead/operator audit-log evidence; not inferred from gate logs.',
    },
    {
      id: 'O7',
      item: 'Production gate runner',
      expected: '`public`, `production` และหลัง deploy `postdeploy` ต้อง `fail=0`; off-host log ต้องมีชื่อ backup ล่าสุด',
      result: gateRunnerStatus,
      evidence: evidenceList(phase9Evidence, operatorEvidence),
      note: 'Requires public Phase 9 evidence plus production/postdeploy operator gate evidence.',
    },
    {
      id: 'O8',
      item: 'Evidence pack',
      expected: 'แนบ `summary.md`, `manifest.json`, gate logs และ validator PASS',
      result: evidencePackStatus,
      evidence: evidenceList(phase9Evidence, restoreEvidence, operatorEvidence),
      note: 'Requires phase9, restore drill, and operator gate evidence validators to pass.',
    },
  ];
}

function summaryMarkdown() {
  const validationRows = [phase9, restore, operator]
    .map((item) => `| ${item.id} | ${item.status} | ${escapeCell(item.detail)} | ${item.source ? `\`${item.source}\`` : ''} |`)
    .join('\n');
  const opsRowsMd = rows
    .map((row) => `| ${row.id} | ${row.result} | ${escapeCell(row.evidence)} | ${escapeCell(row.note)} |`)
    .join('\n');

  return `# Ops Sign-off Draft Summary

- Generated: ${new Date().toISOString()}
- Status: ${status}
- Phase 9 evidence: ${selectedPhase9 ? `\`${rel(selectedPhase9)}\`` : 'not found'}
- Restore drill evidence: ${selectedRestore ? `\`${rel(selectedRestore)}\`` : 'not found'}
- Operator gate evidence: ${selectedOperator ? `\`${rel(selectedOperator)}\`` : 'not found'}
- PASS: ${totals.pass}
- PENDING: ${totals.pending}
- FAIL: ${totals.fail}

## Validator Inputs

| Input | Status | Detail | Source |
|---|---|---|---|
${validationRows}

## Draft Rows

| ID | Result | Evidence | Note |
|---|---|---|---|
${opsRowsMd}

This draft is non-mutating. It does not edit \`docs/UAT_SIGNOFF_2026-08.md\`, run gates, run restore drills, deploy, call APIs, copy raw logs, or write any database.
`;
}

function opsTransferCsv() {
  const columns = ['id', 'item', 'expected', 'result', 'evidence', 'note'];
  return `${[
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n')}\n`;
}

function opsSignoffDraftMarkdown() {
  const draftRows = rows
    .map((row) => `| ${row.id} | ${row.item} | ${row.expected} | ${row.result} | ${row.evidence || row.note} |`)
    .join('\n');
  return `# Ops Sign-off Draft

Copy reviewed rows into \`docs/UAT_SIGNOFF_2026-08.md\` only after the responsible owner verifies the referenced evidence. Do not copy raw secrets, raw student/parent data, or unredacted logs.

## 5. Ops Checks

| ID | รายการ | Expected | ผล | Evidence |
|---|---|---|---|---|
${draftRows}

## Notes

- O6 is intentionally kept PENDING because audit-log review needs explicit UAT/operator evidence.
- PASS in this draft means the relevant validator passed from referenced local evidence; it is still subject to owner/operator review before editing the official sign-off document.
`;
}

function escapeCell(value) {
  return String(value || '').replace(/\|/g, '\\|');
}

function csvCell(value) {
  const text = String(value == null ? '' : value);
  return `"${text.replace(/"/g, '""')}"`;
}
