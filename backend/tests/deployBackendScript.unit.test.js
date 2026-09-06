'use strict';

/**
 * scripts/deploy-backend.sh, executed against a throwaway repository.
 *
 * WHY THIS EXISTS
 * ---------------
 * The script used to pull with `git pull … || true`. A pull that failed was
 * swallowed and the script went on to syntax-check, test and `pm2 reload`
 * whatever was already checked out, then reported success. The rewrite that
 * replaced it (2026-09-05) was reviewed on 2026-09-06 and found to have its
 * own gaps: a local commit ahead of the remote was deployed as "already up to
 * date", a retry after a failed install skipped the install, the health
 * check accepted any HTTP 200, the rollback reference was the checkout's
 * HEAD rather than the running release, the lock could be stolen, and a
 * rollback could reset over edits made while the deploy ran. This suite
 * pins the behaviour that closes each of those.
 *
 * WHAT THE SCRIPT GUARANTEES (stated exactly, and asserted here)
 * --------------------------------------------------------------
 * Every failure up to and including the unit tests stops BEFORE `pm2 reload`,
 * and if dependencies were already swapped in they are put back. A
 * health-check failure happens AFTER the reload by definition (the failing-
 * health cases below assert one reload happened); it is answered by rolling
 * code and dependencies back to the release that was running before the run
 * and reloading again. It is not true that every failure stops before PM2.
 *
 * HOW
 * ---
 * A bare "origin", a "server" clone with a gitignored node_modules that
 * carries the install marker, a runtime file that models WHAT IS RUNNING
 * independently of what is checked out, and stub pm2/npx/npm/curl/mv
 * executables. The script is given the stubs by ABSOLUTE path through
 * DEPLOY_CURL/DEPLOY_PM2/DEPLOY_NPM/DEPLOY_NPX/DEPLOY_MV — not through PATH
 * order, which is a hypothesis about how Git Bash resolves `curl`, not a
 * guarantee — and every stub records `$0`, so a case can prove the stub was
 * the thing invoked. `git`, `node`, `find`, `stat` and `sha256sum` are real.
 * bash itself is resolved explicitly (DEPLOY_TEST_BASH, else Git for Windows'
 * bash.exe, else PATH); a machine without bash fails the first test rather
 * than silently skipping the behavioural cases.
 *
 * Nothing here touches /home/schoolbus. Every child process has a timeout.
 * The two migration-guard suites next to this one assert, at source level,
 * that the script still does not apply schema changes and still calls
 * `pm2 reload`; this one asserts behaviour.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'deploy-backend.sh');
const SERVICE = 'lampang-bus-backend'; // backend/package.json "name" — the script's HEALTH_SERVICE default

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
    const r = spawnSync(BASH, ['-c', 'echo ok; command -v mv'], { encoding: 'utf8', timeout: 20000 });
    const lines = (r.stdout || '').trim().split(/\r?\n/);
    return { ok: r.status === 0 && lines[0] === 'ok', realMv: lines[1] || '', error: r.error && r.error.message };
  } catch (err) {
    return { ok: false, realMv: '', error: err.message };
  }
})();
const hasBash = bashProbe.ok;
const describeWithBash = hasBash ? describe : describe.skip;

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** sha256 over the concatenated bytes — must equal `cat a b | sha256sum`. */
function sha256Concat(...files) {
  return crypto.createHash('sha256').update(Buffer.concat(files.map((f) => fs.readFileSync(f)))).digest('hex');
}

const PACKAGE_JSON = '{"name":"fixture","version":"1.0.0"}\n';
const LOCK_V1 = '{"name":"fixture","lockfileVersion":3,"packages":{}}\n';
const LOCK_V2 = '{"name":"fixture","lockfileVersion":3,"packages":{"node_modules/x":{}}}\n';

