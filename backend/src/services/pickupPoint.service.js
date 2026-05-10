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

/* ─────────────────────────────────────────────────────────────────────────
 * Admin CRUD
 *
 * Routes own input validation + audit logging; services own DB work +
 * existence checks. Service functions return null on not-found so the
 * route can decide between 404 vs throwing.
 * ───────────────────────────────────────────────────────────────────────── */

async function listPickupPoints({ vehicle_id, page = 1, per_page = 50 } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const pp = Math.min(100, Math.max(1, parseInt(per_page, 10) || 50));
  const offset = (p - 1) * pp;

  let where = 'pp.is_deleted = FALSE';
  const params = [];
  if (vehicle_id) {
    where += ' AND pp.vehicle_id = ?';
    params.push(vehicle_id);
  }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM pickup_points pp WHERE ${where}`,
    params
  );

  const [rows] = await pool.query(`
    SELECT
      pp.id, pp.vehicle_id, pp.sequence, pp.label,
      pp.latitude, pp.longitude, pp.session, pp.notes,
      pp.created_at, pp.updated_at,
      v.plate_no,
      (SELECT COUNT(*) FROM student_pickup_points spp
        WHERE spp.pickup_point_id = pp.id) AS student_count
    FROM pickup_points pp
    LEFT JOIN vehicles v ON v.id = pp.vehicle_id
    WHERE ${where}
    ORDER BY v.plate_no ASC, pp.sequence ASC, pp.id ASC
    LIMIT ? OFFSET ?
  `, [...params, pp, offset]);

  return {
    rows: rows.map(r => ({
      ...r,
      latitude: r.latitude == null ? null : parseFloat(r.latitude),
      longitude: r.longitude == null ? null : parseFloat(r.longitude),
    })),
    meta: { page: p, per_page: pp, total },
  };
}

async function getPickupPointById(id) {
  const [[row]] = await pool.query(
    `SELECT id, vehicle_id, sequence, label, latitude, longitude,
            session, notes, created_at, updated_at
       FROM pickup_points
      WHERE id = ? AND is_deleted = FALSE`,
    [id]
  );
  if (!row) return null;
  return {
    ...row,
    latitude:  row.latitude  == null ? null : parseFloat(row.latitude),
    longitude: row.longitude == null ? null : parseFloat(row.longitude),
  };
}

async function vehicleExists(vehicleId) {
  const [[row]] = await pool.query(
    'SELECT id FROM vehicles WHERE id = ? AND is_deleted = FALSE',
    [vehicleId]
  );
  return !!row;
}

async function studentExists(studentId) {
  const [[row]] = await pool.query(
    'SELECT id FROM students WHERE id = ? AND is_deleted = FALSE',
    [studentId]
  );
  return !!row;
}

async function createPickupPoint(input) {
  const [result] = await pool.query(`
    INSERT INTO pickup_points (vehicle_id, sequence, label, latitude, longitude, session, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    input.vehicle_id,
    parseInt(input.sequence, 10) || 0,
    String(input.label).trim(),
    parseFloat(input.latitude),
    parseFloat(input.longitude),
    input.session || 'both',
    input.notes ? String(input.notes).slice(0, 255) : null,
  ]);
  return result.insertId;
}

async function updatePickupPoint(id, input) {
  const updates = [];
  const params = [];
  if (input.label     !== undefined) { updates.push('label = ?');     params.push(String(input.label).trim()); }
  if (input.latitude  !== undefined) { updates.push('latitude = ?');  params.push(parseFloat(input.latitude)); }
  if (input.longitude !== undefined) { updates.push('longitude = ?'); params.push(parseFloat(input.longitude)); }
  if (input.session   !== undefined) { updates.push('session = ?');   params.push(input.session); }
  if (input.sequence  !== undefined) { updates.push('sequence = ?');  params.push(parseInt(input.sequence, 10) || 0); }
  if (input.notes     !== undefined) {
    updates.push('notes = ?');
    params.push(input.notes ? String(input.notes).slice(0, 255) : null);
  }
  if (updates.length === 0) return false;

  params.push(id);
  const [result] = await pool.query(
    `UPDATE pickup_points SET ${updates.join(', ')} WHERE id = ? AND is_deleted = FALSE`,
    params
  );
  return result.affectedRows > 0;
}

async function softDeletePickupPoint(id) {
  const [result] = await pool.query(
    `UPDATE pickup_points
        SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
      WHERE id = ? AND is_deleted = FALSE`,
    [id]
  );
  return result.affectedRows > 0;
}

async function assignStudentToPoint(pointId, studentId) {
  // INSERT IGNORE because (student_id, pickup_point_id) is the PK —
  // a duplicate assign is a silent no-op rather than a 5xx.
  const [result] = await pool.query(
    `INSERT IGNORE INTO student_pickup_points (student_id, pickup_point_id)
     VALUES (?, ?)`,
    [studentId, pointId]
  );
  return result.affectedRows > 0;
}

async function unassignStudentFromPoint(pointId, studentId) {
  const [result] = await pool.query(
    `DELETE FROM student_pickup_points
      WHERE student_id = ? AND pickup_point_id = ?`,
    [studentId, pointId]
  );
  return result.affectedRows > 0;
}

module.exports = {
  // Read (driver + school)
  getPickupPointsForVehicle,
  getPickupPointsForSchool,
  // Admin CRUD
  listPickupPoints,
  getPickupPointById,
  vehicleExists,
  studentExists,
  createPickupPoint,
  updatePickupPoint,
  softDeletePickupPoint,
  assignStudentToPoint,
  unassignStudentFromPoint,
};
