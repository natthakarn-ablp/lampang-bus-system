'use strict';

const mysql = require('mysql2/promise');
const env = require('./env');

const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.name,
  user: env.db.user,
  password: env.db.password,
  charset: 'utf8mb4',
  timezone: '+07:00',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
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
