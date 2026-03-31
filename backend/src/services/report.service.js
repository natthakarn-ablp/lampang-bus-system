'use strict';

const { pool } = require('../config/database');

/**
 * Build WHERE clause fragments for role-based scoping.
 * Returns { where, params } to append to queries involving students + schools.
 */
function buildScopeFilter(user, { date, month, school_id, affiliation_id, vehicle_id }) {
  let where = 's.is_deleted = FALSE';
  const params = [];

  // Role-based scoping
  if (user.role === 'school') {
    where += ' AND s.school_id = ?';
    params.push(user.scopeId);
  } else if (user.role === 'affiliation') {
    where += ' AND sc.affiliation_id = ?';
    params.push(user.scopeId);
  }
  // province/admin: no scope restriction

  // Optional filters (only if user is allowed — can't escape scope)
  if (school_id) {
    // school role: ignore if different from own scope
    if (user.role !== 'school' || school_id === user.scopeId) {
      where += ' AND s.school_id = ?';
      params.push(school_id);
    }
  }
  if (affiliation_id && user.role !== 'school' && user.role !== 'affiliation') {
    where += ' AND sc.affiliation_id = ?';
    params.push(affiliation_id);
  }
  if (vehicle_id) {
    where += ' AND s.vehicle_id = ?';
    params.push(vehicle_id);
  }

  return { where, params };
}

/**
 * Daily report for a specific date.
 */
async function getDailyReport(user, filters) {
  const date = filters.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const { where, params } = buildScopeFilter(user, filters);

  // Total students
  const [[{ total_students }]] = await pool.query(
    `SELECT COUNT(*) AS total_students FROM students s
     JOIN schools sc ON sc.id = s.school_id WHERE ${where}`, params
  );

  // Morning/evening totals
  const [[{ morning_total }]] = await pool.query(
    `SELECT COUNT(*) AS morning_total FROM students s
     JOIN schools sc ON sc.id = s.school_id WHERE ${where} AND s.morning_enabled = TRUE`, params
  );
  const [[{ evening_total }]] = await pool.query(
    `SELECT COUNT(*) AS evening_total FROM students s
     JOIN schools sc ON sc.id = s.school_id WHERE ${where} AND s.evening_enabled = TRUE`, params
  );

  // Checkin stats for the date
  const [[stats]] = await pool.query(
    `SELECT
       COUNT(DISTINCT CASE WHEN ds.morning_done = TRUE THEN ds.student_id END) AS morning_done,
       COUNT(DISTINCT CASE WHEN ds.evening_done = TRUE THEN ds.student_id END) AS evening_done
     FROM daily_status ds
     JOIN students s ON s.id = ds.student_id
     JOIN schools sc ON sc.id = s.school_id
     WHERE ds.check_date = ? AND ${where}`,
    [date, ...params]
  );

  // Total vehicles
  const [[{ total_vehicles }]] = await pool.query(
    `SELECT COUNT(DISTINCT s.vehicle_id) AS total_vehicles FROM students s
     JOIN schools sc ON sc.id = s.school_id WHERE ${where} AND s.vehicle_id IS NOT NULL`, params
  );

  // Emergency count for this date
  const [[{ emergency_count }]] = await pool.query(
    `SELECT COUNT(DISTINCT el.id) AS emergency_count
     FROM emergency_logs el
     JOIN vehicles v ON v.id = el.vehicle_id
     JOIN students s ON s.vehicle_id = v.id
     JOIN schools sc ON sc.id = s.school_id
     WHERE DATE(el.reported_at) = ? AND ${where}`,
    [date, ...params]
  );

  // Per-vehicle breakdown
  const [vehicles] = await pool.query(
    `SELECT v.id AS vehicle_id, v.plate_no,
            COUNT(DISTINCT s2.id) AS student_count,
            COUNT(DISTINCT CASE WHEN ds.morning_done = TRUE THEN ds.student_id END) AS morning_done,
            COUNT(DISTINCT CASE WHEN ds.evening_done = TRUE THEN ds.student_id END) AS evening_done
     FROM vehicles v
     JOIN students s2 ON s2.vehicle_id = v.id AND s2.is_deleted = FALSE
     JOIN schools sc ON sc.id = s2.school_id
     LEFT JOIN daily_status ds ON ds.student_id = s2.id AND ds.check_date = ?
     WHERE v.is_deleted = FALSE AND ${where.replace(/\bs\./g, 's2.')}
     GROUP BY v.id, v.plate_no
     ORDER BY v.plate_no`,
    [date, ...params]
  );

  // Per-school breakdown
  const [schoolBreakdown] = await pool.query(
    `SELECT sc.id AS school_id, sc.name AS school_name,
            COUNT(DISTINCT s.id) AS student_count,
            COUNT(DISTINCT CASE WHEN ds.morning_done = TRUE THEN ds.student_id END) AS morning_done,
            COUNT(DISTINCT CASE WHEN ds.evening_done = TRUE THEN ds.student_id END) AS evening_done
     FROM schools sc
     JOIN students s ON s.school_id = sc.id AND s.is_deleted = FALSE
     LEFT JOIN daily_status ds ON ds.student_id = s.id AND ds.check_date = ?
     WHERE sc.is_deleted = FALSE AND ${where}
     GROUP BY sc.id, sc.name
     ORDER BY sc.name`,
    [date, ...params]
  );

  return {
    date,
    total_students,
    total_vehicles,
    morning_total,
    evening_total,
    morning_done: stats?.morning_done ?? 0,
    evening_done: stats?.evening_done ?? 0,
    morning_pending: morning_total - (stats?.morning_done ?? 0),
    evening_pending: evening_total - (stats?.evening_done ?? 0),
    emergency_count,
    vehicles,
    schools: schoolBreakdown,
  };
}

