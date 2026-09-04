'use strict';

/**
 * Jest globalTeardown — runs once after all test suites.
 * Removes all test data seeded by setup.js and by individual suites.
 *
 * WHY THIS IS NOT A HAND-ORDERED LIST OF DELETES ANY MORE
 * ------------------------------------------------------
 * It used to be, and the order was maintained by hand. That broke in a way
 * that was expensive to diagnose: a suite left one row in `students` inside the
 * test school (school_id = '__TSCH') that the teardown's `WHERE id = 99999` did
 * not match, so `DELETE FROM schools WHERE id = '__TSCH'` failed with
 * fk_students_school. globalTeardown threw, every delete after that line never
 * ran, and — the part that actually costs time — **jest exited non-zero even
 * though every test had passed**. A green suite reported as a red run, with a
 * bare foreign-key error and no indication of which table was holding on.
 *
 * So two things changed:
 *
 *   1. Order comes from the live foreign-key graph (computeDeleteOrder), not
 *      from the order someone typed the statements in. Adding a cleanup step
 *      in the wrong place can no longer break the run.
 *   2. A leftover row is reported by name — which table still references what —
 *      instead of surfacing as ER_ROW_IS_REFERENCED_2. The run still fails,
 *      deliberately: silent residue is what makes suite totals untrustworthy
 *      run over run, so it must stay loud.
 */

// Load .env.test FIRST (see tests/setup.js for the full rationale).
// globalTeardown runs in its own process where jest `setupFiles` does NOT
// apply, so the bootstrap must be required here explicitly.
require('./loadTestEnv');
require('dotenv').config();
const { assertDisposableTestDatabase } = require('../src/utils/testDatabaseGuard');
const mysql = require('mysql2/promise');

// The fixtures every suite builds on, seeded by setup.js.
const TEST_SCHOOL = '__TSCH';
const TEST_AFFILIATION = '__TAFF';
const TEST_VEHICLE = 'V-test000000ab';
const TEST_DRIVER_NAME = '__Test Driver';
// Suites add their own users on the same '__' prefix (numericPathParamValidation
// seeds '__test_admin_cs507'), so match the prefix rather than a fixed list —
// a list is exactly what fell behind before.
const TEST_USER_PREFIX = '\\_\\_%';

// A table name is interpolated into SQL, so it must be an identifier and
// nothing else. Anything that is not gets dropped rather than escaped: these
// names come from information_schema on a database we control, so a name that
// fails this test means something is wrong upstream, not that it needs quoting.
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Order tables so that every child is deleted before the parent it references.
 *
 * @param {string[]} tables  table names in the schema
 * @param {{child: string, parent: string}[]} edges  foreign keys, child -> parent
 * @returns {string[]} every safe table exactly once, children first
 *
 * Unsafe identifiers are dropped. Edges naming a table outside `tables` are
 * ignored, as are self-references (a self-FK cannot constrain the order of a
 * table against itself). A cycle is broken rather than hung on or silently
 * dropped — an unorderable table still has to be deleted, and the resulting
 * FK error is more useful than a table quietly missing from the teardown.
 */
function computeDeleteOrder(tables, edges) {
  const nodes = (tables || []).filter((t) => typeof t === 'string' && SAFE_IDENT.test(t));
  const present = new Set(nodes);

  const parentsOf = new Map(nodes.map((t) => [t, new Set()]));
  for (const e of edges || []) {
    if (!e) continue;
    const { child, parent } = e;
    if (child === parent) continue;
    if (!present.has(child) || !present.has(parent)) continue;
    parentsOf.get(child).add(parent);
  }

  // in-degree = number of distinct children that must go first
  const indegree = new Map(nodes.map((t) => [t, 0]));
  for (const [child, parents] of parentsOf) {
    for (const parent of parents) indegree.set(parent, indegree.get(parent) + 1);
    void child;
  }

  const order = [];
  const remaining = new Set(nodes);
  while (remaining.size > 0) {
    // Sorted so the same schema always produces the same order; a teardown that
    // varies run to run is not a teardown you can compare runs against.
    let ready = [...remaining].filter((t) => indegree.get(t) === 0).sort();
    if (ready.length === 0) ready = [[...remaining].sort()[0]];

    for (const table of ready) {
      order.push(table);
      remaining.delete(table);
      for (const parent of parentsOf.get(table)) {
        if (remaining.has(parent)) indegree.set(parent, indegree.get(parent) - 1);
      }
    }
  }
  return order;
}

