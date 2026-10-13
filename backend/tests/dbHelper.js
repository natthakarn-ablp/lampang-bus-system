'use strict';

/**
 * dbHelper.js — shared, GUARDED database access for integration tests.
 *
 * SAFETY-CRITICAL (defense-in-depth, issue #8): every integration test that
 * opens its own connection to run DELETE/TRUNCATE/INSERT MUST go through this
 * helper. Before any connection is created we call
 * assertDisposableTestDatabase(process.env), which throws unless:
 *   - NODE_ENV === 'test'
 *   - DB_NAME  === 'lampang_bus_test'
 *   - ALLOW_TEST_DB_RESET === 'true'
 *
 * This means no test file can reach the dev/production database even if the
 * env-loading layer (issue #7) were somehow misconfigured. The guard runs on
 * EVERY getTestConnection()/getTestPool() call.
 *
 * SQL sessions and date decoding use Bangkok, matching the application pool.
 * Otherwise CURDATE() fixture cleanup targets yesterday between00:00–07:00
 * Bangkok while application writes target today, causing cross-test leakage.
 */

const mysql = require('mysql2/promise');
const { assertDisposableTestDatabase } = require('../src/utils/testDatabaseGuard');

function testDbConfig(extra = {}) {
  return {
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    database: process.env.DB_NAME || 'lampang_bus',
    user:     process.env.DB_USER || 'lampang',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
    timezone: '+07:00',
    ...extra,
  };
}

/**
 * Open a single guarded mysql2/promise connection to the disposable test DB.
 * The guard is asserted BEFORE the socket is opened.
 * @param {object} [extra] additional mysql2 connection options
 * @returns {Promise<import('mysql2/promise').Connection>}
 */
async function getTestConnection(extra = {}) {
  assertDisposableTestDatabase(process.env);
  const conn = await mysql.createConnection(testDbConfig(extra));
  try {
    await conn.query("SET time_zone = '+07:00'");
    return conn;
  } catch (error) {
    await conn.end();
    throw error;
  }
}

/**
 * Create a guarded mysql2/promise pool against the disposable test DB.
 * The guard is asserted BEFORE the pool is created.
 * @param {object} [extra] additional mysql2 pool options
 * @returns {import('mysql2/promise').Pool}
 */
function getTestPool(extra = {}) {
  assertDisposableTestDatabase(process.env);
  const pool = mysql.createPool(testDbConfig(extra));
  pool.on('connection', conn => { conn.query("SET time_zone = '+07:00'"); });
  return pool;
}

module.exports = { getTestConnection, getTestPool, testDbConfig };
