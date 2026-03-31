'use strict';

const env = require('./config/env');
const { testConnection } = require('./config/database');
const app = require('./app');

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
