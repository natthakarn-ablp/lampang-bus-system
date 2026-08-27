#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_EVIDENCE_ROOT = path.join(ROOT, 'outputs', 'restore-drill');
const REQUIRED_TARGET_DB = 'lampang_bus_restore_drill';
const REQUIRED_CHECKS = [
  'Approval signed before drill',
  `Target database is ${REQUIRED_TARGET_DB}`,
  'Backup sha256 verified',
  'Gzip integrity verified',
  'Restore command exit code 0',
  'Restore completed',
  'Table count reviewed',
  'Key row counts reviewed',
  'Production aggregate counts unchanged',
  'No production writes outside drill DB',
  'Cleanup or retention decision recorded',
];
const REQUIRED_ROW_COUNT_ROWS = ['_table_total', 'users', 'schools', 'students', 'vehicles'];
const SAFETY_FLAGS = [
  'calls_apis',
  'runs_restore_drill',
  'runs_deploy',
  'runs_migrations',
  'runs_imports',
  'runs_feature_flags',
  'writes_production_db',
  'writes_any_database',
];

let allowPending = false;
let targetPath = null;

function usage() {
  console.error('Usage: node scripts/validate-restore-drill-evidence.js [restore-drill-dir|manifest.json] [--allow-pending]');
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
  console.log(`[restore-drill-evidence] OK: ${message}`);
}

function pending(message) {
  state.pending += 1;
  console.log(`[restore-drill-evidence] PENDING: ${message}`);
}

