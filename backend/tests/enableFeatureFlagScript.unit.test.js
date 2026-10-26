'use strict';

/**
 * scripts/enable-feature-flag.sh, executed against a throwaway app directory.
 *
 * WHY THIS EXISTS
 * ---------------
 * ecosystem.config.js declares no exec_mode and no instances, so PM2 runs this
 * app in fork mode and `pm2 reload` is a stop and start, not a seamless swap.
 * A flag turned on without its migration makes backend/src/index.js refuse to
 * boot; PM2 retries to max_restarts and parks the app `errored`, and the whole
 * site is down for every role until somebody edits backend/.env back by hand.
 * The automatic rollback in this script is the only thing standing between a
 * typo and that outage, and until now nothing exercised it — while the older
 * and far less dangerous restore-drill script had a suite of its own.
 *
 * WHAT THE SCRIPT GUARANTEES (stated exactly, and asserted here)
 * --------------------------------------------------------------
 * Every refusal — unknown flag, bad value, missing file, unmet flag pair,
 * unwritable state directory — happens BEFORE backend/.env is touched and
 * before PM2 is called. Once the file is written the reload has happened by
 * definition, so a bad health verdict is answered by copying the backup back
 * over backend/.env and reloading again. It is NOT true that a failure always
 * leaves PM2 alone; it is true that a failure always leaves backend/.env as it
 * found it, unless the rollback reload itself cannot restore health — and then
 * the file is still restored and the script says so and exits 2.
 *
 * HOW
 * ---
 * The architecture is deployBackendScript.unit.test.js's, because that suite
 * already solved every hard part of this problem. A throwaway APP_DIR with its
 * own backend/.env and ecosystem.config.js, a STATE_DIR beside it, and stub
 * pm2/curl executables handed to the script by ABSOLUTE path through
 * FLAG_PM2/FLAG_CURL — not through PATH order, which is a hypothesis about how
 * Git Bash resolves a name, not a guarantee. Every stub records `$0`, so a case
 * can prove the stub was the thing invoked.
 *
 * The one piece added here is that the modelled runtime is a FUNCTION OF THE
 * FILE. The pm2 stub reads the .env the script just wrote and refuses to come
 * up when a line matches STUB_BOOT_FAILS_ON — which is precisely what the boot
 * guard in src/index.js does. So "the rollback worked" is not asserted by
 * exit code: health comes back only because the bytes that were put back no
 * longer contain the flag, and the tests below compare those bytes directly.
 *
 * Nothing here touches /home/schoolbus, backend/.env, or a feature flag. Every
 * child process has a timeout.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'enable-feature-flag.sh');
const ENV_JS = fs.readFileSync(path.join(ROOT, 'backend', 'src', 'config', 'env.js'), 'utf8');
const SRC = fs.readFileSync(SCRIPT, 'utf8');

const toPosix = (p) => p.replace(/\\/g, '/');

function resolveBash() {
  const explicit = process.env.DEPLOY_TEST_BASH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  if (process.platform === 'win32') {
    for (const candidate of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return 'bash';
}
const BASH = resolveBash();
const bashProbe = (() => {
  try {
    const r = spawnSync(BASH, ['-c', 'echo ok'], { encoding: 'utf8', timeout: 20000 });
    return { ok: r.status === 0 && (r.stdout || '').trim() === 'ok', error: r.error && r.error.message };
  } catch (err) {
    return { ok: false, error: err.message };
  }
})();
const hasBash = bashProbe.ok;
const describeWithBash = hasBash ? describe : describe.skip;

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/**
 * A production-shaped backend/.env: real-looking secrets that the rollback
 * assertions compare byte for byte, a Thai comment because the server's file
 * has them, and two flags already present so both the replace path and the
 * append path can be exercised against the same fixture.
 */
