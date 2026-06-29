// Phase 10.13B-9 + 10.15B — PM2 ecosystem config (crash-loop hardening).
//
// Adopted on 2026-06-29. Provides crash-loop hardening, memory cap, and
// exponential backoff. Env continues to come from backend/.env (loaded by the
// app via dotenv) — nothing secret is hardcoded.
//
// To start after a server reboot:
//   pm2 start ecosystem.config.js
//   pm2 save
//
// To reload after code changes:
//   pm2 reload ecosystem.config.js
// Then verify /health is GREEN and `pm2 logs schoolbus-backend` is clean.

module.exports = {
  apps: [
    {
      name: 'schoolbus-backend',
      cwd: '/home/schoolbus/apps/lampang-bus-system/backend',
      script: 'src/index.js',
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '500M',
      error_file: '/home/schoolbus/logs/schoolbus-backend.error.log',
      out_file: '/home/schoolbus/logs/schoolbus-backend.out.log',
      time: true,
      env: {
        NODE_ENV: 'production',
        // All other config (DB, JWT, LINE, …) is read from backend/.env by the app.
      },
    },
  ],
};
