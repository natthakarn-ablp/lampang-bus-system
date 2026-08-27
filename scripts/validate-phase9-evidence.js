#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function usage() {
  console.error('Usage: node scripts/validate-phase9-evidence.js <evidence-dir|manifest.json> [--require-mode <mode>]');
}

function fail(message) {
  console.error(`[phase9-evidence] FAIL: ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`[phase9-evidence] OK: ${message}`);
}

const args = process.argv.slice(2);
if (args.length < 1) {
  usage();
  process.exit(2);
}

const targetArg = args[0];
const requiredModes = [];
for (let i = 1; i < args.length; i += 1) {
  if (args[i] === '--require-mode' && args[i + 1]) {
    requiredModes.push(args[i + 1]);
    i += 1;
  } else {
    usage();
    process.exit(2);
  }
}

const target = path.resolve(targetArg);
const stat = fs.existsSync(target) ? fs.statSync(target) : null;
if (!stat) {
  fail(`target not found: ${target}`);
  process.exit(1);
}

const evidenceDir = stat.isDirectory() ? target : path.dirname(target);
const manifestPath = stat.isDirectory() ? path.join(target, 'manifest.json') : target;
const summaryPath = path.join(evidenceDir, 'summary.md');

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  ok(`manifest parsed: ${manifestPath}`);
} catch (err) {
  fail(`manifest is not valid JSON: ${err.message}`);
  process.exit(1);
}

if (!fs.existsSync(summaryPath)) {
  fail(`summary.md missing: ${summaryPath}`);
} else {
  const summary = fs.readFileSync(summaryPath, 'utf8');
  if (!summary.includes('Manifest: `manifest.json`')) {
    fail('summary.md does not reference manifest.json');
  } else {
    ok('summary.md references manifest.json');
  }
}

const safety = manifest.safety || {};
const safetyFlags = [
  'runs_restore_drill',
  'runs_deploy',
  'runs_migrations',
  'runs_imports',
  'runs_feature_flags',
  'writes_production_db',
];
for (const flag of safetyFlags) {
  if (safety[flag] !== false) {
    fail(`safety.${flag} must be false`);
  }
}
if (process.exitCode !== 1) ok('safety flags are non-mutating');

if (!Array.isArray(manifest.gates) || manifest.gates.length === 0) {
  fail('manifest.gates must be a non-empty array');
} else {
  ok(`gate count=${manifest.gates.length}`);
}

const modes = Array.isArray(manifest.modes) ? manifest.modes : [];
for (const mode of requiredModes) {
  if (!modes.includes(mode)) {
    fail(`required mode missing from manifest.modes: ${mode}`);
  }
}

for (const [index, gate] of (manifest.gates || []).entries()) {
  const label = gate && gate.mode ? gate.mode : `#${index}`;
  if (!gate || gate.result !== 'PASS') {
    fail(`gate ${label} result must be PASS`);
  }
  const summary = gate && gate.summary ? gate.summary : {};
  if (Number(summary.fail || 0) !== 0) {
    fail(`gate ${label} summary.fail must be 0`);
  }
  const logName = gate && gate.log;
  if (!logName) {
    fail(`gate ${label} log missing in manifest`);
    continue;
  }
  const logPath = path.join(evidenceDir, logName);
  if (!fs.existsSync(logPath)) {
    fail(`gate ${label} log file missing: ${logPath}`);
    continue;
  }
  const log = fs.readFileSync(logPath, 'utf8');
  if (!/^\[gate\] summary pass=\d+ warn=\d+ fail=0 skip=\d+/m.test(log)) {
    fail(`gate ${label} log does not contain a zero-fail summary`);
  } else {
    ok(`gate ${label} log summary is zero-fail`);
  }
}

if (!manifest.totals || Number(manifest.totals.failed_gates || 0) !== 0) {
  fail('manifest.totals.failed_gates must be 0');
} else {
  ok(`passed_gates=${Number(manifest.totals.passed_gates || 0)} failed_gates=0`);
}

if (!Array.isArray(manifest.remaining_manual_gates) || manifest.remaining_manual_gates.length === 0) {
  fail('remaining_manual_gates must list the external gates still required for 100%');
}

if (process.exitCode === 1) {
  process.exit(1);
}
console.log('[phase9-evidence] PASS');
