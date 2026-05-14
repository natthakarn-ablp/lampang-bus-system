'use strict';

/**
 * health.js — small helpers for the public /health endpoint.
 *
 * Phase 9.14 — adds safe operational metadata (service / version /
 * environment / commit / database connectivity) without ever exposing
 * secrets, file paths, env values, or DB error details.
 *
 * Design contracts:
 *   • Build info is computed ONCE at module load (cheap to read on every
 *     request, never shells out to git per request).
 *   • Database ping is per-request but bounded by Promise.race timeout
 *     so /health can never hang a load balancer probe.
 *   • Every failure path is swallowed silently and translates to a safe
 *     fallback value — /health never throws.
 */

const { execSync } = require('child_process');
const path = require('path');

const { pool } = require('../config/database');
const env = require('../config/env');

let pkgName = 'lampang-bus-backend';
let pkgVersion = '0.0.0';
try {
  const pkg = require('../../package.json');
  pkgName = pkg.name || pkgName;
  pkgVersion = pkg.version || pkgVersion;
} catch {
  // package.json should always be present; if not, fall back silently.
}

/**
 * Resolve the short git commit ONCE at module load. Order of preference:
 *   1. process.env.GIT_COMMIT  (set by CI / Docker build at deploy time)
 *   2. `git rev-parse --short HEAD`  (works in dev + on-server checkouts)
 *   3. null  (graceful — /health stays usable in non-repo environments)
 */
function resolveCommit() {
  if (process.env.GIT_COMMIT) {
    return String(process.env.GIT_COMMIT).trim().slice(0, 12);
  }
  try {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const sha = execSync('git rev-parse --short HEAD', {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    }).toString().trim();
    return sha || null;
  } catch {
    return null;
  }
}

const BUILD_INFO = Object.freeze({
  service: pkgName,
  version: pkgVersion,
  commit: resolveCommit(),
});

function getBuildInfo() {
  return BUILD_INFO;
}

/**
 * Lightweight `SELECT 1` ping bounded by a timeout. Returns `true` when
 * the DB responds within `timeoutMs`, `false` on any error or timeout.
 * Never leaks the underlying error string.
 */
async function pingDatabaseWithTimeout(timeoutMs = 1500) {
  let timer;
  try {
    const ping = pool.query('SELECT 1 AS ok');
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('db-ping-timeout')), timeoutMs);
    });
    await Promise.race([ping, timeout]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function getEnvironment() {
  return env.app.nodeEnv || 'development';
}

module.exports = {
  getBuildInfo,
  pingDatabaseWithTimeout,
  getEnvironment,
};
