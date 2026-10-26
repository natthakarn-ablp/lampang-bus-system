'use strict';

/**
 * Regression test for the globalTeardown foreign-key ordering fix.
 *
 * THE BUG, as reproduced: tests/teardown.js deleted students with
 * `WHERE id = 99999`, but suites create their own students inside the test
 * school. One such row (id 99777, school_id '__TSCH') survived, so
 * `DELETE FROM schools WHERE id = '__TSCH'` failed with fk_students_school and
 * threw out of globalTeardown. Every delete after that line (affiliations)
 * never ran, and jest exited non-zero reporting only a bare foreign-key error
 * — with all 1463 tests passing. A green suite read as a red run.
 *
 * The same shape is reachable through any of the other FK chains in this
 * schema (emergency_logs.reported_by -> users is the next closest), which is
 * why the fix orders every cleanup step from the live FK graph rather than
 * patching the one statement that happened to break.
 *
 * computeDeleteOrder is the pure core of the fix: given the live FK graph it
 * must place every child table strictly before the parent it references.
 * DB-free by design, so it runs in `npm run test:unit` too.
 */

const { computeDeleteOrder } = require('./teardown');

// A faithful subset of the real lampang_bus_test foreign-key graph, taken from
// information_schema. Enough tables to cover the constraint that broke
// (fk_el_reported_by) plus the deeper chains around it.
const TABLES = [
  'affiliations',
  'audit_logs',
  'checkin_logs',
  'driver_vehicle_assignments',
  'drivers',
  'emergency_logs',
  'import_batches',
  'line_users',
  'notifications',
  'parent_student',
  'parents',
  'schools',
  'students',
  'users',
  'vehicle_inspection_applications',
  'vehicles',
];

const EDGES = [
  { child: 'schools',                         parent: 'affiliations' },
  { child: 'students',                        parent: 'schools' },
  { child: 'students',                        parent: 'vehicles' },
  { child: 'students',                        parent: 'import_batches' },
  { child: 'import_batches',                  parent: 'schools' },
  { child: 'checkin_logs',                    parent: 'students' },
  { child: 'checkin_logs',                    parent: 'vehicles' },
  { child: 'emergency_logs',                  parent: 'users' },     // fk_el_reported_by
  { child: 'emergency_logs',                  parent: 'vehicles' },  // fk_el_vehicle
  { child: 'users',                           parent: 'drivers' },
  { child: 'driver_vehicle_assignments',      parent: 'drivers' },
  { child: 'driver_vehicle_assignments',      parent: 'vehicles' },
  { child: 'driver_vehicle_assignments',      parent: 'users' },
  { child: 'line_users',                      parent: 'parents' },
  { child: 'line_users',                      parent: 'drivers' },
  { child: 'notifications',                   parent: 'line_users' },
  { child: 'parent_student',                  parent: 'parents' },
  { child: 'parent_student',                  parent: 'students' },
  { child: 'parent_student',                  parent: 'users' },
  // self-reference: vehicle_inspection_applications.superseded_by_id
  { child: 'vehicle_inspection_applications', parent: 'vehicle_inspection_applications' },
  { child: 'vehicle_inspection_applications', parent: 'users' },
  { child: 'vehicle_inspection_applications', parent: 'vehicles' },
];

function positions(order) {
  const at = new Map();
  order.forEach((table, i) => at.set(table, i));
  return at;
}

describe('teardown computeDeleteOrder', () => {
  test('deletes emergency_logs before users (the constraint that broke teardown)', () => {
    const at = positions(computeDeleteOrder(TABLES, EDGES));
    expect(at.get('emergency_logs')).toBeLessThan(at.get('users'));
    expect(at.get('emergency_logs')).toBeLessThan(at.get('vehicles'));
  });

  test('every child precedes every parent it references', () => {
    const at = positions(computeDeleteOrder(TABLES, EDGES));
    const violations = EDGES
      .filter((e) => e.child !== e.parent)
      .filter((e) => at.get(e.child) > at.get(e.parent))
      .map((e) => `${e.child} deleted after ${e.parent}`);
    expect(violations).toEqual([]);
  });

  test('covers the deeper chains: users -> drivers, students -> schools -> affiliations', () => {
    const at = positions(computeDeleteOrder(TABLES, EDGES));
    expect(at.get('users')).toBeLessThan(at.get('drivers'));
    expect(at.get('driver_vehicle_assignments')).toBeLessThan(at.get('users'));
    expect(at.get('students')).toBeLessThan(at.get('schools'));
    expect(at.get('schools')).toBeLessThan(at.get('affiliations'));
    expect(at.get('import_batches')).toBeLessThan(at.get('schools'));
    expect(at.get('notifications')).toBeLessThan(at.get('line_users'));
  });

  test('returns every table exactly once — nothing is skipped', () => {
    const order = computeDeleteOrder(TABLES, EDGES);
    expect(order.slice().sort()).toEqual(TABLES.slice().sort());
    expect(new Set(order).size).toBe(order.length);
  });

  test('is deterministic across calls', () => {
    expect(computeDeleteOrder(TABLES, EDGES)).toEqual(computeDeleteOrder(TABLES, EDGES));
  });

  test('a self-referencing FK does not remove the table from the order', () => {
    const order = computeDeleteOrder(TABLES, EDGES);
    expect(order).toContain('vehicle_inspection_applications');
  });

  test('tolerates a cycle instead of hanging or dropping tables', () => {
    const cyclic = [
      { child: 'a', parent: 'b' },
      { child: 'b', parent: 'a' },
      { child: 'c', parent: 'a' },
    ];
    const order = computeDeleteOrder(['a', 'b', 'c'], cyclic);
    expect(order.slice().sort()).toEqual(['a', 'b', 'c']);
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('a'));
  });

  test('skips identifiers that are not safe to interpolate into SQL', () => {
    const order = computeDeleteOrder(['users', 'bad-name', 'x`; DROP TABLE users; --'], []);
    expect(order).toEqual(['users']);
  });

  test('ignores edges naming a table outside the schema', () => {
    const order = computeDeleteOrder(['users'], [{ child: 'users', parent: 'not_a_table' }]);
    expect(order).toEqual(['users']);
  });

  test('handles an empty schema without throwing', () => {
    expect(computeDeleteOrder([], [])).toEqual([]);
    expect(computeDeleteOrder(['users'], undefined)).toEqual(['users']);
  });
});
