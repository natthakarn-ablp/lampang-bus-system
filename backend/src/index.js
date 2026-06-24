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
  await assertDriverShiftMigrationPresent();
  await assertTrackingMigrationPresent();
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
