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

ensureSymlink('manual', manualSrc);
ensureSymlink('docs', docsSrc);