function writeStubs(dir, realMv) {
  const stubs = {
    // pm2 reload moves the modelled runtime to the checkout, unless told the
    // old process keeps answering. `describe` always succeeds.
    pm2: `#!/usr/bin/env bash
echo "pm2 $*" >> "$STUB_LOG"; echo "pm2 $0" >> "$STUB_LOG.paths"
if [ "$1" = reload ]; then
  sleep "\${STUB_RELOAD_SLEEP:-0}"
  if [ "\${STUB_PM2_FAIL_FIRST:-0}" = 1 ] && [ ! -f "$STUB_RUNTIME.reload-failed-once" ]; then touch "$STUB_RUNTIME.reload-failed-once"; exit 1; fi
  if [ "\${STUB_PM2_EXIT:-0}" != 0 ]; then exit "\${STUB_PM2_EXIT}"; fi
  touch "$STUB_RUNTIME.reloaded"
  if [ "\${STUB_RELOAD_KEEPS_OLD:-0}" != 1 ]; then git -C "$STUB_REPO" rev-parse --short HEAD > "$STUB_RUNTIME"; fi
fi
exit 0
`,
    // npx = jest. Can sleep (to hold the lock), edit a file (a concurrent
    // writer), break the history log, or swap the lock owner — all models
    // of things that happen while the tests run.
    npx: `#!/usr/bin/env bash
echo "npx $*" >> "$STUB_LOG"; echo "npx $0" >> "$STUB_LOG.paths"
sleep "\${STUB_JEST_SLEEP:-0}"
if [ -n "\${STUB_JEST_TOUCH:-}" ]; then printf '%s\\n' "concurrent edit" >> "$STUB_JEST_TOUCH"; fi
if [ "\${STUB_JEST_BLOCK_LOG:-0}" = 1 ]; then rm -f "$DEPLOY_LOG" && mkdir -p "$DEPLOY_LOG"; fi
if [ "\${STUB_JEST_SWAP_LOCK_OWNER:-0}" = 1 ]; then d="$DEPLOY_STATE_DIR/deploy-backend.lock"; rm -f "$d"/owner.*; echo "999999 2026-01-01T00:00:00+00:00 other" > "$d/owner.999999"; fi
exit "\${STUB_JEST_EXIT:-0}"
`,
    npm: `#!/usr/bin/env bash
echo "npm $*" >> "$STUB_LOG"; echo "npm $0" >> "$STUB_LOG.paths"
if [ "\${STUB_NPM_EXIT:-0}" != 0 ]; then exit "\${STUB_NPM_EXIT}"; fi
if [ "$1" = ci ]; then mkdir -p node_modules && echo "installed by stub in $PWD" > node_modules/installed.txt; fi
exit 0
`,
    // curl answers for the modelled runtime, not for the checkout. After a
    // reload the *_AFTER_RELOAD overrides apply.
    curl: `#!/usr/bin/env bash
echo "curl $*" >> "$STUB_LOG"; echo "curl $0" >> "$STUB_LOG.paths"
if [ "\${STUB_CURL_EXIT:-0}" != 0 ]; then exit "\${STUB_CURL_EXIT}"; fi
head="$(cat "$STUB_RUNTIME" 2>/dev/null || echo unknown)"
commit="\${STUB_HEALTH_COMMIT:-$head}"; db="\${STUB_HEALTH_DB:-true}"; svc="\${STUB_HEALTH_SERVICE:-${SERVICE}}"; ok="\${STUB_HEALTH_SUCCESS:-true}"
if [ -f "$STUB_RUNTIME.reloaded" ]; then
  if [ "\${STUB_CURL_EXIT_AFTER_RELOAD:-0}" != 0 ]; then exit "\${STUB_CURL_EXIT_AFTER_RELOAD}"; fi
  commit="\${STUB_HEALTH_COMMIT_AFTER_RELOAD:-$commit}"; db="\${STUB_HEALTH_DB_AFTER_RELOAD:-$db}"; svc="\${STUB_HEALTH_SERVICE_AFTER_RELOAD:-$svc}"
fi
for f in \${STUB_HEALTH_FAIL_AT:-}; do [ "$f" = "$head" ] && exit 7; done
printf '{"success":%s,"message":"OK","data":{"service":"%s","commit":"%s","database":{"connected":%s}}}\\n' "$ok" "$svc" "$commit" "$db"
`,
    // mv fails when its arguments match STUB_MV_FAIL_WHEN (a bash regex),
    // otherwise defers to the real mv by absolute path.
    mv: `#!/usr/bin/env bash
echo "mv $*" >> "$STUB_LOG"; echo "mv $0" >> "$STUB_LOG.paths"
if [ -n "\${STUB_MV_FAIL_WHEN:-}" ] && [[ "$*" =~ \${STUB_MV_FAIL_WHEN} ]]; then echo "stub mv: refusing: $*" >&2; exit 1; fi
exec "${realMv}" "$@"
`,
  };
  for (const [name, body] of Object.entries(stubs)) {
    const file = path.join(dir, name);
    write(file, body);
    fs.chmodSync(file, 0o755);
  }
}

/** origin (bare) + seed (author) + server (deploy target) + runtime + stubs. */
function makeFixture({ marker = true } = {}) {
  const base = toPosix(fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-backend-fixture-')));
  const origin = `${base}/origin.git`;
  const seed = `${base}/seed`;
  const server = `${base}/server`;
  const stubs = `${base}/stubs`;
  const state = `${base}/state`;

  git(base, 'init', '--bare', origin);
  fs.mkdirSync(seed);
  git(seed, 'init');
  git(seed, 'checkout', '-b', 'main');
  write(`${seed}/.gitignore`, 'node_modules/\n');
  write(`${seed}/backend/src/ok.js`, "'use strict';\nmodule.exports = 1;\n");
  write(`${seed}/backend/package.json`, PACKAGE_JSON);
  write(`${seed}/backend/package-lock.json`, LOCK_V1);
  write(`${seed}/backend/jest.unit.config.js`, 'module.exports = {};\n');
  write(`${seed}/ecosystem.config.js`, 'module.exports = { apps: [] };\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'seed');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '-q', 'origin', 'main');
  git(base, 'clone', '-q', origin, server);
  git(server, 'checkout', '-q', 'main');

  // The live dependency tree, with the marker a completed install writes.
  fs.mkdirSync(`${server}/backend/node_modules`, { recursive: true });
  if (marker) write(`${server}/backend/node_modules/.deploy-lockfile.sha256`, `${sha256Concat(`${server}/backend/package.json`, `${server}/backend/package-lock.json`)}\n`);
  // What is running: independent of the checkout from here on.
  const runtime = `${base}/runtime.txt`;
  write(runtime, `${git(server, 'rev-parse', '--short', 'HEAD')}\n`);

  writeStubs(stubs, bashProbe.realMv);
  return { base, origin, seed, server, stubs, state, runtime, stubLog: `${base}/stub.log`, deployLog: `${base}/deploy-history.log` };
}

/** Commit a change in the author repo and push it, so the server has something to pull. */
function publish(fx, files, message) {
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) fs.rmSync(`${fx.seed}/${rel}`, { recursive: true, force: true });
    else write(`${fx.seed}/${rel}`, content);
  }
  git(fx.seed, 'add', '-A');
  git(fx.seed, 'commit', '-q', '-m', message);
  git(fx.seed, 'push', '-q', 'origin', 'main');
  return git(fx.seed, 'rev-parse', '--short', 'HEAD');
}

function envFor(fx, env = {}) {
  return {
    ...process.env,
    PATH: `${fx.stubs}${path.delimiter}${process.env.PATH}`,
    PROJECT_DIR: fx.server,
    BACKEND_DIR: `${fx.server}/backend`,
    ECOSYSTEM: `${fx.server}/ecosystem.config.js`,
    APP_NAME: 'fixture-app',
    HEALTH_URL: 'http://127.0.0.1:9/health',
    DEPLOY_LOG: fx.deployLog,
    DEPLOY_STATE_DIR: fx.state,
    DEPLOY_CURL: `${fx.stubs}/curl`,
    DEPLOY_PM2: `${fx.stubs}/pm2`,
    DEPLOY_NPM: `${fx.stubs}/npm`,
    DEPLOY_NPX: `${fx.stubs}/npx`,
    DEPLOY_MV: `${fx.stubs}/mv`,
    DEPLOY_NODE: toPosix(process.execPath),
    STUB_LOG: fx.stubLog,
    STUB_REPO: fx.server,
    STUB_RUNTIME: fx.runtime,
    HEALTH_SLEEP_SEC: '0',
    HEALTH_ATTEMPTS: '2',
    LOCK_WAIT_ATTEMPTS: '2',
    ...env,
  };
}

