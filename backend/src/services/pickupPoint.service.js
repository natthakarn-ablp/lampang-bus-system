'use strict';

const { pool } = require('../config/database');

/* ─────────────────────────────────────────────────────────────────────────
 * Read functions (driver + school)
 *
 * Both return points + assigned students bundled into one row via
 * JSON_ARRAYAGG (MySQL 8). Students[] contains only first/last/grade/
 * classroom — no PII, no phone, no cid_hash.
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * getPickupPointsForVehicle — driver-scope read.
 * Returns all non-deleted pickup points for the given vehicle, with
 * the assigned students embedded per point.
 */
async function getPickupPointsForVehicle(vehicleId, { session = null } = {}) {
  const params = [vehicleId];
  let sessionFilter = '';
  if (session === 'morning' || session === 'evening') {
    sessionFilter = ` AND pp.session IN (?, 'both')`;
    params.push(session);
  }

  const [rows] = await pool.query(`
    SELECT
      pp.id, pp.sequence, pp.label, pp.latitude, pp.longitude,
      pp.session, pp.notes,
      COALESCE(
        (SELECT JSON_ARRAYAGG(
           JSON_OBJECT(
             'id', s.id,
             'first_name', s.first_name,
             'last_name', s.last_name,
             'grade', s.grade,
             'classroom', s.classroom
           )
         )
         FROM student_pickup_points spp
         JOIN students s ON s.id = spp.student_id AND s.is_deleted = FALSE
         WHERE spp.pickup_point_id = pp.id),
        JSON_ARRAY()
      ) AS students
    FROM pickup_points pp
    WHERE pp.vehicle_id = ? AND pp.is_deleted = FALSE${sessionFilter}
    ORDER BY pp.sequence ASC, pp.id ASC
  `, params);

  return rows.map(normalizePoint);
}

/**
 * getPickupPointsForSchool — school-scope read.
 * Returns pickup points that serve at least one student in this school's
 * roster. The student[] inside each point is filtered to only this
 * school's students — cross-school students at the same physical point
 * are NOT exposed to the school.
 */
async function getPickupPointsForSchool(schoolId, { session = null } = {}) {
  const params = [schoolId, schoolId];   // bound twice (inner + EXISTS)
  let sessionFilter = '';
  if (session === 'morning' || session === 'evening') {
    sessionFilter = ` AND pp.session IN (?, 'both')`;
    params.push(session);
  }

  const [rows] = await pool.query(`
    SELECT
      pp.id, pp.sequence, pp.label, pp.latitude, pp.longitude,
      pp.session, pp.notes,
      pp.vehicle_id,
      v.plate_no,
      COALESCE(
        (SELECT JSON_ARRAYAGG(
           JSON_OBJECT(
             'id', s.id,
             'first_name', s.first_name,
             'last_name', s.last_name,
             'grade', s.grade,
             'classroom', s.classroom
           )
         )
         FROM student_pickup_points spp
         JOIN students s ON s.id = spp.student_id AND s.is_deleted = FALSE
                       AND s.school_id = ?
         WHERE spp.pickup_point_id = pp.id),
        JSON_ARRAY()
      ) AS students
    FROM pickup_points pp
    LEFT JOIN vehicles v ON v.id = pp.vehicle_id
    WHERE pp.is_deleted = FALSE${sessionFilter}
      AND EXISTS (
        SELECT 1 FROM student_pickup_points spp2
        JOIN students s2 ON s2.id = spp2.student_id AND s2.is_deleted = FALSE
                       AND s2.school_id = ?
        WHERE spp2.pickup_point_id = pp.id
      )
    ORDER BY v.plate_no ASC, pp.sequence ASC, pp.id ASC
  `, params);

  return rows.map(normalizePoint);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────────────────────────────────── */

// mysql2 typically auto-parses JSON columns, but be defensive in case the
// driver returns a string (varies by version). Also coerce lat/lng to
// JS numbers so the API response is consistent.
function normalizePoint(row) {
  let students = row.students;
  if (typeof students === 'string') {
    try { students = JSON.parse(students); } catch { students = []; }
  }
  return {
    ...row,
    latitude: row.latitude == null ? null : parseFloat(row.latitude),
    longitude: row.longitude == null ? null : parseFloat(row.longitude),
    students: Array.isArray(students) ? students : [],
  };
}

module.exports = {
  getPickupPointsForVehicle,
  getPickupPointsForSchool,
};
