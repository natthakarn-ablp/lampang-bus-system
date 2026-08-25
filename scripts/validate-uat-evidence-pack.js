#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_UAT_EVIDENCE_ROOT = path.join(ROOT, 'outputs', 'uat-evidence');
const REQUIRED_ROLES = ['admin', 'province', 'affiliation', 'school-full', 'school-teacher', 'driver', 'transport', 'parent-line', 'operator'];
const SAFETY_FLAGS = ['calls_apis', 'runs_restore_drill', 'runs_deploy', 'runs_migrations', 'runs_imports', 'runs_feature_flags', 'writes_production_db'];

let allowPending = false;
let targetPath = null;

function usage() {
  console.error('Usage: node scripts/validate-uat-evidence-pack.js [uat-evidence-dir|manifest.json] [--allow-pending]');
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
  console.log(`[uat-evidence] OK: ${message}`);
}

function pending(message) {
  state.pending += 1;
  console.log(`[uat-evidence] PENDING: ${message}`);
}

function fail(message) {
  state.fail += 1;
  console.error(`[uat-evidence] FAIL: ${message}`);
}

function latestPackPath() {
  if (!fs.existsSync(DEFAULT_UAT_EVIDENCE_ROOT)) return null;
  const dirs = fs.readdirSync(DEFAULT_UAT_EVIDENCE_ROOT)
    .map((name) => path.join(DEFAULT_UAT_EVIDENCE_ROOT, name))
    .filter((candidate) => fs.existsSync(path.join(candidate, 'manifest.json')))
    .map((candidate) => ({ path: candidate, mtimeMs: fs.statSync(path.join(candidate, 'manifest.json')).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dirs.length > 0 ? dirs[0].path : null;
}

function normalizeCell(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

function isBlankOrPlaceholder(value) {
  const text = normalizeCell(value);
  if (!text) return true;
  if (text.includes(' / ')) return true;
  if (/^(todo|tbd|pending|n\/a|-|—)$/i.test(text)) return true;
  return false;
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

function requirePass(scope, value, label) {
  const text = normalizeCell(value).toUpperCase();
  if (isBlankOrPlaceholder(value)) {
    pending(`${scope} ${label} missing`);
    return;
  }
  if (text !== 'PASS') {
    fail(`${scope} ${label} must be PASS, found: ${value}`);
    return;
  }
  ok(`${scope} ${label}=PASS`);
}

function requireFilled(scope, value, label) {
  if (isBlankOrPlaceholder(value)) {
    pending(`${scope} ${label} missing`);
    return;
  }
  ok(`${scope} ${label} filled`);
}

function validateRoleFile(packDir, role) {
  const rolePath = path.join(packDir, `${role}.md`);
  if (!fs.existsSync(rolePath)) {
    fail(`${role} file missing`);
    return;
  }
  const markdown = fs.readFileSync(rolePath, 'utf8');

  for (const field of ['Tester name:', 'Tester role:', 'Date/time:']) {
    const line = markdown.split(/\r?\n/).find((candidate) => candidate.startsWith(`- ${field}`));
    const value = line ? line.slice(`- ${field}`.length).trim() : '';
    requireFilled(role, value, field.replace(':', ''));
  }

  const routeTable = parseTable(markdown, '## Route Smoke');
  if (routeTable && requireColumns(routeTable, ['Route', 'Result', 'Evidence path/link', 'Time', 'Notes'])) {
    routeTable.rows.forEach((row, index) => {
      const object = rowToObject(routeTable, row);
      requirePass(`${role} route ${index + 1}`, object.Result, 'result');
      requireFilled(`${role} route ${index + 1}`, object['Evidence path/link'], 'evidence');
      requireFilled(`${role} route ${index + 1}`, object.Time, 'time');
    });
  }

  const checkTable = parseTable(markdown, '## Role Checks');
  if (checkTable && requireColumns(checkTable, ['#', 'Check', 'Result', 'Evidence path/link', 'Notes'])) {
    checkTable.rows.forEach((row, index) => {
      const object = rowToObject(checkTable, row);
      requirePass(`${role} check ${index + 1}`, object.Result, 'result');
      requireFilled(`${role} check ${index + 1}`, object['Evidence path/link'], 'evidence');
    });
  }

  const signoffTable = parseTable(markdown, '## Sign-off');
  if (signoffTable && requireColumns(signoffTable, ['Name', 'Result', 'Date/time', 'Signature/approval evidence'])) {
    const row = signoffTable.rows[0] || [];
    const object = rowToObject(signoffTable, row);
    requireFilled(`${role} sign-off`, object.Name, 'name');
    requirePass(`${role} sign-off`, object.Result, 'result');
    requireFilled(`${role} sign-off`, object['Date/time'], 'date/time');
    requireFilled(`${role} sign-off`, object['Signature/approval evidence'], 'signature/evidence');
  }
}

const resolvedTarget = targetPath || latestPackPath();
if (!resolvedTarget) {
  fail('no UAT evidence pack found');
  process.exit(1);
}

const stat = fs.existsSync(resolvedTarget) ? fs.statSync(resolvedTarget) : null;
if (!stat) {
  fail(`target not found: ${resolvedTarget}`);
  process.exit(1);
}

const packDir = stat.isDirectory() ? resolvedTarget : path.dirname(resolvedTarget);
const manifestPath = stat.isDirectory() ? path.join(resolvedTarget, 'manifest.json') : resolvedTarget;

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  ok(`manifest parsed: ${manifestPath}`);
} catch (err) {
  fail(`manifest is not valid JSON: ${err.message}`);
  process.exit(1);
}

const roles = Array.isArray(manifest.roles) ? manifest.roles : [];
const missingRoles = REQUIRED_ROLES.filter((role) => !roles.includes(role));
if (missingRoles.length > 0) {
  fail(`manifest missing roles: ${missingRoles.join(', ')}`);
} else {
  ok(`manifest contains ${REQUIRED_ROLES.length} required roles`);
}

const safety = manifest.safety || {};
const unsafe = SAFETY_FLAGS.filter((flag) => safety[flag] !== false);
if (unsafe.length > 0) {
  fail(`unsafe manifest flags: ${unsafe.join(', ')}`);
} else {
  ok('safety flags are non-mutating');
}

for (const role of REQUIRED_ROLES) {
  validateRoleFile(packDir, role);
}

console.log(`[uat-evidence] summary ok=${state.ok} pending=${state.pending} fail=${state.fail} allow_pending=${allowPending}`);

if (state.fail > 0) process.exit(1);
if (state.pending > 0 && !allowPending) process.exit(1);
console.log(allowPending && state.pending > 0 ? '[uat-evidence] PASS (pending allowed)' : '[uat-evidence] PASS');
