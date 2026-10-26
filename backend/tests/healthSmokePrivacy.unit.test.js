'use strict';

// Execute the real log-scan section with synthetic logs. No production path,
// database, LINE request or real personal data is used by this regression test.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/health-smoke.sh'), 'utf8');
const begin = source.indexOf('# ─── H. Recent critical PM2 log scan');
const end = source.indexOf('# ─── Summary', begin);
if (begin < 0 || end < 0) throw new Error('Health smoke log-scan section not found');
const logScan = source.slice(begin, end);
const privateMarker = 'SYNTHETIC_STUDENT_RECORD_NOT_FOR_ALERTS';
const syntheticLine = `Unhandled failure ${privateMarker} phone=0890000000 token=synthetic-only`;

let temporary;
beforeEach(() => { temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'health-smoke-privacy-')); });
afterEach(() => fs.rmSync(temporary, { recursive: true, force: true }));

function run(count, missing = false) {
  const logDir = path.join(temporary, 'logs');
  if (!missing) {
    fs.mkdirSync(logDir);
    fs.writeFileSync(path.join(logDir, 'synthetic-error.log'),
      Array.from({ length: count }, () => syntheticLine).join('\n') + (count ? '\n' : ''));
  }
  const script = path.join(temporary, 'scan.sh');
  fs.writeFileSync(script, [
    'set -uo pipefail',
    'BASELINE_PM2_CRITICAL_MATCHES=7',
    'section() { :; }',
    'pass() { printf "PASS %s\\n" "$*"; }',
    'baseline() { printf "BASELINE %s\\n" "$*"; }',
    'warn() { printf "WARN %s\\n" "$*"; }',
    'skip() { printf "SKIP %s\\n" "$*"; }',
    logScan,
  ].join('\n'));
  const result = spawnSync(bash, [script.replace(/\\/g, '/')], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PM2_LOG_DIR: logDir.replace(/\\/g, '/') },
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  const output = result.stdout + result.stderr;
  expect(output).not.toMatch(/SYNTHETIC_STUDENT_RECORD_NOT_FOR_ALERTS|0890000000|synthetic-only|synthetic-error\.log/);
  return output;
}

test('empty logs remain PASS', () => {
  expect(run(0)).toContain('PASS no critical patterns found');
});
test('rotated logs keep the baseline count without disclosing log content', () => {
  expect(run(3)).toMatch(/BASELINE PM2 critical matches=3/);
});
test('historical baseline does not print the first matching records', () => {
  expect(run(7)).toMatch(/BASELINE PM2 critical matches=7/);
});
test('new matches remain WARN without forwarding the last matching records', () => {
  expect(run(8)).toMatch(/WARN PM2 critical matches=8 .* \+ 1 new/);
});
test('missing log directory remains SKIP', () => {
  expect(run(0, true)).toMatch(/SKIP .* does not exist/);
});
