'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

const errorHandler = require('./middleware/errorHandler');
const authRoutes   = require('./routes/auth.routes');
const driverRoutes = require('./routes/driver.routes');
const schoolRoutes      = require('./routes/school.routes');
const affiliationRoutes = require('./routes/affiliation.routes');
const provinceRoutes    = require('./routes/province.routes');
const reportRoutes      = require('./routes/report.routes');

const app = express();

// ─── Security & parsing middleware ──────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use((req, res, next) => {
  // Skip JSON parsing for LINE webhook (needs raw body for signature verification)
  if (req.path === '/api/line/webhook') return next();
  express.json({ limit: '10mb' })(req, res, next);
});
app.use(express.urlencoded({ extended: true }));

// ─── Static uploads ─────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ success: true, message: 'OK', data: { uptime: process.uptime() } });
});

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth',   authRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/school',      schoolRoutes);
app.use('/api/affiliation', affiliationRoutes);
app.use('/api/province',    provinceRoutes);
app.use('/api/reports',     reportRoutes);

// Phase 7+ routes will be added here:
// app.use('/api/district',  require('./routes/district.routes'));
// app.use('/api/central',   require('./routes/central.routes'));
// app.use('/api/transport', require('./routes/transport.routes'));
// app.use('/api/parent',    require('./routes/parent.routes'));
app.use('/api/line',      require('./routes/line.routes'));
// app.use('/api/reports',   require('./routes/report.routes'));

// ─── 404 fallback ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found', errors: [], data: null });
});

// ─── Global error handler (must be last) ────────────────────────────────────
app.use(errorHandler);

module.exports = app;
