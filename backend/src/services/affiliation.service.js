'use strict';

const { pool } = require('../config/database');

/**
 * Get dashboard summary for a specific affiliation (เขตพื้นที่).
 */
async function getDashboard(affiliationId) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

  // Affiliation info
  const [[affiliation]] = await pool.query(
    `SELECT id, name FROM affiliations WHERE id = ? AND is_deleted = FALSE`,
    [affiliationId]
  );

  // Schools in this affiliation
  const [[{ total_schools }]] = await pool.query(
    `SELECT COUNT(*) AS total_schools FROM schools
     WHERE affiliation_id = ? AND is_deleted = FALSE`,
    [affiliationId]
  );

  // Total students across all schools
  const [[{ total_students }]] = await pool.query(
    `SELECT COUNT(*) AS total_students FROM students s
     JOIN schools sc ON sc.id = s.school_id
     WHERE sc.affiliation_id = ? AND s.is_deleted = FALSE`,
    [affiliationId]
  );

  // Total vehicles
  const [[{ total_vehicles }]] = await pool.query(
    `SELECT COUNT(DISTINCT s.vehicle_id) AS total_vehicles FROM students s
     JOIN schools sc ON sc.id = s.school_id
     WHERE sc.affiliation_id = ? AND s.is_deleted = FALSE AND s.vehicle_id IS NOT NULL`,
    [affiliationId]
  );

  // Today's checkin summary
  const [[todayStats]] = await pool.query(
    `SELECT
       COUNT(DISTINCT CASE WHEN ds.morning_done = TRUE THEN ds.student_id END) AS morning_done,
       COUNT(DISTINCT CASE WHEN ds.evening_done = TRUE THEN ds.student_id END) AS evening_done
     FROM daily_status ds
     JOIN students s ON s.id = ds.student_id
     JOIN schools sc ON sc.id = s.school_id
     WHERE ds.check_date = ? AND sc.affiliation_id = ? AND s.is_deleted = FALSE`,
    [today, affiliationId]
  );

  // Morning/evening totals
  const [[{ morning_total }]] = await pool.query(
    `SELECT COUNT(*) AS morning_total FROM students s
     JOIN schools sc ON sc.id = s.school_id
     WHERE sc.affiliation_id = ? AND s.is_deleted = FALSE AND s.morning_enabled = TRUE`,
    [affiliationId]
  );
  const [[{ evening_total }]] = await pool.query(
    `SELECT COUNT(*) AS evening_total FROM students s
     JOIN schools sc ON sc.id = s.school_id
     WHERE sc.affiliation_id = ? AND s.is_deleted = FALSE AND s.evening_enabled = TRUE`,
    [affiliationId]
  );

  // Recent emergencies (7 days)
  const [[{ recent_emergencies }]] = await pool.query(
    `SELECT COUNT(DISTINCT el.id) AS recent_emergencies
     FROM emergency_logs el
     JOIN vehicles v ON v.id = el.vehicle_id
     JOIN students s ON s.vehicle_id = v.id AND s.is_deleted = FALSE
     JOIN schools sc ON sc.id = s.school_id AND sc.affiliation_id = ?
     WHERE el.reported_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
    [affiliationId]
  );

  return {
    affiliation: affiliation || null,
    date: today,
    total_schools,
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
 * List schools in an affiliation with student/vehicle counts.
 */
async function getSchools(affiliationId) {
  const [schools] = await pool.query(
    `SELECT sc.id, sc.name,
            (SELECT COUNT(*) FROM students s
             WHERE s.school_id = sc.id AND s.is_deleted = FALSE) AS student_count,
            (SELECT COUNT(DISTINCT s.vehicle_id) FROM students s
             WHERE s.school_id = sc.id AND s.is_deleted = FALSE AND s.vehicle_id IS NOT NULL) AS vehicle_count
     FROM schools sc
     WHERE sc.affiliation_id = ? AND sc.is_deleted = FALSE
     ORDER BY sc.name`,
    [affiliationId]
  );

  return schools;
}

/**
 * Search/list students across all schools in an affiliation.
 */
async function getStudents(affiliationId, { search, grade, school_id, page = 1, per_page = 20, sort = 'first_name', order = 'asc' }) {
  const allowedSorts = ['id', 'first_name', 'last_name', 'grade', 'classroom', 'school_id', 'vehicle_id'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'first_name';
  const sortDir = order === 'desc' ? 'DESC' : 'ASC';

  let where = 'sc.affiliation_id = ? AND s.is_deleted = FALSE';
  const params = [affiliationId];

  if (search) {
    where += ' AND (s.first_name LIKE ? OR s.last_name LIKE ? OR CAST(s.id AS CHAR) LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (grade) {
    where += ' AND s.grade = ?';
    params.push(grade);
  }
  if (school_id) {
    where += ' AND s.school_id = ?';
    params.push(school_id);
  }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM students s
     JOIN schools sc ON sc.id = s.school_id
     WHERE ${where}`,
    params
  );

  const offset = (page - 1) * per_page;
  const [students] = await pool.query(
    `SELECT s.id, s.prefix, s.first_name, s.last_name, s.grade, s.classroom,
            s.school_id, sc.name AS school_name,
            s.vehicle_id, v.plate_no, s.morning_enabled, s.evening_enabled
     FROM students s
     JOIN schools sc ON sc.id = s.school_id
     LEFT JOIN vehicles v ON v.id = s.vehicle_id
     WHERE ${where}
     ORDER BY s.${sortCol} ${sortDir}
     LIMIT ? OFFSET ?`,
    [...params, per_page, offset]
  );

  return { students, meta: { page, per_page, total } };
}

