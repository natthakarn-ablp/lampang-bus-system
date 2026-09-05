'use strict';

/**
 * scripts/deploy-backend.sh, executed against a throwaway repository.
 *
 * WHY THIS EXISTS
 * ---------------
 * The script used to pull with `git pull … || true`. A pull that failed —
 * network, a stray file on the server, a diverged branch — was swallowed,
 * and the script went on to syntax-check, test and `pm2 reload` whatever was
 * already checked out, then reported success. The evening deploy of
 * 2026-09-05 worked around it by pulling by hand first
 * (docs/ops/deploy-2026-09-05-c0b0d49.md §6). This suite is the proof that
 * the rewritten script stops, before PM2, on every failure that matters:
 * fetch, fast-forward, dirty tree, wrong branch, install, syntax, tests.
 *
 * HOW
 * ---
 * A bare "origin", a "server" clone, and stub `pm2`, `npx`, `npm`, `curl`
 * executables placed first on PATH that log their invocation and exit with
 * whatever STUB_*_EXIT says. `git`, `node` and `find` are the real ones. The
 * script's paths all come from environment, so nothing here touches
 * /home/schoolbus. Skipped where there is no bash on PATH — and says so.
 *
 * The two migration-guard suites next to this one assert, at source level,
 * that the script still does not apply schema changes and still calls
 * `pm2 reload`; this one asserts behaviour.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'deploy-backend.sh');

const hasBash = (() => {
  try { return spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' }).stdout.trim() === 'ok'; } catch { return false; }
})();
const describeWithBash = hasBash ? describe : describe.skip;

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function stub(dir, name, exitVar) {
  const file = path.join(dir, name);
  write(file, `#!/usr/bin/env bash\necho "${name} $*" >> "$STUB_LOG"\nexit "\${${exitVar}:-0}"\n`);
  fs.chmodSync(file, 0o755);
}

/** origin (bare) + seed (author) + server (deploy target) + stubs. */
function makeFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-backend-fixture-'));
  const origin = path.join(base, 'origin.git');
  const seed = path.join(base, 'seed');
  const server = path.join(base, 'server');
  const stubs = path.join(base, 'stubs');

  git(base, 'init', '--bare', origin);
  fs.mkdirSync(seed);
  git(seed, 'init');
  git(seed, 'checkout', '-b', 'main');
  write(path.join(seed, 'backend', 'src', 'ok.js'), "'use strict';\nmodule.exports = 1;\n");
  write(path.join(seed, 'backend', 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
  write(path.join(seed, 'backend', 'package-lock.json'), '{"name":"fixture","lockfileVersion":3,"packages":{}}\n');
  write(path.join(seed, 'backend', 'jest.unit.config.js'), 'module.exports = {};\n');
  write(path.join(seed, 'ecosystem.config.js'), 'module.exports = { apps: [] };\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'seed');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '-q', 'origin', 'main');
  git(base, 'clone', '-q', origin, server);
  git(server, 'checkout', '-q', 'main');

  for (const [name, exitVar] of [['pm2', 'STUB_PM2_EXIT'], ['npx', 'STUB_JEST_EXIT'], ['npm', 'STUB_NPM_EXIT'], ['curl', 'STUB_CURL_EXIT']]) {
    stub(stubs, name, exitVar);
  }
  return { base, origin, seed, server, stubs, stubLog: path.join(base, 'stub.log'), deployLog: path.join(base, 'deploy-history.log') };
}

/** Commit a change in the author repo and push it, so the server has something to pull. */
function publish(fx, files, message) {
  for (const [rel, content] of Object.entries(files)) write(path.join(fx.seed, rel), content);
  git(fx.seed, 'add', '-A');
  git(fx.seed, 'commit', '-q', '-m', message);
  git(fx.seed, 'push', '-q', 'origin', 'main');
  return git(fx.seed, 'rev-parse', '--short', 'HEAD');
}

function run(fx, env = {}) {
  const r = spawnSync('bash', [SCRIPT], {
    cwd: fx.base,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fx.stubs}${path.delimiter}${process.env.PATH}`,
      PROJECT_DIR: fx.server,
      BACKEND_DIR: path.join(fx.server, 'backend'),
      ECOSYSTEM: path.join(fx.server, 'ecosystem.config.js'),
      APP_NAME: 'fixture-app',
      HEALTH_URL: 'http://127.0.0.1:9/health',
      DEPLOY_LOG: fx.deployLog,
      STUB_LOG: fx.stubLog,
      ...env,
    },
  });
  const stubCalls = fs.existsSync(fx.stubLog) ? fs.readFileSync(fx.stubLog, 'utf8').trim().split('\n').filter(Boolean) : [];
  return { ...r, out: `${r.stdout}\n${r.stderr}`, stubCalls, head: git(fx.server, 'rev-parse', '--short', 'HEAD') };
}

const pm2Calls = (r) => r.stubCalls.filter((l) => l.startsWith('pm2 reload'));

describeWithBash('deploy-backend.sh against a throwaway repository', () => {
  let fx;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => { try { fs.rmSync(fx.base, { recursive: true, force: true }); } catch { /* temp dir */ } });

  it('happy path: fast-forwards, checks, tests, reloads once, and records before/after', () => {
    const before = git(fx.server, 'rev-parse', '--short', 'HEAD');
    const after = publish(fx, { 'backend/src/new.js': "'use strict';\nmodule.exports = 2;\n" }, 'feature');
    const r = run(fx);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.head).toBe(after);
    expect(r.out).toContain(`fast-forwarded ${before} -> ${after}`);
    expect(r.out).toContain('Health check OK');
    expect(pm2Calls(r)).toEqual([`pm2 reload ${path.join(fx.server, 'ecosystem.config.js')}`]);
    expect(r.stubCalls.some((l) => l.startsWith('npx jest --config jest.unit.config.js'))).toBe(true);
    const log = fs.readFileSync(fx.deployLog, 'utf8');
    expect(log).toMatch(new RegExp(`branch=main before=${before} after=${after}`));
    // Lockfile did not move, so no install.
    expect(r.stubCalls.some((l) => l.startsWith('npm ci'))).toBe(false);
    expect(r.out).toContain('skipping npm ci');
  });

  it('already up to date: still runs the checks and reloads', () => {
    const r = run(fx);
    expect(r.status).toBe(0);
    expect(r.out).toContain('already up to date');
    expect(pm2Calls(r)).toHaveLength(1);
  });

  it('a failed fetch stops before PM2 — the old `|| true` is gone', () => {
    const before = git(fx.server, 'rev-parse', '--short', 'HEAD');
    const r = run(fx, { DEPLOY_REMOTE: 'no-such-remote' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/git fetch failed — nothing was deployed/);
    expect(pm2Calls(r)).toHaveLength(0);
    expect(r.head).toBe(before);
    // and the source no longer swallows it (comments explain the old bug, so
    // look at code lines only)
    const code = fs.readFileSync(SCRIPT, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code).not.toMatch(/git (pull|fetch|merge)[^\n]*\|\| true/);
  });

  it('a diverged branch cannot fast-forward: stops, PM2 untouched, HEAD unchanged', () => {
    publish(fx, { 'backend/src/remote.js': "'use strict';\n" }, 'remote work');
    write(path.join(fx.server, 'backend', 'src', 'local.js'), "'use strict';\n");
    git(fx.server, 'add', '-A');
    git(fx.server, 'commit', '-q', '-m', 'local-only commit');
    const localHead = git(fx.server, 'rev-parse', '--short', 'HEAD');
    const r = run(fx);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/cannot fast-forward/);
    expect(pm2Calls(r)).toHaveLength(0);
    expect(r.head).toBe(localHead);
  });

  it('a modified tracked file stops before fetching', () => {
    write(path.join(fx.server, 'backend', 'src', 'ok.js'), "'use strict';\nmodule.exports = 'edited on the server';\n");
    const r = run(fx);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/worktree has modified tracked files/);
    expect(r.out).not.toMatch(/Fetching/);
    expect(pm2Calls(r)).toHaveLength(0);
  });

  it('an untracked file (a dist backup, a log) is reported but does not block', () => {
    // The first production run of this script stopped on its own
    // frontend/dist.prev-<ts>/ backup directory. Untracked files cannot be
    // carried into a release by a fast-forward, so they must not block one.
    fs.mkdirSync(path.join(fx.server, 'frontend', 'dist.prev-20260905'), { recursive: true });
    write(path.join(fx.server, 'frontend', 'dist.prev-20260905', 'index.html'), '<html></html>\n');
    const r = run(fx);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    // git collapses a wholly-untracked directory to its top level.
    expect(r.out).toMatch(/untracked files present \(not blocking\): frontend\//);
    expect(pm2Calls(r)).toHaveLength(1);
  });

  it('writes its history log outside the checkout by default', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    expect(src).toMatch(/DEPLOY_LOG="\$\{DEPLOY_LOG:-\$\(dirname "\$\(dirname "\$PROJECT_DIR"\)"\)\/logs\/deploy-history\.log\}"/);
  });

  it('the wrong branch stops when EXPECTED_BRANCH is set', () => {
    const r = run(fx, { EXPECTED_BRANCH: 'release' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/on branch 'main' but EXPECTED_BRANCH='release'/);
    expect(pm2Calls(r)).toHaveLength(0);
  });

  it('a detached HEAD stops', () => {
    git(fx.server, 'checkout', '-q', '--detach');
    const r = run(fx);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/detached HEAD/);
    expect(pm2Calls(r)).toHaveLength(0);
  });

  it('a syntax error in the pulled code stops before PM2, and says where the code now is', () => {
    const before = git(fx.server, 'rev-parse', '--short', 'HEAD');
    const after = publish(fx, { 'backend/src/bad.js': 'this is not javascript (\n' }, 'broken');
    const r = run(fx);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/syntax error in src[\\/]bad\.js/);
    expect(pm2Calls(r)).toHaveLength(0);
    // The checkout did move — that is what the recorded before/after is for.
    expect(r.head).toBe(after);
    expect(fs.readFileSync(fx.deployLog, 'utf8')).toMatch(new RegExp(`before=${before} after=${after}`));
  });

  it('failing unit tests stop before PM2', () => {
    const r = run(fx, { STUB_JEST_EXIT: '1' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/unit tests failed — PM2 not reloaded/);
    expect(pm2Calls(r)).toHaveLength(0);
  });

  it('installs dependencies only when the lockfile moved, and a failed install stops before PM2', () => {
    publish(fx, { 'backend/package-lock.json': '{"name":"fixture","lockfileVersion":3,"packages":{"node_modules/x":{}}}\n' }, 'bump dep');
    const ok = run(fx);
    expect(ok.status).toBe(0);
    expect(ok.stubCalls.some((l) => l === 'npm ci')).toBe(true);
    expect(pm2Calls(ok)).toHaveLength(1);

    // Same change again on a fresh fixture, but npm ci fails.
    const fx2 = makeFixture();
    try {
      publish(fx2, { 'backend/package-lock.json': '{"name":"fixture","lockfileVersion":3,"packages":{"node_modules/y":{}}}\n' }, 'bump dep');
      const bad = run(fx2, { STUB_NPM_EXIT: '1' });
      expect(bad.status).not.toBe(0);
      expect(bad.out).toMatch(/npm ci failed — PM2 not reloaded/);
      expect(pm2Calls(bad)).toHaveLength(0);
    } finally {
      fs.rmSync(fx2.base, { recursive: true, force: true });
    }
  });

  it('DEPLOY_INSTALL=never skips the install even when the lockfile moved; =always forces it', () => {
    publish(fx, { 'backend/package-lock.json': '{"name":"fixture","lockfileVersion":3,"packages":{"node_modules/z":{}}}\n' }, 'bump dep');
    const never = run(fx, { DEPLOY_INSTALL: 'never' });
    expect(never.status).toBe(0);
    expect(never.stubCalls.some((l) => l === 'npm ci')).toBe(false);
    const always = run(fx, { DEPLOY_INSTALL: 'always', STUB_LOG: path.join(fx.base, 'stub2.log') });
    expect(always.status).toBe(0);
    expect(fs.readFileSync(path.join(fx.base, 'stub2.log'), 'utf8')).toMatch(/^npm ci$/m);
  });

  it('a failed health check after reload exits non-zero and names the previous commit', () => {
    const before = git(fx.server, 'rev-parse', '--short', 'HEAD');
    const r = run(fx, { STUB_CURL_EXIT: '22' });
    expect(r.status).not.toBe(0);
    expect(pm2Calls(r)).toHaveLength(1); // reload did happen; the failure is after it
    expect(r.out).toMatch(/Health check failed after reload/);
    expect(r.out).toContain(`previous commit was ${before}`);
    expect(r.stubCalls.some((l) => l.startsWith('pm2 describe fixture-app'))).toBe(true);
  });
});

describe('deploy-backend.sh source', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  it('stops on error and never swallows the fetch or the fast-forward', () => {
    expect(src).toMatch(/^set -euo pipefail$/m);
    // `|| true` is allowed only where it is harmless by design (reading the
    // branch name, `pm2 describe` on the failure path) — never on git fetch,
    // merge or pull, which is the bug this rewrite removes.
    expect(code).not.toMatch(/git (pull|fetch|merge)[^\n]*\|\| true/);
    expect(code).toMatch(/git fetch "\$REMOTE" "\$BRANCH" \|\| fail/);
    expect(code).toMatch(/git merge --ff-only FETCH_HEAD/);
  });

  it('quotes the paths it uses', () => {
    expect(code).toMatch(/cd "\$PROJECT_DIR"/);
    expect(code).toMatch(/cd "\$BACKEND_DIR"/);
    expect(code).toMatch(/pm2 reload "\$ECOSYSTEM"/);
    expect(code).toMatch(/>> "\$DEPLOY_LOG"/);
    expect(code).toMatch(/pm2 describe "\$APP_NAME"/);
    // and the unquoted forms the old script had are gone
    expect(code).not.toMatch(/cd \$PROJECT_DIR\b/);
    expect(code).not.toMatch(/cd \$BACKEND_DIR\b/);
    expect(code).not.toMatch(/pm2 reload \$ECOSYSTEM\b/);
  });

  it('still reloads PM2 and still does not apply schema changes (the guard suites depend on both)', () => {
    expect(src).toMatch(/pm2 reload/);
    expect(src).not.toMatch(/migrations?\//);
  });
});
