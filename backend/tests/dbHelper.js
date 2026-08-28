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
 * Connection params mirror exactly what the test files previously passed to
 * mysql.createConnection(...), PLUS the +07:00 session timezone the application
 * pool pins (src/config/database.js).
 *
 * The timezone is not cosmetic. The app writes checkin_logs.check_date and
 * daily_status.check_date with CURDATE() on a +07:00 connection, i.e. the
 * Bangkok day. A test connection left on the server default (UTC) evaluates
 * CURDATE() as the UTC day, and the two differ from 00:00 to 07:00 Bangkok
 * (17:00–24:00 UTC). During those seven hours every
 * `DELETE ... WHERE check_date = CURDATE()` cleanup in the suite matched
 * nothing: rows written "today" by the app survived into the next test, whose
 * check-in then hit the duplicate guard and returned 409, and globalTeardown
 * finally failed on the checkin_logs → students foreign key. Pinning the same
 * offset here makes "today" mean one thing across the suite.
 */

const mysql = require('mysql2/promise');
const { assertDisposableTestDatabase } = require('../src/utils/testDatabaseGuard');
const { DB_TIMEZONE } = require('../src/config/dbTimezone');

function testDbConfig(extra = {}) {
  return {
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    database: process.env.DB_NAME || 'lampang_bus',
    user:     process.env.DB_USER || 'lampang',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
    timezone: DB_TIMEZONE,
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
  // mysql2's `timezone` option only converts DATE/DATETIME values on the way in
  // and out; the server-side date functions follow the SESSION time_zone, so it
  // has to be set explicitly — same as pool.on('connection') in src/config/database.js.
  await conn.query(`SET time_zone = '${DB_TIMEZONE}'`);
  return conn;
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
  // Queued before any user query on each new connection, so it always applies first.
  pool.on('connection', (conn) => {
    conn.query(`SET time_zone = '${DB_TIMEZONE}'`);
  });
  return pool;
}

module.exports = { getTestConnection, getTestPool, testDbConfig };
