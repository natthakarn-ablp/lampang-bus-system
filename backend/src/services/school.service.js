'use strict';

const { pool } = require('../config/database');

/**
 * Phase 7.11.3 — every school.service read accepts an optional
 * `gradeFilter` (Thai canonical, e.g. 'ป.4'). When set, every
 * student-backed query gets an extra `AND s.grade = ?` clause so a
 * teacher account sees only its own grade. When null (full school
 * account / admin without ?grade=), behaviour is unchanged.
 *
 * Convention: the gradeFilter is appended in a tiny helper inline
 * rather than abstracted, because each query has a different `s.`
 * alias and we want the SQL to stay readable.
 */

/**
 * Get dashboard summary for a specific school.
 */
async function getDashboard(schoolId, { gradeFilter = null } = {}) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  // When gradeFilter is set the SQL adds `AND s.grade = ?` to every
  // student-backed subquery. The `s` alias is used inside the
  // subqueries below; `students` (no alias) requires its own clause.
  const gradeAnd  = gradeFilter ? ' AND s.grade = ?'        : '';
  const gradeAndNoAlias = gradeFilter ? ' AND grade = ?'    : '';
  const ga = (...base) => gradeFilter ? [...base, gradeFilter] : base;

  // Total students (active)
  const [[{ total_students }]] = await pool.query(
    `SELECT COUNT(*) AS total_students FROM students
     WHERE school_id = ? AND is_deleted = FALSE${gradeAndNoAlias}`,
    ga(schoolId)
  );

  // Total vehicles serving this school
  const [[{ total_vehicles }]] = await pool.query(
    `SELECT COUNT(DISTINCT vehicle_id) AS total_vehicles FROM students
     WHERE school_id = ? AND is_deleted = FALSE AND vehicle_id IS NOT NULL${gradeAndNoAlias}`,
    ga(schoolId)
  );

  // Today's checkin summary
  const [[todayStats]] = await pool.query(
    `SELECT
       COUNT(DISTINCT CASE WHEN ds.morning_done = TRUE THEN ds.student_id END) AS morning_done,
       COUNT(DISTINCT CASE WHEN ds.evening_done = TRUE THEN ds.student_id END) AS evening_done
     FROM daily_status ds
     JOIN students s ON s.id = ds.student_id
     WHERE ds.check_date = ? AND s.school_id = ? AND s.is_deleted = FALSE${gradeAnd}`,
    ga(today, schoolId)
  );

  // Students with morning service (excluding leave)
  const [[{ morning_total, morning_leave }]] = await pool.query(
    `SELECT
       COUNT(*) AS morning_total,
       (SELECT COUNT(*) FROM student_leaves sl
        WHERE sl.student_id IN (
          SELECT id FROM students
          WHERE school_id = ? AND is_deleted = FALSE AND morning_enabled = TRUE${gradeAndNoAlias}
        )
          AND sl.leave_date = ? AND sl.cancelled = FALSE
          AND (sl.session = 'morning' OR sl.session = 'both')
       ) AS morning_leave
     FROM students
     WHERE school_id = ? AND is_deleted = FALSE AND morning_enabled = TRUE${gradeAndNoAlias}`,
    gradeFilter
      ? [schoolId, gradeFilter, today, schoolId, gradeFilter]
      : [schoolId, today, schoolId]
  );

  // Students with evening service (excluding leave)
  const [[{ evening_total, evening_leave }]] = await pool.query(
    `SELECT
       COUNT(*) AS evening_total,
       (SELECT COUNT(*) FROM student_leaves sl
        WHERE sl.student_id IN (
          SELECT id FROM students
          WHERE school_id = ? AND is_deleted = FALSE AND evening_enabled = TRUE${gradeAndNoAlias}
        )
          AND sl.leave_date = ? AND sl.cancelled = FALSE
          AND (sl.session = 'evening' OR sl.session = 'both')
       ) AS evening_leave
     FROM students
     WHERE school_id = ? AND is_deleted = FALSE AND evening_enabled = TRUE${gradeAndNoAlias}`,
    gradeFilter
      ? [schoolId, gradeFilter, today, schoolId, gradeFilter]
      : [schoolId, today, schoolId]
  );

  // Recent emergencies count (last 7 days) — scoped via vehicles
  // that serve in-scope students. Teacher gets emergencies only for
  // vehicles carrying their grade.
  const [[{ recent_emergencies }]] = await pool.query(
    `SELECT COUNT(DISTINCT el.id) AS recent_emergencies FROM emergency_logs el
     JOIN vehicles v ON v.id = el.vehicle_id
     JOIN students s ON s.vehicle_id = v.id AND s.school_id = ? AND s.is_deleted = FALSE${gradeAnd}
     WHERE el.reported_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
    ga(schoolId)
  );

  // School info
  const [[school]] = await pool.query(
    `SELECT s.id, s.name, a.name AS affiliation_name
     FROM schools s
     LEFT JOIN affiliations a ON a.id = s.affiliation_id
     WHERE s.id = ?`,
    [schoolId]
  );

  // Data completeness metrics
  const [[completeness]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(vehicle_id IS NOT NULL) AS has_vehicle,
       SUM(vehicle_id IS NULL) AS no_vehicle,
       (SELECT COUNT(DISTINCT ps.student_id) FROM parent_student ps
        JOIN students st ON st.id = ps.student_id AND st.school_id = ? AND st.is_deleted = FALSE${gradeFilter ? ' AND st.grade = ?' : ''}
        WHERE ps.approved = TRUE) AS has_parent
     FROM students WHERE school_id = ? AND is_deleted = FALSE${gradeAndNoAlias}`,
    gradeFilter ? [schoolId, gradeFilter, schoolId, gradeFilter] : [schoolId, schoolId]
  );

  const [[vehicleCompleteness]] = await pool.query(
    `SELECT
       COUNT(DISTINCT v.id) AS total_v,
       SUM(CASE WHEN v.insurance_expiry IS NOT NULL AND v.insurance_expiry >= CURDATE() THEN 1 ELSE 0 END) AS insured,
       SUM(CASE WHEN v.insurance_expiry IS NOT NULL AND v.insurance_expiry < CURDATE() THEN 1 ELSE 0 END) AS ins_expired,
       (SELECT COUNT(DISTINCT vi.vehicle_id) FROM vehicle_inspections vi
        WHERE vi.vehicle_id IN (
          SELECT DISTINCT s2.vehicle_id FROM students s2
          WHERE s2.school_id = ? AND s2.is_deleted = FALSE AND s2.vehicle_id IS NOT NULL${gradeFilter ? ' AND s2.grade = ?' : ''}
        )) AS inspected
     FROM vehicles v
     WHERE v.is_deleted = FALSE AND v.id IN (
       SELECT DISTINCT s3.vehicle_id FROM students s3
       WHERE s3.school_id = ? AND s3.is_deleted = FALSE AND s3.vehicle_id IS NOT NULL${gradeFilter ? ' AND s3.grade = ?' : ''}
     )`,
    gradeFilter ? [schoolId, gradeFilter, schoolId, gradeFilter] : [schoolId, schoolId]
  );

  return {
    school: school || null,
    date: today,
    total_students,
    total_vehicles,
    morning_total,
    evening_total,
    morning_done: todayStats?.morning_done ?? 0,
    evening_done: todayStats?.evening_done ?? 0,
    morning_pending: (morning_total - morning_leave) - (todayStats?.morning_done ?? 0),
    evening_pending: (evening_total - evening_leave) - (todayStats?.evening_done ?? 0),
    morning_leave,
    evening_leave,
    recent_emergencies,
    completeness: {
      students_total: Number(completeness.total) || 0,
      students_with_vehicle: Number(completeness.has_vehicle) || 0,
      students_no_vehicle: Number(completeness.no_vehicle) || 0,
      students_with_parent: Number(completeness.has_parent) || 0,
      vehicles_total: Number(vehicleCompleteness.total_v) || 0,
      vehicles_insured: Number(vehicleCompleteness.insured) || 0,
      vehicles_ins_expired: Number(vehicleCompleteness.ins_expired) || 0,
      vehicles_inspected: Number(vehicleCompleteness.inspected) || 0,
    },
  };
}

