#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const schema = require('./lib/closure-report-schema');

const ROOT = path.resolve(__dirname, '..');

let allowPending = false;

function usage() {
  console.error('Usage: node scripts/validate-go-live-bundle.js <bundle-dir|manifest.json> [--allow-pending]');
}

const args = process.argv.slice(2);
if (args.length < 1) {
  usage();
  process.exit(2);
}

const targetArg = args[0];
for (let i = 1; i < args.length; i += 1) {
  if (args[i] === '--allow-pending') {
    allowPending = true;
  } else {
    usage();
    process.exit(2);
  }
}

const state = { ok: 0, pending: 0, fail: 0 };

function ok(message) {
  state.ok += 1;
  console.log(`[go-live-bundle] OK: ${message}`);
}

function pending(message) {
  state.pending += 1;
  console.log(`[go-live-bundle] PENDING: ${message}`);
}

function fail(message) {
  state.fail += 1;
  console.error(`[go-live-bundle] FAIL: ${message}`);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    fail(`invalid JSON: ${filePath}: ${err.message}`);
    return null;
  }
}


// The action-row schema and its rules are defined once, in
// scripts/lib/closure-report-schema.js, and shared with every program that
// emits or reads these rows.
const { ACTION_CSV_HEADER, validateActionRows } = schema;

