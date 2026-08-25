#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_EVIDENCE_ROOT = path.join(ROOT, 'outputs', 'operator-gates');
const REQUIRED_CHECKS = [
  'Production read-only gate approval signed',
  'Production read-only gate mode=production',
  'Production read-only gate fail=0',
  'Deployment approval signed',
  'Postdeploy gate mode=postdeploy',
  'Postdeploy gate fail=0',
  'Runtime commit matches git HEAD',
  'PM2 monitor reviewed with no new application errors',
  'Health monitor reviewed with no new failures',
  'Off-host sync monitor reviewed with no new backup errors',
  '30-60 minute monitor completed',
  'Rollback plan still valid',
  'No production DB writes outside approved gates',
  'No feature flag changes',
];
const SAFETY_FLAGS = [
  'calls_apis',
  'runs_production_gate',
  'runs_postdeploy_gate',
  'runs_deploy',
  'runs_restore_drill',
  'runs_migrations',
  'runs_imports',
  'runs_feature_flags',
  'writes_production_db',
  'writes_any_database',
];

let allowPending = false;
let targetPath = null;

function usage() {
  console.error('Usage: node scripts/validate-operator-gate-evidence.js [operator-gates-dir|manifest.json] [--allow-pending]');
}

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--allow-pending') {
    allowPending = true;
  } else if (!targetPath) {
    targetPath = path.resolve(arg);
  } else {
    usage();
    process.exit(2);
  }
}

const state = { ok: 0, pending: 0, fail: 0 };

function ok(message) {
  state.ok += 1;
  console.log(`[operator-gate-evidence] OK: ${message}`);
}

function pending(message) {
  state.pending += 1;
  console.log(`[operator-gate-evidence] PENDING: ${message}`);
}

function fail(message) {
  state.fail += 1;
  console.error(`[operator-gate-evidence] FAIL: ${message}`);
}

