'use strict';

const { pool } = require('../config/database');

/**
 * Get dashboard summary for a specific school.
 */
async function getDashboard(schoolId) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

  // Total students (active)
  const [[{ total_students }]] = await pool.query(
    `SELECT COUNT(*) AS total_students FROM students
     WHERE school_id = ? AND is_deleted = FALSE`,
    [schoolId]
  );

  // Total vehicles serving this school
  const [[{ total_vehicles }]] = await pool.query(
    `SELECT COUNT(DISTINCT vehicle_id) AS total_vehicles FROM students
     WHERE school_id = ? AND is_deleted = FALSE AND vehicle_id IS NOT NULL`,
    [schoolId]
  );

  // Today's checkin summary
  const [[todayStats]] = await pool.query(
    `SELECT
       COUNT(DISTINCT CASE WHEN ds.morning_done = TRUE THEN ds.student_id END) AS morning_done,
       COUNT(DISTINCT CASE WHEN ds.evening_done = TRUE THEN ds.student_id END) AS evening_done
     FROM daily_status ds
     JOIN students s ON s.id = ds.student_id
     WHERE ds.check_date = ? AND s.school_id = ? AND s.is_deleted = FALSE`,
    [today, schoolId]
  );

  // Students with morning service
  const [[{ morning_total }]] = await pool.query(
    `SELECT COUNT(*) AS morning_total FROM students
     WHERE school_id = ? AND is_deleted = FALSE AND morning_enabled = TRUE`,
    [schoolId]
  );

  // Students with evening service
  const [[{ evening_total }]] = await pool.query(
    `SELECT COUNT(*) AS evening_total FROM students
     WHERE school_id = ? AND is_deleted = FALSE AND evening_enabled = TRUE`,
    [schoolId]
  );

  // Recent emergencies count (last 7 days)
  const [[{ recent_emergencies }]] = await pool.query(
    `SELECT COUNT(*) AS recent_emergencies FROM emergency_logs el
     JOIN vehicles v ON v.id = el.vehicle_id
     JOIN students s ON s.vehicle_id = v.id AND s.school_id = ? AND s.is_deleted = FALSE
     WHERE el.reported_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
    [schoolId]
  );

  // School info
  const [[school]] = await pool.query(
    `SELECT s.id, s.name, a.name AS affiliation_name
     FROM schools s
     LEFT JOIN affiliations a ON a.id = s.affiliation_id
     WHERE s.id = ?`,
    [schoolId]
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
    morning_pending: morning_total - (todayStats?.morning_done ?? 0),
    evening_pending: evening_total - (todayStats?.evening_done ?? 0),
    recent_emergencies,
  };
}

/**
 * Search/list students for a school with optional filters.
 */
async function getStudents(schoolId, { search, grade, vehicle_id, morning_enabled, evening_enabled, page = 1, per_page = 20, sort = 'first_name', order = 'asc' }) {
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
  if (grade) {
    where += ' AND s.grade = ?';
    params.push(grade);
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

  return {
    students,
    meta: { page, per_page, total },
  };
}

/**
 * Get vehicles serving a specific school.
 */
async function getVehicles(schoolId) {
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
             WHERE s.vehicle_id = v.id AND s.school_id = ? AND s.is_deleted = FALSE) AS student_count
     FROM vehicles v
     WHERE v.is_deleted = FALSE
       AND v.id IN (SELECT DISTINCT s.vehicle_id FROM students s
                    WHERE s.school_id = ? AND s.is_deleted = FALSE AND s.vehicle_id IS NOT NULL)
     ORDER BY v.plate_no`,
    [schoolId, schoolId]
  );

  return vehicles;
}

/**
 * Get today's status for all students of a school, grouped by vehicle.
 */
async function getStatusToday(schoolId) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

  const [rows] = await pool.query(
    `SELECT s.id AS student_id, s.prefix, s.first_name, s.last_name,
            s.grade, s.classroom, s.vehicle_id, v.plate_no,
            s.morning_enabled, s.evening_enabled,
            ds.morning_done, ds.morning_ts,
            ds.evening_done, ds.evening_ts
     FROM students s
     LEFT JOIN vehicles v ON v.id = s.vehicle_id
     LEFT JOIN daily_status ds ON ds.student_id = s.id AND ds.check_date = ?
     WHERE s.school_id = ? AND s.is_deleted = FALSE
     ORDER BY v.plate_no, s.first_name`,
    [today, schoolId]
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
async function getEmergencies(schoolId, { page = 1, per_page = 20 }) {
  // Count
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(DISTINCT el.id) AS total
     FROM emergency_logs el
     JOIN vehicles v ON v.id = el.vehicle_id
     JOIN students s ON s.vehicle_id = v.id AND s.school_id = ? AND s.is_deleted = FALSE`,
    [schoolId]
  );

  const offset = (page - 1) * per_page;

  const [rows] = await pool.query(
    `SELECT DISTINCT el.id, el.vehicle_id, el.plate_no, el.detail, el.note, el.result,
            el.reported_at, el.channel,
            u.display_name AS reported_by_name
     FROM emergency_logs el
     JOIN vehicles v ON v.id = el.vehicle_id
     JOIN students s ON s.vehicle_id = v.id AND s.school_id = ? AND s.is_deleted = FALSE
     LEFT JOIN users u ON u.id = el.reported_by
     ORDER BY el.reported_at DESC
     LIMIT ? OFFSET ?`,
    [schoolId, per_page, offset]
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
