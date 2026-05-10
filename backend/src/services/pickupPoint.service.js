'use strict';

const { pool } = require('../config/database');
const { logAudit } = require('../utils/audit');

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

/* ─────────────────────────────────────────────────────────────────────────
 * Phase 6.1 — workflow correction helpers
 *
 * Driver/School create flows pre-load a student checklist scoped to the
 * acting role. The helpers below do NOT select PII (no phone / cid_hash)
 * and return only the minimal fields the modal needs.
 *
 * Validation helpers compare the supplied student_ids[] against the
 * scope-allowed set via a single COUNT query — if mismatch, scope leak
 * attempted, return false (route returns 400).
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Resolve student IDs that ALREADY have a pickup-point assignment on
 * this vehicle that conflicts with the target `session`.
 *
 * Conflict matrix:
 *   target='morning' ↔ existing in {morning, both}
 *   target='evening' ↔ existing in {evening, both}
 *   target='both'    ↔ existing in {morning, evening, both} (anything)
 *
 * SQL expresses it as: existing.session = 'both' OR target = 'both'
 *                       OR existing.session = target.
 */
async function getStudentIdsConflictingForVehicle(vehicleId, session, { excludePointId = null } = {}) {
  if (!session || !['morning', 'evening', 'both'].includes(session)) return [];
  const params = [vehicleId, session, session];
  let exclude = '';
  if (excludePointId) {
    exclude = ' AND pp.id != ?';
    params.push(excludePointId);
  }
  const [rows] = await pool.query(`
    SELECT DISTINCT spp.student_id
    FROM student_pickup_points spp
    JOIN pickup_points pp ON pp.id = spp.pickup_point_id AND pp.is_deleted = FALSE
    WHERE pp.vehicle_id = ?
      AND (pp.session = 'both' OR ? = 'both' OR pp.session = ?)
      ${exclude}
  `, params);
  return rows.map(r => r.student_id);
}

async function getStudentsForVehicle(vehicleId, { session = null } = {}) {
  const conflictIds = await getStudentIdsConflictingForVehicle(vehicleId, session);
  let where = 'vehicle_id = ? AND is_deleted = FALSE';
  const params = [vehicleId];
  if (conflictIds.length > 0) {
    where += ' AND id NOT IN (?)';
    params.push(conflictIds);
  }
  const [rows] = await pool.query(`
    SELECT id, prefix, first_name, last_name, grade, classroom,
           morning_enabled, evening_enabled
    FROM students
    WHERE ${where}
    ORDER BY classroom ASC, first_name ASC
  `, params);
  return rows;
}

async function getVehiclesForSchool(schoolId) {
  const [rows] = await pool.query(`
    SELECT DISTINCT v.id, v.plate_no,
           (SELECT COUNT(*) FROM students s2
              WHERE s2.vehicle_id = v.id AND s2.school_id = ?
                AND s2.is_deleted = FALSE) AS student_count
    FROM vehicles v
    JOIN students s ON s.vehicle_id = v.id AND s.is_deleted = FALSE
    WHERE v.is_deleted = FALSE AND s.school_id = ?
    ORDER BY v.plate_no ASC
  `, [schoolId, schoolId]);
  return rows;
}

async function getStudentsForSchoolAndVehicle(schoolId, vehicleId, { session = null } = {}) {
  const conflictIds = await getStudentIdsConflictingForVehicle(vehicleId, session);
  let where = 'school_id = ? AND vehicle_id = ? AND is_deleted = FALSE';
  const params = [schoolId, vehicleId];
  if (conflictIds.length > 0) {
    where += ' AND id NOT IN (?)';
    params.push(conflictIds);
  }
  const [rows] = await pool.query(`
    SELECT id, prefix, first_name, last_name, grade, classroom,
           morning_enabled, evening_enabled
    FROM students
    WHERE ${where}
    ORDER BY classroom ASC, first_name ASC
  `, params);
  return rows;
}

/**
 * Reject if any of the supplied studentIds already has a pickup-point
 * assignment on this vehicle that conflicts with the target session.
 * Server-side ground truth — even if the frontend filter is bypassed,
 * the POST handler must catch duplicates here.
 */
