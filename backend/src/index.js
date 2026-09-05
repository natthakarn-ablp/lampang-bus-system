'use strict';

// Set timezone BEFORE any other code — ensures all Date operations use Bangkok time
process.env.TZ = 'Asia/Bangkok';

const env = require('./config/env');
const { testConnection, pool } = require('./config/database');
const app = require('./app');

// Audit 2026-06-18 (config-infra-dos): bind to loopback by default so only the
// local nginx reverse proxy can reach the backend. Binding to 0.0.0.0 let a
// client that could reach :3000 directly bypass Cloudflare/nginx AND spoof
// X-Forwarded-For to defeat the per-IP rate limiter. Override with HOST=0.0.0.0
// only if the backend must be reachable off-box.
const HOST = process.env.HOST || '127.0.0.1';

let server;

// ─── Migration-presence startup guard (#13) ──────────────────────────────────
// When FEATURE_DRIVER_SHIFT_SELECTION=true, the driver-shift code paths depend
// on tables that migration 039 creates (vehicle_operating_shifts,
// driver_qualifications). If the flag is flipped on before that migration runs,
// every shift/checkin request would die per-request with ER_NO_SUCH_TABLE.
// Probe information_schema once at boot and refuse to start so the failure is a
// single clear fatal message instead of a flood of runtime errors. When the
// flag is off, this is a no-op and normal boot is unaffected.
//
// Resilient by design: a genuinely-missing table is a confirmed fatal and we
// exit; but if the probe query itself fails for an UNRELATED reason (e.g. a
// transient permissions hiccup on information_schema), we log a warning and let
// boot continue rather than block startup on an ambiguous probe error.
const REQUIRED_DRIVER_SHIFT_TABLES = ['vehicle_operating_shifts', 'driver_qualifications'];

async function assertDriverShiftMigrationPresent() {
  if (!env.features.driverShiftSelection) return; // flag off → nothing to check

  let presentTables;
  try {
    const [rows] = await pool.query(
      `SELECT table_name AS table_name
         FROM information_schema.tables
        WHERE table_schema = ?
          AND table_name IN (?, ?)`,
      [env.db.name, REQUIRED_DRIVER_SHIFT_TABLES[0], REQUIRED_DRIVER_SHIFT_TABLES[1]]
    );
    presentTables = new Set(rows.map((r) => String(r.table_name).toLowerCase()));
  } catch (err) {
    // The probe itself failed for an unexpected reason — do NOT block boot on
    // an ambiguous error; surface it loudly and continue.
    console.warn(
      `[app] WARNING: could not verify driver-shift migration presence (${err.message}). ` +
      'Continuing startup; verify migration 039 was applied.'
    );
    return;
  }

  const missing = REQUIRED_DRIVER_SHIFT_TABLES.filter((t) => !presentTables.has(t));
  if (missing.length > 0) {
    console.error(
      `[app] FATAL: FEATURE_DRIVER_SHIFT_SELECTION=true requires migration 039 — ` +
      `missing table(s): ${missing.join(', ')}. ` +
      'Apply backend/migrations/039_driver_pool_and_shifts.sql or set ' +
      'FEATURE_DRIVER_SHIFT_SELECTION=false before starting.'
    );
    process.exit(1);
  }
  console.log('[app] Driver-shift migration check passed (migration 039 tables present)');
}

// ─── A1-9 — shared security state guard (migration 051) ──────────────────────
// Unlike the guards above, this one has no feature flag to hide behind. The
// login lockout is read on EVERY login attempt for every role
// (utils/sharedSecurityState.js), the LINE webhook claims each event before
// handling it, and the account-binding lockout gates the parent bind flow. If
// migration 051 has not run, the first symptom is that nobody can sign in, as
// a 500 that names ER_NO_SUCH_TABLE and nothing else.
//
// deploy-backend.sh is `git pull` + `pm2 reload` and does not apply migrations,
// so this is a realistic ordering mistake rather than a theoretical one. Exiting
// at boot means pm2 keeps the previous process serving and the deploy fails
// visibly — a failed deploy instead of an outage.
//
// Same resilience rule as the guards above: a table that is genuinely absent is
// fatal, but a probe that fails for an unrelated reason only warns.
const REQUIRED_SHARED_STATE_TABLES = [
  'login_lockouts', 'line_webhook_events_seen', 'line_bind_lockouts',
];

async function assertSharedSecurityStateMigrationPresent() {
  let presentTables;
  try {
    const [rows] = await pool.query(
      `SELECT table_name AS table_name
         FROM information_schema.tables
        WHERE table_schema = ?
          AND table_name IN (?, ?, ?)`,
      [env.db.name, ...REQUIRED_SHARED_STATE_TABLES]
    );
    presentTables = new Set(rows.map((r) => String(r.table_name).toLowerCase()));
  } catch (err) {
    console.warn(
      `[app] WARNING: could not verify shared-security-state migration presence (${err.message}). ` +
      'Continuing startup; verify migration 051 was applied.'
    );
    return;
  }

  const missing = REQUIRED_SHARED_STATE_TABLES.filter((t) => !presentTables.has(t));
  if (missing.length > 0) {
    console.error(
      '[app] FATAL: this build requires migration 051 — ' +
      `missing table(s): ${missing.join(', ')}. ` +
      'Apply backend/migrations/051_shared_security_state.sql BEFORE starting this ' +
      'version; without it every login fails. To go back instead, deploy the ' +
      'previous release — the schema change is additive and safe to leave in place.'
    );
    process.exit(1);
  }
  console.log('[app] Shared security state check passed (migration 051 tables present)');
}