function latestPackPath() {
  if (!fs.existsSync(DEFAULT_EVIDENCE_ROOT)) return null;
  const dirs = fs.readdirSync(DEFAULT_EVIDENCE_ROOT)
    .map((name) => path.join(DEFAULT_EVIDENCE_ROOT, name))
    .filter((candidate) => fs.existsSync(path.join(candidate, 'manifest.json')))
    .map((candidate) => ({ path: candidate, mtimeMs: fs.statSync(path.join(candidate, 'manifest.json')).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dirs.length > 0 ? dirs[0].path : null;
}

function normalizeCell(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isBlankOrPlaceholder(value) {
  const text = normalizeCell(value);
  if (!text) return true;
  if (text.includes(' / ')) return true;
  if (/^(todo|tbd|pending|n\/a|-|--|—)$/i.test(text)) return true;
  return false;
}

function splitRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const body = trimmed.endsWith('|') ? trimmed.slice(1, -1) : trimmed.slice(1);
  return body.split('|').map(normalizeCell);
}

function isSeparator(line) {
  const cells = splitRow(line);
  return Boolean(cells && cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

function extractSection(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start === -1) return null;
  const rest = markdown.slice(start);
  const next = rest.slice(heading.length).search(/\n##\s+/);
  return next === -1 ? rest : rest.slice(0, heading.length + next);
}

function parseTable(markdown, heading) {
  const section = extractSection(markdown, heading);
  if (!section) {
    fail(`missing section: ${heading}`);
    return null;
  }
  const lines = section.split(/\r?\n/).filter((line) => line.trim().startsWith('|'));
  if (lines.length < 2 || !isSeparator(lines[1])) {
    fail(`missing markdown table in section: ${heading}`);
    return null;
  }
  const header = splitRow(lines[0]);
  const rows = lines.slice(2).map(splitRow).filter(Boolean);
  ok(`table found: ${heading}`);
  return { header, rows, heading };
}

function requireColumns(table, columns) {
  let passed = true;
  for (const column of columns) {
    if (!table.header.includes(column)) {
      fail(`${table.heading} missing column: ${column}`);
      passed = false;
    }
  }
  return passed;
}

function rowToObject(table, row) {
  const object = {};
  table.header.forEach((name, index) => {
    object[name] = row[index] || '';
  });
  return object;
}

function extractBullet(markdown, label) {
  const line = markdown.split(/\r?\n/).find((candidate) => candidate.startsWith(`- ${label}:`));
  return line ? line.slice(`- ${label}:`.length).trim() : '';
}

function requireFilled(scope, value, label) {
  if (isBlankOrPlaceholder(value)) {
    pending(`${scope} ${label} missing`);
    return false;
  }
  ok(`${scope} ${label} filled`);
  return true;
}

function requirePass(scope, value, label) {
  const text = normalizeCell(value).toUpperCase();
  if (isBlankOrPlaceholder(value)) {
    pending(`${scope} ${label} missing`);
    return false;
  }
  if (text !== 'PASS') {
    fail(`${scope} ${label} must be PASS, found: ${value}`);
    return false;
  }
  ok(`${scope} ${label}=PASS`);
  return true;
}

function relPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function resolveEvidencePath(packDir, value) {
  const text = normalizeCell(value);
  if (isBlankOrPlaceholder(text)) return null;
  if (/^https?:\/\//i.test(text)) return { type: 'url', value: text };
  const withoutBackticks = text.replace(/^`|`$/g, '');
  const candidates = [
    path.resolve(packDir, withoutBackticks),
    path.resolve(ROOT, withoutBackticks),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found ? { type: 'file', value: found } : { type: 'missing', value: withoutBackticks };
}

function checkManifest(packDir, manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    ok(`manifest parsed: ${manifestPath}`);
  } catch (err) {
    fail(`manifest is not valid JSON: ${err.message}`);
    return null;
  }

  if (normalizeCell(manifest.base_url)) {
    ok(`manifest base_url=${manifest.base_url}`);
  } else {
    pending('manifest base_url missing');
  }

  const safety = manifest.safety || {};
  const unsafe = SAFETY_FLAGS.filter((flag) => safety[flag] !== false);
  if (unsafe.length > 0) {
    fail(`unsafe manifest flags: ${unsafe.join(', ')}`);
  } else {
    ok('safety flags are non-mutating');
  }

  const evidenceRel = normalizeCell(manifest.evidence_file) || 'operator-gate-result.md';
  const evidencePath = path.join(packDir, evidenceRel);
  if (fs.existsSync(evidencePath)) {
    ok(`evidence file exists: ${evidenceRel}`);
  } else {
    fail(`evidence file missing: ${evidenceRel}`);
  }
  return { manifest, evidencePath };
}

function checkHeader(markdown) {
  const fields = [
    'Operator',
    'Operator role',
    'Date/time (Asia/Bangkok)',
    'Approval evidence',
    'Approved commit/worktree',
    'Deployed commit',
    'Base URL',
    'Production gate log path',
    'Postdeploy gate log path',
    'PM2 monitor log path',
    'Health monitor log path',
    'Off-host monitor log path',
    'Monitor start (Asia/Bangkok)',
    'Monitor end (Asia/Bangkok)',
  ];
  for (const field of fields) {
    requireFilled('operator gate header', extractBullet(markdown, field), field);
  }
}

function checkResultChecks(markdown) {
  const table = parseTable(markdown, '## Result Checks');
  if (!table || !requireColumns(table, ['Check', 'Result', 'Evidence', 'Notes'])) return;
  const rows = table.rows.map((row) => rowToObject(table, row));
  const byCheck = new Map(rows.map((row) => [normalizeCell(row.Check), row]));
  for (const required of REQUIRED_CHECKS) {
    const row = byCheck.get(required);
    if (!row) {
      fail(`Result Checks missing row: ${required}`);
      continue;
    }
    requirePass(required, row.Result, 'result');
    requireFilled(required, row.Evidence, 'evidence');
  }
}

function checkSignoff(markdown) {
  const table = parseTable(markdown, '## Sign-off');
  if (!table || !requireColumns(table, ['Name', 'Result', 'Date/time', 'Signature/approval evidence'])) return;
  const row = table.rows[0] ? rowToObject(table, table.rows[0]) : null;
  if (!row) {
    pending('operator gate sign-off row missing');
    return;
  }
  requireFilled('operator gate sign-off', row.Name, 'name');
  requirePass('operator gate sign-off', row.Result, 'result');
  requireFilled('operator gate sign-off', row['Date/time'], 'date/time');
  requireFilled('operator gate sign-off', row['Signature/approval evidence'], 'signature/evidence');
}

function readLog(packDir, markdown, label) {
  const value = extractBullet(markdown, label);
  const resolved = resolveEvidencePath(packDir, value);
  if (!resolved) {
    pending(`${label} missing`);
    return null;
  }
  if (resolved.type === 'url') {
    pending(`${label} is a URL; attach a redacted local log file for mechanical validation`);
    return null;
  }
  if (resolved.type === 'missing') {
    pending(`${label} not found: ${resolved.value}`);
    return null;
  }
  const log = fs.readFileSync(resolved.value, 'utf8');
  ok(`${label} file found: ${relPath(resolved.value)}`);
  checkLogSafety(log, label);
  return log;
}

function checkLogSafety(log, label) {
  const secretPatterns = [
    /\bDB_PASSWORD\b/i,
    /\bMYSQL_PWD\b/i,
    /\bpassword\s*=/i,
    /\btoken\s*=/i,
    /\bsecret\s*=/i,
    /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  ];
  if (secretPatterns.some((pattern) => pattern.test(log))) {
    fail(`${label} appears to contain a secret or token; replace with a redacted log`);
  } else {
    ok(`${label} has no obvious secret/token pattern`);
  }
}

function checkGateLog(log, mode) {
  if (!log) return;
  requireLogPattern(log, `${mode} gate mode`, new RegExp(`\\[gate\\]\\s+mode=${mode}\\b`));
  requireLogPattern(log, `${mode} gate summary fail=0`, /\[gate\]\s+summary\s+pass=\d+\s+warn=\d+\s+fail=0\s+skip=\d+/i);
  if (/\[fail\]/i.test(log)) {
    fail(`${mode} gate log contains [fail]`);
  } else {
    ok(`${mode} gate log has no [fail] lines`);
  }
}

function checkPostdeployCommit(log) {
  if (!log) return;
  requireLogPattern(log, 'postdeploy health commit matches git HEAD', /health\.data\.commit matches git HEAD/i);
}

function checkMonitorLog(log, label) {
  if (!log) return;
  if (/Replace this file with redacted output/i.test(log) || log.trim().startsWith('#')) {
    pending(`${label} still contains placeholder content`);
    return;
  }
  const highSignalErrors = [
    /UnhandledPromiseRejection/i,
    /ER_ACCESS_DENIED_ERROR/i,
    /\bFATAL\b/i,
    /\bPANIC\b/i,
    /\bTraceback\b/i,
    /\bTypeError\b/i,
    /\bReferenceError\b/i,
    /\bSyntaxError\b/i,
    /Cannot find module/i,
    /ECONNREFUSED/i,
    /EADDRINUSE/i,
    /backup sha256 MISMATCH/i,
  ];
  if (highSignalErrors.some((pattern) => pattern.test(log))) {
    fail(`${label} contains a high-signal error pattern`);
  } else {
    ok(`${label} has no high-signal error pattern`);
  }
}

function requireLogPattern(log, label, pattern) {
  if (pattern.test(log)) {
    ok(label);
  } else {
    pending(`${label} missing`);
  }
}

const resolvedTarget = targetPath || latestPackPath();
if (!resolvedTarget) {
  pending('no operator gate evidence pack found');
  finish();
}

const stat = fs.existsSync(resolvedTarget) ? fs.statSync(resolvedTarget) : null;
if (!stat) {
  fail(`target not found: ${resolvedTarget}`);
  finish();
}

const packDir = stat.isDirectory() ? resolvedTarget : path.dirname(resolvedTarget);
const manifestPath = stat.isDirectory() ? path.join(resolvedTarget, 'manifest.json') : resolvedTarget;
const manifestInfo = checkManifest(packDir, manifestPath);

if (manifestInfo && fs.existsSync(manifestInfo.evidencePath)) {
  const markdown = fs.readFileSync(manifestInfo.evidencePath, 'utf8');
  checkHeader(markdown);
  checkResultChecks(markdown);
  checkSignoff(markdown);

  const productionLog = readLog(packDir, markdown, 'Production gate log path');
  checkGateLog(productionLog, 'production');

  const postdeployLog = readLog(packDir, markdown, 'Postdeploy gate log path');
  checkGateLog(postdeployLog, 'postdeploy');
  checkPostdeployCommit(postdeployLog);

  checkMonitorLog(readLog(packDir, markdown, 'PM2 monitor log path'), 'PM2 monitor log');
  checkMonitorLog(readLog(packDir, markdown, 'Health monitor log path'), 'health monitor log');
  checkMonitorLog(readLog(packDir, markdown, 'Off-host monitor log path'), 'off-host monitor log');
}

finish();

function finish() {
  console.log(`[operator-gate-evidence] summary ok=${state.ok} pending=${state.pending} fail=${state.fail} allow_pending=${allowPending}`);
  if (state.fail > 0) process.exit(1);
  if (state.pending > 0 && !allowPending) process.exit(1);
  console.log(allowPending && state.pending > 0 ? '[operator-gate-evidence] PASS (pending allowed)' : '[operator-gate-evidence] PASS');
  process.exit(0);
}