async function validateNoDuplicateAssignmentsForVehicle(studentIds, vehicleId, session, { excludePointId = null } = {}) {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return true;
  if (!['morning', 'evening', 'both'].includes(session)) {
    // Defensive default: if session unknown, treat like 'both' (most strict)
    // so we never accidentally accept a duplicate.
    session = 'both';
  }
  const params = [vehicleId, studentIds, session, session];
  let exclude = '';
  if (excludePointId) {
    // Phase 6.1 hotfix-7: when EDITING an existing pickup point, students
    // already on THIS point must not be flagged as duplicates against
    // themselves. Caller passes excludePointId = the point being edited.
    exclude = ' AND pp.id != ?';
    params.push(excludePointId);
  }
  const [[{ conflicts }]] = await pool.query(`
    SELECT COUNT(*) AS conflicts FROM student_pickup_points spp
    JOIN pickup_points pp ON pp.id = spp.pickup_point_id AND pp.is_deleted = FALSE
    WHERE pp.vehicle_id = ?
      AND spp.student_id IN (?)
      AND (pp.session = 'both' OR ? = 'both' OR pp.session = ?)
      ${exclude}
  `, params);
  return conflicts === 0;
}

/**
 * getAssignableStudentsForPickupPoint — for the edit-students modal.
 * Returns the candidate student list for a pickup point's vehicle:
 *   - Includes students currently assigned to THIS point (so they
 *     stay checkable in the modal even though they're "in use")
 *   - Includes students with no conflicting assignment on this vehicle
 *   - Excludes students assigned to OTHER points with conflicting session
 *
 * Each row carries a `currently_assigned` flag (1 if on this point,
 * 0 otherwise) so the frontend can pre-check the right students.
 *
 * `schoolId` — optional scope filter. When set (school role), restricts
 * the result to that school's roster. Driver role passes null.
 */
async function getAssignableStudentsForPickupPoint(point, { schoolId = null } = {}) {
  if (!point || !point.id || !point.vehicle_id || !point.session) return [];
  const conflictIds = await getStudentIdsConflictingForVehicle(
    point.vehicle_id, point.session, { excludePointId: point.id }
  );

  let where = 's.vehicle_id = ? AND s.is_deleted = FALSE';
  const params = [point.id, point.vehicle_id];   // first ? = the LEFT JOIN's pickup_point_id
  if (schoolId) {
    where += ' AND s.school_id = ?';
    params.push(schoolId);
  }
  if (conflictIds.length > 0) {
    where += ' AND s.id NOT IN (?)';
    params.push(conflictIds);
  }

  const [rows] = await pool.query(`
    SELECT s.id, s.prefix, s.first_name, s.last_name, s.grade, s.classroom,
           s.morning_enabled, s.evening_enabled,
           CASE WHEN spp.pickup_point_id IS NOT NULL THEN 1 ELSE 0 END AS currently_assigned
    FROM students s
    LEFT JOIN student_pickup_points spp
      ON spp.student_id = s.id AND spp.pickup_point_id = ?
    WHERE ${where}
    ORDER BY s.classroom ASC, s.first_name ASC
  `, params);

  // Coerce the MySQL CASE-WHEN INT to a boolean for cleaner JSON.
  return rows.map(r => ({ ...r, currently_assigned: r.currently_assigned === 1 }));
}

/**
 * replacePickupPointStudents — atomic delete-then-insert for the edit
 * flow. Caller MUST have already validated:
 *   - point belongs to actor's scope
 *   - studentIds belong to scope
 *   - no duplicate-assignment conflicts (excluding this point)
 *
 * Captures old/new student_ids in the audit log so the change is
 * traceable. Wrapped in a single transaction so a partial failure
 * rolls back cleanly.
 */