/**
 * Get vehicles across all schools in an affiliation.
 */
async function getVehicles(affiliationId) {
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
            (SELECT COUNT(*) FROM students s2
             JOIN schools sc2 ON sc2.id = s2.school_id
             WHERE s2.vehicle_id = v.id AND sc2.affiliation_id = ? AND s2.is_deleted = FALSE) AS student_count,
            (SELECT GROUP_CONCAT(DISTINCT sc3.name ORDER BY sc3.name SEPARATOR ', ')
             FROM students s3
             JOIN schools sc3 ON sc3.id = s3.school_id
             WHERE s3.vehicle_id = v.id AND sc3.affiliation_id = ? AND s3.is_deleted = FALSE) AS school_names
     FROM vehicles v
     WHERE v.is_deleted = FALSE
       AND v.id IN (
         SELECT DISTINCT s.vehicle_id FROM students s
         JOIN schools sc ON sc.id = s.school_id
         WHERE sc.affiliation_id = ? AND s.is_deleted = FALSE AND s.vehicle_id IS NOT NULL
       )
     ORDER BY v.plate_no`,
    [affiliationId, affiliationId, affiliationId]
  );

  return vehicles;
}

/**
 * Get today's status across all schools, grouped by school then vehicle.
 */
async function getStatusToday(affiliationId) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

  const [rows] = await pool.query(
    `SELECT s.id AS student_id, s.prefix, s.first_name, s.last_name,
            s.grade, s.classroom,
            s.school_id, sc.name AS school_name,
            s.vehicle_id, v.plate_no,
            s.morning_enabled, s.evening_enabled,
            ds.morning_done, ds.morning_ts,
            ds.evening_done, ds.evening_ts
     FROM students s
     JOIN schools sc ON sc.id = s.school_id
     LEFT JOIN vehicles v ON v.id = s.vehicle_id
     LEFT JOIN daily_status ds ON ds.student_id = s.id AND ds.check_date = ?
     WHERE sc.affiliation_id = ? AND s.is_deleted = FALSE
     ORDER BY sc.name, v.plate_no, s.first_name`,
    [today, affiliationId]
  );

  // Group by school → vehicle
  const schoolMap = {};
  for (const row of rows) {
    const sKey = row.school_id || '__none';
    if (!schoolMap[sKey]) {
      schoolMap[sKey] = {
        school_id: row.school_id,
        school_name: row.school_name || 'ไม่ระบุ',
        vehicles: {},
      };
    }
    const vKey = row.vehicle_id || '__none';
    if (!schoolMap[sKey].vehicles[vKey]) {
      schoolMap[sKey].vehicles[vKey] = {
        vehicle_id: row.vehicle_id,
        plate_no: row.plate_no || 'ไม่มีรถ',
        students: [],
      };
    }
    schoolMap[sKey].vehicles[vKey].students.push({
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

  // Flatten vehicles from map to array
  const schools = Object.values(schoolMap).map((s) => ({
    ...s,
    vehicles: Object.values(s.vehicles),
  }));

  return { date: today, schools };
}

/**
 * Get emergencies across all schools in an affiliation.
 */
async function getEmergencies(affiliationId, { page = 1, per_page = 20 }) {
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(DISTINCT el.id) AS total
     FROM emergency_logs el
     JOIN vehicles v ON v.id = el.vehicle_id
     JOIN students s ON s.vehicle_id = v.id AND s.is_deleted = FALSE
     JOIN schools sc ON sc.id = s.school_id AND sc.affiliation_id = ?`,
    [affiliationId]
  );

  const offset = (page - 1) * per_page;
  const [rows] = await pool.query(
    `SELECT DISTINCT el.id, el.vehicle_id, el.plate_no, el.detail, el.note, el.result,
            el.reported_at, el.channel,
            u.display_name AS reported_by_name
     FROM emergency_logs el
     JOIN vehicles v ON v.id = el.vehicle_id
     JOIN students s ON s.vehicle_id = v.id AND s.is_deleted = FALSE
     JOIN schools sc ON sc.id = s.school_id AND sc.affiliation_id = ?
     LEFT JOIN users u ON u.id = el.reported_by
     ORDER BY el.reported_at DESC
     LIMIT ? OFFSET ?`,
    [affiliationId, per_page, offset]
  );

  return { emergencies: rows, meta: { page, per_page, total } };
}

module.exports = {
  getDashboard,
  getSchools,
  getStudents,
  getVehicles,
  getStatusToday,
  getEmergencies,
};