/**
 * Ordering constraints the FK graph does not express.
 *
 * Three of the cleanup steps below select their rows through a subquery over a
 * table they have no foreign key to — deliberately, in the schema's design:
 * audit_logs must outlive the user it names, and daily_status / notifications
 * are denormalised caches. Without an ordering constraint the parent can be
 * deleted first, the subquery then matches nothing, and the rows stay behind
 * silently. That is how a stale audit_logs row for the CS5-07 probe student
 * survived into the next run and made its assertion count 1 instead of 0 — a
 * test failing on residue from the run before it, which is the exact failure
 * mode this file exists to prevent.
 */
const SUBQUERY_EDGES = [
  { child: 'audit_logs',      parent: 'users' },
  // revoked_tokens.user_id carries no foreign key either: a revocation has to
  // outlive the account it belonged to, or deleting a user would resurrect
  // every token they had ever revoked.
  { child: 'revoked_tokens',  parent: 'users' },
  { child: 'audit_logs',      parent: 'students' },
  { child: 'daily_status',    parent: 'students' },
  { child: 'notifications',   parent: 'students' },
];

/** Read the foreign-key graph of the connected database. */
async function readForeignKeys(conn, schema) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME AS child, REFERENCED_TABLE_NAME AS parent
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [schema]
  );
  return rows;
}

/**
 * The cleanup steps, one per table. Order here is irrelevant — it is recomputed
 * from the FK graph before anything runs.
 *
 * Scoping note: rows are matched by the fixture they belong to (the test
 * school, the test vehicle, the '__' user prefix), never by a single hard-coded
 * id. `students` is the case that broke: `WHERE id = 99999` missed every other
 * student a suite created inside the test school.
 */