const ENV_BASE = [
  'NODE_ENV=production',
  'PORT=3000',
  'TZ=Asia/Bangkok',
  'DB_HOST=127.0.0.1',
  'DB_PORT=3306',
  'DB_NAME=lampang_bus',
  'DB_USER=schoolbus',
  'DB_PASSWORD=fixture-password-never-real',
  // Says what it is. A 32-character hex string is indistinguishable from a
  // real signing key, and the readiness gate's secret scan is right to flag
  // one — a fixture should not make a security check cry wolf.
  'JWT_SECRET=fixture-jwt-secret-never-real-0000000000',
  'LINE_CHANNEL_ACCESS_TOKEN=fixture-token',
  '',
  '# ธงฟีเจอร์ — ปิดไว้ทั้งหมดจนกว่าจะรัน migration ที่เกี่ยวข้อง',
  'FEATURE_VEHICLE_QR=false',
  'FEATURE_ETA=false',
  '',
].join('\n');

function writeStubs(dir) {
  const stubs = {
    // pm2 reload models a fork-mode restart, and the state it leaves behind is
    // a FUNCTION OF THE FILE: the new process reads the .env the script just
    // wrote and comes up unhealthy when a line matches STUB_BOOT_FAILS_ON —
    // the boot guard in src/index.js, in one line. STUB_BOOT_FAILS_STATE says
    // how it is unhealthy (`errored` = never answers, the crash loop).
    // Nothing here remembers a previous verdict, so health returns only if the
    // bytes the rollback put back really no longer carry the flag.
    pm2: `#!/usr/bin/env bash
echo "pm2 $*" >> "$STUB_LOG"; echo "pm2 $0" >> "$STUB_LOG.paths"
if [ "$1" = reload ]; then
  n=$(( $(cat "$STUB_RELOADS" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STUB_RELOADS"
  if [ "\${STUB_PM2_EXIT:-0}" != 0 ]; then exit "\${STUB_PM2_EXIT}"; fi
  if [ -n "\${STUB_BOOT_FAILS_ON:-}" ] && grep -Eq "\${STUB_BOOT_FAILS_ON}" "$STUB_ENV_FILE"; then
    echo "\${STUB_BOOT_FAILS_STATE:-errored}" > "$STUB_RUNTIME"
  else
    echo ok > "$STUB_RUNTIME"
  fi
fi
exit 0
`,
    // curl answers for the modelled runtime. An `errored` process answers
    // nothing at all, which is what the script reads as "unreachable".
    curl: `#!/usr/bin/env bash
echo "curl $*" >> "$STUB_LOG"; echo "curl $0" >> "$STUB_LOG.paths"
state="$(cat "$STUB_RUNTIME" 2>/dev/null || echo ok)"
reloads="$(cat "$STUB_RELOADS" 2>/dev/null || echo 0)"
if [ "$reloads" -ge 2 ] && [ -n "\${STUB_HEALTH_AFTER_ROLLBACK:-}" ]; then state="\${STUB_HEALTH_AFTER_ROLLBACK}"; fi
case "$state" in
  errored|unreachable) exit 7 ;;
  success-false)   printf '{"success":false,"message":"boot failed"}\\n' ;;
  db-disconnected) printf '{"success":true,"data":{"service":"lampang-bus-backend","database":{"connected":false}}}\\n' ;;
  *)               printf '{"success":true,"data":{"service":"lampang-bus-backend","database":{"connected":true}}}\\n' ;;
esac
exit 0
`,
  };
  for (const [name, body] of Object.entries(stubs)) {
    const file = path.join(dir, name);
    write(file, body);
    fs.chmodSync(file, 0o755);
  }
}

/** APP_DIR (with backend/.env + ecosystem.config.js) + STATE_DIR + stubs. */
function makeFixture({ env = ENV_BASE } = {}) {
  const base = toPosix(fs.mkdtempSync(path.join(os.tmpdir(), 'enable-flag-fixture-')));
  const app = `${base}/app`;
  const envFile = `${app}/backend/.env`;
  write(envFile, env);
  write(`${app}/ecosystem.config.js`, "module.exports = { apps: [{ name: 'schoolbus-backend' }] };\n");
  const stubs = `${base}/stubs`;
  writeStubs(stubs);
  const runtime = `${base}/runtime.txt`;
  write(runtime, 'ok\n'); // the service is healthy before the flag is touched
  fs.mkdirSync(`${base}/tmp`, { recursive: true });
  // The script uses absolute paths only, so it is run from an EMPTY directory:
  // Git Bash expands an unquoted glob in the command line it is handed, and a
  // flag name like `*` would otherwise arrive as the name of a fixture file
  // and prove nothing about the script.
  fs.mkdirSync(`${base}/cwd`, { recursive: true });
  return {
    base,
    cwd: `${base}/cwd`,
    app,
    envFile,
    ecosystem: `${app}/ecosystem.config.js`,
    state: `${base}/state`,
    stubs,
    runtime,
    reloads: `${base}/reloads.txt`,
    stubLog: `${base}/stub.log`,
    tmp: `${base}/tmp`,
    original: env,
  };
}

