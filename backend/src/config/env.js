'use strict';

require('dotenv').config();

const required = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'JWT_REFRESH_EXPIRES_IN',
];

// ── Production-only required secrets ─────────────────────────────────────────
// These integrations are allowed to be blank in local dev / dry-run, but in
// production their security controls must NOT be able to silently fail open:
//   - LINE_CHANNEL_SECRET → webhook signature verification (C1)
//   - CRON_API_KEY        → /api/line/process-notifications auth guard (H11)
// Enforced only when NODE_ENV === 'production'. Pure + side-effect free so it
// can be unit-tested without touching process state.
const PRODUCTION_REQUIRED = ['LINE_CHANNEL_SECRET', 'CRON_API_KEY'];

function getMissingProductionSecrets(source = process.env, nodeEnv = source && source.NODE_ENV) {
  if (nodeEnv !== 'production') return [];
  return PRODUCTION_REQUIRED.filter(
    (key) => !source[key] || String(source[key]).trim().length === 0
  );
}

function parseSafetyPolicyConfig(source = process.env) {
  const raw = String(source.SAFETY_POLICY_MODE || 'observe').trim().toUpperCase();
  if (!['OBSERVE', 'ENFORCE'].includes(raw)) {
    throw new Error('SAFETY_POLICY_MODE must be observe or enforce');
  }
  // NOTE: SAFETY_ENFORCEMENT_AT is ADVISORY / record-keeping metadata ONLY.
  // It is parsed and validated for shape here, but NO runtime code reads it and
  // there is NO time-based auto-flip from OBSERVE → ENFORCE. Setting a date does
  // NOT switch the system to enforcement when that time arrives. To actually
  // enforce, an operator must manually set SAFETY_POLICY_MODE=enforce. The field
  // exists so a planned cutover date can be documented in config; treat it as a
  // note, not a switch. (See backend/.env.example for the operator-facing note.)
  const enforcementAt = String(source.SAFETY_ENFORCEMENT_AT || '').trim() || null;
  if (enforcementAt && Number.isNaN(Date.parse(enforcementAt))) {
    throw new Error('SAFETY_ENFORCEMENT_AT must be ISO-8601');
  }
  return { mode: raw, enforcementAt };
}

function validateFeatureDependencies(source = process.env) {
  if (source.FEATURE_QR_LEVEL3 === 'true' && source.FEATURE_VEHICLE_QR !== 'true') {
    throw new Error('FEATURE_QR_LEVEL3 requires FEATURE_VEHICLE_QR=true');
  }
  return true;
}

