'use strict';

// Migrations 052 + 053 create the two tables the policy-notice feature reads
// and writes. Startup now refuses a build when either table is confirmed
// absent, matching the migration-051 guard. The cached status and route-level
// 503 remain useful if a table disappears after boot, while operations health
// continues to expose the degraded state.
//
// The answer is cached for at most CACHE_TTL_MS and then re-probed on demand,
// so running the migrations brings the feature back without a restart.
//
// Three outcomes:
//   ready   — both tables present
//   missing — the probe ran and at least one table is absent
//   unknown — the probe itself failed (permissions, connection); treated like
//             the other boot guards treat an ambiguous probe: warn, do not block

const REQUIRED_POLICY_EVIDENCE_TABLES = ['policy_acknowledgements', 'policy_action_evidence'];
const CACHE_TTL_MS = 60_000;
const UNAVAILABLE_MESSAGE =
  'ฟีเจอร์แจ้งนโยบายยังไม่พร้อมใช้งาน เนื่องจากยังไม่ได้ติดตั้งตารางข้อมูลที่จำเป็น (migration 052/053) ' +
  'การใช้งานส่วนอื่นของระบบเป็นปกติ';

/** Probe information_schema once. Never throws. */
async function probePolicyEvidenceTables(pool, dbName) {
  try {
    const [rows] = await pool.query(
      `SELECT table_name AS table_name
         FROM information_schema.tables
        WHERE table_schema = ?
          AND table_name IN (?, ?)`,
      [dbName, ...REQUIRED_POLICY_EVIDENCE_TABLES]
    );
    const present = new Set(rows.map((r) => String(r.table_name).toLowerCase()));
    const missing = REQUIRED_POLICY_EVIDENCE_TABLES.filter((t) => !present.has(t));
    return { state: missing.length ? 'missing' : 'ready', missing, error: null };
  } catch (err) {
    return { state: 'unknown', missing: [], error: err.code || err.message };
  }
}

let cached = null;   // { status, checkedAt }
let inFlight = null; // de-duplicates concurrent re-probes

function logTransition(previous, status) {
  if (previous && previous.state === status.state) return;
  if (status.state === 'missing') {
    console.warn(
      '[app] WARNING: policy-notice tables missing: ' + status.missing.join(', ') + '. ' +
      '/api/policy-notices answers 503 until backend/migrations/052_policy_acknowledgements.sql ' +
      'and 053_policy_action_evidence.sql are applied; the rest of the app is unaffected.'
    );
  } else if (status.state === 'unknown') {
    console.warn(
      `[app] WARNING: could not verify policy-notice tables (${status.error}). ` +
      'Not blocking /api/policy-notices; verify migrations 052 and 053 were applied.'
    );
  } else if (previous) {
    console.log('[app] Policy-notice tables are now present (migration 052/053); /api/policy-notices re-enabled');
  }
}

/**
 * Cached status, re-probed when older than CACHE_TTL_MS.
 * `now` and `force` exist for tests and for the boot check.
 */
async function getPolicyEvidenceStatus({ now = Date.now(), force = false } = {}) {
  if (!force && cached && now - cached.checkedAt < CACHE_TTL_MS) return cached.status;
  if (inFlight) return inFlight;
  const { pool } = require('../config/database');
  const env = require('../config/env');
  inFlight = probePolicyEvidenceTables(pool, env.db.name)
    .then((status) => {
      logTransition(cached && cached.status, status);
      cached = { status, checkedAt: now };
      return status;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Express middleware: 503 while the tables are known to be missing. */
async function requirePolicyEvidenceTables(req, res, next) {
  const status = await getPolicyEvidenceStatus();
  if (status.state !== 'missing') return next();
  const { sendError } = require('./response');
  return sendError(res, UNAVAILABLE_MESSAGE, [], 503);
}

function resetPolicyEvidenceCache() {
  cached = null;
  inFlight = null;
}

module.exports = {
  REQUIRED_POLICY_EVIDENCE_TABLES,
  CACHE_TTL_MS,
  UNAVAILABLE_MESSAGE,
  probePolicyEvidenceTables,
  getPolicyEvidenceStatus,
  requirePolicyEvidenceTables,
  resetPolicyEvidenceCache,
};
