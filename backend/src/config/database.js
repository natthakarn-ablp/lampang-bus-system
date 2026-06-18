'use strict';

const mysql = require('mysql2/promise');
const env = require('./env');

// ── Timezone (audit 2026-06-18, HIGH) ────────────────────────────────────────
// The MySQL server runs in UTC, but ALL "today" reads compute the Bangkok date in
// JS. Writes used bare CURDATE()/NOW() (UTC), so between 00:00–07:00 Bangkok the
// write day and the read day disagreed: morning check-ins were mis-dated and a
// student's morning/evening rows split across two daily_status keys, permanently
// corrupting attendance. Fix: pin every pooled connection to +07:00 so CURDATE()/
// NOW() mean the Bangkok day, matching the read path. Because mysql2's `timezone`
// is set to the SAME offset, absolute TIMESTAMP values (created_at, checked_at,
// password_changed_at) are unchanged — only the server-side date functions shift.
// OPS: verify on the live DB after deploy: `SELECT CURDATE(), NOW(), @@session.time_zone;`
const DB_TIMEZONE = '+07:00';

const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.name,
  user: env.db.user,
  password: env.db.password,
  charset: 'utf8mb4',
  timezone: DB_TIMEZONE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  // Fail fast instead of hanging forever if the DB is unreachable (config-infra).
  connectTimeout: 10 * 1000,
});

// Set the session timezone on every new pooled connection so CURDATE()/NOW()
// evaluate in Bangkok time. mysql2 queues this before any user query on the
// connection, so it always applies first.
pool.on('connection', (conn) => {
  conn.query(`SET time_zone = '${DB_TIMEZONE}'`);
});

/**
 * Verify that the database connection is working.
 * Called on application startup.
 */
async function testConnection() {
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
  console.log(`[db] Connected to MySQL at ${env.db.host}:${env.db.port}/${env.db.name}`);
}

module.exports = { pool, testConnection };