/**
 * Search/list students for a school with optional filters.
 */
async function getStudents(schoolId, { search, grade, vehicle_id, morning_enabled, evening_enabled, page = 1, per_page = 20, sort = 'first_name', order = 'asc', gradeFilter = null }) {
  const allowedSorts = ['id', 'first_name', 'last_name', 'grade', 'classroom', 'vehicle_id'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'first_name';
  const sortDir = order === 'desc' ? 'DESC' : 'ASC';

  let where = 's.school_id = ? AND s.is_deleted = FALSE';
  const params = [schoolId];

  if (search) {
    where += ' AND (s.first_name LIKE ? OR s.last_name LIKE ? OR CAST(s.id AS CHAR) LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  // Phase 7.11.3 — teacher accounts (gradeFilter set) hard-pin to
  // their own grade. The client `grade` query param is ignored when
  // a gradeFilter is present, so a teacher can't unlock other grades.
  const effectiveGrade = gradeFilter || grade || null;
  if (effectiveGrade) {
    where += ' AND s.grade = ?';
    params.push(effectiveGrade);
  }
  if (vehicle_id) {
    where += ' AND s.vehicle_id = ?';
    params.push(vehicle_id);
  }
  if (morning_enabled !== undefined) {
    where += ' AND s.morning_enabled = ?';
    params.push(morning_enabled === 'true' || morning_enabled === true ? 1 : 0);
  }
  if (evening_enabled !== undefined) {
    where += ' AND s.evening_enabled = ?';
    params.push(evening_enabled === 'true' || evening_enabled === true ? 1 : 0);
  }

  // Count
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM students s WHERE ${where}`,
    params
  );

  // Data
  const offset = (page - 1) * per_page;
  const [students] = await pool.query(
    `SELECT s.id, s.prefix, s.first_name, s.last_name, s.grade, s.classroom,
            s.vehicle_id, v.plate_no, s.morning_enabled, s.evening_enabled,
            s.dropoff_address,
            p.name AS parent_name, p.phone AS parent_phone
     FROM students s
     LEFT JOIN vehicles v ON v.id = s.vehicle_id
     LEFT JOIN parent_student ps ON ps.student_id = s.id AND ps.approved = TRUE
     LEFT JOIN parents p ON p.id = ps.parent_id AND p.is_deleted = FALSE
     WHERE ${where}
     ORDER BY s.${sortCol} ${sortDir}
     LIMIT ? OFFSET ?`,
    [...params, per_page, offset]
  );

  // Phase 7.11.3 — teacher accounts (gradeFilter set) get a sanitized
  // response. Parent contact + dropoff address remain available to the
  // full school account (responsible for parent comms) but are stripped
  // for homeroom teachers, who don't need them to verify roster.
  const sanitized = gradeFilter
    ? students.map(({ parent_phone, dropoff_address, ...rest }) => rest)
    : students;

  return {
    students: sanitized,
    meta: { page, per_page, total },
  };
}

/**
 * Get vehicles serving a specific school.
 */
async function getVehicles(schoolId, { gradeFilter = null } = {}) {
  // student_count is "students of this school on this vehicle"; if a
  // teacher is asking, narrow further to their own grade so the count
  // matches the perspective of the listing.
  const studentCountGrade = gradeFilter ? ' AND s.grade = ?' : '';
  const subqueryGrade     = gradeFilter ? ' AND s.grade = ?' : '';
  const params = [];
  params.push(schoolId);
  if (gradeFilter) params.push(gradeFilter);
  params.push(schoolId);
  if (gradeFilter) params.push(gradeFilter);

  const [vehicles] = await pool.query(
    `SELECT v.id, v.plate_no, v.vehicle_type,
            v.owner_name, v.owner_phone,
            v.insurance_status, v.insurance_type, v.insurance_expiry,
            (SELECT d.name FROM driver_vehicle_assignments dva
             JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
             WHERE dva.vehicle_id = v.id AND dva.is_active = TRUE
             LIMIT 1) AS driver_name,
            (SELECT d.phone FROM driver_vehicle_assignments dva
             JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
             WHERE dva.vehicle_id = v.id AND dva.is_active = TRUE
             LIMIT 1) AS driver_phone,
            (SELECT va.name FROM vehicle_attendants va
             WHERE va.vehicle_id = v.id LIMIT 1) AS attendant_name,
            (SELECT va.phone FROM vehicle_attendants va
             WHERE va.vehicle_id = v.id LIMIT 1) AS attendant_phone,
            (SELECT COUNT(*) FROM students s
             WHERE s.vehicle_id = v.id AND s.school_id = ? AND s.is_deleted = FALSE${studentCountGrade}) AS student_count,
            (SELECT vi.result FROM vehicle_inspections vi
             WHERE vi.vehicle_id = v.id ORDER BY vi.inspection_date DESC LIMIT 1) AS latest_inspection_result,
            (SELECT vi.inspection_date FROM vehicle_inspections vi
             WHERE vi.vehicle_id = v.id ORDER BY vi.inspection_date DESC LIMIT 1) AS latest_inspection_date
     FROM vehicles v
     WHERE v.is_deleted = FALSE
       AND v.id IN (SELECT DISTINCT s.vehicle_id FROM students s
                    WHERE s.school_id = ? AND s.is_deleted = FALSE AND s.vehicle_id IS NOT NULL${subqueryGrade})
     ORDER BY v.plate_no`,
    params
  );

  // Phase 7.11.3 — strip vehicle-side phone fields for teacher
  // accounts. Full school account still gets owner_phone /
  // driver_phone / attendant_phone (parent-contact loop).
  if (gradeFilter) {
    return vehicles.map(({ owner_phone, driver_phone, attendant_phone, ...rest }) => rest);
  }
  return vehicles;
}

/**
 * Get today's status for all students of a school, grouped by vehicle.
 */
async function getStatusToday(schoolId, { gradeFilter = null } = {}) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const gradeAnd = gradeFilter ? ' AND s.grade = ?' : '';
  const params   = gradeFilter ? [today, today, schoolId, gradeFilter]
                               : [today, today, schoolId];

  const [rows] = await pool.query(
    `SELECT s.id AS student_id, s.prefix, s.first_name, s.last_name,
            s.grade, s.classroom, s.vehicle_id, v.plate_no,
            s.morning_enabled, s.evening_enabled,
            ds.morning_done, ds.morning_ts,
            ds.evening_done, ds.evening_ts,
            (SELECT CASE
               WHEN COUNT(*) = 0 THEN NULL
               WHEN MAX(sl2.session = 'both') = 1 THEN 'both'
               WHEN COUNT(DISTINCT sl2.session) > 1 THEN 'both'
               ELSE MAX(sl2.session)
             END
             FROM student_leaves sl2
             WHERE sl2.student_id = s.id AND sl2.leave_date = ? AND sl2.cancelled = FALSE
            ) AS leave_session
     FROM students s
     LEFT JOIN vehicles v ON v.id = s.vehicle_id
     LEFT JOIN daily_status ds ON ds.student_id = s.id AND ds.check_date = ?
     WHERE s.school_id = ? AND s.is_deleted = FALSE${gradeAnd}
     ORDER BY v.plate_no, s.first_name`,
    params
  );

  // Group by vehicle
  const vehicleMap = {};
  for (const row of rows) {
    const key = row.vehicle_id || '__none';
    if (!vehicleMap[key]) {
      vehicleMap[key] = {
        vehicle_id: row.vehicle_id,
        plate_no: row.plate_no || 'ไม่มีรถ',
        students: [],
      };
    }
    vehicleMap[key].students.push({
      id: row.student_id,
      name: `${row.prefix || ''}${row.first_name} ${row.last_name}`,
      grade: row.grade,
      classroom: row.classroom,
      morning_enabled: row.morning_enabled,
      evening_enabled: row.evening_enabled,
      morning_done: !!row.morning_done,
      morning_ts: row.morning_ts,
      evening_done: !!row.evening_done,
      evening_ts: row.evening_ts,
      leave_session: row.leave_session || null,
    });
  }

  return {
    date: today,
    vehicles: Object.values(vehicleMap),
  };
}

/**
 * Get emergency logs related to vehicles serving this school.
 */
async function getEmergencies(schoolId, { page = 1, per_page = 20, gradeFilter = null } = {}) {
  const gradeAnd = gradeFilter ? ' AND s.grade = ?' : '';
  // Count
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(DISTINCT el.id) AS total
     FROM emergency_logs el
     JOIN vehicles v ON v.id = el.vehicle_id
     JOIN students s ON s.vehicle_id = v.id AND s.school_id = ? AND s.is_deleted = FALSE${gradeAnd}`,
    gradeFilter ? [schoolId, gradeFilter] : [schoolId]
  );

  const offset = (page - 1) * per_page;

  const [rows] = await pool.query(
    `SELECT DISTINCT el.id, el.vehicle_id, el.plate_no, el.detail, el.note, el.result,
            el.reported_at, el.channel,
            u.display_name AS reported_by_name
     FROM emergency_logs el
     JOIN vehicles v ON v.id = el.vehicle_id
     JOIN students s ON s.vehicle_id = v.id AND s.school_id = ? AND s.is_deleted = FALSE${gradeAnd}
     LEFT JOIN users u ON u.id = el.reported_by
     ORDER BY el.reported_at DESC
     LIMIT ? OFFSET ?`,
    gradeFilter ? [schoolId, gradeFilter, per_page, offset] : [schoolId, per_page, offset]
  );

  return {
    emergencies: rows,
    meta: { page, per_page, total },
  };
}

module.exports = {
  getDashboard,
  getStudents,
  getVehicles,
  getStatusToday,
  getEmergencies,
};