function readCalls(fx) {
  return fs.existsSync(fx.stubLog) ? fs.readFileSync(fx.stubLog, 'utf8').trim().split('\n').filter(Boolean) : [];
}

function run(fx, env = {}) {
  const r = spawnSync(BASH, [SCRIPT], { cwd: fx.base, encoding: 'utf8', env: envFor(fx, env), timeout: 60000 });
  return {
    ...r,
    out: `${r.stdout}\n${r.stderr}`,
    stubCalls: readCalls(fx),
    head: git(fx.server, 'rev-parse', '--short', 'HEAD'),
    running: fs.readFileSync(fx.runtime, 'utf8').trim(),
    log: fs.existsSync(fx.deployLog) && fs.statSync(fx.deployLog).isFile() ? fs.readFileSync(fx.deployLog, 'utf8') : '',
  };
}

/** Async variant for concurrency cases: every child bounded by a timeout. */
function runAsync(fx, env = {}, timeoutMs = 90000) {
  return new Promise((resolve) => {
    const child = spawn(BASH, [SCRIPT], { cwd: fx.base, env: envFor(fx, env), timeout: timeoutMs, killSignal: 'SIGKILL' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status, signal) => resolve({ status, signal, out: `${stdout}\n${stderr}` }));
  });
}

const pm2Reloads = (r) => r.stubCalls.filter((l) => l.startsWith('pm2 reload'));
const npmCi = (r) => r.stubCalls.filter((l) => l === 'npm ci');
const marker = (fx) => { try { return fs.readFileSync(`${fx.server}/backend/node_modules/.deploy-lockfile.sha256`, 'utf8').trim(); } catch { return null; } };
const sumOf = (fx) => sha256Concat(`${fx.server}/backend/package.json`, `${fx.server}/backend/package-lock.json`);

describe('bash for the behavioural fixtures', () => {
  it(`is available (${BASH}); set DEPLOY_TEST_BASH to point at one — a skipped fixture suite is not a passing one`, () => {
    expect(`bash ok: ${hasBash}${hasBash ? '' : ` (${bashProbe.error || 'probe failed'})`}`).toBe('bash ok: true');
    expect(bashProbe.realMv).toMatch(/mv/);
  });
});

