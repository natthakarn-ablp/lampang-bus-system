'use strict';

const { pool } = require('../config/database');
const { getBuildInfo, pingDatabaseWithTimeout } = require('../utils/health');
const { getMigrationStatus } = require('./migrationStatus.service');

const PUBLIC_HEALTH_CACHE_TTL_MS = 60 * 1000;
let cached = null;
let cachedAt = 0;

async function computePublicHealth() {
  const connected = await pingDatabaseWithTimeout(1500);
  let migrations = { latest: null, pending: null };
  let migrationReady = false;

  if (connected) {
    try {
      const status = await getMigrationStatus(pool);
      migrations = { latest: status.latest, pending: status.pending };
      migrationReady = true;
    } catch {
      // Public health is intentionally path- and error-free. Operators use the
      // authenticated operations report for detailed migration diagnostics.
    }
  }

  const commit = getBuildInfo().commit;
  return {
    status: connected && migrationReady ? 'ok' : 'degraded',
    commit: commit ? String(commit).slice(0, 7) : null,
    database: { connected },
    migrations,
  };
}

async function getPublicHealth() {
  const now = Date.now();
  if (cached && now - cachedAt < PUBLIC_HEALTH_CACHE_TTL_MS) return cached;
  cached = await computePublicHealth();
  cachedAt = now;
  return cached;
}

function resetPublicHealthCache() {
  cached = null;
  cachedAt = 0;
}

module.exports = {
  PUBLIC_HEALTH_CACHE_TTL_MS,
  getPublicHealth,
  resetPublicHealthCache,
};
