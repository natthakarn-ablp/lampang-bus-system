#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let allowPending = false;

function usage() {
  console.error('Usage: node scripts/validate-go-live-closure-status.js <closure-dir|manifest.json> [--allow-pending]');
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
  console.log(`[closure-status] OK: ${message}`);
}

function pending(message) {
  state.pending += 1;
  console.log(`[closure-status] PENDING: ${message}`);
}

function fail(message) {
  state.fail += 1;
  console.error(`[closure-status] FAIL: ${message}`);
}

const target = path.resolve(targetArg);
const stat = fs.existsSync(target) ? fs.statSync(target) : null;
if (!stat) {
  fail(`target not found: ${target}`);
  finish();
}

const closureDir = stat.isDirectory() ? target : path.dirname(target);
const manifestPath = stat.isDirectory() ? path.join(closureDir, 'manifest.json') : target;
const manifest = readJson(manifestPath);
if (manifest) ok(`manifest parsed: ${manifestPath}`);

const requiredFiles = ['summary.md', 'owner-actions.csv', 'owner-actions.json', 'manifest.json'];
const files = {};
for (const relPath of requiredFiles) {
  files[relPath] = requireFile(closureDir, relPath);
}

const actions = files['owner-actions.json'] ? readJson(files['owner-actions.json']) : null;
const csvInfo = files['owner-actions.csv']
  ? countCsvRows(fs.readFileSync(files['owner-actions.csv'], 'utf8'))
  : { header: '', rows: 0 };

if (Array.isArray(actions)) {
  ok(`owner-actions.json rows=${actions.length}`);
  validateActionItems(actions);
} else {
  fail('owner-actions.json must be an array');
}

if (csvInfo.header === 'id,category,owner,priority,pending_count,source,evidence,action') {
  ok('owner-actions.csv header is valid');
} else if (files['owner-actions.csv']) {
  fail('owner-actions.csv header mismatch');
}

if (Array.isArray(actions) && csvInfo.rows === actions.length) {
  ok(`owner-actions.csv rows match JSON (${actions.length})`);
} else if (Array.isArray(actions)) {
  fail(`owner-actions.csv row count ${csvInfo.rows} does not match JSON row count ${actions.length}`);
}

if (files['summary.md']) {
  const summary = fs.readFileSync(files['summary.md'], 'utf8');
  for (const section of ['## Gate Totals', '## Owner Board', '## Checks', '## Next Actions', '## Final Commands', '## Safety']) {
    if (summary.includes(section)) ok(`summary.md contains ${section}`);
    else fail(`summary.md missing ${section}`);
  }
  if (/password|token|secret|bearer/i.test(summary)) {
    fail('summary.md contains a high-risk secret keyword');
  }
}

if (manifest) {
  validateManifest(manifest, actions || []);
}

finish();

function validateManifest(manifestObject, actionsList) {
  const validStatuses = ['PASS', 'PENDING', 'FAIL'];
  if (validStatuses.includes(manifestObject.status)) {
    ok(`manifest status=${manifestObject.status}`);
  } else {
    fail(`manifest status invalid: ${manifestObject.status}`);
  }

  const safety = manifestObject.safety || {};
  const flags = [
    'calls_apis',
    'runs_deploy',
    'runs_restore_drill',
    'runs_migrations',
    'runs_imports',
    'runs_feature_flags',
    'writes_production_db',
    'writes_any_database',
    'copies_raw_uat_evidence',
  ];
  for (const flag of flags) {
    if (safety[flag] !== false) {
      fail(`safety.${flag} must be false`);
    }
  }
  if (state.fail === 0) ok('safety flags are non-mutating');

  if (Array.isArray(manifestObject.files)) {
    for (const relPath of requiredFiles) {
      if (manifestObject.files.includes(relPath)) ok(`manifest.files includes ${relPath}`);
      else fail(`manifest.files missing ${relPath}`);
    }
  } else {
    fail('manifest.files must be an array');
  }

  const totals = manifestObject.totals || {};
  const failCount = Number(totals.fail || 0);
  const pendingCount = Number(totals.pending || 0);
  const passCount = Number(totals.pass || 0);
  if (Number.isFinite(failCount) && Number.isFinite(pendingCount) && Number.isFinite(passCount)) {
    ok(`manifest totals pass=${passCount} pending=${pendingCount} fail=${failCount}`);
  } else {
    fail('manifest totals must contain numeric pass/pending/fail');
  }

  if (failCount > 0 || manifestObject.status === 'FAIL') {
    fail(`closure status has failures: status=${manifestObject.status} fail=${failCount}`);
  }
  if (pendingCount > 0 || actionsList.length > 0 || manifestObject.status === 'PENDING') {
    pending(`closure status is pending: status=${manifestObject.status} pending=${pendingCount} actions=${actionsList.length}`);
  }

  if (manifestObject.status === 'PASS' && actionsList.length > 0) {
    fail(`PASS closure must not have action rows, found ${actionsList.length}`);
  }
  if (manifestObject.status === 'PASS' && pendingCount > 0) {
    fail(`PASS closure must not have pending totals, found ${pendingCount}`);
  }

  if (manifestObject.git_status_clean !== true) {
    pending('git status was not clean when closure report was generated');
  } else {
    ok('git status clean at generation');
  }

  if (manifestObject.source_git_head && manifestObject.bundle_git_head) {
    if (manifestObject.source_git_head === manifestObject.bundle_git_head) {
      ok(`source git head matches bundle git head (${manifestObject.source_git_head})`);
    } else {
      pending(`source git head ${manifestObject.source_git_head} differs from bundle git head ${manifestObject.bundle_git_head}`);
    }
  } else {
    pending('source or bundle git head missing');
  }

  const selectedBundle = resolveMaybeRelative(manifestObject.selected_bundle || '');
  if (selectedBundle && fs.existsSync(path.join(selectedBundle, 'manifest.json'))) {
    ok(`selected bundle exists: ${manifestObject.selected_bundle}`);
    validateBundleLink(selectedBundle, actionsList);
  } else {
    fail(`selected bundle missing or invalid: ${manifestObject.selected_bundle || '(blank)'}`);
  }

  validateOwnerTotals(manifestObject.owner_totals || {}, actionsList);
}