const CLEANUP = [
  ['checkin_logs', 'DELETE FROM checkin_logs WHERE vehicle_id = ? OR student_id IN (SELECT id FROM students WHERE school_id = ?)', [TEST_VEHICLE, TEST_SCHOOL]],
  ['daily_status', 'DELETE FROM daily_status WHERE vehicle_id = ? OR student_id IN (SELECT id FROM students WHERE school_id = ?)', [TEST_VEHICLE, TEST_SCHOOL]],
  ['emergency_logs', `DELETE FROM emergency_logs WHERE vehicle_id = ? OR reported_by IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}')`, [TEST_VEHICLE]],
  ['notifications', 'DELETE FROM notifications WHERE student_id IN (SELECT id FROM students WHERE school_id = ?)', [TEST_SCHOOL]],
  ['student_leaves', 'DELETE FROM student_leaves WHERE vehicle_id = ? OR student_id IN (SELECT id FROM students WHERE school_id = ?)', [TEST_VEHICLE, TEST_SCHOOL]],
  ['student_pickup_points', 'DELETE FROM student_pickup_points WHERE student_id IN (SELECT id FROM students WHERE school_id = ?)', [TEST_SCHOOL]],
  ['roster_change_requests', 'DELETE FROM roster_change_requests WHERE school_id = ? OR vehicle_id = ? OR student_id IN (SELECT id FROM students WHERE school_id = ?)', [TEST_SCHOOL, TEST_VEHICLE, TEST_SCHOOL]],
  ['parent_student', `DELETE FROM parent_student WHERE student_id IN (SELECT id FROM students WHERE school_id = ?) OR approved_by IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}')`, [TEST_SCHOOL]],
  ['pickup_points', 'DELETE FROM pickup_points WHERE vehicle_id = ?', [TEST_VEHICLE]],
  ['vehicle_attendants', 'DELETE FROM vehicle_attendants WHERE vehicle_id = ?', [TEST_VEHICLE]],
  ['vehicle_latest_locations', 'DELETE FROM vehicle_latest_locations WHERE vehicle_id = ?', [TEST_VEHICLE]],
  ['vehicle_location_history', 'DELETE FROM vehicle_location_history WHERE vehicle_id = ?', [TEST_VEHICLE]],
  ['vehicle_operating_shifts', `DELETE FROM vehicle_operating_shifts WHERE vehicle_id = ? OR started_by IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}')`, [TEST_VEHICLE]],
  ['eta_predictions', 'DELETE FROM eta_predictions WHERE vehicle_id = ?', [TEST_VEHICLE]],
  ['geofence_events', 'DELETE FROM geofence_events WHERE vehicle_id = ?', [TEST_VEHICLE]],
  ['geofences', 'DELETE FROM geofences WHERE vehicle_id = ?', [TEST_VEHICLE]],
  ['route_baselines', 'DELETE FROM route_baselines WHERE vehicle_id = ?', [TEST_VEHICLE]],
  ['route_deviations', 'DELETE FROM route_deviations WHERE vehicle_id = ?', [TEST_VEHICLE]],
  ['vehicle_inspections', `DELETE FROM vehicle_inspections WHERE vehicle_id = ? OR certifying_school_id = ? OR inspected_by IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}')`, [TEST_VEHICLE, TEST_SCHOOL]],
  ['inspection_application_schools', 'DELETE FROM inspection_application_schools WHERE school_id = ?', [TEST_SCHOOL]],
  ['vehicle_inspection_applications', `DELETE FROM vehicle_inspection_applications WHERE vehicle_id = ? OR issuing_school_id = ? OR requested_by IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}')`, [TEST_VEHICLE, TEST_SCHOOL]],
  ['driver_vehicle_assignments', 'DELETE FROM driver_vehicle_assignments WHERE vehicle_id = ?', [TEST_VEHICLE]],
  ['driver_qualifications', 'DELETE FROM driver_qualifications WHERE driver_id IN (SELECT id FROM drivers WHERE name = ?)', [TEST_DRIVER_NAME]],
  ['driver_display_status', 'DELETE FROM driver_display_status WHERE driver_id IN (SELECT id FROM drivers WHERE name = ?)', [TEST_DRIVER_NAME]],
  ['driver_risk_records', 'DELETE FROM driver_risk_records WHERE driver_id IN (SELECT id FROM drivers WHERE name = ?)', [TEST_DRIVER_NAME]],
  ['line_users', 'DELETE FROM line_users WHERE driver_id IN (SELECT id FROM drivers WHERE name = ?)', [TEST_DRIVER_NAME]],
  ['participation_case_events', `DELETE FROM participation_case_events WHERE actor_user_id IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}')`, []],
  ['participation_cases', `DELETE FROM participation_cases WHERE initiated_by IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}')`, []],
  ['password_reset_requests', `DELETE FROM password_reset_requests WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}')`, []],
  ['user_recovery_channels', `DELETE FROM user_recovery_channels WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}')`, []],
  ['user_recovery_codes', `DELETE FROM user_recovery_codes WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}')`, []],
  ['import_batches', 'DELETE FROM import_batches WHERE school_id = ?', [TEST_SCHOOL]],
  ['students', 'DELETE FROM students WHERE school_id = ? OR id = 99999', [TEST_SCHOOL]],
  ['revoked_tokens', `DELETE FROM revoked_tokens WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}')`, []],
  ['users', `DELETE FROM users WHERE username LIKE '${TEST_USER_PREFIX}'`, []],
  ['drivers', 'DELETE FROM drivers WHERE name = ?', [TEST_DRIVER_NAME]],
  ['vehicles', 'DELETE FROM vehicles WHERE id = ?', [TEST_VEHICLE]],
  ['schools', 'DELETE FROM schools WHERE id = ?', [TEST_SCHOOL]],
  ['affiliations', 'DELETE FROM affiliations WHERE id = ?', [TEST_AFFILIATION]],
  // No foreign keys at all — an audit trail has to outlive what it describes.
  // Scoped by the acting user and the probe students instead, because the old
  // fixed entity_type list silently missed 'student' rows written by the
  // positive-control cases and they accumulated run over run.
  ['audit_logs', `DELETE FROM audit_logs
     WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}')
        OR (entity_type = 'student'
            -- entity_id is a varchar and CAST(id AS CHAR) comes back in the
            -- server default collation, which will not aggregate with the
            -- column's utf8mb4_unicode_ci. Compare as numbers instead, and
            -- guard the cast with a digits-only test so a non-numeric entity_id
            -- (audit_logs is shared with entity types keyed by string) is
            -- simply not matched rather than silently casting to 0.
            AND entity_id REGEXP '^[0-9]+$'
            AND CAST(entity_id AS UNSIGNED) IN (SELECT id FROM students WHERE school_id = ?))
        OR (entity_type IN ('checkin','emergency','leave','roster_request','driver')
            AND entity_id IS NOT NULL)`, [TEST_SCHOOL]],
];

