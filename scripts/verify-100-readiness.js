#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_EVIDENCE_ROOT = path.join(ROOT, 'outputs', 'phase9-evidence');
const DEFAULT_UAT_EVIDENCE_ROOT = path.join(ROOT, 'outputs', 'uat-evidence');
const DEFAULT_RESTORE_DRILL_ROOT = path.join(ROOT, 'outputs', 'restore-drill');
const DEFAULT_REPORT_ROOT = path.join(ROOT, 'outputs', 'go-live-readiness');

let allowPending = false;
let evidencePath = null;
let restoreDrillEvidencePath = null;
let writeReport = true;
let reportRoot = DEFAULT_REPORT_ROOT;

function usage() {
  console.error('Usage: node scripts/verify-100-readiness.js [--allow-pending] [--evidence <dir|manifest.json>] [--restore-drill <dir|manifest.json>] [--no-report] [--report-dir <dir>]');
}

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--allow-pending') {
    allowPending = true;
  } else if (arg === '--evidence' && args[i + 1]) {
    evidencePath = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--restore-drill' && args[i + 1]) {
    restoreDrillEvidencePath = path.resolve(args[i + 1]);
    i += 1;
  } else if (arg === '--no-report') {
    writeReport = false;
  } else if (arg === '--report-dir' && args[i + 1]) {
    reportRoot = path.resolve(args[i + 1]);
    i += 1;
  } else {
    usage();
    process.exit(2);
  }
}

const state = {
  pass: 0,
  pending: 0,
  fail: 0,
  checks: [],
};

function addCheck(id, status, detail, evidence) {
  state.checks.push({ id, status, detail, evidence: evidence || '' });
  if (status === 'PASS') state.pass += 1;
  else if (status === 'PENDING') state.pending += 1;
  else state.fail += 1;
  const suffix = evidence ? ` (${evidence})` : '';
  const stream = status === 'FAIL' ? process.stderr : process.stdout;
  stream.write(`[ready-100] ${status}: ${id} - ${detail}${suffix}\n`);
}