// ── Hard validation (fail-closed) ────────────────────────────────────────────
// Collects every fatal config problem and reports it. Behaviour by environment:
//   - NODE_ENV !== 'test'  → on the FIRST fatal problem, log + process.exit(1).
//     This preserves production/dev fail-closed behaviour (the app refuses to
//     boot on bad config).
//   - NODE_ENV === 'test'  → THROW an Error instead of exiting, so a unit test
//     can `require('env')` (and call this validator) without the process.exit(1)
//     killing the Jest worker. The security checks themselves are unchanged —
//     bad config is still rejected, just via a catchable Error.
//
// Requiring this module does NOT call process.exit() under test: the load-time
// invocation below is gated on NODE_ENV !== 'test', so for production/dev the
// app still refuses to boot on bad config (index.js requires this module at
// startup), while `require('env')` stays side-effect-free under test. The
// function is also exported so index.js / tests can invoke it explicitly.
function validateEnvOrExit(source = process.env, nodeEnv = source && source.NODE_ENV) {
  // The `nodeEnv` argument selects WHICH checks apply (e.g. production secrets
  // are only required when nodeEnv === 'production'). The throw-vs-exit decision,
  // however, is driven by the ACTUAL running process so a unit test — which may
  // pass nodeEnv='production' to exercise the production-secret path — gets a
  // catchable Error rather than killing the Jest worker. The real Jest run sets
  // process.env.NODE_ENV === 'test'.
  const failClosedByThrow = process.env.NODE_ENV === 'test';
  const fail = (message) => {
    if (failClosedByThrow) {
      throw new Error(message);
    }
    console.error(`[env] ${message}`);
    process.exit(1);
  };

  const missing = required.filter((key) => !source[key]);
  if (missing.length > 0) {
    return fail(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (String(source.JWT_SECRET).length < 32) {
    return fail('JWT_SECRET must be at least 32 characters');
  }

  const missingProd = getMissingProductionSecrets(source, nodeEnv);
  if (missingProd.length > 0) {
    return fail(
      `Missing required production secrets (must be non-empty when NODE_ENV=production): ${missingProd.join(', ')}`
    );
  }

  try {
    parseSafetyPolicyConfig(source);
    validateFeatureDependencies(source);
  } catch (error) {
    return fail(error.message);
  }

  return true;
}

// Run the hard validation at module load for production/dev so the app refuses
// to boot on bad config. Skipped under test so `require('env')` never triggers
// process.exit(1); tests assert validateEnvOrExit() throws on bad input instead.
if (process.env.NODE_ENV !== 'test') {
  validateEnvOrExit(process.env, process.env.NODE_ENV);
}

// Build the safetyPolicy slice of the exported object. Under test this must not
// throw (require stays side-effect-free): if SAFETY_POLICY_MODE/_AT are invalid,
// validateEnvOrExit() is the authoritative rejecter, so fall back to a safe
// default here. Outside test, validateEnvOrExit() already exited above on bad
// values, so the parse below succeeds.
let safetyPolicyConfig;
try {
  safetyPolicyConfig = parseSafetyPolicyConfig(process.env);
} catch {
  safetyPolicyConfig = { mode: 'OBSERVE', enforcementAt: null };
}

const env = {
  db: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
  },
  line: {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
    channelSecret: process.env.LINE_CHANNEL_SECRET || '',
    liffId: process.env.LINE_LIFF_ID || '',
    groupId: process.env.LINE_GROUP_ID || '',
  },
  app: {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    cronApiKey: process.env.CRON_API_KEY || '',
    // Phase 10.12H — browser origins allowed to read the API cross-origin in
    // production. Override with CORS_ORIGINS (comma-separated). The SPA is
    // same-origin with the API, so these only matter for cross-origin callers.
    corsOrigins: (process.env.CORS_ORIGINS ||
      'https://schoolbuslampang.com,https://www.schoolbuslampang.com,https://schoolbus.lp-pao.go.th')
      .split(',').map((s) => s.trim()).filter(Boolean),
    timezone: process.env.TZ || 'Asia/Bangkok',
    currentTerm: process.env.CURRENT_TERM || '2568-2',
    // Hour (0-23, Bangkok time) at which the session switches morning → evening.
    // Before this hour = morning (ส่งเช้า). From this hour onward = evening (รับเย็น).
    driverSessionSwitchHour: parseInt(process.env.DRIVER_SESSION_SWITCH_HOUR || '12', 10),
  },
  safetyPolicy: safetyPolicyConfig,
  export: {
    pdfFontPath: process.env.PDF_FONT_PATH || './fonts/THSarabunNew.ttf',
  },
  // Vehicle-QR feature (PDPA 3-level access). Dark by default — when
  // featureVehicleQr is false the /api/qr + /api/consent routers are not mounted,
  // so the existing system is byte-for-byte unchanged.
  features: {
    vehicleQr: process.env.FEATURE_VEHICLE_QR === 'true',
    driverShiftSelection: process.env.FEATURE_DRIVER_SHIFT_SELECTION === 'true',
    qrLevel3: process.env.FEATURE_QR_LEVEL3 === 'true',   // Level-3 sensitive viewer (default off, DPO-gated)
    qrEmergencyContactSource: process.env.QR_EMERGENCY_CONTACT_SOURCE || 'driver', // driver | attendant | school
    // Phase 11A — Intelligent Tracking Layer (2026-06-23). Dark by default.
    // Each flag independently gates its router + the per-ping hooks in
    // driver.routes.js /vehicle-location, so operators can roll out one
    // capability at a time. Migration 040 must be applied before flipping
    // any of these on (index.js asserts this at boot).
    eta: process.env.FEATURE_ETA === 'true',
    geofence: process.env.FEATURE_GEOFENCE === 'true',
    routeDeviation: process.env.FEATURE_ROUTE_DEVIATION === 'true',
    // Phase 10.14 — driver-initiated vehicle registration roster + per-school
    // approval. Dark by default: when false the /api/{driver,school}/registrations
    // routers are not mounted, so the existing system is byte-for-byte unchanged.
    driverRegistration: process.env.FEATURE_DRIVER_REGISTRATION === 'true',
  },
  // Phase 11A — tunable thresholds for the intelligent tracking layer.
  // Exposed via env so operators can adjust without code changes.
  tracking: {
    locationHistoryRetentionDays: parseInt(process.env.LOCATION_HISTORY_RETENTION_DAYS || '30', 10),
    geofenceDefaultRadiusM: parseInt(process.env.GEOFENCE_DEFAULT_RADIUS_M || '150', 10),
    deviationRadiusM: parseInt(process.env.DEVIATION_RADIUS_M || '500', 10),
    delayThresholdMin: parseInt(process.env.DELAY_THRESHOLD_MIN || '10', 10),
    stalledThresholdMin: parseInt(process.env.STALLED_THRESHOLD_MIN || '15', 10),
    etaMinConfidenceSpeedMps: parseFloat(process.env.ETA_MIN_CONFIDENCE_SPEED_MPS || '1.5'),
    // Fallback speed when the driver app omits speed from the GPS ping.
    // Must be a realistic urban average, NOT the confidence threshold (1.5 m/s
    // is walking speed — using it as fallback makes ETAs unrealistically long).
    etaFallbackSpeedMps: parseFloat(process.env.ETA_FALLBACK_SPEED_MPS || '8'),
    baselineWindowDays: parseInt(process.env.BASELINE_WINDOW_DAYS || '14', 10),
    baselineSampleEveryM: parseInt(process.env.BASELINE_SAMPLE_EVERY_M || '200', 10),
  },
};

module.exports = env;
// Exposed for unit testing (pure, no side effects).
module.exports.getMissingProductionSecrets = getMissingProductionSecrets;
module.exports.parseSafetyPolicyConfig = parseSafetyPolicyConfig;
module.exports.validateFeatureDependencies = validateFeatureDependencies;
// Imperative hard validation. Runs automatically at module load for non-test
// environments (so the app refuses to boot on bad config); exported so it can be
// invoked explicitly too. Exits the process on bad config when NODE_ENV !==
// 'test', and throws (catchable) when NODE_ENV === 'test'.
module.exports.validateEnvOrExit = validateEnvOrExit;
