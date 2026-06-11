// Phase 10.13B-9 — PM2 ecosystem config (crash-loop hardening).
//
// NOT yet adopted. The running process is currently started via `npm start`
// (pm_exec_path=/usr/bin/npm). This file documents a hardened start with
// backoff so a crash loop can't hammer the host. Env continues to come from
// backend/.env (loaded by the app via dotenv) — nothing secret is hardcoded.
//
// Adopt later, during a planned window, with:
//   pm2 delete schoolbus-backend
//   pm2 start ecosystem.config.js
//   pm2 save
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