async function replacePickupPointStudents(pointId, studentIds, ctx = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Read current assignments for the audit oldValue
    const [oldRows] = await conn.query(
      `SELECT student_id FROM student_pickup_points WHERE pickup_point_id = ?`,
      [pointId]
    );
    const oldIds = oldRows.map(r => r.student_id);

    // Delete-then-insert pattern. Simpler than diffing, and the table
    // is tiny per-point (typically < 30 students per pickup), so the
    // write cost is negligible. INSERT IGNORE on the way back in
    // protects against accidental duplicates in the input array.
    await conn.query(
      `DELETE FROM student_pickup_points WHERE pickup_point_id = ?`,
      [pointId]
    );

    if (Array.isArray(studentIds) && studentIds.length > 0) {
      const values = studentIds.map(sid => [sid, pointId]);
      await conn.query(
        `INSERT IGNORE INTO student_pickup_points (student_id, pickup_point_id) VALUES ?`,
        [values]
      );
    }

    await logAudit({
      userId: ctx.actorId || null,
      action: 'UPDATE',
      entityType: 'pickup_point',
      entityId: pointId,
      oldValue: { student_ids: oldIds },
      newValue: { student_ids: studentIds || [] },
      ipAddress: ctx.ipAddress || null,
      userAgent: ctx.userAgent || null,
      conn,
    });

    await conn.commit();
    return {
      added:   (studentIds || []).filter(id => !oldIds.includes(id)),
      removed: oldIds.filter(id => !(studentIds || []).includes(id)),
      total:   (studentIds || []).length,
    };
  } catch (err) {
    try { await conn.rollback(); } catch { /* swallow */ }
    throw err;
  } finally {
    conn.release();
  }
}

async function validateStudentsBelongToVehicle(studentIds, vehicleId) {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return true;
  const [[{ matched }]] = await pool.query(`
    SELECT COUNT(*) AS matched FROM students
    WHERE id IN (?) AND vehicle_id = ? AND is_deleted = FALSE
  `, [studentIds, vehicleId]);
  return matched === studentIds.length;
}

async function validateStudentsBelongToSchoolAndVehicle(studentIds, schoolId, vehicleId) {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return true;
  const [[{ matched }]] = await pool.query(`
    SELECT COUNT(*) AS matched FROM students
    WHERE id IN (?) AND school_id = ? AND vehicle_id = ? AND is_deleted = FALSE
  `, [studentIds, schoolId, vehicleId]);
  return matched === studentIds.length;
}

async function validateVehicleServesSchool(vehicleId, schoolId) {
  const [[row]] = await pool.query(`
    SELECT 1 FROM students
    WHERE vehicle_id = ? AND school_id = ? AND is_deleted = FALSE
    LIMIT 1
  `, [vehicleId, schoolId]);
  return !!row;
}

/**
 * createPickupPointWithStudents — atomic create + assign-students.
 *
 * Wraps the INSERT pickup_point + N INSERT student_pickup_points + audit
 * log in a single transaction so a failure mid-flow rolls back cleanly.
 * INSERT IGNORE on the junction table makes duplicate (student, point)
 * pairs a silent no-op; this matters if the route handler doesn't dedupe.
 */
async function createPickupPointWithStudents(input, studentIds, ctx = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(`
      INSERT INTO pickup_points
        (vehicle_id, sequence, label, latitude, longitude, session, notes)
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
    const pointId = result.insertId;

    if (Array.isArray(studentIds) && studentIds.length > 0) {
      // One bulk INSERT IGNORE — two columns × N rows.
      const values = studentIds.map(sid => [sid, pointId]);
      await conn.query(
        `INSERT IGNORE INTO student_pickup_points (student_id, pickup_point_id) VALUES ?`,
        [values]
      );
    }

    await logAudit({
      userId: ctx.actorId || null,
      action: 'CREATE',
      entityType: 'pickup_point',
      entityId: pointId,
      newValue: {
        vehicle_id: input.vehicle_id,
        label: String(input.label).trim(),
        latitude: parseFloat(input.latitude),
        longitude: parseFloat(input.longitude),
        session: input.session || 'both',
        student_ids: studentIds || [],
      },
      ipAddress: ctx.ipAddress || null,
      userAgent: ctx.userAgent || null,
      conn,
    });

    await conn.commit();
    return pointId;
  } catch (err) {
    try { await conn.rollback(); } catch { /* swallow */ }
    throw err;
  } finally {
    conn.release();
  }
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
  // Phase 6.1 — driver/school workflow
  getStudentsForVehicle,
  getVehiclesForSchool,
  getStudentsForSchoolAndVehicle,
  validateStudentsBelongToVehicle,
  validateStudentsBelongToSchoolAndVehicle,
  validateVehicleServesSchool,
  createPickupPointWithStudents,
  // Phase 6.1 hotfix-4 — duplicate-assignment guard
  validateNoDuplicateAssignmentsForVehicle,
  // Phase 6.1 hotfix-7 — edit-students workflow
  getAssignableStudentsForPickupPoint,
  replacePickupPointStudents,
};
