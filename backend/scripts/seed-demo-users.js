'use strict';

/**
 * seed-demo-users.js
 *
 * Creates the six demo accounts used for local UAT (demo123 password).
 * Idempotent — re-running reactivates + resets password to demo123.
 *
 * H5 safety guards:
 *   - Refuses to run when NODE_ENV=production.
 *   - Refuses to run unless DB_NAME looks like a dev/test database.
 *   - No hardcoded DB password fallback — DB_PASSWORD must come from .env.
 *   - Sets must_change_password=TRUE so the admin must set a real password
 *     on first login (even in dev, to build the habit).
 *
 * Usage:  node scripts/seed-demo-users.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const BCRYPT_COST = 12;
const DEFAULT_PASSWORD = 'demo123';

// H5: allowlist of DB name patterns that are safe for seeding demo data.
// Production databases must NOT match any of these.
const DEV_DB_PATTERNS = [/dev/i, /test/i, /uat/i, /staging/i, /local/i, /_new$/i];

const DEMO_USERS = [
  { username: 'demo_admin',     role: 'admin',       scope_type: null,        scope_id: null, display_name: 'UAT ผู้ดูแลระบบ' },
  { username: 'demo_province',  role: 'province',    scope_type: null,        scope_id: null, display_name: 'UAT ส่วนกลางจังหวัด' },
  { username: 'demo_aff',       role: 'affiliation', scope_type: 'AFFILIATION', scope_id: 'AFF001', display_name: 'UAT เขต 1' },
  { username: 'demo_sch1',      role: 'school',      scope_type: 'SCHOOL',      scope_id: 'SCH0001', display_name: 'UAT โรงเรียน 1' },
  { username: 'demo_transport', role: 'transport',   scope_type: null,        scope_id: null, display_name: 'UAT ขนส่ง' },
  { username: 'demo_drv',       role: 'driver',      scope_type: null,        scope_id: null, display_name: 'UAT คนขับทดสอบ' },
];

async function main() {
  // H5: refuse to run in production or against a database that doesn't look
  // like a dev/test DB.
  if (process.env.NODE_ENV === 'production') {
    console.error('REFUSING TO RUN: NODE_ENV=production — seed-demo-users must never run on prod.');
    process.exit(1);
  }
  const dbName = process.env.DB_NAME || '';
  if (!dbName) {
    console.error('REFUSING TO RUN: DB_NAME is not set — set it in .env explicitly.');
    process.exit(1);
  }
  if (!DEV_DB_PATTERNS.some((p) => p.test(dbName))) {
    console.error(`REFUSING TO RUN: DB_NAME "${dbName}" does not look like a dev/test database.`);
    console.error('Allowed patterns: dev, test, uat, staging, local, *_new');
    process.exit(1);
  }
  if (!process.env.DB_PASSWORD) {
    console.error('REFUSING TO RUN: DB_PASSWORD is not set — must come from .env, no hardcoded fallback.');
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    database: dbName,
    user: process.env.DB_USER || 'lampang_dev',
    password: process.env.DB_PASSWORD, // no fallback — H5
    charset: 'utf8mb4',
  });

  try {
    const hash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_COST);

    for (const u of DEMO_USERS) {
      const [existing] = await conn.query(
        'SELECT id, is_deleted FROM users WHERE username = ?',
        [u.username]
      );

      if (existing.length > 0) {
        await conn.query(
          `UPDATE users SET password_hash = ?, role = ?, scope_type = ?, scope_id = ?,
           display_name = ?, is_deleted = FALSE, deleted_at = NULL, is_active = TRUE,
           must_change_password = TRUE WHERE id = ?`,
          [hash, u.role, u.scope_type, u.scope_id, u.display_name, existing[0].id]
        );
        console.log(`[reactivated] ${u.username} (id=${existing[0].id}) — ${u.role} (must change password)`);
      } else {
        const [result] = await conn.query(
          `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name, must_change_password, is_active)
           VALUES (?, ?, ?, ?, ?, ?, TRUE, TRUE)`,
          [u.username, hash, u.role, u.scope_type, u.scope_id, u.display_name]
        );
        console.log(`[created] ${u.username} (id=${result.insertId}) — ${u.role} (must change password)`);
      }
    }

    // Link demo_drv to a real driver record if possible
    const [drvUser] = await conn.query("SELECT id FROM users WHERE username = 'demo_drv'");
    if (drvUser.length > 0) {
      const [drvRow] = await conn.query("SELECT id FROM drivers ORDER BY id LIMIT 1");
      if (drvRow.length > 0) {
        await conn.query('UPDATE users SET driver_id = ? WHERE id = ?', [drvRow[0].id, drvUser[0].id]);
        console.log(`[linked] demo_drv → driver_id=${drvRow[0].id}`);
      }
    }

    console.log('\nAll demo accounts ready. Password: ' + DEFAULT_PASSWORD);
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main();
