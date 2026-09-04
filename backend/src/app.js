'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const errorHandler = require('./middleware/errorHandler');
const { getBuildInfo, pingDatabaseWithTimeout, getEnvironment } = require('./utils/health');
const authRoutes   = require('./routes/auth.routes');
const driverRoutes = require('./routes/driver.routes');
const schoolRoutes      = require('./routes/school.routes');
const affiliationRoutes = require('./routes/affiliation.routes');
const provinceRoutes    = require('./routes/province.routes');
const reportRoutes      = require('./routes/report.routes');

const app = express();

const GLOBAL_API_LIMITED_PREFIXES = [
  '/api/driver',
  '/api/school',
  '/api/affiliation',
  '/api/province',
  '/api/transport',
  '/api/verification',
  '/api/documents',
  '/api/admin',
  '/api/readiness',
  '/api/terms',
  '/api/eta',
  '/api/geofences',
  '/api/route-deviations',
];

// ─── Proxy trust ────────────────────────────────────────────────────────────
// Production chain: client → Cloudflare → nginx (127.0.0.1) → backend.
// nginx appends `$remote_addr` (= Cloudflare edge IP) via
// proxy_add_x_forwarded_for, so XFF arrives as `<client>, <cf-edge>`.
// trust proxy = 1 strips the rightmost trusted entry (cf-edge), exposing the
// real client IP as req.ip for rate-limit keys + audit logs.
app.set('trust proxy', 1);

// ─── Security & parsing middleware ──────────────────────────────────────────
app.use(helmet());

// ─── CORS (Phase 10.12H) ─────────────────────────────────────────────────────
// Production: allow only the configured site origins (env CORS_ORIGINS).
// Non-production: reflect any origin for local dev. Requests without an Origin
// header (server-to-server: LINE webhook, health checks, monitors) always pass
// — CORS only governs what a browser may read cross-origin. Credentials are off
// (auth is a Bearer token in the Authorization header, never a cookie).
function isOriginAllowed(origin) {
  if (env.app.nodeEnv !== 'production') return true; // dev convenience
  if (!origin) return true;                          // non-browser / same-origin
  return env.app.corsOrigins.includes(origin);
}
app.use(cors({
  origin: (origin, cb) => cb(null, isOriginAllowed(origin)),
  credentials: false,
}));
app.use((req, res, next) => {
  // Skip JSON parsing for LINE webhook (needs raw body for signature verification)
  if (req.path === '/api/line/webhook') return next();
  express.json({ limit: '10mb' })(req, res, next);
});
app.use(express.urlencoded({ extended: true }));

// ─── Uploaded files are NOT served publicly (Phase 10.12F — closes H7) ───────
// Imported CSV/XLSX (student/parent PII) and driver photos live under
// ../uploads and must never be reachable without authorization. Block all
// direct /uploads access at the app layer and return a path-free 404.
// Defense-in-depth: in production nginx serves the SPA for this path and never
// proxies it to the backend; this also closes the exposure on a direct backend
// hit (e.g. 127.0.0.1:3000). A scoped, authenticated file-serving route can be
// added later if a feature needs it (e.g. driver photos).
app.use('/uploads', (_req, res) => {
  res.status(404).json({ success: false, message: 'Not found', errors: [], data: null });
});

// ─── Health check ────────────────────────────────────────────────────────────
// Phase 9.14 — enriched response: keeps existing { success, message, data:
// { uptime } } contract for old monitors, adds safe operational metadata
// (service, version, environment, node_version, commit, timestamp, and
// a bounded database-ping flag). Never exposes secrets, file paths, env
// values, or DB error details. HTTP 200 + success:true even when DB is
// down — caller probes data.database.connected for the DB signal.
app.get('/health', async (_req, res) => {
  const dbConnected = await pingDatabaseWithTimeout(1500);
  const build = getBuildInfo();
  res.json({
    success: true,
    message: 'OK',
    data: {
      service: build.service,
      version: build.version,
      environment: getEnvironment(),
      node_version: process.version,
      commit: build.commit,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: { connected: dbConnected },
    },
  });
});

// ─── Global rate-limit floor (Medium fix) ───────────────────────────────────
// A single authenticated token should not be able to hammer any API endpoint
// unchecked. The per-route limiters (login/refresh/export/webhook) stay in
// place; this is a catch-all floor for /api/{school,affiliation,province,
// transport,admin}/* and related authenticated operator routes. Generous enough
// for normal UI usage, tight enough to prevent pool exhaustion (pool=10).
const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 120,                  // 120 requests/min per IP — ~2/sec, plenty for UI
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, message: 'คำขอถี่เกินไป กรุณารอสักครู่', errors: [], data: null },
});

// Mount BEFORE the protected routers below. Keep it scoped so login, LINE
// webhook/LIFF parent endpoints, and report exports continue to use their own
// tighter/specialized limiters instead of sharing this generic UI floor.
app.use(GLOBAL_API_LIMITED_PREFIXES, globalApiLimiter);

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth',   authRoutes);
app.use('/api/auth/recovery', require('./routes/adminPasswordRecovery.routes'));