describeWithBash('deploy-backend.sh against a throwaway repository', () => {
  jest.setTimeout(60000);
  let fx;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => { try { fs.rmSync(fx.base, { recursive: true, force: true }); } catch { /* temp dir */ } });

  // ── happy paths ──────────────────────────────────────────────────────────
  it('happy path: fast-forwards, checks, tests, reloads once, proves the new commit answers, records start and end', () => {
    const before = git(fx.server, 'rev-parse', '--short', 'HEAD');
    const after = publish(fx, { 'backend/src/new.js': "'use strict';\nmodule.exports = 2;\n" }, 'feature');
    const r = run(fx);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.head).toBe(after);
    expect(r.running).toBe(after);
    expect(r.out).toContain(`fast-forwarded ${before} -> ${after}`);
    expect(r.out).toContain(`Health check OK — running ${after}`);
    expect(pm2Reloads(r)).toEqual([`pm2 reload ${fx.server}/ecosystem.config.js`]);
    expect(r.stubCalls.some((l) => l.startsWith('npx jest --config jest.unit.config.js'))).toBe(true);
    expect(r.log).toMatch(new RegExp(`start branch=main before=${before} target=${after} running_before=${before} rollback_ref=${before}\\(running\\)`));
    expect(r.log).toMatch(new RegExp(`end result=ok head=${after} deps=untouched exit=0`));
    // Marker matches the lockfile, so no install.
    expect(npmCi(r)).toHaveLength(0);
    expect(r.out).toContain('skipping npm ci');
    expect(fs.existsSync(`${fx.state}/deploy-backend.lock`)).toBe(false);
  });

  it('already up to date: still runs the checks and reloads once', () => {
    const r = run(fx);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).toContain('already up to date');
    expect(pm2Reloads(r)).toHaveLength(1);
  });

  it('proves the stubs were what ran: every recorded $0 is under the stub directory, not a PATH lookup', () => {
    const r = run(fx);
    expect(r.status).toBe(0);
    const paths = fs.readFileSync(`${fx.stubLog}.paths`, 'utf8').trim().split('\n');
    const foreign = paths.filter((l) => !l.split(' ')[1].startsWith(fx.stubs));
    expect(`foreign invocations: ${foreign.join('; ')}`).toBe('foreign invocations: ');
    expect(new Set(paths.map((l) => l.split(' ')[0]))).toEqual(new Set(['pm2', 'npx', 'curl']));
  });

  // ── fetch / fast-forward ─────────────────────────────────────────────────
  it('a failed fetch stops before PM2 — the old `|| true` is gone', () => {
    const before = git(fx.server, 'rev-parse', '--short', 'HEAD');
    const r = run(fx, { DEPLOY_REMOTE: 'no-such-remote' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/git fetch failed — nothing was deployed/);
    expect(pm2Reloads(r)).toHaveLength(0);
    expect(r.head).toBe(before);
    const code = fs.readFileSync(SCRIPT, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code).not.toMatch(/git (pull|fetch|merge)[^\n]*\|\| true/);
  });

  it('a local commit ahead of the remote is not deployed as "already up to date"', () => {
    write(`${fx.server}/backend/src/local.js`, "'use strict';\n");
    git(fx.server, 'add', '-A');
    git(fx.server, 'commit', '-q', '-m', 'local-only commit');
    const localHead = git(fx.server, 'rev-parse', '--short', 'HEAD');
    // What is running is still the published commit, not the local one.
    const r = run(fx);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/cannot fast-forward/);
    expect(pm2Reloads(r)).toHaveLength(0);
    expect(r.head).toBe(localHead);
    expect(r.log).toBe('');
  });

  it('a diverged branch cannot fast-forward: stops, PM2 untouched, HEAD unchanged', () => {
    publish(fx, { 'backend/src/remote.js': "'use strict';\n" }, 'remote work');
    write(`${fx.server}/backend/src/local.js`, "'use strict';\n");
    git(fx.server, 'add', '-A');
    git(fx.server, 'commit', '-q', '-m', 'local-only commit');
    const localHead = git(fx.server, 'rev-parse', '--short', 'HEAD');
    const r = run(fx);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/cannot fast-forward/);
    expect(pm2Reloads(r)).toHaveLength(0);
    expect(r.head).toBe(localHead);
  });

  // ── lock ─────────────────────────────────────────────────────────────────
  it('refuses to run while another deploy holds the lock, and never removes that lock', async () => {
    const lock = `${fx.state}/deploy-backend.lock`;
    fs.mkdirSync(fx.state, { recursive: true });
    // A live holder: a bash process whose pid is in the owner file name.
    const holder = spawn(BASH, ['-c', 'mkdir -p "$L" && printf "%s %s fixture\\n" "$$" "$(date -Is)" > "$L/owner.$$" && sleep 40'], { cwd: os.tmpdir(), env: { ...process.env, L: lock }, timeout: 45000, killSignal: 'SIGKILL' });
    try {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && !(fs.existsSync(lock) && fs.readdirSync(lock).some((f) => /^owner\.\d+$/.test(f)))) {
        await new Promise((res) => setTimeout(res, 100));
      }
      const owner = fs.readdirSync(lock).find((f) => /^owner\.\d+$/.test(f));
      expect(owner).toBeDefined();
      const r = run(fx);
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/another deploy is running \(pid \d+/);
      expect(pm2Reloads(r)).toHaveLength(0);
      expect(r.log).toBe('');
      expect(fs.existsSync(`${lock}/${owner}`)).toBe(true);
    } finally {
      holder.kill('SIGKILL');
    }
  });

  it('reclaims a lock whose owner process is dead, then deploys and removes its own lock', () => {
    const lock = `${fx.state}/deploy-backend.lock`;
    write(`${lock}/owner.999999`, '999999 2026-01-01T00:00:00+00:00 fixture\n');
    const r = run(fx);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).toMatch(/stale lock/);
    expect(pm2Reloads(r)).toHaveLength(1);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it('a half-written owner file is not proof of a stale lock: waits, then gives up without touching it', () => {
    const lock = `${fx.state}/deploy-backend.lock`;
    write(`${lock}/owner.4242.tmp`, '4242');
    const r = run(fx);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/could not acquire .*owner is not readable yet/);
    expect(r.out).not.toMatch(/stale lock|orphaned/);
    expect(pm2Reloads(r)).toHaveLength(0);
    expect(fs.existsSync(`${lock}/owner.4242.tmp`)).toBe(true);
  });

  it('an empty lock directory is reclaimed only once it is older than LOCK_ORPHAN_SEC', () => {
    const lock = `${fx.state}/deploy-backend.lock`;
    fs.mkdirSync(lock, { recursive: true });
    const fresh = run(fx);
    expect(fresh.status).not.toBe(0);
    expect(fresh.out).toMatch(/could not acquire/);
    expect(fs.existsSync(lock)).toBe(true);
    const old = new Date(Date.now() - 3600 * 1000);
    fs.utimesSync(lock, old, old);
    const later = run(fx, { STUB_LOG: `${fx.base}/stub2.log` });
    expect(`exit ${later.status}: ${later.out}`).toMatch(/^exit 0:/);
    expect(later.out).toMatch(/treating as orphaned/);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it('four runs racing for a stale lock: exactly one deploys, the rest are refused, nobody deletes the winner\'s lock', async () => {
    write(`${fx.state}/deploy-backend.lock/owner.999999`, '999999 2026-01-01T00:00:00+00:00 fixture\n');
    const after = publish(fx, { 'backend/src/new.js': "'use strict';\n" }, 'feature');
    // The winner holds the lock through a 6 s "jest" so the others collide.
    const results = await Promise.all([1, 2, 3, 4].map(() => runAsync(fx, { STUB_JEST_SLEEP: '6' })));
    const winners = results.filter((r) => r.status === 0);
    const losers = results.filter((r) => r.status !== 0);
    expect(`winners: ${winners.length}; statuses: ${results.map((r) => `${r.status}/${r.signal}`).join(',')}`).toBe('winners: 1; statuses: ' + results.map((r) => `${r.status}/${r.signal}`).join(','));
    for (const l of losers) expect(l.out).toMatch(/another deploy is running \(pid \d+|could not acquire|collided/);
    const calls = readCalls(fx);
    expect(calls.filter((l) => l.startsWith('pm2 reload'))).toHaveLength(1);
    expect(git(fx.server, 'rev-parse', '--short', 'HEAD')).toBe(after);
    expect(fs.existsSync(`${fx.state}/deploy-backend.lock`)).toBe(false);
  }, 120000);

  it('releases only its own lock: if the owner file is no longer its own it warns and leaves the directory', () => {
    const r = run(fx, { STUB_JEST_SWAP_LOCK_OWNER: '1' });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/not removed — it holds another run's owner file/);
    expect(fs.existsSync(`${fx.state}/deploy-backend.lock/owner.999999`)).toBe(true);
  });

  // ── history log ──────────────────────────────────────────────────────────
  it('refuses to deploy when the start line cannot be written, before anything moves', () => {
    const before = git(fx.server, 'rev-parse', '--short', 'HEAD');
    publish(fx, { 'backend/src/new.js': "'use strict';\n" }, 'feature');
    write(`${fx.base}/not-a-dir`, 'regular file\n');
    const r = run(fx, { DEPLOY_LOG: `${fx.base}/not-a-dir/deploy-history.log` });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/cannot write .*refusing to deploy without a record/);
    expect(r.head).toBe(before);
    expect(pm2Reloads(r)).toHaveLength(0);
  });

  it('writes its history log outside the checkout by default', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    expect(src).toMatch(/DEPLOY_LOG="\$\{DEPLOY_LOG:-\$\(dirname "\$\(dirname "\$PROJECT_DIR"\)"\)\/logs\/deploy-history\.log\}"/);
  });

  it('reports an end line it could not write instead of claiming it was recorded', () => {
    const r = run(fx, { STUB_JEST_BLOCK_LOG: '1' });
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).toMatch(/end line was NOT written/);
    expect(r.out).toContain('Health check OK');
    expect(fs.existsSync(`${fx.state}/deploy-backend.lock`)).toBe(false);
  });

  // ── tree / branch checks ─────────────────────────────────────────────────
  it('a modified tracked file stops before fetching', () => {
    write(`${fx.server}/backend/src/ok.js`, "'use strict';\nmodule.exports = 'edited on the server';\n");
    const r = run(fx);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/worktree has modified tracked files/);
    expect(r.out).not.toMatch(/Fetching/);
    expect(pm2Reloads(r)).toHaveLength(0);
  });

  it('an untracked file (a dist backup, a log) is reported but does not block', () => {
    fs.mkdirSync(`${fx.server}/frontend/dist.prev-20260905`, { recursive: true });
    write(`${fx.server}/frontend/dist.prev-20260905/index.html`, '<html></html>\n');
    const r = run(fx);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).toMatch(/untracked files present \(not blocking\): frontend\//);
    expect(pm2Reloads(r)).toHaveLength(1);
  });

  it('the wrong branch stops when EXPECTED_BRANCH is set', () => {
    const r = run(fx, { EXPECTED_BRANCH: 'release' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/on branch 'main' but EXPECTED_BRANCH='release'/);
    expect(pm2Reloads(r)).toHaveLength(0);
  });

  it('a detached HEAD stops', () => {
    git(fx.server, 'checkout', '-q', '--detach');
    const r = run(fx);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/detached HEAD/);
    expect(pm2Reloads(r)).toHaveLength(0);
  });

  // ── settings ─────────────────────────────────────────────────────────────
  it.each([
    ['HEALTH_TIMEOUT_SEC', '0', /curl treats 0 as no time limit/],
    ['HEALTH_TIMEOUT_SEC', 'abc', /HEALTH_TIMEOUT_SEC must be an integer/],
    ['HEALTH_ATTEMPTS', '0', /HEALTH_ATTEMPTS must be an integer >= 1/],
    ['HEALTH_SLEEP_SEC', '-1', /HEALTH_SLEEP_SEC must be an integer/],
    ['DEPLOY_INSTALL', 'sometimes', /DEPLOY_INSTALL must be auto, always or never/],
    ['DEPLOY_ROLLBACK', 'maybe', /DEPLOY_ROLLBACK must be auto or never/],
    ['DEPLOY_UNKNOWN_RUNNING', 'guess', /DEPLOY_UNKNOWN_RUNNING must be abort or use-checkout/],
  ])('rejects %s=%s before anything moves', (key, value, message) => {
    const r = run(fx, { [key]: value });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(message);
    expect(r.out).not.toMatch(/Fetching/);
    expect(r.stubCalls).toEqual([]);
    expect(fs.existsSync(`${fx.state}/deploy-backend.lock`)).toBe(false);
  });

  // ── syntax / tests ───────────────────────────────────────────────────────
  it('a syntax error in the pulled code stops before PM2, and the record shows where the code now is', () => {
    const before = git(fx.server, 'rev-parse', '--short', 'HEAD');
    const after = publish(fx, { 'backend/src/bad.js': 'this is not javascript (\n' }, 'broken');
    const r = run(fx);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/syntax error in src[\\/]bad\.js/);
    expect(pm2Reloads(r)).toHaveLength(0);
    expect(r.head).toBe(after);
    expect(r.running).toBe(before);
    expect(r.log).toMatch(new RegExp(`before=${before} target=${after}`));
    expect(r.log).toMatch(new RegExp(`end result=failed-before-reload head=${after} deps=untouched exit=1`));
  });

  it('a syntax error after a dependency swap puts the previous node_modules back', () => {
    const oldMarker = marker(fx);
    publish(fx, { 'backend/src/bad.js': 'nope (\n', 'backend/package-lock.json': LOCK_V2 }, 'broken with deps');
    const r = run(fx);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/syntax error/);
    expect(r.out).toMatch(/previous node_modules was put back/);
    expect(pm2Reloads(r)).toHaveLength(0);
    expect(marker(fx)).toBe(oldMarker);
    expect(fs.existsSync(`${fx.state}/node_modules.failed/installed.txt`)).toBe(true);
    expect(r.log).toMatch(/end result=failed-before-reload .* deps=restored exit=1/);
  });

  it('a published commit that deletes every source file is refused', () => {
    publish(fx, { 'backend/src': null }, 'delete src');
    const r = run(fx);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/no JavaScript files/);
    expect(pm2Reloads(r)).toHaveLength(0);
  });

  it('failing unit tests stop before PM2 and restore swapped dependencies', () => {
    const oldMarker = marker(fx);
    publish(fx, { 'backend/package-lock.json': LOCK_V2 }, 'bump dep');
    const r = run(fx, { STUB_JEST_EXIT: '1' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/unit tests failed — PM2 not reloaded/);
    expect(pm2Reloads(r)).toHaveLength(0);
    expect(npmCi(r)).toHaveLength(1);
    expect(marker(fx)).toBe(oldMarker);
    expect(r.log).toMatch(/deps=restored exit=1/);
  });

  // ── dependencies ─────────────────────────────────────────────────────────
  it('a failed npm ci leaves the live tree untouched; the retry installs; the third run skips', () => {
    const oldMarker = marker(fx);
    publish(fx, { 'backend/package-lock.json': LOCK_V2 }, 'bump dep');
    const bad = run(fx, { STUB_NPM_EXIT: '1' });
    expect(bad.status).not.toBe(0);
    expect(bad.out).toMatch(/npm ci failed — PM2 not reloaded/);
    expect(pm2Reloads(bad)).toHaveLength(0);
    expect(marker(fx)).toBe(oldMarker);
    expect(fs.existsSync(`${fx.server}/backend/node_modules/installed.txt`)).toBe(false);

    const retry = run(fx, { STUB_LOG: `${fx.base}/stub2.log` });
    expect(`exit ${retry.status}: ${retry.out}`).toMatch(/^exit 0:/);
    expect(fs.readFileSync(`${fx.base}/stub2.log`, 'utf8')).toMatch(/^npm ci$/m);
    expect(fs.existsSync(`${fx.server}/backend/node_modules/installed.txt`)).toBe(true);
    expect(marker(fx)).toBe(sumOf(fx));
    expect(fs.readFileSync(`${fx.state}/node_modules.prev/.deploy-lockfile.sha256`, 'utf8').trim()).toBe(oldMarker);

    const third = run(fx, { STUB_LOG: `${fx.base}/stub3.log` });
    expect(third.status).toBe(0);
    expect(fs.readFileSync(`${fx.base}/stub3.log`, 'utf8')).not.toMatch(/^npm ci$/m);
    expect(third.out).toContain('skipping npm ci');
  });

  it('a pull done by hand first still installs: the decision comes from the marker, not the diff', () => {
    publish(fx, { 'backend/package-lock.json': LOCK_V2 }, 'bump dep');
    git(fx.server, 'pull', '-q', 'origin', 'main');
    const r = run(fx);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).toContain('already up to date');
    expect(npmCi(r)).toHaveLength(1);
    expect(r.out).toMatch(/lockfile differs from the last completed install/);
  });

  it('installs when there is no record of a completed install, even with nothing changed', () => {
    const bare = makeFixture({ marker: false });
    try {
      const r = run(bare);
      expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
      expect(r.out).toMatch(/no record of a completed install/);
      expect(npmCi(r)).toHaveLength(1);
      expect(marker(bare)).toBe(sumOf(bare));
    } finally {
      fs.rmSync(bare.base, { recursive: true, force: true });
    }
  });

  it('DEPLOY_INSTALL=never skips the install with a warning; =always forces it', () => {
    publish(fx, { 'backend/package-lock.json': LOCK_V2 }, 'bump dep');
    const never = run(fx, { DEPLOY_INSTALL: 'never' });
    expect(never.status).toBe(0);
    expect(npmCi(never)).toHaveLength(0);
    expect(never.out).toMatch(/DEPLOY_INSTALL=never — node_modules does NOT match the lockfile/);
    const always = run(fx, { DEPLOY_INSTALL: 'always', STUB_LOG: `${fx.base}/stub2.log` });
    expect(always.status).toBe(0);
    expect(fs.readFileSync(`${fx.base}/stub2.log`, 'utf8')).toMatch(/^npm ci$/m);
    expect(always.out).toMatch(/DEPLOY_INSTALL=always/);
  });

  it('the swap: moving the live tree aside fails → nothing changed', () => {
    const oldMarker = marker(fx);
    publish(fx, { 'backend/package-lock.json': LOCK_V2 }, 'bump dep');
    const r = run(fx, { STUB_MV_FAIL_WHEN: 'node_modules\\.prev$' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/could not move the live node_modules aside — nothing changed/);
    expect(pm2Reloads(r)).toHaveLength(0);
    expect(marker(fx)).toBe(oldMarker);
    expect(fs.existsSync(`${fx.state}/deps-staging/node_modules/installed.txt`)).toBe(true);
    expect(r.log).toMatch(/deps=untouched exit=1/);
  });

  it('the swap: moving the new tree in fails → the previous tree is put back before aborting', () => {
    const oldMarker = marker(fx);
    publish(fx, { 'backend/package-lock.json': LOCK_V2 }, 'bump dep');
    const r = run(fx, { STUB_MV_FAIL_WHEN: 'deps-staging/node_modules node_modules$' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/could not move the new node_modules into place — the previous tree was put back/);
    expect(pm2Reloads(r)).toHaveLength(0);
    expect(marker(fx)).toBe(oldMarker);
    expect(r.log).toMatch(/deps=restored exit=1/);
  });

  it('the swap: both moves fail → says the backend has NO node_modules and where both trees are', () => {
    publish(fx, { 'backend/package-lock.json': LOCK_V2 }, 'bump dep');
    const r = run(fx, { STUB_MV_FAIL_WHEN: '(deps-staging/node_modules node_modules|node_modules\\.prev node_modules)$' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/backend has NO node_modules/);
    expect(r.out).toMatch(/fix by hand NOW/);
    expect(pm2Reloads(r)).toHaveLength(0);
    expect(fs.existsSync(`${fx.server}/backend/node_modules`)).toBe(false);
    expect(fs.existsSync(`${fx.state}/node_modules.prev/.deploy-lockfile.sha256`)).toBe(true);
    expect(r.log).toMatch(/deps=restore-failed exit=1/);
  });

  // ── health and rollback ──────────────────────────────────────────────────
  it('every health probe is bounded by --max-time', () => {
    const r = run(fx);
    const curls = r.stubCalls.filter((l) => l.startsWith('curl '));
    expect(curls.length).toBeGreaterThan(0);
    expect(curls.every((l) => l.includes('--max-time'))).toBe(true);
  });

  it('a disconnected database after reload with nothing changed: exits non-zero, nothing to roll back, names the previous commit', () => {
    const before = git(fx.server, 'rev-parse', '--short', 'HEAD');
    const r = run(fx, { STUB_HEALTH_DB: 'false' });
    expect(r.status).not.toBe(0);
    expect(pm2Reloads(r)).toHaveLength(1);
    expect(r.out).toMatch(/Health check FAILED after reload: \/health says the database is not connected/);
    expect(r.out).toMatch(/nothing to roll back/);
    expect(r.out).toContain(`previous commit was ${before}`);
    expect(r.stubCalls.some((l) => l.startsWith('pm2 describe fixture-app'))).toBe(true);
    expect(r.log).toMatch(/end result=health-failed-nothing-to-roll-back/);
  });

  it('the new release crashes after reload: rolls code back, reloads again, proves the previous commit answers', () => {
    const before = git(fx.server, 'rev-parse', '--short', 'HEAD');
    const after = publish(fx, { 'backend/src/new.js': "'use strict';\n" }, 'feature');
    const r = run(fx, { STUB_HEALTH_FAIL_AT: after });
    expect(r.status).not.toBe(0);
    expect(r.head).toBe(before);
    expect(r.running).toBe(before);
    expect(pm2Reloads(r)).toHaveLength(2);
    expect(r.out).toMatch(/Rolling back/);
    expect(r.out).toMatch(new RegExp(`Rolled back: running ${before}`));
    expect(r.log).toMatch(new RegExp(`end result=rolled-back head=${before} deps=untouched exit=1`));
  });

  it('rollback also restores the previous dependencies and keeps the failed tree', () => {
    const before = git(fx.server, 'rev-parse', '--short', 'HEAD');
    const oldMarker = marker(fx);
    const after = publish(fx, { 'backend/package-lock.json': LOCK_V2, 'backend/src/new.js': "'use strict';\n" }, 'feature with deps');
    const r = run(fx, { STUB_HEALTH_FAIL_AT: after });
    expect(r.status).not.toBe(0);
    expect(r.head).toBe(before);
    expect(marker(fx)).toBe(oldMarker);
    expect(fs.existsSync(`${fx.state}/node_modules.failed/installed.txt`)).toBe(true);
    expect(r.log).toMatch(/end result=rolled-back .* deps=restored exit=1/);
  });

  it('the old process keeps answering after the reload (commit mismatch): rolls back, and the rollback verifies against the running release', () => {
    const before = git(fx.server, 'rev-parse', '--short', 'HEAD');
    publish(fx, { 'backend/src/new.js': "'use strict';\n" }, 'feature');
    const r = run(fx, { STUB_RELOAD_KEEPS_OLD: '1' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/the process answering is not running the deployed commit/);
    expect(r.head).toBe(before);
    expect(pm2Reloads(r)).toHaveLength(2);
    expect(r.log).toMatch(/end result=rolled-back /);
  });

  it('the database drops during the deploy: rolled back but still unhealthy, and says so', () => {
    const before = git(fx.server, 'rev-parse', '--short', 'HEAD');
    publish(fx, { 'backend/src/new.js': "'use strict';\n" }, 'feature');
    const r = run(fx, { STUB_HEALTH_DB_AFTER_RELOAD: 'false' });
    expect(r.status).not.toBe(0);
    expect(r.head).toBe(before);
    expect(pm2Reloads(r)).toHaveLength(2);
    expect(r.out).toMatch(/health still fails/);
    expect(r.log).toMatch(/end result=rolled-back-unhealthy/);
  });

  it('a failed pm2 reload is treated as a failed activation: rolls back and reloads again', () => {
    const before = git(fx.server, 'rev-parse', '--short', 'HEAD');
    const oldMarker = marker(fx);
    publish(fx, { 'backend/package-lock.json': LOCK_V2, 'backend/src/new.js': "'use strict';\n" }, 'feature with deps');
    const r = run(fx, { STUB_PM2_FAIL_FIRST: '1' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/pm2 reload failed — the process state is unknown; rolling back/);
    expect(r.head).toBe(before);
    expect(marker(fx)).toBe(oldMarker);
    expect(pm2Reloads(r)).toHaveLength(2);
    expect(r.log).toMatch(/end result=rolled-back .* deps=restored exit=1/);
  });

  it('DEPLOY_ROLLBACK=never leaves the new commit in place and prints the manual rollback', () => {
    const beforeFull = git(fx.server, 'rev-parse', 'HEAD');
    const after = publish(fx, { 'backend/src/new.js': "'use strict';\n" }, 'feature');
    const r = run(fx, { DEPLOY_ROLLBACK: 'never', STUB_HEALTH_FAIL_AT: after });
    expect(r.status).not.toBe(0);
    expect(r.head).toBe(after);
    expect(pm2Reloads(r)).toHaveLength(1);
    expect(r.out).toContain('DEPLOY_ROLLBACK=never');
    expect(r.out).toContain(`git reset --hard ${beforeFull}`);
    expect(r.log).toMatch(/end result=health-failed-no-rollback/);
  });

  it('refuses to reset over edits made while the deploy ran, and says what to do', () => {
    const after = publish(fx, { 'backend/src/new.js': "'use strict';\n" }, 'feature');
    const edited = `${fx.server}/backend/src/ok.js`;
    const r = run(fx, { STUB_HEALTH_FAIL_AT: after, STUB_JEST_TOUCH: edited });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/ROLLBACK REFUSED: tracked files were modified while this deploy ran/);
    expect(r.head).toBe(after);
    expect(fs.readFileSync(edited, 'utf8')).toContain('concurrent edit');
    expect(pm2Reloads(r)).toHaveLength(1);
    expect(r.log).toMatch(/end result=rollback-refused-dirty-tree/);
  });

  // ── the rollback reference is the running release, not the checkout ─────
  it('operator pulled by hand first: the rollback goes to what was RUNNING, not to the pre-pulled HEAD', () => {
    const running = git(fx.server, 'rev-parse', '--short', 'HEAD');
    const pulled = publish(fx, { 'backend/src/new.js': "'use strict';\n" }, 'feature');
    git(fx.server, 'pull', '-q', 'origin', 'main');
    expect(git(fx.server, 'rev-parse', '--short', 'HEAD')).toBe(pulled);
    const r = run(fx, { STUB_HEALTH_FAIL_AT: pulled });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('already up to date');
    expect(r.out).toMatch(new RegExp(`previous commit was ${running} \\(running\\) — the checkout was at ${pulled}`));
    expect(r.head).toBe(running);
    expect(r.running).toBe(running);
    expect(r.log).toMatch(new RegExp(`before=${pulled} target=${pulled} running_before=${running} rollback_ref=${running}\\(running\\)`));
    expect(r.log).toMatch(new RegExp(`end result=rolled-back head=${running}`));
  });

  it('operator pulled by hand first, deploy succeeds: the OK line names what was running', () => {
    const running = git(fx.server, 'rev-parse', '--short', 'HEAD');
    const pulled = publish(fx, { 'backend/src/new.js': "'use strict';\n" }, 'feature');
    git(fx.server, 'pull', '-q', 'origin', 'main');
    const r = run(fx);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).toContain(`Health check OK — running ${pulled} (deployed ${pulled}, was ${running})`);
    expect(r.running).toBe(pulled);
  });

  it('a running commit the repository does not contain: aborts before the merge, nothing moves', () => {
    const before = git(fx.server, 'rev-parse', '--short', 'HEAD');
    publish(fx, { 'backend/src/new.js': "'use strict';\n" }, 'feature');
    const r = run(fx, { STUB_HEALTH_COMMIT: '0000000' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/cannot establish a rollback reference/);
    expect(r.head).toBe(before);
    expect(pm2Reloads(r)).toHaveLength(0);
    expect(r.log).toBe('');
  });

  it('a /health commit that is not a git SHA is never handed to git', () => {
    const r = run(fx, { STUB_HEALTH_COMMIT: 'HEAD~1; echo pwned' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/is not a git SHA/);
    expect(r.out).toMatch(/running release could not be identified/);
    expect(pm2Reloads(r)).toHaveLength(0);
  });

  it('service unreachable before the deploy: aborts by default; DEPLOY_UNKNOWN_RUNNING=use-checkout proceeds and labels the reference unverified', () => {
    const before = git(fx.server, 'rev-parse', '--short', 'HEAD');
    const strict = run(fx, { STUB_CURL_EXIT: '22' });
    expect(strict.status).not.toBe(0);
    expect(strict.out).toMatch(/running release could not be identified \(no HTTP 2xx/);
    expect(strict.out).not.toMatch(/Fetching/);
    expect(pm2Reloads(strict)).toHaveLength(0);
    expect(strict.log).toBe('');

    const lenient = run(fx, { STUB_CURL_EXIT: '22', DEPLOY_UNKNOWN_RUNNING: 'use-checkout', STUB_LOG: `${fx.base}/stub2.log` });
    expect(lenient.status).not.toBe(0); // health is still unreachable after the reload
    expect(lenient.out).toMatch(/NOT verified to be what was running/);
    expect(lenient.out).toMatch(/nothing to roll back/);
    const lenientCalls = fs.readFileSync(`${fx.base}/stub2.log`, 'utf8').trim().split('\n');
    expect(lenientCalls.filter((l) => l.startsWith('pm2 reload'))).toHaveLength(1);
    expect(lenient.log).toMatch(new RegExp(`rollback_ref=${before}\\(checkout-unverified\\)`));
  });

  it('another service answering on the port is not ours: refused before the deploy, and rolled back after it', () => {
    const before = git(fx.server, 'rev-parse', '--short', 'HEAD');
    const strict = run(fx, { STUB_HEALTH_SERVICE: 'other-service' });
    expect(strict.status).not.toBe(0);
    expect(strict.out).toMatch(/names service 'other-service', not lampang-bus-backend/);
    expect(pm2Reloads(strict)).toHaveLength(0);

    publish(fx, { 'backend/src/new.js': "'use strict';\n" }, 'feature');
    const later = run(fx, { STUB_HEALTH_SERVICE_AFTER_RELOAD: 'other-service', STUB_LOG: `${fx.base}/stub2.log` });
    expect(later.status).not.toBe(0);
    expect(later.out).toMatch(/the process answering is not lampang-bus-backend/);
    expect(later.head).toBe(before);
    expect(later.log).toMatch(/end result=rolled-back-unhealthy/);
  });
});

describe('deploy-backend.sh source', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  it('stops on error and never swallows the fetch or the fast-forward', () => {
    expect(src).toMatch(/^set -euo pipefail$/m);
    expect(code).not.toMatch(/git (pull|fetch|merge)[^\n]*\|\| true/);
    expect(code).toMatch(/git fetch "\$REMOTE" "\$BRANCH" \|\| fail/);
  });

  it('pins the fetched commit by full SHA and checks HEAD equals it after the merge', () => {
    expect(code).toMatch(/git merge --ff-only "\$TARGET_FULL"/);
    expect(code).toMatch(/\[ "\$AFTER_FULL" = "\$TARGET_FULL" \] \|\| fail/);
    // FETCH_HEAD is read exactly once, to pin it.
    const uses = code.match(/FETCH_HEAD/g) || [];
    expect(uses).toHaveLength(1);
    expect(code).toMatch(/TARGET_FULL="\$\(git rev-parse FETCH_HEAD\)"/);
  });

  it('quotes the paths it uses', () => {
    expect(code).toMatch(/cd "\$PROJECT_DIR"/);
    expect(code).toMatch(/cd "\$BACKEND_DIR"/);
    expect(code).toMatch(/"\$PM2_BIN" reload "\$ECOSYSTEM"/);
    expect(code).toMatch(/>> "\$DEPLOY_LOG"/);
    expect(code).toMatch(/"\$PM2_BIN" describe "\$APP_NAME"/);
    expect(code).not.toMatch(/cd \$PROJECT_DIR\b/);
    expect(code).not.toMatch(/cd \$BACKEND_DIR\b/);
    expect(code).not.toMatch(/pm2 reload \$ECOSYSTEM\b/);
  });

  it('writes the end line while it still holds the lock, and only removes its own owner file', () => {
    const finish = src.slice(src.indexOf('finish() {'), src.indexOf('trap finish EXIT'));
    expect(finish.indexOf('record "end result=')).toBeGreaterThan(-1);
    expect(finish.indexOf('record "end result=')).toBeLessThan(finish.indexOf('release_lock'));
    const release = src.slice(src.indexOf('release_lock() {'), src.indexOf('finish() {'));
    expect(release).toMatch(/rm -f "\$LOCK_DIR\/owner\.\$\$"/);
    expect(release).toMatch(/rmdir "\$LOCK_DIR"/);
    expect(release).not.toMatch(/rm -rf/);
  });

  it('never rm -rf\'s a lock directory, and validates the health timeout', () => {
    const lockCode = src.slice(src.indexOf('acquire_lock() {'), src.indexOf('finish() {'));
    expect(lockCode).not.toMatch(/rm -rf/);
    expect(code).toMatch(/HEALTH_TIMEOUT_SEC" -ge 1/);
  });

  it('still reloads PM2 and still does not apply schema changes (the guard suites depend on both)', () => {
    expect(src).toMatch(/pm2 reload/);
    expect(src).not.toMatch(/migrations?\//);
  });

  it('uses LF line endings so the server\'s bash can run it', () => {
    expect(`has CR: ${src.includes('\r')}`).toBe('has CR: false');
  });
});
