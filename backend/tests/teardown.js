'use strict';

/**
 * Jest globalTeardown — runs once after all test suites.
 * Removes test users seeded by setup.js.
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

module.exports = async function globalTeardown() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    database: process.env.DB_NAME     || 'lampang_bus',
    user:     process.env.DB_USER     || 'lampang',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
  });

  await conn.query(
    `DELETE FROM users WHERE username IN ('__test_province', '__test_school', '__test_driver')`
  );

  await conn.end();
};
