'use strict';

/**
 * scripts/install-automation-crons.sh (2026-11-13).
 *
 * Runs the real installer with a fake `crontab` first on PATH. The fake keeps
 * the "installed" crontab in $FAKE_CRONTAB_FILE, answers `crontab -l` from it
 * (exit 1 + "no crontab for ..." when it does not exist) and replaces it on
 * `crontab <file>`. Nothing touches the real crontab.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const INSTALLER = path.join(ROOT, 'scripts', 'install-automation-crons.sh');
const toPosix = (p) => p.replace(/\\/g, '/');
// Git Bash on Windows needs /c/... in PATH (a "C:" entry would be split at the colon).
const toBashPath = (p) => toPosix(p).replace(/^([A-Za-z]):\//, (_, d) => `/${d.toLowerCase()}/`);

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

const FAKE_CRONTAB = `#!/usr/bin/env bash
set -e
if [ -n "\${FAKE_CRONTAB_FAIL_WRITE:-}" ] && [ "\${1:-}" != "-l" ]; then echo "fake crontab: write refused" >&2; exit 1; fi
case "\${1:-}" in
  -l) if [ -f "$FAKE_CRONTAB_FILE" ]; then cat "$FAKE_CRONTAB_FILE"; else echo "no crontab for fixture" >&2; exit 1; fi ;;
  -) cat > "$FAKE_CRONTAB_FILE" ;;
  "") echo "fake crontab: no argument" >&2; exit 1 ;;
  *) cat "$1" > "$FAKE_CRONTAB_FILE" ;;
esac
`;

const APP = '/home/schoolbus/apps/lampang-bus-system';
const LOGS = '/home/schoolbus/logs';
const LINES = [
  `0 1 * * * cd ${APP}/backend && /usr/local/bin/node scripts/pending-queue-alert.js >> ${LOGS}/pending-queue-alert.log 2>&1`,
  `0 13 * * * cd ${APP}/backend && /usr/local/bin/node scripts/daily-snapshot.js >> ${LOGS}/daily-snapshot.log 2>&1`,
  `*/30 * * * * cd ${APP}/backend && /usr/local/bin/node scripts/ops-watch.js >> ${LOGS}/ops-watch.log 2>&1`,
];
const OTHER = [
  '# existing jobs',
  `0 19 * * * ${APP}/scripts/backup-db.sh >> /home/schoolbus/backups/lampang-bus/backup.log 2>&1`,
  '*/5 * * * * /home/schoolbus/health-smoke.sh',
];

function makeFixture(initial) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'install-crons-fixture-'));
  const bin = path.join(base, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'crontab'), FAKE_CRONTAB, { mode: 0o755 });
  const tab = path.join(base, 'crontab.txt');
  if (initial !== undefined) fs.writeFileSync(tab, initial);
  return { base, bin, tab, backups: path.join(base, 'deploy-state') };
}

function run(fx, args = [], env = {}) {
  // Prepend the fake bin inside bash so the PATH syntax is bash's on every platform.
  const r = spawnSync(BASH, ['-c', 'PATH="$1:$PATH"; shift; exec bash "$@"', 'wrap', toBashPath(fx.bin), toPosix(INSTALLER), ...args], {
    encoding: 'utf8', timeout: 60000,
    env: {
      ...process.env,
      FAKE_CRONTAB_FILE: toPosix(fx.tab),
      BACKUP_DIR: toPosix(fx.backups),
      ...env,
    },
  });
  return { ...r, out: `${r.stdout}\n${r.stderr}` };
}
const tabLines = (fx) => fs.readFileSync(fx.tab, 'utf8').split('\n').filter(Boolean);
const backups = (fx) => (fs.existsSync(fx.backups) ? fs.readdirSync(fx.backups) : []);

describeWithBash('install-automation-crons.sh', () => {
  jest.setTimeout(60000);
  let fx;
  afterEach(() => { try { fs.rmSync(fx.base, { recursive: true, force: true }); } catch { /* temp */ } });

  it('adds the three lines after the existing ones, keeps every other line, backs up, prints a diff', () => {
    fx = makeFixture(`${OTHER.join('\n')}\n`);
    const r = run(fx);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(tabLines(fx)).toEqual([...OTHER, ...LINES]);
    for (const l of LINES) expect(r.stdout).toContain(`+${l}`);
    const b = backups(fx);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatch(/^crontab\.backup-\d{8}T\d{6}Z$/);
    expect(fs.readFileSync(path.join(fx.backups, b[0]), 'utf8')).toBe(`${OTHER.join('\n')}\n`);
    expect(r.stdout).toContain('installed 3 line(s)');
  });

  it('is idempotent: a second run changes nothing, adds no duplicate and writes no backup', () => {
    fx = makeFixture(`${OTHER.join('\n')}\n`);
    expect(run(fx).status).toBe(0);
    const after1 = fs.readFileSync(fx.tab, 'utf8');
    const r = run(fx);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.stdout).toContain('no change needed');
    expect(fs.readFileSync(fx.tab, 'utf8')).toBe(after1);
    expect(backups(fx)).toHaveLength(1);
  });

  it('--dry-run prints the diff but writes neither the crontab nor a backup', () => {
    fx = makeFixture(`${OTHER.join('\n')}\n`);
    const r = run(fx, ['--dry-run']);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(r.stdout).toContain(`+${LINES[2]}`);
    expect(r.stdout).toContain('dry run: nothing written');
    expect(fs.readFileSync(fx.tab, 'utf8')).toBe(`${OTHER.join('\n')}\n`);
    expect(backups(fx)).toHaveLength(0);
  });

  it('no crontab yet: installs exactly the three lines (empty backup)', () => {
    fx = makeFixture(undefined);
    const r = run(fx);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(tabLines(fx)).toEqual(LINES);
    expect(fs.readFileSync(path.join(fx.backups, backups(fx)[0]), 'utf8')).toBe('');
  });

  it('only adds what is missing; a last line without newline stays intact', () => {
    fx = makeFixture(`${OTHER[1]}\n  ${LINES[1]}  \n${OTHER[2]}`);
    const r = run(fx);
    expect(`exit ${r.status}: ${r.out}`).toMatch(/^exit 0:/);
    expect(tabLines(fx)).toEqual([OTHER[1], `  ${LINES[1]}  `, OTHER[2], LINES[0], LINES[2]]);
    expect(r.stdout).toContain('already present: daily-snapshot.js');
  });

  it('a commented-out copy does not count as installed', () => {
    fx = makeFixture(`#${LINES[0]}\n`);
    const r = run(fx);
    expect(r.status).toBe(0);
    expect(tabLines(fx)).toEqual([`#${LINES[0]}`, ...LINES]);
  });

  it('the same script on another schedule: left alone, not duplicated, exit 2, others still added', () => {
    const variant = `0 2 * * * cd ${APP}/backend && /usr/local/bin/node scripts/ops-watch.js >> ${LOGS}/ops-watch.log 2>&1`;
    fx = makeFixture(`${variant}\n`);
    const r = run(fx);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('ops-watch.js already runs from a different line');
    expect(tabLines(fx)).toEqual([variant, LINES[0], LINES[1]]);
  });

  it('crontab refusing the write: exits non-zero and the old crontab is unchanged', () => {
    fx = makeFixture(`${OTHER.join('\n')}\n`);
    const r = run(fx, [], { FAKE_CRONTAB_FAIL_WRITE: '1' });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('crontab rejected the new file');
    expect(fs.readFileSync(fx.tab, 'utf8')).toBe(`${OTHER.join('\n')}\n`);
  });

  it('rejects unknown arguments before reading anything', () => {
    fx = makeFixture(`${OTHER.join('\n')}\n`);
    const r = run(fx, ['--force']);
    expect(r.status).toBe(1);
    expect(r.out).toContain('unknown argument');
    expect(backups(fx)).toHaveLength(0);
  });
});

describe('install-automation-crons.sh source', () => {
  const src = fs.readFileSync(INSTALLER, 'utf8');
  it('uses LF line endings', () => { expect(src.includes('\r')).toBe(false); });
  it('does not install the GPS stale alert (it pushes LINE; owner decision)', () => {
    const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code).not.toMatch(/gps-stale-alert/);
  });
  it('matches the lines documented in docs/ops/automation-crons.md', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'automation-crons.md'), 'utf8');
    for (const l of LINES) expect(doc).toContain(l);
  });
});