/**
 * When a root delete still fails, say which table is holding the row. The bare
 * ER_ROW_IS_REFERENCED_2 names the constraint, not the row, and finding the
 * table by hand is the part that took the time.
 */
async function describeBlockers(conn, schema, parentTable) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME AS child, COLUMN_NAME AS col, CONSTRAINT_NAME AS name
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME = ?`,
    [schema, parentTable]
  );
  const blockers = [];
  for (const r of rows) {
    if (!SAFE_IDENT.test(r.child) || !SAFE_IDENT.test(r.col)) continue;
    const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${r.child}\` WHERE \`${r.col}\` IS NOT NULL`);
    if (n > 0) blockers.push(`${r.child}.${r.col} (${n} row${n === 1 ? '' : 's'}, ${r.name})`);
  }
  return blockers;
}

module.exports = async function globalTeardown() {
  assertDisposableTestDatabase(process.env);

  const schema = process.env.DB_NAME || 'lampang_bus';
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    database: schema,
    user:     process.env.DB_USER     || 'lampang',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
  });

  try {
    const edges = await readForeignKeys(conn, schema);
    const byTable = new Map(CLEANUP.map((step) => [step[0], step]));
    const order = computeDeleteOrder([...byTable.keys()], [...edges, ...SUBQUERY_EDGES]);

    const failures = [];
    for (const table of order) {
      const [, sql, params] = byTable.get(table);
      try {
        await conn.query(sql, params);
      } catch (err) {
        // A table this schema version does not have is not a failure — the
        // cleanup list covers every migration state the suite may run against.
        if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR') continue;
        if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
          const blockers = await describeBlockers(conn, schema, table).catch(() => []);
          failures.push(`${table}: ${err.code}; still referenced by ${blockers.join(', ') || '(could not determine)'}`);
          continue;
        }
        failures.push(`${table}: ${err.code || err.message}`);
      }
    }

    if (failures.length > 0) {
      // Loud on purpose. Residue that survives teardown changes what the next
      // run sees, so the run that produced it is the run that must report it.
      throw new Error(
        `globalTeardown left test data behind — the next run will not start from a clean database:\n  ${failures.join('\n  ')}`
      );
    }
  } finally {
    await conn.end();

    // Close the application pool to prevent Jest open-handle warnings
    try {
      const { pool } = require('../src/config/database');
      await pool.end();
    } catch { /* pool may not have been initialized */ }
  }
};

module.exports.computeDeleteOrder = computeDeleteOrder;
