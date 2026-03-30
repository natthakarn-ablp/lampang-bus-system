'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const env = require('./config/env');
const { testConnection } = require('./config/database');
const errorHandler = require('./middleware/errorHandler');
const authRoutes   = require('./routes/auth.routes');
const driverRoutes = require('./routes/driver.routes');

const app = express();

// ─── Security & parsing middleware ──────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ success: true, message: 'OK', data: { uptime: process.uptime() } });
});

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth',   authRoutes);
app.use('/api/driver', driverRoutes);

// Phase 3+ routes will be added here:
// app.use('/api/school',    require('./routes/school.routes'));
// app.use('/api/district',  require('./routes/district.routes'));
// app.use('/api/central',   require('./routes/central.routes'));
// app.use('/api/transport', require('./routes/transport.routes'));
// app.use('/api/parent',    require('./routes/parent.routes'));
// app.use('/api/line',      require('./routes/line.routes'));
// app.use('/api/reports',   require('./routes/report.routes'));

// ─── 404 fallback ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found', errors: [], data: null });
});

// ─── Global error handler (must be last) ────────────────────────────────────
app.use(errorHandler);

// ─── Start ───────────────────────────────────────────────────────────────────
async function start() {
  await testConnection();
  app.listen(env.app.port, () => {
    console.log(`[app] Lampang Bus System API running on port ${env.app.port}`);
    console.log(`[app] Environment: ${env.app.nodeEnv}`);
  });
}

start().catch((err) => {
  console.error('[app] Failed to start:', err.message);
  process.exit(1);
});

module.exports = app; // exported for tests
