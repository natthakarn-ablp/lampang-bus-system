'use strict';

const { pool } = require('../config/database');

/**
 * Province-level dashboard — full system overview.
 */
async function getDashboard() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

  const [[{ total_affiliations }]] = await pool.query(
    `SELECT COUNT(*) AS total_affiliations FROM affiliations WHERE is_deleted = FALSE`
  );
  const [[{ total_schools }]] = await pool.query(
    `SELECT COUNT(*) AS total_schools FROM schools WHERE is_deleted = FALSE`
  );
  const [[{ total_students }]] = await pool.query(
    `SELECT COUNT(*) AS total_students FROM students WHERE is_deleted = FALSE`
  );
  const [[{ total_vehicles }]] = await pool.query(
    `SELECT COUNT(DISTINCT vehicle_id) AS total_vehicles FROM students
     WHERE is_deleted = FALSE AND vehicle_id IS NOT NULL`
  );

  const [[todayStats]] = await pool.query(
    `SELECT
       COUNT(DISTINCT CASE WHEN ds.morning_done = TRUE THEN ds.student_id END) AS morning_done,
       COUNT(DISTINCT CASE WHEN ds.evening_done = TRUE THEN ds.student_id END) AS evening_done
     FROM daily_status ds
     JOIN students s ON s.id = ds.student_id AND s.is_deleted = FALSE
     WHERE ds.check_date = ?`,
    [today]
  );

  const [[{ morning_total }]] = await pool.query(
    `SELECT COUNT(*) AS morning_total FROM students
     WHERE is_deleted = FALSE AND morning_enabled = TRUE`
  );
  const [[{ evening_total }]] = await pool.query(
    `SELECT COUNT(*) AS evening_total FROM students
     WHERE is_deleted = FALSE AND evening_enabled = TRUE`
  );

  const [[{ recent_emergencies }]] = await pool.query(
    `SELECT COUNT(*) AS recent_emergencies FROM emergency_logs
     WHERE reported_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
  );

  return {
    date: today,
    total_affiliations,
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
 * List all affiliations with counts.
 */
async function getAffiliations() {
  const [rows] = await pool.query(
    `SELECT a.id, a.name,
            (SELECT COUNT(*) FROM schools sc
             WHERE sc.affiliation_id = a.id AND sc.is_deleted = FALSE) AS school_count,
            (SELECT COUNT(*) FROM students s
             JOIN schools sc ON sc.id = s.school_id AND sc.affiliation_id = a.id
             WHERE s.is_deleted = FALSE) AS student_count,
            (SELECT COUNT(DISTINCT s.vehicle_id) FROM students s
             JOIN schools sc ON sc.id = s.school_id AND sc.affiliation_id = a.id
             WHERE s.is_deleted = FALSE AND s.vehicle_id IS NOT NULL) AS vehicle_count
     FROM affiliations a
     WHERE a.is_deleted = FALSE
     ORDER BY a.name`
  );
  return rows;
}

/**
 * List all schools with affiliation name and counts.
 */
async function getSchools({ affiliation_id, page = 1, per_page = 50 }) {
  let where = 'sc.is_deleted = FALSE';
  const params = [];

  if (affiliation_id) {
    where += ' AND sc.affiliation_id = ?';
    params.push(affiliation_id);
  }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM schools sc WHERE ${where}`, params
  );

  const offset = (page - 1) * per_page;
  const [rows] = await pool.query(
    `SELECT sc.id, sc.name, sc.affiliation_id, a.name AS affiliation_name,
            (SELECT COUNT(*) FROM students s
             WHERE s.school_id = sc.id AND s.is_deleted = FALSE) AS student_count,
            (SELECT COUNT(DISTINCT s.vehicle_id) FROM students s
             WHERE s.school_id = sc.id AND s.is_deleted = FALSE AND s.vehicle_id IS NOT NULL) AS vehicle_count
     FROM schools sc
     LEFT JOIN affiliations a ON a.id = sc.affiliation_id
     WHERE ${where}
     ORDER BY a.name, sc.name
     LIMIT ? OFFSET ?`,
    [...params, per_page, offset]
  );

  return { schools: rows, meta: { page, per_page, total } };
}

/**
 * Search/list all students system-wide.
 */
