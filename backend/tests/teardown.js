'use strict';

/**
 * Jest globalTeardown — runs once after all test suites.
 * Removes all test data seeded by setup.js.
 * Order matters: FK children deleted before parents.
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

  // checkin_logs for the test vehicle (written during driver tests)
  await conn.query(`DELETE FROM checkin_logs   WHERE vehicle_id = 'V-test000000ab'`);
  await conn.query(`DELETE FROM daily_status   WHERE vehicle_id = 'V-test000000ab'`);
  await conn.query(`DELETE FROM emergency_logs WHERE vehicle_id = 'V-test000000ab'`);
  await conn.query(`DELETE FROM notifications  WHERE student_id = 99999`);
  await conn.query(`DELETE FROM audit_logs     WHERE entity_type IN ('checkin','emergency') AND entity_id IS NOT NULL`);

  // test student
  await conn.query(`DELETE FROM students WHERE id = 99999`);

  // driver assignment
  await conn.query(`DELETE FROM driver_vehicle_assignments WHERE vehicle_id = 'V-test000000ab'`);

  // test users
  await conn.query(
    `DELETE FROM users WHERE username IN ('__test_province', '__test_school', '__test_affiliation', '__TEST PLATE 9999')`
  );

  // test driver record (seeded by setup for the assignment — no FK to users now)
  await conn.query(`DELETE FROM drivers WHERE name = '__Test Driver'`);

  // test vehicle
  await conn.query(`DELETE FROM vehicles WHERE id = 'V-test000000ab'`);

  // test school + affiliation
  await conn.query(`DELETE FROM schools      WHERE id = '__TSCH'`);
  await conn.query(`DELETE FROM affiliations WHERE id = '__TAFF'`);

  await conn.end();
};
