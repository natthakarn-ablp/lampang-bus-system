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

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`[env] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('[env] JWT_SECRET must be at least 32 characters');
  process.exit(1);
}

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

const missingProd = getMissingProductionSecrets(process.env, process.env.NODE_ENV);
if (missingProd.length > 0) {
  console.error(
    `[env] Missing required production secrets (must be non-empty when NODE_ENV=production): ${missingProd.join(', ')}`
  );
  process.exit(1);
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
  export: {
    pdfFontPath: process.env.PDF_FONT_PATH || './fonts/THSarabunNew.ttf',
  },
  // Vehicle-QR feature (PDPA 3-level access). Dark by default — when
  // featureVehicleQr is false the /api/qr + /api/consent routers are not mounted,
  // so the existing system is byte-for-byte unchanged.
  features: {
    vehicleQr: process.env.FEATURE_VEHICLE_QR === 'true',
    qrLevel3: process.env.FEATURE_QR_LEVEL3 === 'true',   // Level-3 sensitive viewer (default off, DPO-gated)
    qrEmergencyContactSource: process.env.QR_EMERGENCY_CONTACT_SOURCE || 'driver', // driver | attendant | school
  },
};

module.exports = env;
// Exposed for unit testing (pure, no side effects).
module.exports.getMissingProductionSecrets = getMissingProductionSecrets;