/**
 * Nothing the caller exports may reach the fixture. The deploy script runs the
 * unit suites with its own DEPLOY_ and HEALTH_ variables exported, and on
 * 2026-09-06 that inheritance aborted every fixture in the sibling suite for
 * the wrong reason. Every variable this script or a stub reads is dropped and
 * re-supplied by the fixture itself.
 */
const INHERITED_FLAG_VARS = [
  'APP_DIR', 'STATE_DIR', 'HEALTH_URL', 'HEALTH_ATTEMPTS', 'HEALTH_SLEEP_SEC',
  'DRY_RUN', 'FLAG_PM2', 'FLAG_CURL', 'TMPDIR',
];
function baseEnv() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (INHERITED_FLAG_VARS.includes(k) || k.startsWith('STUB_')) continue;
    out[k] = v;
  }
  return out;
}

function envFor(fx, env = {}) {
  return {
    ...baseEnv(),
    APP_DIR: fx.app,
    STATE_DIR: fx.state,
    HEALTH_URL: 'http://127.0.0.1:9/health',
    HEALTH_ATTEMPTS: '2',
    HEALTH_SLEEP_SEC: '0',
    TMPDIR: fx.tmp,
    FLAG_PM2: `${fx.stubs}/pm2`,
    FLAG_CURL: `${fx.stubs}/curl`,
    STUB_LOG: fx.stubLog,
    STUB_RUNTIME: fx.runtime,
    STUB_RELOADS: fx.reloads,
    STUB_ENV_FILE: fx.envFile,
    ...env,
  };
}

function run(fx, args = [], env = {}) {
  const r = spawnSync(BASH, [SCRIPT, ...args], { cwd: fx.cwd, encoding: 'utf8', env: envFor(fx, env), timeout: 60000 });
  const calls = fs.existsSync(fx.stubLog) ? fs.readFileSync(fx.stubLog, 'utf8').trim().split('\n').filter(Boolean) : [];
  return {
    ...r,
    out: `${r.stdout}\n${r.stderr}`,
    stubCalls: calls,
    reloads: calls.filter((l) => l.startsWith('pm2 reload')),
    curls: calls.filter((l) => l.startsWith('curl ')),
    // null rather than a throw: one case deletes the file on purpose.
    env: fs.existsSync(fx.envFile) ? fs.readFileSync(fx.envFile, 'utf8') : null,
  };
}

/** The backups the script wrote into STATE_DIR, newest name last. */
function backups(fx) {
  if (!fs.existsSync(fx.state)) return [];
  return fs.readdirSync(fx.state).filter((f) => f.startsWith('env.backup-')).sort();
}
const backupBody = (fx, name) => fs.readFileSync(path.join(fx.state, name), 'utf8');

describe('bash for the behavioural fixtures', () => {
  it(`is available (${BASH}); set DEPLOY_TEST_BASH to point at one — a skipped fixture suite is not a passing one`, () => {
    expect(`bash ok: ${hasBash}${hasBash ? '' : ` (${bashProbe.error || 'probe failed'})`}`).toBe('bash ok: true');
  });
});

