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
 * Compute KPI percentage safely (avoid division by zero).
 */
function pct(done, expected) {
  if (!expected || expected === 0) return 0;
  return Math.round((done / expected) * 10000) / 100; // 2 decimal places
}

/**
 * Monthly report for a specific month (YYYY-MM) — KPI-oriented.
 */
async function getMonthlyReport(user, filters) {
  const month = filters.month || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).substring(0, 7);
  const startDate = `${month}-01`;
  const { where, params } = buildScopeFilter(user, filters);

  // Total students + morning/evening expected
  const [[{ total_students }]] = await pool.query(
    `SELECT COUNT(*) AS total_students FROM students s
     JOIN schools sc ON sc.id = s.school_id WHERE ${where}`, params
  );
  const [[{ morning_expected }]] = await pool.query(
    `SELECT COUNT(*) AS morning_expected FROM students s
     JOIN schools sc ON sc.id = s.school_id WHERE ${where} AND s.morning_enabled = TRUE`, params
  );
  const [[{ evening_expected }]] = await pool.query(
    `SELECT COUNT(*) AS evening_expected FROM students s
     JOIN schools sc ON sc.id = s.school_id WHERE ${where} AND s.evening_enabled = TRUE`, params
  );

  // Daily trend with per-day expected counts for KPI
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

  // Enrich daily trend with percentages
  const enrichedTrend = dailyTrend.map((d) => ({
    ...d,
    morning_expected,
    evening_expected,
    morning_pct: pct(d.morning_done, morning_expected),
    evening_pct: pct(d.evening_done, evening_expected),
  }));

  // Derive monthly totals from same data source
  const total_morning_done = dailyTrend.reduce((sum, d) => sum + (d.morning_done || 0), 0);
  const total_evening_done = dailyTrend.reduce((sum, d) => sum + (d.evening_done || 0), 0);
  const days_with_data = dailyTrend.length;
  const total_morning_expected = morning_expected * days_with_data;
  const total_evening_expected = evening_expected * days_with_data;

  // Days at 100%
  const days_morning_100 = dailyTrend.filter((d) => morning_expected > 0 && d.morning_done >= morning_expected).length;
  const days_evening_100 = dailyTrend.filter((d) => evening_expected > 0 && d.evening_done >= evening_expected).length;

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

  // Per-school KPI summary (morning + evening done from daily_status)
  const [schoolSummary] = await pool.query(
    `SELECT sc.id AS school_id, sc.name AS school_name,
            COUNT(DISTINCT s.id) AS student_count,
            SUM(CASE WHEN s.morning_enabled THEN 1 ELSE 0 END) AS school_morning_expected,
            SUM(CASE WHEN s.evening_enabled THEN 1 ELSE 0 END) AS school_evening_expected
     FROM schools sc
     JOIN students s ON s.school_id = sc.id AND s.is_deleted = FALSE
     WHERE sc.is_deleted = FALSE AND ${where}
     GROUP BY sc.id, sc.name
     ORDER BY sc.name`,
    params
  );

  // Per-school daily aggregates for KPI
  const [schoolDailyAgg] = await pool.query(
    `SELECT s.school_id,
            SUM(CASE WHEN ds.morning_done = TRUE THEN 1 ELSE 0 END) AS total_morning_done,
            SUM(CASE WHEN ds.evening_done = TRUE THEN 1 ELSE 0 END) AS total_evening_done,
            COUNT(DISTINCT ds.check_date) AS days_with_data
     FROM daily_status ds
     JOIN students s ON s.id = ds.student_id
     JOIN schools sc ON sc.id = s.school_id
     WHERE ds.check_date >= ? AND ds.check_date < DATE_ADD(?, INTERVAL 1 MONTH) AND ${where}
     GROUP BY s.school_id`,
    [startDate, startDate, ...params]
  );

  // Per-school: days at 100% morning
  const [schoolDays100] = await pool.query(
    `SELECT s.school_id, ds.check_date,
            COUNT(DISTINCT CASE WHEN ds.morning_done = TRUE THEN ds.student_id END) AS md,
            COUNT(DISTINCT CASE WHEN ds.evening_done = TRUE THEN ds.student_id END) AS ed
     FROM daily_status ds
     JOIN students s ON s.id = ds.student_id
     JOIN schools sc ON sc.id = s.school_id
     WHERE ds.check_date >= ? AND ds.check_date < DATE_ADD(?, INTERVAL 1 MONTH) AND ${where}
     GROUP BY s.school_id, ds.check_date`,
    [startDate, startDate, ...params]
  );

  // Build per-school days-at-100% lookup
  const schoolDays100Map = {};
  for (const row of schoolDays100) {
    const key = row.school_id;
    if (!schoolDays100Map[key]) schoolDays100Map[key] = { morning: 0, evening: 0 };
    const sch = schoolSummary.find((s) => s.school_id === key);
    if (sch) {
      if (sch.school_morning_expected > 0 && row.md >= sch.school_morning_expected) schoolDays100Map[key].morning++;
      if (sch.school_evening_expected > 0 && row.ed >= sch.school_evening_expected) schoolDays100Map[key].evening++;
    }
  }

  const aggMap = {};
  for (const row of schoolDailyAgg) aggMap[row.school_id] = row;

  const enrichedSchools = schoolSummary.map((s) => {
    const agg = aggMap[s.school_id] || { total_morning_done: 0, total_evening_done: 0, days_with_data: 0 };
    const d100 = schoolDays100Map[s.school_id] || { morning: 0, evening: 0 };
    const mExp = s.school_morning_expected * (agg.days_with_data || 1);
    const eExp = s.school_evening_expected * (agg.days_with_data || 1);
    return {
      school_id: s.school_id,
      school_name: s.school_name,
      student_count: s.student_count,
      morning_expected: s.school_morning_expected,
      evening_expected: s.school_evening_expected,
      total_morning_done: agg.total_morning_done,
      total_evening_done: agg.total_evening_done,
      morning_kpi: pct(agg.total_morning_done, mExp),
      evening_kpi: pct(agg.total_evening_done, eExp),
      days_morning_100: d100.morning,
      days_evening_100: d100.evening,
      days_with_data: agg.days_with_data,
    };
  });

  // Per-vehicle KPI
  const [vehicleAgg] = await pool.query(
    `SELECT v.id AS vehicle_id, v.plate_no,
            COUNT(DISTINCT s2.id) AS student_count,
            SUM(CASE WHEN ds.morning_done = TRUE THEN 1 ELSE 0 END) AS total_morning_done,
            SUM(CASE WHEN ds.evening_done = TRUE THEN 1 ELSE 0 END) AS total_evening_done,
            COUNT(DISTINCT ds.check_date) AS days_with_data
     FROM vehicles v
     JOIN students s2 ON s2.vehicle_id = v.id AND s2.is_deleted = FALSE
     JOIN schools sc ON sc.id = s2.school_id
     LEFT JOIN daily_status ds ON ds.student_id = s2.id
       AND ds.check_date >= ? AND ds.check_date < DATE_ADD(?, INTERVAL 1 MONTH)
     WHERE v.is_deleted = FALSE AND ${where.replace(/\bs\./g, 's2.')}
     GROUP BY v.id, v.plate_no
     ORDER BY v.plate_no`,
    [startDate, startDate, ...params]
  );

  const enrichedVehicles = vehicleAgg.map((v) => {
    const mExp = v.student_count * (v.days_with_data || 1);
    const eExp = v.student_count * (v.days_with_data || 1);
    return {
      ...v,
      morning_kpi: pct(v.total_morning_done, mExp),
      evening_kpi: pct(v.total_evening_done, eExp),
    };
  });

  return {
    month,
    total_students,
    morning_expected,
    evening_expected,
    total_morning_done,
    total_evening_done,
    total_morning_expected,
    total_evening_expected,
    morning_kpi: pct(total_morning_done, total_morning_expected),
    evening_kpi: pct(total_evening_done, total_evening_expected),
    days_with_data,
    days_morning_100,
    days_evening_100,
    emergency_count,
    daily_trend: enrichedTrend,
    schools: enrichedSchools,
    vehicles: enrichedVehicles,
  };
}