/**
 * Monthly report for a specific month (YYYY-MM).
 */
async function getMonthlyReport(user, filters) {
  const month = filters.month || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).substring(0, 7);
  const startDate = `${month}-01`;
  const { where, params } = buildScopeFilter(user, filters);

  // Total students
  const [[{ total_students }]] = await pool.query(
    `SELECT COUNT(*) AS total_students FROM students s
     JOIN schools sc ON sc.id = s.school_id WHERE ${where}`, params
  );

  // Daily trend for the month
  const [dailyTrend] = await pool.query(
    `SELECT ds.check_date AS date,
            COUNT(DISTINCT CASE WHEN ds.morning_done = TRUE THEN ds.student_id END) AS morning_done,
            COUNT(DISTINCT CASE WHEN ds.evening_done = TRUE THEN ds.student_id END) AS evening_done
     FROM daily_status ds
     JOIN students s ON s.id = ds.student_id
     JOIN schools sc ON sc.id = s.school_id
     WHERE ds.check_date >= ? AND ds.check_date < DATE_ADD(?, INTERVAL 1 MONTH) AND ${where}
     GROUP BY ds.check_date
     ORDER BY ds.check_date`,
    [startDate, startDate, ...params]
  );

  // Total checkins in the month
  const [[monthTotals]] = await pool.query(
    `SELECT
       COUNT(DISTINCT CASE WHEN cl.session = 'morning' AND cl.status = 'CHECKED_IN' THEN CONCAT(cl.check_date, '-', cl.student_id) END) AS total_morning_checkins,
       COUNT(DISTINCT CASE WHEN cl.session = 'evening' AND cl.status = 'CHECKED_IN' THEN CONCAT(cl.check_date, '-', cl.student_id) END) AS total_evening_checkins
     FROM checkin_logs cl
     JOIN students s ON s.id = cl.student_id
     JOIN schools sc ON sc.id = s.school_id
     WHERE cl.check_date >= ? AND cl.check_date < DATE_ADD(?, INTERVAL 1 MONTH) AND ${where}`,
    [startDate, startDate, ...params]
  );

  // Emergency count for the month
  const [[{ emergency_count }]] = await pool.query(
    `SELECT COUNT(DISTINCT el.id) AS emergency_count
     FROM emergency_logs el
     JOIN vehicles v ON v.id = el.vehicle_id
     JOIN students s ON s.vehicle_id = v.id
     JOIN schools sc ON sc.id = s.school_id
     WHERE el.reported_at >= ? AND el.reported_at < DATE_ADD(?, INTERVAL 1 MONTH) AND ${where}`,
    [startDate, startDate, ...params]
  );

  // Per-school summary
  const [schoolSummary] = await pool.query(
    `SELECT sc.id AS school_id, sc.name AS school_name,
            COUNT(DISTINCT s.id) AS student_count,
            (SELECT COUNT(DISTINCT CONCAT(cl2.check_date, '-', cl2.student_id))
             FROM checkin_logs cl2
             JOIN students s2 ON s2.id = cl2.student_id AND s2.school_id = sc.id AND s2.is_deleted = FALSE
             WHERE cl2.session = 'morning' AND cl2.status = 'CHECKED_IN'
               AND cl2.check_date >= ? AND cl2.check_date < DATE_ADD(?, INTERVAL 1 MONTH)
            ) AS total_morning
     FROM schools sc
     JOIN students s ON s.school_id = sc.id AND s.is_deleted = FALSE
     WHERE sc.is_deleted = FALSE AND ${where}
     GROUP BY sc.id, sc.name
     ORDER BY sc.name`,
    [startDate, startDate, ...params]
  );

  return {
    month,
    total_students,
    total_morning_checkins: monthTotals?.total_morning_checkins ?? 0,
    total_evening_checkins: monthTotals?.total_evening_checkins ?? 0,
    emergency_count,
    daily_trend: dailyTrend,
    schools: schoolSummary,
  };
}

