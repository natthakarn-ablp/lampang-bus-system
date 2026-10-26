'use strict';

// Exercise the real shell wrapper with synthetic smoke results and a curl
// stub. No LINE request, real credential or production state is involved.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const posix = p => p.replace(/\\/g, '/');
let base, app, state, calls, stubs, script;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'health-alert-retry-'));
  app = path.join(base, 'app'); state = path.join(base, 'state');
  stubs = path.join(base, 'stubs'); calls = path.join(base, 'http-attempts');
  fs.mkdirSync(path.join(app, 'scripts'), { recursive: true });
  fs.mkdirSync(state); fs.mkdirSync(stubs);
  function executable(file, content) {
    fs.writeFileSync(file, content); fs.chmodSync(file, 0o755);
  }
  executable(path.join(app, 'scripts/health-smoke.sh'), [
    '#!/usr/bin/env bash',
    'if [ "$SYNTH_SMOKE" = "PASS" ]; then',
    '  echo "PASS: 1 BASELINE: 0 WARN: 0 FAIL: 0 SKIP: 0"; exit 0',
    'fi',
    'echo "[FAIL] synthetic incident $SYNTH_SMOKE"',
    'echo "PASS: 0 BASELINE: 0 WARN: 0 FAIL: 1 SKIP: 0"; exit 1',
    ''
  ].join('\n'));
  executable(path.join(stubs, 'curl'), [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$SYNTH_HTTP" >> "$SYNTH_CALLS"',
    'while [ "$#" -gt 0 ]; do',
    '  if [ "$1" = "-o" ]; then printf "{}" > "$2"; shift; fi',
    '  shift',
    'done',
    'printf "%s" "$SYNTH_HTTP"',
    ''
  ].join('\n'));
  executable(path.join(stubs, 'python3'), [
    '#!/usr/bin/env bash',
    'node -e \'console.log(JSON.stringify({to:process.env.TARGET_ID,messages:[{type:"text",text:process.env.MSG}]}))\'',
    ''
  ].join('\n'));
  const original = fs.readFileSync(path.resolve(__dirname, '../../scripts/health-smoke-alert.sh'), 'utf8');
  expect(original).toContain('APP_DIR="/home/schoolbus/apps/lampang-bus-system"');
  expect(original).toContain('ALERT_STATE_DIR="/var/lib/schoolbus/health-alert"');
  script = path.join(base, 'wrapper.sh');
  executable(script, original
    .replace('APP_DIR="/home/schoolbus/apps/lampang-bus-system"', 'APP_DIR="' + posix(app) + '"')
    .replace('ALERT_STATE_DIR="/var/lib/schoolbus/health-alert"', 'ALERT_STATE_DIR="' + posix(state) + '"')
    .replace('LINE_PUSH_ENDPOINT="https://api.line.me/v2/bot/message/push"', 'LINE_PUSH_ENDPOINT="http://127.0.0.1:1/synthetic-disabled"')
    .replace('$(curl --silent', '$("$SYNTH_CURL" --silent')
    .replace(' python3 - <<', ' "$SYNTH_PYTHON" - <<'));
});

afterEach(() => fs.rmSync(base, { recursive: true, force: true }));
function run(smoke, http = '200', credentials = true) {
  return spawnSync(bash, [posix(script)], {
    encoding: 'utf8', timeout: 15000,
    env: { ...process.env, PATH: posix(stubs) + path.delimiter + process.env.PATH,
      FORCE_FAIL: '0', SYNTH_SMOKE: smoke, SYNTH_HTTP: http, SYNTH_CALLS: posix(calls),
      SYNTH_CURL: posix(path.join(stubs, 'curl')), SYNTH_PYTHON: posix(path.join(stubs, 'python3')),
      LINE_CHANNEL_ACCESS_TOKEN: credentials ? 'synthetic-not-a-real-token' : '',
      TECH_LINE_TARGET_ID: credentials ? 'synthetic-technical-recipient' : '',
      LINE_TARGET_ID: '' }
  });
}
function attempts() {
  return fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : [];
}

test('healthy smoke stays quiet', () => {
  expect(run('PASS').status).toBe(0); expect(attempts()).toEqual([]);
});
test('successful delivery suppresses an identical failure', () => {
  const first = run('A');
  expect(first.stdout + first.stderr).toContain('ALERT DELIVERED');
  expect({status:first.status,output:first.stdout+first.stderr}).toMatchObject({status:1});
  expect(run('A').status).toBe(2);
  expect(attempts()).toEqual(['200']);
});
test('failed delivery of a new incident is retried despite a recent older alert', () => {
  expect(run('A').status).toBe(1);
  expect(run('B', '503').status).toBe(2);
  expect(run('B').status).toBe(1);
  expect(attempts()).toEqual(['200', '503', '200']);
});
test('missing credentials do not silence the next configured retry', () => {
  expect(run('A', '200', false).status).toBe(2);
  expect(run('A').status).toBe(1);
  expect(attempts()).toEqual(['200']);
});
test('failed recovery notification is retried and successful recovery then stays quiet', () => {
  expect(run('A').status).toBe(1);
  expect(run('PASS', '503').status).toBe(2);
  expect(run('PASS').status).toBe(0);
  expect(run('PASS').status).toBe(0);
  expect(attempts()).toEqual(['200', '503', '200']);
});