function latestEvidencePath() {
  if (!fs.existsSync(DEFAULT_EVIDENCE_ROOT)) return null;
  const dirs = fs.readdirSync(DEFAULT_EVIDENCE_ROOT)
    .map((name) => path.join(DEFAULT_EVIDENCE_ROOT, name))
    .filter((candidate) => fs.existsSync(path.join(candidate, 'manifest.json')))
    .map((candidate) => ({
      path: candidate,
      mtimeMs: fs.statSync(path.join(candidate, 'manifest.json')).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dirs.length > 0 ? dirs[0].path : null;
}

function latestUatEvidencePath() {
  if (!fs.existsSync(DEFAULT_UAT_EVIDENCE_ROOT)) return null;
  const dirs = fs.readdirSync(DEFAULT_UAT_EVIDENCE_ROOT)
    .map((name) => path.join(DEFAULT_UAT_EVIDENCE_ROOT, name))
    .filter((candidate) => fs.existsSync(path.join(candidate, 'manifest.json')))
    .map((candidate) => ({
      path: candidate,
      mtimeMs: fs.statSync(path.join(candidate, 'manifest.json')).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dirs.length > 0 ? dirs[0].path : null;
}

function latestRestoreDrillEvidencePath() {
  if (!fs.existsSync(DEFAULT_RESTORE_DRILL_ROOT)) return null;
  const dirs = fs.readdirSync(DEFAULT_RESTORE_DRILL_ROOT)
    .map((name) => path.join(DEFAULT_RESTORE_DRILL_ROOT, name))
    .filter((candidate) => fs.existsSync(path.join(candidate, 'manifest.json')))
    .map((candidate) => ({
      path: candidate,
      mtimeMs: fs.statSync(path.join(candidate, 'manifest.json')).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dirs.length > 0 ? dirs[0].path : null;
}

function runNodeScript(script, argsForScript) {
  const result = spawnSync(process.execPath, [path.join(ROOT, script), ...argsForScript], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return {
    status: result.status == null ? 1 : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function parseGoLiveSummary(output) {
  const match = output.match(/\[go-live-signoff\] summary ok=(\d+) pending=(\d+) fail=(\d+)/);
  if (!match) return null;
  return {
    ok: Number(match[1]),
    pending: Number(match[2]),
    fail: Number(match[3]),
  };
}

function parseUatEvidenceSummary(output) {
  const match = output.match(/\[uat-evidence\] summary ok=(\d+) pending=(\d+) fail=(\d+)/);
  if (!match) return null;
  return {
    ok: Number(match[1]),
    pending: Number(match[2]),
    fail: Number(match[3]),
  };
}

function parseUatSafetySummary(output) {
  const match = output.match(/\[uat-safety\] summary scanned=(\d+) fail=(\d+) warn=(\d+) manual_review=(\d+) status=([A-Z]+)/);
  if (!match) return null;
  return {
    scanned: Number(match[1]),
    fail: Number(match[2]),
    warn: Number(match[3]),
    manualReview: Number(match[4]),
    status: match[5],
  };
}

function parseRestoreDrillSummary(output) {
  const match = output.match(/\[restore-drill-evidence\] summary ok=(\d+) pending=(\d+) fail=(\d+)/);
  if (!match) return null;
  return {
    ok: Number(match[1]),
    pending: Number(match[2]),
    fail: Number(match[3]),
  };
}

function checkRequiredFiles() {
  const required = [
    'docs/READINESS_SCORECARD_2026-08.md',
    'docs/UAT_SIGNOFF_2026-08.md',
    'docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md',
    'docs/PHASE9_PRODUCTION_GATE_2026-08.md',
    'docs/PRODUCTION_GOVERNANCE_CHECKLIST_2026-08.md',
    'docs/INCIDENT_PDPA_SOP_2026-08.md',
    'docs/TRAINING_PACK_2026-08.md',
    'docs/OPERATOR_RUNBOOK.md',
    'scripts/production-readiness-gate.sh',
    'scripts/collect-phase9-evidence.sh',
    'scripts/validate-phase9-evidence.js',
    'scripts/validate-go-live-signoff.js',
    'scripts/create-uat-evidence-pack.js',
    'scripts/validate-uat-evidence-pack.js',
    'scripts/summarize-uat-evidence.js',
    'scripts/scan-uat-evidence-safety.js',
    'scripts/create-go-live-signoff-draft.js',
    'scripts/create-restore-drill-evidence-pack.js',
    'scripts/validate-restore-drill-evidence.js',
    'scripts/create-go-live-bundle.js',
    'scripts/validate-go-live-bundle.js',
    'scripts/verify-100-readiness.js',
  ];

  const missing = required.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
  if (missing.length > 0) {
    addCheck('required-files', 'FAIL', `missing ${missing.length} required files`, missing.join(', '));
    return;
  }
  addCheck('required-files', 'PASS', `${required.length} required files exist`);
}

function checkPhase9Evidence(targetPath) {
  if (!targetPath) {
    addCheck('phase9-evidence', 'PENDING', 'no Phase 9 evidence pack found');
    return null;
  }
  const resolved = path.resolve(targetPath);
  const result = runNodeScript('scripts/validate-phase9-evidence.js', [resolved, '--require-mode', 'public']);
  const output = `${result.stdout}${result.stderr}`;
  if (result.status === 0) {
    addCheck('phase9-evidence', 'PASS', 'public evidence pack validates', path.relative(ROOT, resolved));
  } else {
    addCheck('phase9-evidence', 'FAIL', 'evidence validator failed', output.split(/\r?\n/).filter(Boolean).slice(-3).join(' | '));
  }
  return resolved;
}

function relPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function checkUatEvidencePack() {
  const packDir = latestUatEvidencePath();
  if (!packDir) {
    addCheck('uat-evidence-pack', 'PENDING', 'no generated UAT evidence pack found');
    return null;
  }

  const result = runNodeScript('scripts/validate-uat-evidence-pack.js', [packDir]);
  const output = `${result.stdout}${result.stderr}`;
  const summary = parseUatEvidenceSummary(output);
  if (result.status === 0) {
    addCheck('uat-evidence-pack', 'PASS', 'UAT evidence pack is complete', relPath(packDir));
    return packDir;
  }
  if (summary && summary.fail === 0 && summary.pending > 0) {
    addCheck('uat-evidence-pack', 'PENDING', `${summary.pending} UAT evidence fields still pending`, relPath(packDir));
    return packDir;
  }
  addCheck('uat-evidence-pack', 'FAIL', 'UAT evidence validator failed', output.split(/\r?\n/).filter(Boolean).slice(-5).join(' | '));
  return packDir;
}

function checkRestoreDrillEvidence() {
  const packDir = restoreDrillEvidencePath || latestRestoreDrillEvidencePath();
  if (!packDir) {
    addCheck('restore-drill-evidence', 'PENDING', 'no restore drill evidence pack found');
    return null;
  }

  const result = runNodeScript('scripts/validate-restore-drill-evidence.js', [packDir]);
  const output = `${result.stdout}${result.stderr}`;
  const summary = parseRestoreDrillSummary(output);
  if (result.status === 0) {
    addCheck('restore-drill-evidence', 'PASS', 'restore drill evidence is complete', relPath(packDir));
    return packDir;
  }
  if (summary && summary.fail === 0 && summary.pending > 0) {
    addCheck('restore-drill-evidence', 'PENDING', `${summary.pending} restore drill evidence fields still pending`, relPath(packDir));
    return packDir;
  }
  addCheck('restore-drill-evidence', 'FAIL', 'restore drill evidence validator failed', output.split(/\r?\n/).filter(Boolean).slice(-5).join(' | '));
  return packDir;
}

function checkUatEvidenceSafety(packDir) {
  if (!packDir) {
    addCheck('uat-evidence-safety', 'PENDING', 'no UAT evidence pack found for safety scan');
    return;
  }

  const result = runNodeScript('scripts/scan-uat-evidence-safety.js', [packDir, '--no-report']);
  const output = `${result.stdout}${result.stderr}`;
  const summary = parseUatSafetySummary(output);
  if (result.status === 0 && summary && summary.status === 'PASS') {
    addCheck('uat-evidence-safety', 'PASS', `no text leaks found; scanned ${summary.scanned} text files`, relPath(packDir));
    return;
  }
  if (summary && summary.fail === 0 && summary.warn > 0) {
    addCheck('uat-evidence-safety', 'PENDING', `${summary.warn} UAT evidence safety warnings need review`, relPath(packDir));
    return;
  }
  addCheck('uat-evidence-safety', 'FAIL', 'UAT evidence safety scan failed', output.split(/\r?\n/).filter(Boolean).slice(-5).join(' | '));
}

function checkSignoff() {
  const result = runNodeScript('scripts/validate-go-live-signoff.js', []);
  const output = `${result.stdout}${result.stderr}`;
  const summary = parseGoLiveSummary(output);
  if (result.status === 0) {
    addCheck('go-live-signoff', 'PASS', 'UAT and owner/operator sign-off are complete');
    return;
  }
  if (summary && summary.fail === 0 && summary.pending > 0) {
    addCheck('go-live-signoff', 'PENDING', `${summary.pending} UAT/approval/evidence fields still pending`, 'docs/UAT_SIGNOFF_2026-08.md + docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md');
    return;
  }
  addCheck('go-live-signoff', 'FAIL', 'sign-off validator failed', output.split(/\r?\n/).filter(Boolean).slice(-5).join(' | '));
}

function checkScorecardOverall() {
  const scorecardPath = path.join(ROOT, 'docs', 'READINESS_SCORECARD_2026-08.md');
  if (!fs.existsSync(scorecardPath)) {
    addCheck('scorecard-overall', 'FAIL', 'readiness scorecard missing');
    return;
  }
  const scorecard = fs.readFileSync(scorecardPath, 'utf8');
  const overallLine = scorecard.split(/\r?\n/).find((line) => /\|\s*Overall\s*\|/.test(line));
  if (!overallLine) {
    addCheck('scorecard-overall', 'FAIL', 'overall readiness row missing');
    return;
  }
  if (/\|\s*Overall\s*\|\s*100%\s*\|/.test(overallLine)) {
    addCheck('scorecard-overall', 'PASS', 'scorecard overall readiness is 100%');
    return;
  }
  addCheck('scorecard-overall', 'PENDING', `scorecard is not yet 100%: ${overallLine.trim()}`);
}

function checkSafetyLanguage() {
  const files = [
    'docs/PHASE9_PRODUCTION_GATE_2026-08.md',
    'docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md',
    'docs/PRODUCTION_GOVERNANCE_CHECKLIST_2026-08.md',
  ];
  const missing = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (!/production DB|production data|ข้อมูลจริง/i.test(text)) missing.push(rel);
  }
  if (missing.length > 0) {
    addCheck('production-safety-language', 'FAIL', 'safety language missing from gate docs', missing.join(', '));
    return;
  }
  addCheck('production-safety-language', 'PASS', 'gate docs explicitly protect production data');
}

function createReport(evidenceResolved, restoreDrillEvidenceResolved, uatEvidenceResolved) {
  if (!writeReport) return null;
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  const outDir = path.join(reportRoot, ts);
  fs.mkdirSync(outDir, { recursive: true });
  const summaryPath = path.join(outDir, 'summary.md');
  const manifestPath = path.join(outDir, 'manifest.json');
  const generatedAt = new Date().toISOString();

  const rows = state.checks.map((check) => `| ${check.id} | ${check.status} | ${check.detail.replace(/\|/g, '\\|')} | ${check.evidence.replace(/\|/g, '\\|')} |`).join('\n');
  const summary = [
    '# 100% Readiness Verification',
    '',
    `- Generated: ${generatedAt}`,
    `- Evidence: ${evidenceResolved ? `\`${path.relative(ROOT, evidenceResolved)}\`` : 'not found'}`,
    `- Restore drill evidence: ${restoreDrillEvidenceResolved ? `\`${path.relative(ROOT, restoreDrillEvidenceResolved)}\`` : 'not found'}`,
    `- UAT evidence: ${uatEvidenceResolved ? `\`${path.relative(ROOT, uatEvidenceResolved)}\`` : 'not found'}`,
    `- Allow pending: ${allowPending}`,
    '',
    '## Checks',
    '',
    '| Check | Status | Detail | Evidence |',
    '|---|---|---|---|',
    rows,
    '',
    '## Summary',
    '',
    `- PASS: ${state.pass}`,
    `- PENDING: ${state.pending}`,
    `- FAIL: ${state.fail}`,
    '',
    'This verifier is non-mutating. It does not run deploys, restore drills, migrations, imports, feature flags, or production DB writes.',
    '',
  ].join('\n');

  fs.writeFileSync(summaryPath, summary);
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    generated_at: generatedAt,
    root: ROOT,
    evidence: evidenceResolved ? path.relative(ROOT, evidenceResolved) : null,
    restore_drill_evidence: restoreDrillEvidenceResolved ? path.relative(ROOT, restoreDrillEvidenceResolved) : null,
    uat_evidence: uatEvidenceResolved ? path.relative(ROOT, uatEvidenceResolved) : null,
    allow_pending: allowPending,
    safety: {
      runs_restore_drill: false,
      runs_deploy: false,
      runs_migrations: false,
      runs_imports: false,
      runs_feature_flags: false,
      writes_production_db: false,
    },
    totals: {
      pass: state.pass,
      pending: state.pending,
      fail: state.fail,
    },
    checks: state.checks,
  }, null, 2)}\n`);
  console.log(`[ready-100] report: ${summaryPath}`);
  return outDir;
}

checkRequiredFiles();
const evidenceResolved = checkPhase9Evidence(evidencePath || latestEvidencePath());
const restoreDrillEvidenceResolved = checkRestoreDrillEvidence();
const uatEvidenceResolved = checkUatEvidencePack();
checkUatEvidenceSafety(uatEvidenceResolved);
checkSignoff();
checkScorecardOverall();
checkSafetyLanguage();
createReport(evidenceResolved, restoreDrillEvidenceResolved, uatEvidenceResolved);

console.log(`[ready-100] summary pass=${state.pass} pending=${state.pending} fail=${state.fail} allow_pending=${allowPending}`);

if (state.fail > 0) process.exit(1);
if (state.pending > 0 && !allowPending) process.exit(1);
console.log(allowPending && state.pending > 0 ? '[ready-100] PASS (pending allowed)' : '[ready-100] PASS');
