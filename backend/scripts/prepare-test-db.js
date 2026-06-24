'use strict';

// Load .env.test FIRST so this destructive prep script targets the disposable
// lampang_bus_test database (and the guard below passes). This script runs as a
// standalone `node` process — jest `setupFiles` does NOT apply here, so the
// bootstrap must be required explicitly. dotenv never overrides already-set
// vars, so the safe values win over the real .env.
require('../tests/loadTestEnv');
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { assertDisposableTestDatabase } = require('../src/utils/testDatabaseGuard');

const SCHEMA_PATH = path.join(__dirname, '../tests/schema.sql');

function readRawSchema() {
  return fs.readFileSync(SCHEMA_PATH, 'utf8');
}

function loadSchema(raw) {
  // The schema is a mysqldump-style file. mysqldump emits DEFINER clauses for
  // VIEWs/TRIGGERs that reference a user that won't exist in the test MySQL
  // instance, which makes the import fail. These regexes strip them.
  //
  // NOTE: the current schema.sql contains NO views/triggers, so these match
  // nothing today — they are kept as a safety net so that if a future
  // mysqldump adds a view/trigger, the regenerated schema still imports
  // cleanly without a manual edit.
  return raw
    // mysqldump conditional-comment forms: /*!50013 DEFINER=`u`@`h` SQL SECURITY DEFINER */
    .replace(/\/\*!50013 DEFINER=`[^`]+`@`[^`]+` SQL SECURITY DEFINER \*\//g, '')
    // /*!50017 DEFINER=`u`@`h`*/ and the /*!50117 ...*/ trigger form
    .replace(/\/\*!\d{5} DEFINER=`[^`]+`@`[^`]+`\*\//g, '')
    // Bare DEFINER=`u`@`h` on CREATE VIEW / CREATE TRIGGER (non-comment form)
    .replace(/\sDEFINER=`[^`]+`@`[^`]+`/g, ' ');
}

/**
 * Derive the expected table count from the schema itself so that adding a
 * future CREATE TABLE does not silently break prep (was a brittle hardcoded
 * `!== 47`). We count top-level `CREATE TABLE` statements.
 */
function expectedTableCount(raw) {
  const matches = raw.match(/^\s*CREATE TABLE\b/gim);
  return matches ? matches.length : 0;
}

async function main() {
  assertDisposableTestDatabase(process.env);

  const raw = readRawSchema();
  const expectedTables = expectedTableCount(raw);
  if (expectedTables < 1) {
    throw new Error(`Could not derive table count from schema.sql (found ${expectedTables})`);
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
  });
  await connection.query('DROP DATABASE IF EXISTS `lampang_bus_test`');
  await connection.query('CREATE DATABASE `lampang_bus_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await connection.changeUser({ database: 'lampang_bus_test' });
  await connection.query(loadSchema(raw));
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='lampang_bus_test'"
  );
  if (Number(row.n) !== expectedTables) {
    throw new Error(`Expected ${expectedTables} tables (from schema.sql), found ${row.n}`);
  }
  await connection.end();
  console.log(`[test-db] ready: lampang_bus_test (${expectedTables} tables)`);
}

main().catch((error) => { console.error('[test-db]', error.message); process.exit(1); });
