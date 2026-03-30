'use strict';

/**
 * Jest globalSetup — runs once before all test suites.
 * Seeds a minimal test user into the database.
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

module.exports = async function globalSetup() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    database: process.env.DB_NAME     || 'lampang_bus',
    user:     process.env.DB_USER     || 'lampang',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
  });

  const hash = await bcrypt.hash('testpass123', 12);

  // Seed one user per role for tests
  const users = [
    { username: '__test_province', role: 'province', scope_type: 'PROVINCE', scope_id: 'LPG' },
    { username: '__test_school',   role: 'school',   scope_type: 'SCHOOL',   scope_id: 'SCH0001' },
    { username: '__test_driver',   role: 'driver',   scope_type: null,       scope_id: null },
  ];

  for (const u of users) {
    await conn.query(
      `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
      [u.username, hash, u.role, u.scope_type, u.scope_id, u.username]
    );
  }

  await conn.end();
};