/**
 * Summary report — executive KPI view for today.
 */
async function getSummaryReport(user, filters) {
  const daily = await getDailyReport(user, filters);
  const date = daily.date;
  const { where, params } = buildScopeFilter(user, filters);

  // Add KPI percentages
  daily.morning_kpi = pct(daily.morning_done, daily.morning_total);
  daily.evening_kpi = pct(daily.evening_done, daily.evening_total);

  // Per-school KPI
  if (daily.schools) {
    daily.schools = daily.schools.map((s) => ({
      ...s,
      morning_kpi: pct(s.morning_done, s.student_count),
      evening_kpi: pct(s.evening_done, s.student_count),
    }));
  }

  // Per-vehicle KPI
  if (daily.vehicles) {
    daily.vehicles = daily.vehicles.map((v) => ({
      ...v,
      morning_kpi: pct(v.morning_done, v.student_count),
      evening_kpi: pct(v.evening_done, v.student_count),
    }));
  }

  // Per-affiliation KPI (for province/admin users seeing multiple affiliations)
  const [affRows] = await pool.query(
    `SELECT a.id AS affiliation_id, a.name AS affiliation_name,
            COUNT(DISTINCT s.id) AS student_count,
            COUNT(DISTINCT CASE WHEN ds.morning_done = TRUE THEN ds.student_id END) AS morning_done,
            COUNT(DISTINCT CASE WHEN ds.evening_done = TRUE THEN ds.student_id END) AS evening_done
     FROM affiliations a
     JOIN schools sc ON sc.affiliation_id = a.id AND sc.is_deleted = FALSE
     JOIN students s ON s.school_id = sc.id AND s.is_deleted = FALSE
     LEFT JOIN daily_status ds ON ds.student_id = s.id AND ds.check_date = ?
     WHERE a.is_deleted = FALSE AND ${where}
     GROUP BY a.id, a.name
     ORDER BY a.name`,
    [date, ...params]
  );

  daily.affiliations = affRows.map((a) => ({
    ...a,
    morning_kpi: pct(a.morning_done, a.student_count),
    evening_kpi: pct(a.evening_done, a.student_count),
  }));

  return daily;
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
