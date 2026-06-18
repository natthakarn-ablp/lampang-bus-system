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

// ─── Start ───────────────────────────────────────────────────────────────────
async function start() {
  await testConnection();
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