function countCsvRows(csv) {
  const lines = String(csv || '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return { header: '', rows: 0 };
  return { header: lines[0], rows: lines.length - 1 };
}

function requireFile(bundleDir, relPath) {
  const filePath = path.join(bundleDir, relPath);
  if (!fs.existsSync(filePath)) {
    fail(`required bundle file missing: ${relPath}`);
    return null;
  }
  ok(`required bundle file exists: ${relPath}`);
  return filePath;
}

const target = path.resolve(targetArg);
const stat = fs.existsSync(target) ? fs.statSync(target) : null;
if (!stat) {
  fail(`target not found: ${target}`);
  finish();
}

const bundleDir = stat.isDirectory() ? target : path.dirname(target);
const manifestPath = stat.isDirectory() ? path.join(bundleDir, 'manifest.json') : target;
const manifest = readJson(manifestPath);
if (manifest) ok(`manifest parsed: ${manifestPath}`);

const requiredFiles = [
  'EXECUTIVE_BRIEF.md',
  'OPERATOR_COMMANDS.md',
  'SIGNOFF_INDEX.md',
  'SOURCE_STATE.md',
  'ACTION_PLAN.md',
  'ACTION_ITEMS.csv',
  'ACTION_ITEMS.json',
  'summary.md',
  'manifest.json',
];

const filePaths = {};
for (const relPath of requiredFiles) {
  filePaths[relPath] = requireFile(bundleDir, relPath);
}

if (filePaths['summary.md']) {
  const summary = fs.readFileSync(filePaths['summary.md'], 'utf8');
  if (!summary.includes('Action items: `ACTION_ITEMS.csv`, `ACTION_ITEMS.json`')) {
    fail('summary.md does not reference action item files');
  } else {
    ok('summary.md references action item files');
  }
  if (!summary.includes('Source state: `SOURCE_STATE.md`')) {
    fail('summary.md does not reference SOURCE_STATE.md');
  } else {
    ok('summary.md references SOURCE_STATE.md');
  }
}

if (filePaths['SOURCE_STATE.md']) {
  const sourceState = fs.readFileSync(filePaths['SOURCE_STATE.md'], 'utf8');
  if (!sourceState.includes('## Source Candidates For Review') || !sourceState.includes('## Suggested Stage Command')) {
    fail('SOURCE_STATE.md is missing required sections');
  } else {
    ok('SOURCE_STATE.md has source candidate and stage-command sections');
  }
}

if (filePaths['ACTION_PLAN.md']) {
  const actionPlan = fs.readFileSync(filePaths['ACTION_PLAN.md'], 'utf8');
  if (!actionPlan.includes('## UAT Evidence Pending By Role') || !actionPlan.includes('## Exact Final Commands')) {
    fail('ACTION_PLAN.md is missing required sections');
  } else {
    ok('ACTION_PLAN.md has UAT and final-command sections');
  }
}

if (filePaths['ACTION_ITEMS.json']) {
  const items = readJson(filePaths['ACTION_ITEMS.json']);
  if (Array.isArray(items) && items.length > 0) {
    ok(`ACTION_ITEMS.json rows=${items.length}`);
    validateActionRows(items, 'ACTION_ITEMS.json', ROOT, { ok, pending, fail });

    if (filePaths['ACTION_ITEMS.csv']) {
      const csv = fs.readFileSync(filePaths['ACTION_ITEMS.csv'], 'utf8');
      const csvInfo = countCsvRows(csv);
      if (csvInfo.header !== ACTION_CSV_HEADER) {
        fail(`ACTION_ITEMS.csv header mismatch: expected "${ACTION_CSV_HEADER}"`);
      } else {
        ok('ACTION_ITEMS.csv header is valid');
      }
      if (csvInfo.rows !== items.length) {
        fail(`ACTION_ITEMS.csv row count ${csvInfo.rows} does not match JSON row count ${items.length}`);
      } else {
        ok(`ACTION_ITEMS.csv rows match JSON (${items.length})`);
      }
      if (csv.includes('<timestamp>')) {
        fail('ACTION_ITEMS.csv contains an unresolved <timestamp> placeholder');
      }
    }
  } else {
    pending('ACTION_ITEMS.json has no rows');
  }
}

if (manifest) {
  const safety = manifest.safety || {};
  const flags = [
    'calls_apis',
    'runs_restore_drill',
    'runs_deploy',
    'runs_migrations',
    'runs_imports',
    'runs_feature_flags',
    'writes_production_db',
    'copies_raw_uat_evidence',
  ];
  for (const flag of flags) {
    if (safety[flag] !== false) {
      fail(`safety.${flag} must be false`);
    }
  }
  if (state.fail === 0) ok('safety flags are non-mutating');

  if (Array.isArray(manifest.action_columns)) {
    if (manifest.action_columns.join(',') === ACTION_CSV_HEADER) {
      ok('manifest.action_columns matches the shared action-row schema');
    } else {
      fail(`manifest.action_columns does not match the shared action-row schema: ${manifest.action_columns.join(',')}`);
    }
  } else {
    fail('manifest.action_columns must list the shared action-row schema');
  }

  const bundleFiles = Array.isArray(manifest.bundle_files) ? manifest.bundle_files : [];
  for (const relPath of requiredFiles) {
    if (!bundleFiles.includes(relPath)) {
      fail(`manifest.bundle_files missing ${relPath}`);
    }
  }

  const checks = Array.isArray(manifest.checks) ? manifest.checks : [];
  if (checks.length === 0) {
    fail('manifest.checks is empty');
  }
  for (const check of checks) {
    if (check.status === 'FAIL') {
      fail(`check ${check.id} is FAIL`);
    } else if (check.status === 'PENDING') {
      pending(`check ${check.id} is PENDING`);
    } else if (check.status === 'PASS') {
      ok(`check ${check.id} is PASS`);
    } else {
      fail(`check ${check.id || '(unknown)'} has invalid status ${check.status}`);
    }
    if (check.log && !fs.existsSync(path.join(bundleDir, path.relative(manifest.bundle_dir || '', check.log)))) {
      const directLogPath = path.isAbsolute(check.log) ? check.log : path.join(path.dirname(bundleDir), check.log);
      if (!fs.existsSync(directLogPath)) {
        fail(`check log missing: ${check.log}`);
      }
    }
  }

  if (manifest.totals && Number(manifest.totals.fail || 0) > 0) {
    fail(`manifest totals fail=${manifest.totals.fail}`);
  }
  if (manifest.totals && Number(manifest.totals.pending || 0) > 0) {
    pending(`manifest totals pending=${manifest.totals.pending}`);
  }
}

finish();

function finish() {
  console.log(`[go-live-bundle] summary ok=${state.ok} pending=${state.pending} fail=${state.fail} allow_pending=${allowPending}`);
  if (state.fail > 0) process.exit(1);
  if (state.pending > 0 && !allowPending) process.exit(1);
  console.log(allowPending && state.pending > 0 ? '[go-live-bundle] PASS (pending allowed)' : '[go-live-bundle] PASS');
  process.exit(0);
}
