'use strict';

/**
 * scripts/install-deploy-scripts.sh — OPS-001 (2026-11-08).
 *
 * Runs the real installer against a throwaway repository and state directory.
 * The committed deploy-ci-gate.js in the fixture is a stub that answers
 * STUB_CI_EXIT, so nothing touches GitHub; the committed deploy-backend.sh is
 * the real one from this checkout (the installer's final probe starts it).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const INSTALLER = path.join(ROOT, 'scripts', 'install-deploy-scripts.sh');
const REAL_DEPLOY = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy-backend.sh'), 'utf8');
const toPosix = (p) => p.replace(/\\/g, '/');

function resolveBash() {
  const explicit = process.env.DEPLOY_TEST_BASH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  if (process.platform === 'win32') {
    for (const c of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']) if (fs.existsSync(c)) return c;
  }
  return 'bash';
}
const BASH = resolveBash();
const hasBash = (() => { try { return spawnSync(BASH, ['-c', 'echo ok'], { encoding: 'utf8', timeout: 20000 }).stdout.trim() === 'ok'; } catch { return false; } })();
const describeWithBash = hasBash ? describe : describe.skip;

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}
function write(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const STUB_GATE = `'use strict';
const code = Number(process.env.STUB_CI_EXIT || 0);
console.log('[ci-gate] stub ' + process.argv.slice(2).join(' ') + ' -> ' + code);
process.exit(code);
`;

function makeFixture({ withGateInCommit = true } = {}) {
  const base = toPosix(fs.mkdtempSync(path.join(os.tmpdir(), 'install-deploy-fixture-')));
  const origin = `${base}/origin.git`; const seed = `${base}/seed`; const server = `${base}/server`; const state = `${base}/state`;
  git(base, 'init', '--bare', origin);
  fs.mkdirSync(seed); git(seed, 'init'); git(seed, 'checkout', '-b', 'feat');
  write(`${seed}/backend/src/ok.js`, "'use strict';\n");
  write(`${seed}/scripts/deploy-backend.sh`, REAL_DEPLOY);
  if (withGateInCommit) write(`${seed}/scripts/deploy-ci-gate.js`, STUB_GATE);
  git(seed, 'add', '.'); git(seed, 'commit', '-q', '-m', 'release');
  git(seed, 'remote', 'add', 'origin', origin); git(seed, 'push', '-q', 'origin', 'feat');
  git(base, 'clone', '-q', '-b', 'feat', origin, server);
  write(`${state}/deploy-backend.sh`, '#!/usr/bin/env bash\necho old-deploy-script\n');
  return { base, origin, seed, server, state, sha: git(seed, 'rev-parse', 'HEAD') };
}

function run(fx, args, env = {}) {
  const r = spawnSync(BASH, [INSTALLER, ...args], {
    cwd: fx.base, encoding: 'utf8', timeout: 60000,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME || fx.base, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP,
      PROJECT_DIR: fx.server, DEPLOY_STATE_DIR: fx.state, INSTALL_BRANCH: 'feat',
      DEPLOY_NODE: toPosix(process.execPath), DEPLOY_LOG: `${fx.base}/deploy-history.log`, ...env,
    },
  });
  return { ...r, out: `${r.stdout}\n${r.stderr}` };
}
const stateFiles = (fx) => fs.readdirSync(fx.state).sort();

describeWithBash('install-deploy-scripts.sh (OPS-001)', () => {
  jest.setTimeout(60000);
  let fx;
  afterEach(() => { try { fs.rmSync(fx.base, { recursive: true, force: true }); } catch { /* temp */ } });

  it('green CI: backs up, installs helper then main from the commit, checksums match, main finds its helper, lock released', () => {
    fx = makeFixture();
    const r = run(fx, [fx.sha]);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.out).toContain(`[ci-gate] stub --sha ${fx.sha} --branch feat -> 0`);
    // installed bytes = the commit's bytes
    expect(sha256(`${fx.state}/deploy-backend.sh`)).toBe(sha256(`${fx.seed}/scripts/deploy-backend.sh`));
    expect(sha256(`${fx.state}/deploy-ci-gate.js`)).toBe(sha256(`${fx.seed}/scripts/deploy-ci-gate.js`));
    expect(r.out).toContain('resolves deploy-ci-gate.js and stops at the lock as expected');
    const stamp = (r.out.match(/Backup stamp: (\d{8}T\d{6}Z)/) || [])[1];
    expect(stamp).toBeTruthy();
    expect(fs.readFileSync(`${fx.state}/deploy-backend.sh.pre-install-${stamp}`, 'utf8')).toContain('old-deploy-script');
    expect(fs.existsSync(`${fx.state}/deploy-backend.lock`)).toBe(false);
    expect(fs.readFileSync(`${fx.base}/deploy-history.log`, 'utf8')).toMatch(new RegExp(`deploy-scripts installed from ${fx.sha} backup=${stamp}`));
    // helper went in before the main script (order printed by the file write times is not observable; the source order is pinned below)
  });

  it.each([['2', 'refused'], ['3', 'cannot check']])('CI gate exit %s (%s): nothing installed, old script untouched, no lock left', (code) => {
    fx = makeFixture();
    const before = stateFiles(fx);
    const r = run(fx, [fx.sha], { STUB_CI_EXIT: code });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('CI is not green');
    expect(stateFiles(fx)).toEqual(before);
    expect(fs.readFileSync(`${fx.state}/deploy-backend.sh`, 'utf8')).toContain('old-deploy-script');
  });

  it('a deploy holding the lock: refuses, nothing installed', () => {
    fx = makeFixture();
    fs.mkdirSync(`${fx.state}/deploy-backend.lock`);
    fs.writeFileSync(`${fx.state}/deploy-backend.lock/owner.1`, '1 2026-11-08T00:00:00+07:00 deployer\n');
    const r = run(fx, [fx.sha]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/lock .* exists/);
    expect(fs.existsSync(`${fx.state}/deploy-ci-gate.js`)).toBe(false);
    expect(fs.readFileSync(`${fx.state}/deploy-backend.sh`, 'utf8')).toContain('old-deploy-script');
    expect(fs.existsSync(`${fx.state}/deploy-backend.lock/owner.1`)).toBe(true); // someone else's lock is left alone
  });

  it.each([['abc1234'], ['']])('SHA %j that is not full 40-hex: refused before anything', (sha) => {
    fx = makeFixture();
    const r = run(fx, [sha]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('give the full 40-character merge SHA');
    expect(fs.existsSync(`${fx.state}/deploy-ci-gate.js`)).toBe(false);
  });

  it('a SHA not on the branch is refused', () => {
    fx = makeFixture();
    git(fx.seed, 'checkout', '-q', '-b', 'side');
    write(`${fx.seed}/x.txt`, 'x'); git(fx.seed, 'add', '.'); git(fx.seed, 'commit', '-q', '-m', 'side');
    git(fx.seed, 'push', '-q', 'origin', 'side');
    const r = run(fx, [git(fx.seed, 'rev-parse', 'HEAD')]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/is not on origin\/feat|is not in the repository/);
    expect(fs.existsSync(`${fx.state}/deploy-ci-gate.js`)).toBe(false);
  });

  it('a commit that predates the gate is refused (no helper to install)', () => {
    fx = makeFixture({ withGateInCommit: false });
    const r = run(fx, [fx.sha]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('predates the CI gate');
    expect(fs.readFileSync(`${fx.state}/deploy-backend.sh`, 'utf8')).toContain('old-deploy-script');
  });

  it('--restore puts the previous main script back and removes a helper that did not exist before', () => {
    fx = makeFixture();
    const r = run(fx, [fx.sha]);
    const stamp = r.out.match(/Backup stamp: (\d{8}T\d{6}Z)/)[1];
    const back = run(fx, ['--restore', stamp]);
    expect(`exit ${back.status}: ${back.out}`).toMatch(/^exit 0:/);
    expect(fs.readFileSync(`${fx.state}/deploy-backend.sh`, 'utf8')).toContain('old-deploy-script');
    expect(fs.existsSync(`${fx.state}/deploy-ci-gate.js`)).toBe(false);
    expect(fs.existsSync(`${fx.state}/deploy-backend.lock`)).toBe(false);
  });
});

