'use strict';

// Phase 10.13A-25 — read-only plate diagnostic.
// Usage:  node scripts/diagnose-plate.js <prefix> <number> <province> [schoolId]
// Example: node scripts/diagnose-plate.js นข 800 ลำปาง 52020039
//
// Outputs: canonical plate, conflict classification (A–F), existing owner
// (vehicle_id / display_plate / active|soft-deleted / school), whether it can be
// added, and the exact Thai message to show the operator. Never writes.

const { pool } = require('../src/config/database');
const PI = require('../src/utils/plateIdentity');

async function main() {
  const [prefix, number, province, schoolId] = process.argv.slice(2);
  if (!prefix || !number) {
    console.log('usage: node scripts/diagnose-plate.js <prefix> <number> <province> [schoolId]');
    process.exit(1);
  }
  const input = { plate_prefix: prefix, plate_number: number, province: province || '' };

  // All vehicles (active + soft-deleted) with a derived school (most-common
  // school of the students on that vehicle).
  const [vehicles] = await pool.query(
    `SELECT v.id, v.plate_no, v.is_deleted,
            (SELECT s.school_id FROM students s
              WHERE s.vehicle_id = v.id AND COALESCE(s.is_deleted, FALSE) = FALSE
              GROUP BY s.school_id ORDER BY COUNT(*) DESC LIMIT 1) AS school_id
     FROM vehicles v`
  );
  // attach school names
  const [schools] = await pool.query('SELECT id, name FROM schools');
  const nameOf = Object.fromEntries(schools.map((s) => [s.id, s.name]));
  vehicles.forEach((v) => { v.school_name = v.school_id ? nameOf[v.school_id] || null : null; });

  const r = PI.classifyVehiclePlateConflict(input, vehicles, { schoolId });
  const canAdd = r.code === 'VALID_NEW_VEHICLE';

  console.log('── Plate diagnostic ──');
  console.log('input            : ' + JSON.stringify(input) + (schoolId ? ' (school ' + schoolId + ')' : ''));
  console.log('canonical_plate  : ' + PI.buildCanonicalPlate(input));
  console.log('display_plate    : ' + PI.buildDisplayPlate(input));
  console.log('classification   : ' + r.code);
  console.log('can_add          : ' + (canAdd ? 'YES' : 'NO'));
  if (r.vehicle_id) {
    console.log('existing_owner   : ' + r.vehicle_id + " '" + r.display_plate + "' "
      + (r.is_deleted ? '[SOFT-DELETED]' : '[ACTIVE]')
      + (r.school_id ? ' school=' + r.school_id + (r.school_name ? " '" + r.school_name + "'" : '') : ''));
  }
  console.log('operator_message : ' + (r.message || '(none — valid new vehicle)'));
  await pool.end();
}

main().catch((e) => { console.error('diagnose-plate error:', e.message); process.exit(1); });
