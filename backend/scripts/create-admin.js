'use strict';

/**
 * create-admin.js
 *
 * Creates an admin user account safely.
 * Reads credentials from environment variables — never hardcoded.
 *
 * Usage (PowerShell):
 *   $env:ADMIN_USERNAME="admin"
 *   $env:ADMIN_PASSWORD="YourSecurePassword"
 *   $env:ADMIN_DISPLAY_NAME="ผู้ดูแลระบบ"
 *   npm run create:admin
 *
 * Requirements:
 *   - ADMIN_USERNAME (required)
 *   - ADMIN_PASSWORD (required, min 6 chars)
 *   - ADMIN_DISPLAY_NAME (optional, defaults to ADMIN_USERNAME)
 *   - Database must be running with users table + must_change_password column
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const BCRYPT_COST = 12;

async function main() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const displayName = process.env.ADMIN_DISPLAY_NAME || username;
  const forceChange = process.env.ADMIN_FORCE_PASSWORD_CHANGE !== 'false'; // default true

  // Validate inputs
  if (!username) {
    console.error('ERROR: ADMIN_USERNAME is required');
    console.error('Set it via: $env:ADMIN_USERNAME="admin"');
    process.exit(1);
  }
  if (!password) {
    console.error('ERROR: ADMIN_PASSWORD is required');
    console.error('Set it via: $env:ADMIN_PASSWORD="YourSecurePassword"');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error('ERROR: ADMIN_PASSWORD must be at least 6 characters');
    process.exit(1);
  }

  // Connect to DB
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    database: process.env.DB_NAME || 'lampang_bus',
    user: process.env.DB_USER || 'lampang',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4',
  });

  try {
    // Check if username already exists
    const [existing] = await conn.query(
      'SELECT id, role, is_deleted FROM users WHERE username = ?',
      [username]
    );

    if (existing.length > 0) {
      const user = existing[0];
      if (user.role === 'admin' && !user.is_deleted) {
        console.log(`Admin account "${username}" already exists (id=${user.id}). No changes made.`);
        process.exit(0);
      }
      if (user.role !== 'admin') {
        console.error(`ERROR: Username "${username}" already exists with role="${user.role}".`);
        console.error('Cannot override existing non-admin account. Choose a different username.');
        process.exit(1);
      }
      if (user.is_deleted) {
        // Reactivate deleted admin
        const hash = await bcrypt.hash(password, BCRYPT_COST);
        await conn.query(
          `UPDATE users SET password_hash = ?, display_name = ?, is_deleted = FALSE, deleted_at = NULL,
           is_active = TRUE, must_change_password = ? WHERE id = ?`,
          [hash, displayName, forceChange, user.id]
        );
        console.log(`Reactivated admin account "${username}" (id=${user.id})`);
        console.log(`  must_change_password: ${forceChange}`);
        process.exit(0);
      }
    }

    // Create new admin
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    const [result] = await conn.query(
      `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name, must_change_password)
       VALUES (?, ?, 'admin', 'PROVINCE', 'LPG', ?, ?)`,
      [username, hash, displayName, forceChange]
    );

    console.log('');
    console.log('Admin account created successfully!');
    console.log(`  ID:                    ${result.insertId}`);
    console.log(`  Username:              ${username}`);
    console.log(`  Display name:          ${displayName}`);
    console.log(`  Role:                  admin`);
    console.log(`  must_change_password:  ${forceChange}`);
    console.log('');
    console.log('The admin can now log in and will be directed to the province dashboard.');
    if (forceChange) {
      console.log('Password change will be required on first login.');
    }
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main();
