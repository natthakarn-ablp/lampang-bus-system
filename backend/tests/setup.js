'use strict';

/**
 * Jest globalSetup — runs once before all test suites.
 * Seeds minimal test data for auth and driver tests.
 */

// Load .env.test FIRST so the safe DB_NAME=lampang_bus_test / NODE_ENV=test
// values win. globalSetup runs in its own process where jest `setupFiles`
// does NOT apply, so we must require the bootstrap here explicitly. The
// subsequent dotenv.config() reads the real .env but cannot override these.
require('./loadTestEnv');
require('dotenv').config();
const { assertDisposableTestDatabase } = require('../src/utils/testDatabaseGuard');
// Opens the connection through the shared helper so the seed sees the SAME
// "today" (+07:00 CURDATE()) the application writes — see tests/dbHelper.js.
const { getTestConnection } = require('./dbHelper');
const bcrypt = require('bcrypt');

module.exports = async function globalSetup() {
  assertDisposableTestDatabase(process.env);

  const conn = await getTestConnection({ multipleStatements: true });

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
  // plate_no MUST match the __test_driver username — resolution is plate_no = username.
  // Phase 10.6B — normalized_plate becomes NOT NULL UNIQUE in migration 024, so
  // raw fixture INSERTs must supply it explicitly (computed via the same rule
  // as utils/vehiclePlate.normalizePlate: lowercase + strip whitespace + dashes).
  await conn.query(`
    INSERT INTO vehicles (id, plate_no, normalized_plate, vehicle_type)
    VALUES ('V-test000000ab', '__TEST PLATE 9999', '__testplate9999', 'รถตู้')
    ON DUPLICATE KEY UPDATE
      plate_no         = VALUES(plate_no),
      normalized_plate = VALUES(normalized_plate)
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