describeWithBash('enable-feature-flag.sh against a throwaway app directory', () => {
  jest.setTimeout(60000);
  let fx;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => { try { fs.rmSync(fx.base, { recursive: true, force: true }); } catch { /* temp dir */ } });

  // ── happy paths ──────────────────────────────────────────────────────────
  it('happy path (flag absent): appends the line, backs the file up first, reloads once, reports the flag live', () => {
    const r = run(fx, ['FEATURE_GEOFENCE']);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).toContain('current: <not set>');
    expect(r.out).toContain('health OK — FEATURE_GEOFENCE=true is live');
    expect(r.out).toMatch(/anyone already signed in must sign out and back in/);
    expect(r.reloads).toEqual([`pm2 reload ${fx.ecosystem}`]);
    // The whole previous file is still there, with exactly one line added.
    expect(r.env.startsWith(fx.original)).toBe(true);
    expect(r.env).toMatch(/\n# set by scripts\/enable-feature-flag\.sh on \d{8}-\d{6}\nFEATURE_GEOFENCE=true\n$/);
    // and the backup is the file as it was BEFORE the edit.
    expect(backups(fx)).toHaveLength(1);
    expect(backups(fx)[0]).toMatch(/^env\.backup-\d{8}-\d{6}-FEATURE_GEOFENCE$/);
    expect(backupBody(fx, backups(fx)[0])).toBe(fx.original);
  });

  it('happy path (flag already present): replaces that line in place and changes nothing else', () => {
    const r = run(fx, ['FEATURE_ETA', 'true']);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).toContain('current: false');
    // Byte-for-byte: the one line differs, no appended comment, no duplicate.
    expect(r.env).toBe(fx.original.replace('FEATURE_ETA=false', 'FEATURE_ETA=true'));
    expect(r.env).not.toMatch(/set by scripts\/enable-feature-flag\.sh/);
    expect(r.env.match(/^FEATURE_ETA=/gm)).toHaveLength(1);
    expect(r.reloads).toHaveLength(1);
  });

  it('turns a flag off the same way, and counts the feature lines it left behind', () => {
    const on = ENV_BASE.replace('FEATURE_ETA=false', 'FEATURE_ETA=true');
    const local = makeFixture({ env: on });
    try {
      const r = run(local, ['FEATURE_ETA', 'false']);
      expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
      expect(r.env).toBe(on.replace('FEATURE_ETA=true', 'FEATURE_ETA=false'));
      expect(r.out).toContain('env updated: 2 feature line(s) now set');
    } finally {
      fs.rmSync(local.base, { recursive: true, force: true });
    }
  });

  it('already at the wanted value: says so and does nothing at all', () => {
    const r = run(fx, ['FEATURE_ETA', 'false']);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).toContain('already false — nothing to do.');
    expect(r.stubCalls).toEqual([]);
    expect(backups(fx)).toEqual([]);
    expect(r.env).toBe(fx.original);
  });

  it('DRY_RUN=1 shows the change and writes nothing — no backup, no edit, no reload', () => {
    const r = run(fx, ['FEATURE_ETA', 'true'], { DRY_RUN: '1' });
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).toContain('DRY RUN: would set FEATURE_ETA=true and reload. Nothing was changed.');
    expect(r.stubCalls).toEqual([]);
    expect(backups(fx)).toEqual([]);
    expect(r.env).toBe(fx.original);
  });

  it('a pm2 reload that returns non-zero is not fatal: health is still the verdict', () => {
    // pm2 reload can exit non-zero and still have restarted the process. The
    // process state is what /health reports, not what pm2's exit code claims.
    const r = run(fx, ['FEATURE_ETA', 'true'], { STUB_PM2_EXIT: '1' });
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).toContain('pm2 reload returned non-zero — checking health anyway');
    expect(r.curls.length).toBeGreaterThan(0);
  });

  it('proves the stubs were what ran: every recorded $0 is under the stub directory, not a PATH lookup', () => {
    const r = run(fx, ['FEATURE_ETA', 'true']);
    expect(r.status).toBe(0);
    const paths = fs.readFileSync(`${fx.stubLog}.paths`, 'utf8').trim().split('\n');
    const foreign = paths.filter((l) => !l.split(' ')[1].startsWith(fx.stubs));
    expect(`foreign invocations: ${foreign.join('; ')}`).toBe('foreign invocations: ');
    expect(new Set(paths.map((l) => l.split(' ')[0]))).toEqual(new Set(['pm2', 'curl']));
  });

  it('every health probe is bounded by --max-time', () => {
    const r = run(fx, ['FEATURE_ETA', 'true']);
    expect(r.curls.length).toBeGreaterThan(0);
    expect(r.curls.every((l) => l.includes('--max-time'))).toBe(true);
  });

  // ── the rollback: the point of the whole script ──────────────────────────
  it('the new process refuses to boot: the flag is put back, byte for byte, and the service is healthy again', () => {
    // The real case: FEATURE_PARTICIPATION_CASES turned on while migration 050
    // is missing, so src/index.js exits and PM2 crash-loops to `errored`.
    const r = run(fx, ['FEATURE_PARTICIPATION_CASES'], { STUB_BOOT_FAILS_ON: '^FEATURE_PARTICIPATION_CASES=true' });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/health verdict: unreachable — rolling the flag back/);
    expect(r.out).toContain('FEATURE_PARTICIPATION_CASES was NOT enabled; the previous configuration is restored and the service is healthy');
    // THE assertion: the file is the file it started as, not merely "the
    // script exited non-zero". No appended line, no stray comment, secrets
    // and Thai comment intact.
    expect(r.env).toBe(fx.original);
    expect(r.env).not.toMatch(/FEATURE_PARTICIPATION_CASES/);
    // Two reloads: the one that broke it and the one that fixed it.
    expect(r.reloads).toHaveLength(2);
    // and the backup is still on disk for the operator to inspect.
    expect(backupBody(fx, backups(fx)[0])).toBe(fx.original);
  });

  it('the rollback restores the PREVIOUS VALUE of a flag that was already set, not just any old file', () => {
    const r = run(fx, ['FEATURE_ETA', 'true'], { STUB_BOOT_FAILS_ON: '^FEATURE_ETA=true' });
    expect(r.status).toBe(1);
    expect(r.env).toBe(fx.original);
    expect(r.env).toContain('FEATURE_ETA=false');
    expect(r.env.match(/^FEATURE_ETA=/gm)).toHaveLength(1);
    expect(r.reloads).toHaveLength(2);
  });

  it.each([
    ['answers HTTP but reports success:false', 'success-false'],
    ['answers but says the database is not connected', 'db-disconnected'],
  ])('a process that boots and %s is rolled back too — a 200 is not a verdict', (_label, state) => {
    const r = run(fx, ['FEATURE_ETA', 'true'], {
      STUB_BOOT_FAILS_ON: '^FEATURE_ETA=true',
      STUB_BOOT_FAILS_STATE: state,
    });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(new RegExp(`health verdict: ${state} — rolling the flag back`));
    expect(r.env).toBe(fx.original);
    expect(r.reloads).toHaveLength(2);
  });

  it('reports every failed attempt while it waits, so the log shows how long it tried', () => {
    const r = run(fx, ['FEATURE_ETA', 'true'], {
      STUB_BOOT_FAILS_ON: '^FEATURE_ETA=true',
      STUB_BOOT_FAILS_STATE: 'db-disconnected',
      HEALTH_ATTEMPTS: '3',
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain('health attempt 1/3: db-disconnected');
    expect(r.out).toContain('health attempt 3/3: db-disconnected');
    // Three probes before the rollback; the rollback needs only one, because
    // the restored file boots.
    expect(r.curls).toHaveLength(4);
  });

  it('the rollback itself does not restore health: exits 2, still leaves the file restored, and prints the manual fix', () => {
    const r = run(fx, ['FEATURE_ETA', 'true'], {
      STUB_BOOT_FAILS_ON: '^FEATURE_ETA=true',
      STUB_HEALTH_AFTER_ROLLBACK: 'unreachable',
    });
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/FATAL: rollback did not restore health \(verdict: unreachable\)/);
    // The operator is handed a command that is a no-op re-run rather than a
    // repair, which is only true because the file really was put back.
    expect(r.env).toBe(fx.original);
    const backup = backups(fx)[0];
    expect(r.out).toContain(`Restore by hand:  cp -a ${fx.state}/${backup} ${fx.envFile} && pm2 reload ${fx.ecosystem}`);
    expect(backupBody(fx, backup)).toBe(fx.original);
  });

  it('a flag pair the app validates but this script does not pre-check is still caught — by the rollback', () => {
    // env.js throws when FEATURE_ADMIN_PASSWORD_RECOVERY is on without
    // LINE_LIFF_ID. KNOWN_FLAGS lets the flag through, so the refusal happens
    // at boot rather than before the write; the rollback is what keeps that
    // from being an outage. Pinning it here so the safety net is not removed
    // on the assumption that the pre-checks cover every pair. They do not.
    expect(ENV_JS).toContain("throw new Error('FEATURE_ADMIN_PASSWORD_RECOVERY requires LINE_LIFF_ID')");
    expect(fx.original).not.toContain('LINE_LIFF_ID');
    const r = run(fx, ['FEATURE_ADMIN_PASSWORD_RECOVERY'], { STUB_BOOT_FAILS_ON: '^FEATURE_ADMIN_PASSWORD_RECOVERY=true' });
    expect(r.status).toBe(1);
    expect(r.env).toBe(fx.original);
    expect(r.reloads).toHaveLength(2);
  });

  // ── refusals, all of them before anything is written ─────────────────────
  it.each([
    ['no argument at all', [], /usage: bash scripts\/enable-feature-flag\.sh <FEATURE_NAME> \[true\|false\]/],
    ['an empty argument', [''], /usage: bash scripts\/enable-feature-flag\.sh/],
    ['a flag this app does not read', ['FEATURE_NOPE'], /unknown flag: FEATURE_NOPE/],
    ['the wrong case', ['feature_eta'], /unknown flag: feature_eta/],
    ['an assignment instead of a name', ['FEATURE_ETA=true'], /unknown flag: FEATURE_ETA=true/],
    ['a command appended to the name', ['FEATURE_ETA; rm -rf /'], /unknown flag: FEATURE_ETA; rm -rf \//],
    ['a prefix of a real flag', ['FEATURE_'], /unknown flag: FEATURE_/],
    // The whitelist is a `case` pattern with the name inside double quotes, so
    // a glob given as the name is matched literally rather than expanded.
    ['a glob', ['*'], /unknown flag: \*/],
    ['a single-character glob', ['?'], /unknown flag: \?/],
  ])('refuses %s and leaves .env, the state directory and PM2 alone', (_label, args, message) => {
    const r = run(fx, args);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(message);
    expect(r.env).toBe(fx.original);
    expect(r.stubCalls).toEqual([]);
    expect(fs.existsSync(fx.state)).toBe(false);
  });

  it.each([['TRUE'], ['yes'], ['1'], ['on'], ['true false']])('refuses the value %p — only true or false may be written', (value) => {
    const r = run(fx, ['FEATURE_ETA', value]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(`value must be true or false, got: ${value}`);
    expect(r.env).toBe(fx.original);
    expect(r.stubCalls).toEqual([]);
  });

  it('an EMPTY second argument means true, not an empty assignment — a quirk of ${2:-true}, pinned deliberately', () => {
    // `${2:-true}` cannot tell an empty argument from an absent one, so
    // `… FEATURE_ETA ""` is the documented default rather than a refusal. That
    // is safe (the alternative would be writing `FEATURE_ETA=`, which dotenv
    // reads as the empty string and env.js treats as off, while the script
    // reported it "live"). If this is ever tightened to `${2-true}` the change
    // is a behaviour change and this test is where it shows up.
    const r = run(fx, ['FEATURE_ETA', '']);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).toContain('wanted:  true');
    expect(r.env).toContain('FEATURE_ETA=true');
    expect(r.env).not.toMatch(/^FEATURE_ETA=$/m);
  });

  it('refuses when backend/.env is missing, before creating the state directory', () => {
    fs.rmSync(fx.envFile);
    const r = run(fx, ['FEATURE_ETA', 'true']);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(`env file not found: ${fx.envFile}`);
    expect(r.stubCalls).toEqual([]);
    expect(fs.existsSync(fx.state)).toBe(false);
  });

  it('refuses when ecosystem.config.js is missing — there would be nothing to reload', () => {
    fs.rmSync(fx.ecosystem);
    const r = run(fx, ['FEATURE_ETA', 'true']);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/ecosystem file not found/);
    expect(r.env).toBe(fx.original);
    expect(r.stubCalls).toEqual([]);
  });

  it('refuses FEATURE_PARENT_CONSENT_REQUIRED without FEATURE_VEHICLE_QR, before touching .env', () => {
    const r = run(fx, ['FEATURE_PARENT_CONSENT_REQUIRED']);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/FEATURE_PARENT_CONSENT_REQUIRED requires FEATURE_VEHICLE_QR=true/);
    expect(r.out).toMatch(/the consent router is the only way a parent can grant consent/);
    expect(r.env).toBe(fx.original);
    expect(r.stubCalls).toEqual([]);
    expect(backups(fx)).toEqual([]);
  });

  it('refuses FEATURE_QR_LEVEL3 without FEATURE_VEHICLE_QR, and allows it once QR is on', () => {
    const refused = run(fx, ['FEATURE_QR_LEVEL3']);
    expect(refused.status).not.toBe(0);
    expect(refused.out).toMatch(/FEATURE_QR_LEVEL3 requires FEATURE_VEHICLE_QR=true/);
    expect(refused.env).toBe(fx.original);

    const withQr = makeFixture({ env: ENV_BASE.replace('FEATURE_VEHICLE_QR=false', 'FEATURE_VEHICLE_QR=true') });
    try {
      const ok = run(withQr, ['FEATURE_QR_LEVEL3']);
      expect(`exit ${ok.status}: ${ok.out}`).toMatch(/^exit 0:/);
      expect(ok.env).toContain('FEATURE_QR_LEVEL3=true');
    } finally {
      fs.rmSync(withQr.base, { recursive: true, force: true });
    }
  });

  it('turning a paired flag OFF is never blocked by its partner', () => {
    // The pre-checks guard `=true` only: rolling a feature back must not be
    // refused because its dependency is also off.
    const on = ENV_BASE.replace('FEATURE_ETA=false', 'FEATURE_ETA=false\nFEATURE_QR_LEVEL3=true');
    const local = makeFixture({ env: on });
    try {
      const r = run(local, ['FEATURE_QR_LEVEL3', 'false']);
      expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
      expect(r.env).toContain('FEATURE_QR_LEVEL3=false');
    } finally {
      fs.rmSync(local.base, { recursive: true, force: true });
    }
  });

  it('a state directory that cannot be created stops before .env is touched — there would be nowhere to put the backup', () => {
    write(`${fx.base}/not-a-dir`, 'regular file\n');
    const r = run(fx, ['FEATURE_ETA', 'true'], { STATE_DIR: `${fx.base}/not-a-dir/state` });
    expect(r.status).not.toBe(0);
    expect(r.env).toBe(fx.original);
    expect(r.stubCalls).toEqual([]);
  });

  it('leaves no temporary .env behind, on the happy path or after a rollback', () => {
    const ok = run(fx, ['FEATURE_ETA', 'true']);
    expect(ok.status).toBe(0);
    expect(fs.readdirSync(fx.tmp)).toEqual([]);
    const rolled = run(fx, ['FEATURE_GEOFENCE'], { STUB_BOOT_FAILS_ON: '^FEATURE_GEOFENCE=true' });
    expect(rolled.status).toBe(1);
    expect(fs.readdirSync(fx.tmp)).toEqual([]);
  });
});

