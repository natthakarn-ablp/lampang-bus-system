'use strict';

/**
 * Jest globalSetup — runs once before all test suites.
 * Seeds minimal test data for auth and driver tests.
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
    multipleStatements: true,
  });

  const hash = await bcrypt.hash('testpass123', 12);

  // ── Test affiliation & school (required by student FK) ──────────────────
  await conn.query(`
    INSERT INTO affiliations (id, name)
    VALUES ('__TAFF', '__Test Affiliation')
    ON DUPLICATE KEY UPDATE name = VALUES(name)
  `);

  await conn.query(`
    INSERT INTO schools (id, name, affiliation_id)
    VALUES ('__TSCH', '__Test School', '__TAFF')
    ON DUPLICATE KEY UPDATE name = VALUES(name)
  `);

  // ── Test vehicle ─────────────────────────────────────────────────────────
  // plate_no MUST match the __test_driver username — resolution is plate_no = username
  await conn.query(`
    INSERT INTO vehicles (id, plate_no, vehicle_type)
    VALUES ('V-test000000ab', '__TEST PLATE 9999', 'รถตู้')
    ON DUPLICATE KEY UPDATE plate_no = VALUES(plate_no)
  `);

  // ── Test driver record ───────────────────────────────────────────────────
  const [driverResult] = await conn.query(`
    INSERT INTO drivers (name, phone)
    VALUES ('__Test Driver', '0000000001')
    ON DUPLICATE KEY UPDATE phone = VALUES(phone)
  `);
  let driverId = driverResult.insertId;
  if (driverId === 0) {
    const [rows] = await conn.query(
      "SELECT id FROM drivers WHERE name = '__Test Driver' LIMIT 1"
    );
    driverId = rows[0].id;
  }
  // Store driverId for teardown reference (write to process.env so teardown can read it)
  process.env.__TEST_DRIVER_ID = String(driverId);

  // ── Test users ───────────────────────────────────────────────────────────
  // __test_driver username = plate_no of test vehicle — required by new resolution strategy
  const users = [
    { username: '__test_province',    role: 'province',    scope_type: 'PROVINCE',    scope_id: 'LPG'     },
    { username: '__test_school',     role: 'school',      scope_type: 'SCHOOL',      scope_id: '__TSCH'  },
    { username: '__test_affiliation',role: 'affiliation', scope_type: 'AFFILIATION', scope_id: '__TAFF'  },
    { username: '__TEST PLATE 9999', role: 'driver',      scope_type: null,          scope_id: null      },
  ];

  for (const u of users) {
    await conn.query(
      `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         password_hash = VALUES(password_hash)`,
      [u.username, hash, u.role, u.scope_type, u.scope_id, u.username]
    );
  }

  // ── Driver → vehicle assignment ──────────────────────────────────────────
  await conn.query(`
    INSERT INTO driver_vehicle_assignments (driver_id, vehicle_id, term_id, start_date, is_active)
    VALUES (?, 'V-test000000ab', '2568-2', CURDATE(), TRUE)
    ON DUPLICATE KEY UPDATE is_active = TRUE
  `, [driverId]);

  // ── Test student assigned to the test vehicle ────────────────────────────
  await conn.query(`
    INSERT INTO students
      (id, cid_hash, prefix, first_name, last_name, grade, classroom,
       school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
    VALUES
      (99999, SHA2('1234567890123', 256), 'เด็กชาย', '__Test', 'Student', 'ป.1', '1',
       '__TSCH', 'V-test000000ab', TRUE, TRUE, '2568-2')
    ON DUPLICATE KEY UPDATE
      vehicle_id = 'V-test000000ab',
      school_id  = '__TSCH'
  `);

  await conn.end();
};
