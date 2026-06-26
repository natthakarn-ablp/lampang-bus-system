#!/usr/bin/env node
'use strict';

// Phase 10.13C — recreate docs/manual and docs/docs symlinks inside
// frontend/dist after every Vite build. This keeps /manual and /docs URLs
// working even though dist/ is in .gitignore and is regenerated on deploy.

const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '../frontend/dist');
const manualSrc = path.resolve(__dirname, '../docs/manual-html');
const docsSrc = path.resolve(__dirname, '../docs');

function ensureSymlink(name, target) {
  const linkPath = path.join(distDir, name);
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      const current = fs.readlinkSync(linkPath);
      const desired = path.relative(distDir, target);
      if (current === desired || current === target) {
        console.log(`[postbuild] ${name} symlink already correct`);
        return;
      }
      fs.unlinkSync(linkPath);
    } else {
      fs.rmSync(linkPath, { recursive: true, force: true });
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const relativeTarget = path.relative(distDir, target);
  fs.symlinkSync(relativeTarget, linkPath, 'dir');
  console.log(`[postbuild] created symlink ${linkPath} -> ${relativeTarget}`);
}

if (!fs.existsSync(distDir)) {
  console.error(`[postbuild] dist directory not found: ${distDir}`);
  process.exit(1);
}

ensureSymlink('manual', manualSrc);
ensureSymlink('docs', docsSrc);
