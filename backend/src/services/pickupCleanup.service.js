'use strict';

// SCH-STU-7 (school audit 2026-11-08, owner-approved): a pupil's pickup-point
// assignment belongs to the vehicle that point is on. When the pupil changes
// vehicle, leaves the roll, is transferred out, graduates or an import is rolled
// back, the old student_pickup_points row stayed — the pupil kept showing at the
// old vehicle's stop. Every place that changes students.vehicle_id / is_deleted
// calls this right after, on the same connection (inside its transaction).
//
// Deletes, for the given pupils, every assignment whose point is not on the
// pupil's CURRENT vehicle (or all of them when the pupil has no vehicle or is
// deleted). Assignments that still match are kept.
async function clearStalePickupAssignments(db, studentIds) {
  const ids = (Array.isArray(studentIds) ? studentIds : [studentIds])
    .map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return 0;
  const [res] = await db.query(
    `DELETE spp FROM student_pickup_points spp
       JOIN pickup_points pp ON pp.id = spp.pickup_point_id
       JOIN students s ON s.id = spp.student_id
      WHERE spp.student_id IN (?)
        AND (s.is_deleted = TRUE OR s.vehicle_id IS NULL OR s.vehicle_id <> pp.vehicle_id)`,
    [ids]
  );
  return res && typeof res.affectedRows === 'number' ? res.affectedRows : 0;
}

module.exports = { clearStalePickupAssignments };