describe('enable-feature-flag.sh source', () => {
  const code = SRC.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  it('uses LF line endings so the server\'s bash can run it', () => {
    expect(`has CR: ${SRC.includes('\r')}`).toBe('has CR: false');
  });

  it('stops on error, unset variables and a failed pipe', () => {
    expect(SRC).toMatch(/^set -euo pipefail$/m);
  });

  it('knows exactly the flags backend/src/config/env.js reads — no more, no fewer', () => {
    // A flag env.js reads but KNOWN_FLAGS omits cannot be turned on through
    // the safe path at all, so somebody edits .env by hand instead and loses
    // the backup and the rollback. A flag in KNOWN_FLAGS that env.js does not
    // read writes a line nothing acts on and reports it "live".
    const declared = new Set((code.match(/^KNOWN_FLAGS="[\s\S]*?"$/m)[0].match(/FEATURE_[A-Z0-9_]+/g) || []));
    const read = new Set((ENV_JS.match(/process\.env\.(FEATURE_[A-Z0-9_]+)/g) || []).map((m) => m.replace('process.env.', '')));
    expect([...declared].sort().join(' ')).toBe([...read].sort().join(' '));
  });

  it('guards the same flag pairs env.js refuses to boot on', () => {
    for (const pair of ['FEATURE_QR_LEVEL3', 'FEATURE_PARENT_CONSENT_REQUIRED']) {
      expect(ENV_JS).toMatch(new RegExp(`source\\.${pair} === 'true' && source\\.FEATURE_VEHICLE_QR !== 'true'`));
      expect(code).toContain(`[ "$FLAG" = "${pair}" ] && [ "$VALUE" = "true" ]`);
    }
  });

  it('reads .env with sed, not grep -P: a locale where grep -P refuses would silently report a set flag as unset', () => {
    // An empty read makes the script think the flag is not there and APPEND a
    // second line for it. The comment in the script says so; this pins it.
    expect(code).toMatch(/read_flag\(\) \{ sed -n "s\/\^\$1=\/\/p" "\$ENV_FILE" \| head -1; \}/);
    expect(code).not.toMatch(/grep\s+-[a-zA-Z]*P/);
  });

  it('backs the file up BEFORE it writes, and rolls back from that same backup', () => {
    const backupAt = code.indexOf('cp -a "$ENV_FILE" "$BACKUP"');
    const writeAt = code.indexOf('cat "$TMP" > "$ENV_FILE"');
    const restoreAt = code.indexOf('cp -a "$BACKUP" "$ENV_FILE"');
    expect(`backup before write: ${backupAt > -1 && backupAt < writeAt}`).toBe('backup before write: true');
    expect(`restores from the backup: ${restoreAt > writeAt}`).toBe('restores from the backup: true');
  });

  it('writes through a mode-600 temp file and then copies its CONTENT into .env', () => {
    // `mv` would replace the inode and hand .env the temp file's ownership and
    // permissions; `cat >` keeps the file the server already trusts.
    expect(code).toMatch(/chmod 600 "\$TMP"/);
    expect(code).toMatch(/cat "\$TMP" > "\$ENV_FILE"/);
    expect(code).not.toMatch(/mv\s+"?\$TMP"?\s+"?\$ENV_FILE/);
    expect(code).toMatch(/trap 'rm -f "\$TMP" 2>\/dev\/null \|\| true' EXIT INT TERM/);
  });

  it('invokes pm2 and curl through their *_BIN variable — a bare name resolves through PATH', () => {
    // Lines that only BUILD the operator's manual-restore text are prose, not
    // commands, and are excluded; so are words inside double-quoted strings
    // ("pm2 reload returned non-zero — checking health anyway").
    const blankStrings = (l) => l.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    const bare = code.split('\n')
      .filter((l) => !/^\s*echo "\[flag\] /.test(l))
      .map(blankStrings)
      .filter((l) => /(^|[\s;&|(])(pm2|curl)\s/.test(l));
    expect(bare).toEqual([]);
    expect(code).toContain('PM2_BIN="${FLAG_PM2:-pm2}"');
    expect(code).toContain('CURL_BIN="${FLAG_CURL:-curl}"');
  });

  it('keeps the server defaults, so an unset environment behaves exactly as it did', () => {
    expect(code).toMatch(/^APP_DIR="\$\{APP_DIR:-\/home\/schoolbus\/apps\/lampang-bus-system\}"$/m);
    expect(code).toMatch(/^STATE_DIR="\$\{STATE_DIR:-\/home\/schoolbus\/deploy-state\}"$/m);
    expect(code).toMatch(/^HEALTH_URL="\$\{HEALTH_URL:-http:\/\/127\.0\.0\.1:3000\/health\}"$/m);
    expect(code).toMatch(/^HEALTH_ATTEMPTS="\$\{HEALTH_ATTEMPTS:-12\}"$/m);
    expect(code).toMatch(/^HEALTH_SLEEP_SEC="\$\{HEALTH_SLEEP_SEC:-2\}"$/m);
  });

  it('does not apply migrations — that is the other script\'s job, and the order matters', () => {
    expect(SRC).toMatch(/It does not apply migrations/);
    expect(code).not.toMatch(/migrations?\//);
  });
});