// ─── Phase 11A — Intelligent Tracking migration guard (2026-06-23) ───────────
// Same pattern as the driver-shift guard: if any of FEATURE_ETA /
// FEATURE_GEOFENCE / FEATURE_ROUTE_DEVIATION is on, migration 040 must have
// been applied. Probe once at boot and refuse to start on a missing table so
// the failure is a single clear fatal message instead of per-ping errors.
const REQUIRED_TRACKING_TABLES = [
  'vehicle_location_history',
  'geofences',
  'geofence_events',
  'route_baselines',
  'route_deviations',
  'eta_predictions',
];

const REQUIRED_ADMIN_RECOVERY_TABLES = [
  'user_recovery_channels',
  'user_recovery_codes',
  'password_reset_requests',
];

async function assertAdminRecoveryMigrationPresent() {
  if (!env.features.adminPasswordRecovery) return;
  const placeholders = REQUIRED_ADMIN_RECOVERY_TABLES.map(() => '?').join(', ');
  let presentTables;
  try {
    const [rows] = await pool.query(
      `SELECT table_name AS table_name FROM information_schema.tables
        WHERE table_schema = ? AND table_name IN (${placeholders})`,
      [env.db.name, ...REQUIRED_ADMIN_RECOVERY_TABLES]
    );
    presentTables = new Set(rows.map((row) => String(row.table_name).toLowerCase()));
  } catch (error) {
    throw new Error(`Could not verify admin-recovery migration 049: ${error.message}`);
  }
  const missing = REQUIRED_ADMIN_RECOVERY_TABLES.filter((table) => !presentTables.has(table));
  if (missing.length) {
    console.error(
      `[app] FATAL: FEATURE_ADMIN_PASSWORD_RECOVERY=true requires migration 049 — ` +
      `missing table(s): ${missing.join(', ')}.`
    );
    process.exit(1);
  }
  console.log('[app] Admin password-recovery migration check passed (migration 049 tables present)');
}

async function assertTrackingMigrationPresent() {
  const anyTrackingFlag =
    env.features.eta || env.features.geofence || env.features.routeDeviation;
  if (!anyTrackingFlag) return; // all flags off → nothing to check

  let presentTables;
  try {
    const placeholders = REQUIRED_TRACKING_TABLES.map(() => '?').join(', ');
    const [rows] = await pool.query(
      `SELECT table_name AS table_name
         FROM information_schema.tables
        WHERE table_schema = ?
          AND table_name IN (${placeholders})`,
      [env.db.name, ...REQUIRED_TRACKING_TABLES]
    );
    presentTables = new Set(rows.map((r) => String(r.table_name).toLowerCase()));
  } catch (err) {
    console.warn(
      `[app] WARNING: could not verify tracking migration presence (${err.message}). ` +
      'Continuing startup; verify migration 040 was applied.'
    );
    return;
  }

  const missing = REQUIRED_TRACKING_TABLES.filter((t) => !presentTables.has(t));
  if (missing.length > 0) {
    console.error(
      `[app] FATAL: Intelligent Tracking feature flag(s) require migration 040 — ` +
      `missing table(s): ${missing.join(', ')}. ` +
      'Apply backend/migrations/040_intelligent_tracking.sql or set ' +
      'FEATURE_ETA / FEATURE_GEOFENCE / FEATURE_ROUTE_DEVIATION = false before starting.'
    );
    process.exit(1);
  }
  console.log('[app] Intelligent Tracking migration check passed (migration 040 tables present)');
}

// ─── Start ───────────────────────────────────────────────────────────────────
async function start() {
  await testConnection();
  await assertSharedSecurityStateMigrationPresent();
  await assertDriverShiftMigrationPresent();
  await assertTrackingMigrationPresent();
  await assertAdminRecoveryMigrationPresent();
  // Warm the current-term cache so getCurrentTermCachedSync() returns the live
  // DB value (terms.is_current) from the first request. Best-effort — falls back
  // to env.app.currentTerm if the table/row isn't present yet (pre-migration-046).
  try { await require('./services/term.service').getCurrentTerm(pool); } catch { /* env fallback */ }
  server = app.listen(env.app.port, HOST, () => {
    console.log(`[app] Lampang Bus System API running on ${HOST}:${env.app.port}`);
    console.log(`[app] Environment: ${env.app.nodeEnv}`);
  });
}

// ─── Graceful shutdown (audit 2026-06-18, limitations-scalability) ────────────
// Stop accepting new connections, then drain the MySQL pool, so a pm2 restart /
// deploy doesn't sever in-flight transactions.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[app] ${signal} received — shutting down gracefully`);
  const done = () => pool.end().then(() => { console.log('[app] DB pool drained'); process.exit(0); })
    .catch(() => process.exit(0));
  if (server) server.close(done); else done();
  // Hard cap so a hung connection can't block the restart forever.
  setTimeout(() => process.exit(1), 10000).unref();
}
['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig)));

// Never let an unhandled async error silently leave the process in a bad state.
process.on('unhandledRejection', (reason) => {
  console.error('[app] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[app] Uncaught exception:', err);
  shutdown('uncaughtException');
});

start().catch((err) => {
  console.error('[app] Failed to start:', err.message);
  process.exit(1);
});
