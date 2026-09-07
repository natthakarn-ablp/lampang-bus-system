#!/usr/bin/env node
'use strict';

// Phase 10.13C — recreate the docs/manual symlink inside frontend/dist after
// every Vite build. This keeps /manual URLs working even though dist/ is in
// .gitignore and is regenerated on deploy.
//
// 2026-09-07: the sibling link dist/docs -> docs/ is GONE and is actively
// removed here. It published the entire documentation tree at
// https://schoolbuslampang.com/docs/**, including docs/security/residual-risk-
// register.md — a list of the system's known weaknesses with file:line
// references — plus the audit reports, the closure plans and the approval
// forms. Only the manuals are meant to be public. The three operator links
// that used to point into /docs/ were removed from docs/manual-html/index.html
// in the same change.
//
// The published PDFs are unaffected: /manual/pdf/** resolves through
// docs/manual-html/pdf, a git symlink to ../manual-pdf, so it does not depend
// on dist/docs.

const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '../frontend/dist');
const manualSrc = path.resolve(__dirname, '../docs/manual-html');

function copyDirFallback(target, linkPath) {
  fs.cpSync(target, linkPath, { recursive: true, force: true });
  console.log(`[postbuild] copied ${target} -> ${linkPath} (symlink unavailable)`);
}

function ensureSymlink(name, target) {
  const linkPath = path.join(distDir, name);
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(linkPath);
    } else {
      fs.rmSync(linkPath, { recursive: true, force: true });
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const isWindows = process.platform === 'win32';
  const linkTarget = isWindows ? target : path.relative(distDir, target);
  const linkType = isWindows ? 'junction' : 'dir';

  try {
    fs.symlinkSync(linkTarget, linkPath, linkType);
    console.log(`[postbuild] created ${linkType} ${linkPath} -> ${linkTarget}`);
  } catch (e) {
    if (isWindows && ['EPERM', 'EINVAL'].includes(e.code)) {
      copyDirFallback(target, linkPath);
      return;
    }
    throw e;
  }
}

if (!fs.existsSync(distDir)) {
  console.error(`[postbuild] dist directory not found: ${distDir}`);
  process.exit(1);
}

/** Remove a path left by an earlier build, whatever kind of thing it is. */
function removeIfPresent(name) {
  const p = path.join(distDir, name);
  try {
    const stat = fs.lstatSync(p);
    if (stat.isSymbolicLink()) fs.unlinkSync(p);
    else fs.rmSync(p, { recursive: true, force: true });
    console.log(`[postbuild] removed ${p} (documentation tree is not published)`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

ensureSymlink('manual', manualSrc);
// A deploy that ran before 2026-09-07 left dist/docs behind; a rebuild alone
// would not clear it, so remove it every time.
removeIfPresent('docs');