describe('install-deploy-scripts.sh source', () => {
  const src = fs.readFileSync(INSTALLER, 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  it('takes the lock before writing, and installs the helper BEFORE the main script', () => {
    const lockAt = code.indexOf('take_lock\nSTAMP=');
    const helperAt = code.indexOf('place "$TMP/$HELPER" "$DEPLOY_STATE_DIR/$HELPER" 644');
    const mainAt = code.indexOf('place "$TMP/$MAIN" "$DEPLOY_STATE_DIR/$MAIN" 755');
    expect(`lock ${lockAt > -1} helper ${helperAt > lockAt} main-after-helper ${mainAt > helperAt}`).toBe('lock true helper true main-after-helper true');
  });
  it('reads both files from the commit objects, never from the working tree, and gates on CI before the lock', () => {
    expect(code).toMatch(/git -C "\$PROJECT_DIR" show "\$SHA:scripts\/\$MAIN"/);
    expect(code).toMatch(/git -C "\$PROJECT_DIR" show "\$SHA:scripts\/\$HELPER"/);
    expect(code.indexOf('"$NODE_BIN" "$TMP/$HELPER" --sha "$SHA"')).toBeLessThan(code.indexOf('take_lock\nSTAMP='));
  });
  it('uses LF line endings', () => { expect(src.includes('\r')).toBe(false); });
});