/**
 * Summary report — high-level overview (used for export base data too).
 */
async function getSummaryReport(user, filters) {
  const daily = await getDailyReport(user, filters);
  return daily; // summary reuses daily structure
}

/**
 * Build flat rows for CSV/Excel export from a daily report date.
 */
async function getExportRows(user, filters) {
  const date = filters.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const { where, params } = buildScopeFilter(user, filters);

  const [rows] = await pool.query(
    `SELECT s.id AS student_id,
            CONCAT(IFNULL(s.prefix,''), s.first_name, ' ', s.last_name) AS student_name,
            s.grade, s.classroom,
            sc.name AS school_name,
            IFNULL(a.name, '') AS affiliation_name,
            IFNULL(v.plate_no, '') AS plate_no,
            CASE WHEN s.morning_enabled THEN 'ใช่' ELSE 'ไม่' END AS morning_service,
            CASE WHEN s.evening_enabled THEN 'ใช่' ELSE 'ไม่' END AS evening_service,
            CASE WHEN ds.morning_done THEN 'เสร็จ' ELSE 'รอ' END AS morning_status,
            IFNULL(ds.morning_ts, '') AS morning_time,
            CASE WHEN ds.evening_done THEN 'เสร็จ' ELSE 'รอ' END AS evening_status,
            IFNULL(ds.evening_ts, '') AS evening_time
     FROM students s
     JOIN schools sc ON sc.id = s.school_id
     LEFT JOIN affiliations a ON a.id = sc.affiliation_id
     LEFT JOIN vehicles v ON v.id = s.vehicle_id
     LEFT JOIN daily_status ds ON ds.student_id = s.id AND ds.check_date = ?
     WHERE ${where}
     ORDER BY sc.name, v.plate_no, s.first_name`,
    [date, ...params]
  );

  return { date, rows };
}

module.exports = {
  getDailyReport,
  getMonthlyReport,
  getSummaryReport,
  getExportRows,
};