function validateBundleLink(bundleDir, actionsList) {
  const bundleActions = readJson(path.join(bundleDir, 'ACTION_ITEMS.json'));
  if (!Array.isArray(bundleActions)) {
    fail('selected bundle ACTION_ITEMS.json must be an array');
    return;
  }
  if (actionsList.length >= bundleActions.length) {
    ok(`closure actions cover bundle actions (${actionsList.length}/${bundleActions.length})`);
  } else {
    fail(`closure actions ${actionsList.length} fewer than bundle actions ${bundleActions.length}`);
  }
}

function validateOwnerTotals(ownerTotals, actionsList) {
  const expected = {};
  for (const item of actionsList) {
    const owner = String(item.owner || 'project-owner');
    expected[owner] = expected[owner] || { actions: 0, pending_count: 0 };
    expected[owner].actions += 1;
    expected[owner].pending_count += Number(item.pending_count || 0);
  }

  for (const [owner, totals] of Object.entries(expected)) {
    const actual = ownerTotals[owner];
    if (!actual) {
      fail(`owner_totals missing ${owner}`);
      continue;
    }
    if (Number(actual.actions || 0) !== totals.actions) {
      fail(`owner_totals ${owner} actions mismatch: expected ${totals.actions}, found ${actual.actions}`);
    } else {
      ok(`owner_totals ${owner} actions=${totals.actions}`);
    }
    if (Number(actual.pending_count || 0) !== totals.pending_count) {
      fail(`owner_totals ${owner} pending_count mismatch: expected ${totals.pending_count}, found ${actual.pending_count}`);
    } else {
      ok(`owner_totals ${owner} pending_count=${totals.pending_count}`);
    }
  }

  if (actionsList.length === 0 && Object.keys(ownerTotals).length === 0) {
    ok('owner_totals empty for PASS-ready report');
  }
}

function validateActionItems(actionsList) {
  const requiredKeys = ['id', 'category', 'owner', 'priority', 'pending_count', 'source', 'evidence', 'action'];
  for (const [index, item] of actionsList.entries()) {
    for (const key of requiredKeys) {
      if (item[key] == null || String(item[key]).trim() === '') {
        fail(`owner-actions.json row ${index + 1} missing ${key}`);
      }
    }
    const priority = String(item.priority || '').trim();
    if (!['P0', 'P1', 'P2'].includes(priority)) {
      fail(`owner-actions.json row ${index + 1} invalid priority: ${priority}`);
    }
    const pendingCount = Number(item.pending_count);
    if (!Number.isFinite(pendingCount) || pendingCount < 0) {
      fail(`owner-actions.json row ${index + 1} invalid pending_count: ${item.pending_count}`);
    }
    const combined = requiredKeys.map((key) => String(item[key] || '')).join(' ');
    if (combined.includes('<timestamp>')) {
      fail(`owner-actions.json row ${index + 1} contains placeholder path`);
    }
    if (/password|token|secret|bearer/i.test(combined)) {
      fail(`owner-actions.json row ${index + 1} contains a high-risk secret keyword`);
    }
  }
}

function requireFile(root, relPath) {
  const filePath = path.join(root, relPath);
  if (!fs.existsSync(filePath)) {
    fail(`required closure file missing: ${relPath}`);
    return null;
  }
  ok(`required closure file exists: ${relPath}`);
  return filePath;
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    fail(`invalid JSON: ${filePath}: ${err.message}`);
    return null;
  }
}

function countCsvRows(csv) {
  const lines = String(csv || '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return { header: '', rows: 0 };
  return { header: lines[0], rows: lines.length - 1 };
}

function resolveMaybeRelative(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return path.isAbsolute(text) ? text : path.join(ROOT, text);
}

function finish() {
  console.log(`[closure-status] summary ok=${state.ok} pending=${state.pending} fail=${state.fail} allow_pending=${allowPending}`);
  if (state.fail > 0) process.exit(1);
  if (state.pending > 0 && !allowPending) process.exit(1);
  console.log(allowPending && state.pending > 0 ? '[closure-status] PASS (pending allowed)' : '[closure-status] PASS');
  process.exit(0);
}
