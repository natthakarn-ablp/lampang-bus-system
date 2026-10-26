'use strict';

/**
 * Only the manuals are published. Nothing else in docs/ may reach the web.
 *
 * Until 2026-09-07 the post-build step created frontend/dist/docs -> docs/,
 * so every file in the documentation tree was downloadable from the public
 * site. Confirmed live that day: /docs/security/residual-risk-register.md
 * (65 KB, the register of known weaknesses with file:line references),
 * /docs/audit/AUDIT_COVERAGE.md (92 KB) and
 * /docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md all returned 200 with their
 * real contents. The owner asked for the internal documentation to be closed
 * off and the manuals kept.
 *
 * These are source-level guards (there is no frontend test runner here —
 * handoff §5). They fail if someone re-publishes the tree, or links into it
 * from a published page.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('the post-build step publishes the manuals and nothing else', () => {
  const src = read('scripts/postbuild-symlinks.js');

  it('links dist/manual at docs/manual-html', () => {
    expect(src).toMatch(/ensureSymlink\('manual',\s*manualSrc\)/);
    expect(src).toMatch(/const manualSrc = path\.resolve\(__dirname, '\.\.\/docs\/manual-html'\)/);
  });

  it('does not link the documentation tree', () => {
    expect(src).not.toMatch(/ensureSymlink\('docs'/);
    // The whole-tree target must not be resolved at all any more.
    expect(src).not.toMatch(/path\.resolve\(__dirname, '\.\.\/docs'\)/);
  });

  it('actively removes a dist/docs left by an earlier deploy', () => {
    expect(src).toMatch(/removeIfPresent\('docs'\)/);
  });
});

describe('no published page links into the documentation tree', () => {
  const dir = path.join(ROOT, 'docs/manual-html');
  const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));

  it('finds the published pages', () => {
    expect(pages.length).toBeGreaterThanOrEqual(8);
  });

  it.each(pages)('%s has no /docs/ link', (page) => {
    const html = read(path.join('docs/manual-html', page));
    const hits = [...html.matchAll(/(?:href|src)="(\/docs\/[^"]*)"/g)].map((m) => m[1]);
    expect(hits).toEqual([]);
  });
});

describe('the published PDFs do not depend on the removed link', () => {
  it('reaches docs/manual-pdf through docs/manual-html/pdf', () => {
    // A git symlink (mode 120000) whose content is the relative target; on a
    // Windows checkout it is a small text file, on the server a real symlink.
    const p = path.join(ROOT, 'docs/manual-html/pdf');
    const stat = fs.lstatSync(p);
    const target = stat.isSymbolicLink() ? fs.readlinkSync(p) : fs.readFileSync(p, 'utf8').trim();
    expect(target).toBe('../manual-pdf');
    expect(fs.existsSync(path.join(ROOT, 'docs/manual-pdf'))).toBe(true);
  });
});
