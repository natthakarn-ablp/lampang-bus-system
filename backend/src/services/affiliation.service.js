'use strict';

const { pool } = require('../config/database');

// Phase 10.7C-1 — match province.service.js window so "ยังไม่เริ่มใช้ระบบ"
// means the same thing at both scopes. School is "used recently" if it has
// any daily_status row in the last N days.
const SCHOOL_USAGE_WINDOW_DAYS = 14;

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
     WHERE el.reported_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       AND el.is_deleted = FALSE`,
    [affiliationId]
  );

  // Students on leave today — by session
  const [[{ leave_count, morning_leave, evening_leave }]] = await pool.query(
    `SELECT
       COUNT(DISTINCT sl.student_id) AS leave_count,
       COUNT(DISTINCT CASE WHEN sl.session IN ('morning','both') THEN sl.student_id END) AS morning_leave,
       COUNT(DISTINCT CASE WHEN sl.session IN ('evening','both') THEN sl.student_id END) AS evening_leave
     FROM student_leaves sl
     JOIN students s ON s.id = sl.student_id
     JOIN schools sc ON sc.id = s.school_id AND sc.affiliation_id = ?
     WHERE sl.leave_date = ? AND sl.cancelled = FALSE AND s.is_deleted = FALSE`,
    [affiliationId, today]
  );

  // Schools not yet 100% morning
  const [schoolCompleteness] = await pool.query(
    `SELECT sc.id, sc.name,
            COUNT(DISTINCT s.id) AS student_count,
            COUNT(DISTINCT s.vehicle_id) AS vehicle_count,
            COUNT(DISTINCT CASE WHEN s.morning_enabled THEN s.id END) AS m_expected,
            COUNT(DISTINCT CASE WHEN ds.morning_done = TRUE THEN ds.student_id END) AS m_done,
            COUNT(DISTINCT CASE WHEN s.evening_enabled THEN s.id END) AS e_expected,
            COUNT(DISTINCT CASE WHEN ds.evening_done = TRUE THEN ds.student_id END) AS e_done
     FROM schools sc
     JOIN students s ON s.school_id = sc.id AND s.is_deleted = FALSE
     LEFT JOIN daily_status ds ON ds.student_id = s.id AND ds.check_date = ?
     WHERE sc.affiliation_id = ? AND sc.is_deleted = FALSE
     GROUP BY sc.id, sc.name`,
    [today, affiliationId]
  );

  const schools_not_complete = schoolCompleteness.filter(
    s => (s.m_expected > 0 && s.m_done < s.m_expected) || (s.e_expected > 0 && s.e_done < s.e_expected)
  );

  // ─── Phase 10.7C-1 — additive school-checklist KPI fields ───────────────
  //
  // Mirrors the 10.7B-1 pattern at the affiliation scope. ALL new queries
  // filter by sc.affiliation_id so the affiliation account never sees
  // counts that include other affiliations. Two invariants must hold:
  //   school_total === school_used_recently + school_not_using_recently
  //   school_total === schools_with_vehicle_data + schools_missing_vehicle_data
  // The bottom of getDashboard() asserts both via non-fatal console.warn.

  // 1. Schools with any daily_status in the last N days. daily_status has
  //    no school_id column, so join through students -> schools.
  const [[{ school_used_recently }]] = await pool.query(
    `SELECT COUNT(DISTINCT s.school_id) AS school_used_recently
     FROM   daily_status ds
     JOIN   students s ON s.id = ds.student_id AND s.is_deleted = FALSE
     JOIN   schools  sc ON sc.id = s.school_id AND sc.is_deleted = FALSE
                       AND sc.affiliation_id = ?
     WHERE  ds.check_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
    [affiliationId, SCHOOL_USAGE_WINDOW_DAYS]
  );

  // 2. Schools that have at least one student with vehicle_id set.
  const [[{ schools_with_vehicle_data }]] = await pool.query(
    `SELECT COUNT(DISTINCT sc.id) AS schools_with_vehicle_data
     FROM   schools sc
     JOIN   students s ON s.school_id = sc.id AND s.is_deleted = FALSE
     WHERE  sc.affiliation_id = ? AND sc.is_deleted = FALSE
       AND  s.vehicle_id IS NOT NULL`,
    [affiliationId]
  );

  // Derived (JS) — non-negative by SQL filter design.
  const school_total                 = total_schools;
  const school_not_using_recently    = school_total - school_used_recently;
  const schools_missing_vehicle_data = school_total - schools_with_vehicle_data;

  // Aliases for clearer downstream naming. Old names ALSO returned below
  // so 10.7C-2 frontend cutover doesn't have to happen in the same phase.
  const emergency_7d   = recent_emergencies;
  const leave_today    = leave_count;
  const at_risk_schools = schools_not_complete.length;

  // Invariant guards — log warnings (never throw) if the buckets drift.
  if (school_used_recently + school_not_using_recently !== school_total) {
    // eslint-disable-next-line no-console
    console.warn('[affiliation.getDashboard] school adoption invariant drift', {
      affiliationId, school_total, school_used_recently, school_not_using_recently,
    });
  }
  if (schools_with_vehicle_data + schools_missing_vehicle_data !== school_total) {
    // eslint-disable-next-line no-console
    console.warn('[affiliation.getDashboard] school vehicle-data invariant drift', {
      affiliationId, school_total, schools_with_vehicle_data, schools_missing_vehicle_data,
    });
  }

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
    leave_count,
    morning_leave,
    evening_leave,
    schools_not_complete: schools_not_complete.map(s => ({
      school_id: s.id, school_name: s.name,
      student_count: s.student_count,
      vehicle_count: s.vehicle_count,
      morning_done: s.m_done,
      morning_expected: s.m_expected,
      morning_pending: s.m_expected - s.m_done,
      evening_done: s.e_done,
      evening_expected: s.e_expected,
      evening_pending: s.e_expected - s.e_done,
    })),

    // Phase 10.7C-1 — new additive fields (frontend cuts over in 10.7C-2)
    school_total,
    school_used_recently,
    school_not_using_recently,
    schools_with_vehicle_data,
    schools_missing_vehicle_data,
    emergency_7d,
    leave_today,
    at_risk_schools,
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
async function getStudents(affiliationId, { search, grade, school_id, vehicle_id, has_vehicle, page = 1, per_page = 20, sort = 'first_name', order = 'asc' }) {
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
  if (vehicle_id) {
    where += ' AND s.vehicle_id = ?';
    params.push(vehicle_id);
  }
  // ตัวกรอง "ยังไม่ผูกรถ" — ใช้ has_vehicle แทนการส่ง vehicle_id ว่าง
  // เพราะ `if (vehicle_id)` ข้างบนตีความค่าว่างเป็น "ไม่กรอง"
  if (has_vehicle === 'no') where += ' AND s.vehicle_id IS NULL';
  else if (has_vehicle === 'yes') where += ' AND s.vehicle_id IS NOT NULL';

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM students s
     JOIN schools sc ON sc.id = s.school_id
     WHERE ${where}`,
    params
  );

  const offset = (page - 1) * per_page;
  // PDPA / data minimization (2026-06-23): the affiliation (เขตพื้นที่) tier is
  // a read-only oversight role per the RBAC matrix, so parent CONTACT PII
  // (parent_name / parent_phone) is intentionally NOT selected here. Only
  // oversight-relevant identity fields (name, grade, classroom, school,
  // vehicle, status) are returned. The SCHOOL role keeps parent contact via
  // its own school.service.getStudents — this change does not touch that path.
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
             WHERE s3.vehicle_id = v.id AND sc3.affiliation_id = ? AND s3.is_deleted = FALSE) AS school_names,
            (SELECT vi.result FROM vehicle_inspections vi
             WHERE vi.vehicle_id = v.id ORDER BY vi.inspection_date DESC LIMIT 1) AS latest_inspection_result,
            (SELECT vi.inspection_date FROM vehicle_inspections vi
             WHERE vi.vehicle_id = v.id ORDER BY vi.inspection_date DESC LIMIT 1) AS latest_inspection_date
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
     JOIN schools sc ON sc.id = s.school_id AND sc.affiliation_id = ?
     WHERE el.is_deleted = FALSE`,
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
     WHERE el.is_deleted = FALSE
     ORDER BY el.reported_at DESC
     LIMIT ? OFFSET ?`,
    [affiliationId, per_page, offset]
  );

  return { emergencies: rows, meta: { page, per_page, total } };
}

/**
 * getVehiclesAtRisk — affiliation-scoped twin of province.service.js's
 * getVehiclesAtRisk. Same scoring formula and sort, scoped to vehicles
 * that serve at least one student in a school under this affiliation.
 *
 * Scoring weights (additive — kept in sync with province):
 *   FAILED inspection           +100  ('ไม่ผ่านตรวจ')
 *   no inspection on record     +80   ('ยังไม่ตรวจ')
 *   NEEDS_FIX                   +60   ('ต้องแก้ไข')
 *   insurance expired           +50   ('ประกันหมด')
 *   no insurance field          +40   ('ไม่มีข้อมูลประกัน')
 *   insurance expiring < 30d    +20   ('ประกันใกล้หมด')
 *
 * The inner subqueries that pull school_names + student_count also
 * filter by affiliation_id so the counts reflect only this affiliation's
 * footprint on the vehicle (a vehicle may serve schools in multiple
 * affiliations; this affiliation's view shows only its own students).
 */
async function getVehiclesAtRisk(affiliationId, { limit = 10 } = {}) {
  const topN = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

  const [rows] = await pool.query(`
    SELECT
      v.id,
      v.plate_no,
      v.insurance_expiry,
      (SELECT GROUP_CONCAT(DISTINCT sc.name ORDER BY sc.name SEPARATOR ', ')
        FROM students s
        JOIN schools sc ON sc.id = s.school_id AND sc.is_deleted = FALSE
        WHERE s.vehicle_id = v.id AND s.is_deleted = FALSE
          AND sc.affiliation_id = ?) AS school_names,
      (SELECT COUNT(*) FROM students s
        JOIN schools sc ON sc.id = s.school_id AND sc.is_deleted = FALSE
        WHERE s.vehicle_id = v.id AND s.is_deleted = FALSE
          AND sc.affiliation_id = ?) AS student_count,
      (SELECT d.name FROM driver_vehicle_assignments dva
        JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
        WHERE dva.vehicle_id = v.id AND dva.is_active = TRUE
        LIMIT 1) AS driver_name,
      (SELECT vi.result FROM vehicle_inspections vi
        WHERE vi.vehicle_id = v.id
        ORDER BY vi.inspection_date DESC LIMIT 1) AS latest_inspection_result,
      (SELECT vi.inspection_date FROM vehicle_inspections vi
        WHERE vi.vehicle_id = v.id
        ORDER BY vi.inspection_date DESC LIMIT 1) AS latest_inspection_date
    FROM vehicles v
    WHERE v.is_deleted = FALSE
      AND EXISTS (SELECT 1 FROM students s
                  JOIN schools sc ON sc.id = s.school_id AND sc.is_deleted = FALSE
                  WHERE s.vehicle_id = v.id AND s.is_deleted = FALSE
                    AND sc.affiliation_id = ?)
  `, [affiliationId, affiliationId, affiliationId]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thirtyDays = new Date(today.getTime() + 30 * 86400000);

  const scored = rows.map(v => {
    let score = 0;
    const reasons = [];
    const insp = v.latest_inspection_result;
    const expiry = v.insurance_expiry ? new Date(v.insurance_expiry) : null;
    const insExpired       = expiry && expiry < today;
    const insExpiring      = expiry && expiry >= today && expiry < thirtyDays;
    const hasInsuranceField = v.insurance_expiry != null;

    if (insp === 'FAILED')    { score += 100; reasons.push('ไม่ผ่านตรวจ'); }
    if (!insp)                { score +=  80; reasons.push('ยังไม่ตรวจ'); }
    if (insp === 'NEEDS_FIX') { score +=  60; reasons.push('ต้องแก้ไข'); }
    if (insExpired)           { score +=  50; reasons.push('ประกันหมด'); }
    if (!hasInsuranceField)   { score +=  40; reasons.push('ไม่มีข้อมูลประกัน'); }
    if (insExpiring)          { score +=  20; reasons.push('ประกันใกล้หมด'); }

    return {
      id: v.id,
      plate_no: v.plate_no,
      school_names: v.school_names || '-',
      driver_name: v.driver_name || '-',
      student_count: v.student_count || 0,
      latest_inspection_result: insp,
      latest_inspection_date: v.latest_inspection_date,
      insurance_expiry: v.insurance_expiry,
      risk_score: score,
      risk_reasons: reasons,
    };
  });

  scored.sort((a, b) =>
    (b.risk_score - a.risk_score) || a.plate_no.localeCompare(b.plate_no, 'th')
  );
  return scored.slice(0, topN);
}

module.exports = {
  getDashboard,
  getSchools,
  getStudents,
  getVehicles,
  getStatusToday,
  getEmergencies,
  getVehiclesAtRisk,
};