// ─── Phase 10.14 — Driver-initiated vehicle registration (feature-flagged) ───
// Mounted BEFORE the broad /api/driver and /api/school routers so the more
// specific /api/{driver,school}/registrations paths match first (a fall-through
// would otherwise run authenticate twice). Dark by default — when
// FEATURE_DRIVER_REGISTRATION is off these paths 404 and the existing routers
// are byte-for-byte unchanged. Migration 044 must be applied before flipping on.
if (env.features.driverRegistration) {
  const { driverRouter, schoolRouter } = require('./routes/registration.routes');
  app.use('/api/driver/registrations', driverRouter);
  app.use('/api/school/registrations', schoolRouter);
  // Scoped document viewing (vehicle/driver evidence). Real /api route, so it is
  // NOT caught by the /uploads 404 wall below and nginx won't shadow it.
  app.use('/api/documents', require('./routes/documents.routes'));
}

app.use('/api/driver', driverRoutes);
app.use('/api/school',      schoolRoutes);
app.use('/api/affiliation', affiliationRoutes);
app.use('/api/province',    provinceRoutes);
// Audit 2026-06-18 (config-infra-dos): the report/export endpoints build full
// datasets in memory and were unthrottled. Cap them so a single authenticated
// user can't hammer expensive exports. Skipped under test.
const exportLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, message: 'ขอรายงานถี่เกินไป กรุณารอสักครู่', errors: [], data: null },
});
app.use('/api/reports',     exportLimiter, reportRoutes);

// ─── Phase 7+ routes ────────────────────────────────────────────────────────
app.use('/api/transport', require('./routes/transport.routes'));
app.use('/api/verification', require('./routes/verification.routes'));
app.use('/api/parent',    require('./routes/parent.routes'));
app.use('/api/line',      require('./routes/line.routes'));
app.use('/api/admin',     require('./routes/admin.routes'));

// `/api/visits/track` is public and unauthenticated by design (aggregate
// counter, no PII, deduped per browser session by the frontend). That also made
// it the only completely unlimited write path in the API: a curl loop could
// inflate daily_visits without bound and write a row per request against a
// single 2 GB instance. It gets its own limiter rather than joining the
// operator floor, so anonymous public traffic and authenticated operator
// traffic from one NAT'd school do not share a bucket. The UI fires this about
// once per browser session, so 30/min per IP is far above real usage.
const visitsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, message: 'คำขอถี่เกินไป กรุณารอสักครู่', errors: [], data: null },
});
app.use('/api/visits', visitsLimiter, require('./routes/visits.routes'));
app.use('/api/readiness', require('./routes/readiness.routes'));
app.use('/api/terms',     require('./routes/terms.routes'));

// ─── Vehicle QR + consent (feature-flagged; dark by default) ─────────────────
// Mounted ONLY when FEATURE_VEHICLE_QR=true. When off, these paths 404 and the
// existing system is byte-for-byte unchanged (true dark launch).
if (env.features.vehicleQr) {
  app.use('/api/qr',      require('./routes/qr.routes'));
  // Every parent-facing consent request costs an outbound LINE id_token
  // verification, so an unlimited consent router would let anyone spend the
  // channel's quota. `qr.routes.js` already carries its own limiter; consent
  // shipped without one and must not stay that way when Phase 7 turns the flag
  // on. Sized for a real parent session (grant, withdraw, re-read), not a loop.
  const consentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    message: { success: false, message: 'คำขอถี่เกินไป กรุณารอสักครู่', errors: [], data: null },
  });
  app.use('/api/consent', consentLimiter, require('./routes/consent.routes'));
}

// ─── Phase 11A — Intelligent Tracking Layer (2026-06-23) ─────────────────────
// Three feature-flagged routers: ETA predictions, geofencing, and route
// deviation detection. Each flag is independent so operators can roll out
// one capability at a time. Migration 040 must be applied before flipping
// any of these on (index.js asserts this at boot). When a flag is off the
// corresponding paths 404 and the per-ping hooks in driver.routes.js skip
// the relevant check, so the existing system is byte-for-byte unchanged.
if (env.features.eta) {
  app.use('/api/eta', require('./routes/eta.routes'));
}
if (env.features.geofence) {
  app.use('/api/geofences', require('./routes/geofence.routes'));
}
if (env.features.routeDeviation) {
  app.use('/api/route-deviations', require('./routes/routeDeviation.routes'));
}

// ─── Serve frontend build in production ──────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  // ─── 404 fallback (dev only — frontend has its own dev server) ─────────
  app.use((_req, res) => {
    res.status(404).json({ success: false, message: 'Route not found', errors: [], data: null });
  });
}

// ─── Global error handler (must be last) ────────────────────────────────────
app.use(errorHandler);

module.exports = app;
// Exposed for unit testing the CORS allow-list.
module.exports.isOriginAllowed = isOriginAllowed;
module.exports.GLOBAL_API_LIMITED_PREFIXES = GLOBAL_API_LIMITED_PREFIXES;
