'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

const errorHandler = require('./middleware/errorHandler');
const { getBuildInfo, pingDatabaseWithTimeout, getEnvironment } = require('./utils/health');
const authRoutes   = require('./routes/auth.routes');
const driverRoutes = require('./routes/driver.routes');
const schoolRoutes      = require('./routes/school.routes');
const affiliationRoutes = require('./routes/affiliation.routes');
const provinceRoutes    = require('./routes/province.routes');
const reportRoutes      = require('./routes/report.routes');

const app = express();

// ─── Proxy trust ────────────────────────────────────────────────────────────
// Production chain: client → Cloudflare → nginx (127.0.0.1) → backend.
// nginx appends `$remote_addr` (= Cloudflare edge IP) via
// proxy_add_x_forwarded_for, so XFF arrives as `<client>, <cf-edge>`.
// trust proxy = 1 strips the rightmost trusted entry (cf-edge), exposing the
// real client IP as req.ip for rate-limit keys + audit logs.
app.set('trust proxy', 1);

// ─── Security & parsing middleware ──────────────────────────────────────────
app.use(helmet());
app.use(cors());
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

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth',   authRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/school',      schoolRoutes);
app.use('/api/affiliation', affiliationRoutes);
app.use('/api/province',    provinceRoutes);
app.use('/api/reports',     reportRoutes);

// ─── Phase 7+ routes ────────────────────────────────────────────────────────
app.use('/api/transport', require('./routes/transport.routes'));
app.use('/api/parent',    require('./routes/parent.routes'));
app.use('/api/line',      require('./routes/line.routes'));
app.use('/api/admin',     require('./routes/admin.routes'));
app.use('/api/visits',    require('./routes/visits.routes'));

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