async function getStudents({ search, grade, school_id, affiliation_id, page = 1, per_page = 20, sort = 'first_name', order = 'asc' }) {
  const allowedSorts = ['id', 'first_name', 'last_name', 'grade', 'classroom', 'school_id', 'vehicle_id'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'first_name';
  const sortDir = order === 'desc' ? 'DESC' : 'ASC';

  let where = 's.is_deleted = FALSE';
  const params = [];

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
  if (affiliation_id) {
    where += ' AND sc.affiliation_id = ?';
    params.push(affiliation_id);
  }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM students s
     JOIN schools sc ON sc.id = s.school_id
     WHERE ${where}`, params
  );

  const offset = (page - 1) * per_page;
  const [students] = await pool.query(
    `SELECT s.id, s.prefix, s.first_name, s.last_name, s.grade, s.classroom,
            s.school_id, sc.name AS school_name,
            sc.affiliation_id, a.name AS affiliation_name,
            s.vehicle_id, v.plate_no, s.morning_enabled, s.evening_enabled
     FROM students s
     JOIN schools sc ON sc.id = s.school_id
     LEFT JOIN affiliations a ON a.id = sc.affiliation_id
     LEFT JOIN vehicles v ON v.id = s.vehicle_id
     WHERE ${where}
     ORDER BY s.${sortCol} ${sortDir}
     LIMIT ? OFFSET ?`,
    [...params, per_page, offset]
  );

  return { students, meta: { page, per_page, total } };
}

/**
 * Get all vehicles system-wide.
 */
async function getVehicles() {
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
             WHERE s.vehicle_id = v.id AND s.is_deleted = FALSE) AS student_count,
            (SELECT GROUP_CONCAT(DISTINCT sc.name ORDER BY sc.name SEPARATOR ', ')
             FROM students s
             JOIN schools sc ON sc.id = s.school_id
             WHERE s.vehicle_id = v.id AND s.is_deleted = FALSE) AS school_names
     FROM vehicles v
     WHERE v.is_deleted = FALSE
       AND v.id IN (
         SELECT DISTINCT vehicle_id FROM students WHERE is_deleted = FALSE AND vehicle_id IS NOT NULL
       )
     ORDER BY v.plate_no`
  );
  return vehicles;
}

/**
 * Today's status grouped by affiliation → school → vehicle.
 */
async function getStatusToday() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

  const [rows] = await pool.query(
    `SELECT s.id AS student_id, s.prefix, s.first_name, s.last_name,
            s.grade, s.classroom,
            s.school_id, sc.name AS school_name,
            sc.affiliation_id, a.name AS affiliation_name,
            s.vehicle_id, v.plate_no,
            s.morning_enabled, s.evening_enabled,
            ds.morning_done, ds.morning_ts,
            ds.evening_done, ds.evening_ts
     FROM students s
     JOIN schools sc ON sc.id = s.school_id
     LEFT JOIN affiliations a ON a.id = sc.affiliation_id
     LEFT JOIN vehicles v ON v.id = s.vehicle_id
     LEFT JOIN daily_status ds ON ds.student_id = s.id AND ds.check_date = ?
     WHERE s.is_deleted = FALSE
     ORDER BY a.name, sc.name, v.plate_no, s.first_name`,
    [today]
  );

  // Group: affiliation → school → vehicle → students
  const affMap = {};
  for (const row of rows) {
    const aKey = row.affiliation_id || '__none';
    if (!affMap[aKey]) {
      affMap[aKey] = {
        affiliation_id: row.affiliation_id,
        affiliation_name: row.affiliation_name || 'ไม่ระบุเขต',
        schools: {},
      };
    }
    const sKey = row.school_id || '__none';
    if (!affMap[aKey].schools[sKey]) {
      affMap[aKey].schools[sKey] = {
        school_id: row.school_id,
        school_name: row.school_name || 'ไม่ระบุ',
        vehicles: {},
      };
    }
    const vKey = row.vehicle_id || '__none';
    if (!affMap[aKey].schools[sKey].vehicles[vKey]) {
      affMap[aKey].schools[sKey].vehicles[vKey] = {
        vehicle_id: row.vehicle_id,
        plate_no: row.plate_no || 'ไม่มีรถ',
        students: [],
      };
    }
    affMap[aKey].schools[sKey].vehicles[vKey].students.push({
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

  const affiliations = Object.values(affMap).map((a) => ({
    ...a,
    schools: Object.values(a.schools).map((s) => ({
      ...s,
      vehicles: Object.values(s.vehicles),
    })),
  }));

  return { date: today, affiliations };
}

/**
 * All emergencies system-wide.
 */
async function getEmergencies({ page = 1, per_page = 20 }) {
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM emergency_logs`
  );

  const offset = (page - 1) * per_page;
  const [rows] = await pool.query(
    `SELECT el.id, el.vehicle_id, el.plate_no, el.detail, el.note, el.result,
            el.reported_at, el.channel,
            u.display_name AS reported_by_name
     FROM emergency_logs el
     LEFT JOIN users u ON u.id = el.reported_by
     ORDER BY el.reported_at DESC
     LIMIT ? OFFSET ?`,
    [per_page, offset]
  );

  return { emergencies: rows, meta: { page, per_page, total } };
}

module.exports = {
  getDashboard,
  getAffiliations,
  getSchools,
  getStudents,
  getVehicles,
  getStatusToday,
  getEmergencies,
};