function fail(message) {
  state.fail += 1;
  console.error(`[restore-drill-evidence] FAIL: ${message}`);
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

  const targetDb = normalizeCell(manifest.target_database);
  if (targetDb === REQUIRED_TARGET_DB) {
    ok(`manifest target_database=${REQUIRED_TARGET_DB}`);
  } else {
    fail(`manifest target_database must be ${REQUIRED_TARGET_DB}, found: ${targetDb || '(blank)'}`);
  }

  if (normalizeCell(manifest.production_database) && normalizeCell(manifest.production_database) !== targetDb) {
    ok('manifest production_database differs from target_database');
  } else {
    fail('manifest production_database must be filled and differ from target_database');
  }

  const safety = manifest.safety || {};
  const unsafe = SAFETY_FLAGS.filter((flag) => safety[flag] !== false);
  if (unsafe.length > 0) {
    fail(`unsafe manifest flags: ${unsafe.join(', ')}`);
  } else {
    ok('safety flags are non-mutating');
  }

  const evidenceRel = normalizeCell(manifest.evidence_file) || 'restore-drill-result.md';
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
    ['Operator', extractBullet(markdown, 'Operator')],
    ['Operator role', extractBullet(markdown, 'Operator role')],
    ['Date/time (Asia/Bangkok)', extractBullet(markdown, 'Date/time (Asia/Bangkok)')],
    ['Approval evidence', extractBullet(markdown, 'Approval evidence')],
    ['Backup file', extractBullet(markdown, 'Backup file')],
    ['Restore log path', extractBullet(markdown, 'Restore log path')],
    ['Production before evidence', extractBullet(markdown, 'Production before evidence')],
    ['Production after evidence', extractBullet(markdown, 'Production after evidence')],
  ];
  for (const [label, value] of fields) {
    requireFilled('restore drill header', value, label);
  }

  const targetDb = extractBullet(markdown, 'Restore target database');
  if (normalizeCell(targetDb) === REQUIRED_TARGET_DB) {
    ok(`restore target database=${REQUIRED_TARGET_DB}`);
  } else if (isBlankOrPlaceholder(targetDb)) {
    pending('restore target database missing');
  } else {
    fail(`restore target database must be ${REQUIRED_TARGET_DB}, found: ${targetDb}`);
  }

  const productionDb = extractBullet(markdown, 'Production database');
  if (isBlankOrPlaceholder(productionDb)) {
    pending('production database missing');
  } else if (normalizeCell(productionDb) === REQUIRED_TARGET_DB) {
    fail(`production database must not equal restore target ${REQUIRED_TARGET_DB}`);
  } else {
    ok('production database differs from restore target');
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

function checkRowCounts(markdown) {
  const table = parseTable(markdown, '## Row Count Review');
  if (!table || !requireColumns(table, ['Table', 'Restored', 'Production', 'Result', 'Notes'])) return;
  const rows = table.rows.map((row) => rowToObject(table, row));
  const byTable = new Map(rows.map((row) => [normalizeCell(row.Table), row]));
  for (const required of REQUIRED_ROW_COUNT_ROWS) {
    const row = byTable.get(required);
    if (!row) {
      fail(`Row Count Review missing row: ${required}`);
      continue;
    }
    requireFilled(`row count ${required}`, row.Restored, 'restored count');
    requireFilled(`row count ${required}`, row.Production, 'production count');
    requirePass(`row count ${required}`, row.Result, 'result');
  }
}

function checkSignoff(markdown) {
  const table = parseTable(markdown, '## Sign-off');
  if (!table || !requireColumns(table, ['Name', 'Result', 'Date/time', 'Signature/approval evidence'])) return;
  const row = table.rows[0] ? rowToObject(table, table.rows[0]) : null;
  if (!row) {
    pending('restore drill sign-off row missing');
    return;
  }
  requireFilled('restore drill sign-off', row.Name, 'name');
  requirePass('restore drill sign-off', row.Result, 'result');
  requireFilled('restore drill sign-off', row['Date/time'], 'date/time');
  requireFilled('restore drill sign-off', row['Signature/approval evidence'], 'signature/evidence');
}

function checkRestoreLog(packDir, markdown) {
  const logPathValue = extractBullet(markdown, 'Restore log path');
  const resolved = resolveEvidencePath(packDir, logPathValue);
  if (!resolved) {
    pending('restore log path missing');
    return;
  }
  if (resolved.type === 'url') {
    pending('restore log is a URL; attach a redacted local log file for mechanical validation');
    return;
  }
  if (resolved.type === 'missing') {
    pending(`restore log file not found: ${resolved.value}`);
    return;
  }

  const log = fs.readFileSync(resolved.value, 'utf8');
  ok(`restore log file found: ${relPath(resolved.value)}`);

  const secretPatterns = [
    /\bDB_PASSWORD\b/i,
    /\bpassword\s*=/i,
    /\btoken\s*=/i,
    /\bsecret\s*=/i,
    /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  ];
  if (secretPatterns.some((pattern) => pattern.test(log))) {
    fail('restore log appears to contain a secret or token; replace with a redacted log');
  } else {
    ok('restore log has no obvious secret/token pattern');
  }

  if (/\[restore-drill\]\s+ERROR:|\bABORT:|checksum mismatch|gzip integrity check failed|restore pipeline failed/i.test(log)) {
    fail('restore log contains restore error/abort text');
  } else {
    ok('restore log has no restore error/abort text');
  }

  requireLogPattern(log, 'restore log target database', new RegExp(`target:\\s+${REQUIRED_TARGET_DB}\\b`));
  requireLogPattern(log, 'restore log sha256 OK', /sha256:\s+OK/i);
  requireLogPattern(log, 'restore log gzip OK', /gzip:\s+OK/i);
  requireLogPattern(log, 'restore log completed', /restore complete in \d+s/i);
  requireLogPattern(log, 'restore log table count', /tables restored=\d+\s+production=\d+/i);
  requireLogPattern(log, 'restore log done timestamp', /\[restore-drill\]\s+\d{4}-\d{2}-\d{2}T/i);
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
  pending('no restore drill evidence pack found');
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
  checkRowCounts(markdown);
  checkSignoff(markdown);
  checkRestoreLog(packDir, markdown);
}

finish();

function finish() {
  console.log(`[restore-drill-evidence] summary ok=${state.ok} pending=${state.pending} fail=${state.fail} allow_pending=${allowPending}`);
  if (state.fail > 0) process.exit(1);
  if (state.pending > 0 && !allowPending) process.exit(1);
  console.log(allowPending && state.pending > 0 ? '[restore-drill-evidence] PASS (pending allowed)' : '[restore-drill-evidence] PASS');
  process.exit(0);
}
