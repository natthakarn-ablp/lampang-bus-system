'use strict';

/**
 * scripts/build-manual-pdf.sh regenerates the seven role manuals plus the
 * index from docs/manual-html. Until 2026-09-05 it hard-coded the production
 * checkout path (/home/schoolbus/apps/...), so the manuals could only ever be
 * regenerated on the server — which is why Phase 11 could not rebuild them on
 * a sandbox (closure handoff §2 item 5).
 *
 * It also died silently on any host without the Playwright chromium cache:
 * with `set -e` and `pipefail`, the `find … | tail -1` that located chromium
 * returned 1 and the script exited on that assignment, before the check that
 * would have said what was missing.
 *
 * Three layers here:
 *   1. source level — no hard-coded host path, root derived from the script's
 *      own location, env overrides honoured, sources checked before render;
 *   2. filesystem — every guide the loop names exists, and so does every Thai
 *      distribution PDF it would overwrite (a typo in the loop would render
 *      to a new filename and leave the linked one stale);
 *   3. execution — `--dry-run` actually runs from a directory that is not the
 *      repo root, lists eight renders under this checkout, and fails loudly
 *      with the right hint when the manual directory is wrong. Skipped when
 *      no `bash` is on PATH, and says so.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'build-manual-pdf.sh');
const SRC = fs.readFileSync(SCRIPT, 'utf8');

const hasBash = (() => {
  try {
    return spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' }).stdout.trim() === 'ok';
  } catch {
    return false;
  }
})();
const withBash = hasBash ? it : it.skip;

function runScript(args, env = {}) {
  return spawnSync('bash', [SCRIPT, ...args], {
    cwd: __dirname, // deliberately not the repo root
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('source: the script no longer knows where production lives', () => {
  it('has no hard-coded /home/schoolbus path', () => {
    expect(`hard-coded path: ${/\/home\/schoolbus/.test(SRC)}`).toBe('hard-coded path: false');
  });

  it('derives the repo root from its own location, like the other scripts', () => {
    expect(SRC).toMatch(/ROOT="\$\(cd "\$\(dirname "\$0"\)\/\.\." && pwd\)"/);
    expect(SRC).toMatch(/MANUAL="\$\{MANUAL_HTML_DIR:-\$ROOT\/docs\/manual-html\}"/);
    expect(SRC).toMatch(/PDF_DIR="\$\{MANUAL_PDF_DIR:-\$ROOT\/docs\/manual-pdf\}"/);
  });

  it('lets an operator point at another chromium', () => {
    expect(SRC).toMatch(/CHROME="\$\{CHROME:-/);
  });

  it('does not exit silently when the Playwright cache is absent', () => {
    // The `|| true` is what keeps `set -e` from killing the script on the
    // find pipeline; the explicit check below it is what reports the problem.
    expect(SRC).toMatch(/tail -1 \|\| true\)\}"/);
    expect(SRC).toMatch(/chromium not found/);
  });

  it('refuses to render a guide that does not exist', () => {
    expect(SRC).toMatch(/\[ -f "\$MANUAL\/\$1" \] \|\| \{ echo "ERROR: source not found/);
  });

  it('renders into the real PDF directory, not through the pdf symlink', () => {
    // docs/manual-html/pdf → ../manual-pdf; on a Windows checkout the link is
    // a plain file, so writing "through" it would fail there.
    expect(SRC).not.toMatch(/PDF_DIR="\$MANUAL\/pdf"/);
  });
});

describe('filesystem: everything the loop names is really there', () => {
  const roles = (() => {
    const m = SRC.match(/^for r in ([a-z ]+); do$/m);
    if (!m) throw new Error('role loop not found in script');
    return m[1].trim().split(/\s+/);
  })();

  const thaiNames = (() => {
    const out = {};
    for (const m of SRC.matchAll(/\[([a-z]+)\]="([^"]+)"/g)) out[m[1]] = m[2];
    return out;
  })();

  it('renders all seven roles', () => {
    expect(roles.sort()).toEqual(['admin', 'affiliation', 'driver', 'parent', 'province', 'school', 'transport']);
  });

  it('has a source HTML guide for each role, plus the index', () => {
    const missing = [...roles.map((r) => `user-guide-${r}.html`), 'index.html']
      .filter((f) => !fs.existsSync(path.join(ROOT, 'docs', 'manual-html', f)));
    expect(`missing guides: ${missing.join(', ')}`).toBe('missing guides: ');
  });

  it('would overwrite the Thai PDFs people were actually given, not new files', () => {
    const missing = [...roles.map((r) => `${thaiNames[r]}.pdf`), 'คู่มือ-สารบัญหลัก.pdf']
      .filter((f) => !fs.existsSync(path.join(ROOT, 'docs', 'manual-pdf', f)));
    expect(`no such PDF yet: ${missing.join(', ')}`).toBe('no such PDF yet: ');
  });
});

describe(`execution: --dry-run${hasBash ? '' : ' (skipped: no bash on PATH)'}`, () => {
  withBash('lists eight renders under this checkout, from a cwd that is not the repo root', () => {
    const r = runScript(['--dry-run'], { CHROME: '' });
    expect(`exit ${r.status}: ${r.stderr}`).toBe('exit 0: ');
    const lines = r.stdout.split('\n').filter((l) => l.startsWith('would render: '));
    expect(lines).toHaveLength(8);
    // Every path is inside this checkout's docs/, wherever the shell was started.
    const rootPosix = ROOT.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
    for (const l of lines) {
      expect(l).toMatch(/docs\/manual-html\/(user-guide-[a-z]+|index)\.html -> /);
      expect(l.includes(rootPosix) || l.includes(ROOT.replace(/\\/g, '/'))).toBe(true);
    }
    expect(r.stdout).toMatch(/dry run — nothing written/);
  });

  withBash('fails with the override hint when the manual directory is wrong', () => {
    const r = runScript(['--dry-run'], { MANUAL_HTML_DIR: path.join(__dirname, 'no-such-manual-dir') });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/manual dir not found: .*no-such-manual-dir \(set MANUAL_HTML_DIR\)/);
  });

  withBash('honours MANUAL_PDF_DIR in the plan', () => {
    const r = runScript(['--dry-run'], { CHROME: '', MANUAL_PDF_DIR: '/tmp/manual-out' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/-> \/tmp\/manual-out\/คู่มือ-คนขับ\.pdf/);
  });
});
