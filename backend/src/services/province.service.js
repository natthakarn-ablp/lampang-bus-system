'use strict';

const { pool } = require('../config/database');
const {
  ONLINE_SECONDS_MAX,
  STALE_SECONDS_MAX,
} = require('./vehicleLocation.service');

// Phase 10.7B-1 — schools count as "using the system" if they have any
// daily_status row in the last N days. Two weeks ≈ school-week × 2, which
// is the smallest window that survives a normal school holiday.
const SCHOOL_USAGE_WINDOW_DAYS = 14;

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

  const mDone = todayStats?.morning_done ?? 0;
  const eDone = todayStats?.evening_done ?? 0;

  // Per-affiliation KPI for dashboard
  const affiliations = await getAffiliations();

  // Leave counts by session
  const [[{ leave_count, morning_leave, evening_leave }]] = await pool.query(
    `SELECT
       COUNT(DISTINCT sl.student_id) AS leave_count,
       COUNT(DISTINCT CASE WHEN sl.session IN ('morning','both') THEN sl.student_id END) AS morning_leave,
       COUNT(DISTINCT CASE WHEN sl.session IN ('evening','both') THEN sl.student_id END) AS evening_leave
     FROM student_leaves sl
     JOIN students s ON s.id = sl.student_id
     WHERE sl.leave_date = ? AND sl.cancelled = FALSE AND s.is_deleted = FALSE`,
    [today]
  );

  // All schools list for dropdown
  const [allSchools] = await pool.query(
    `SELECT sc.id, sc.name, a.name AS affiliation_name
     FROM schools sc
     LEFT JOIN affiliations a ON a.id = sc.affiliation_id
     WHERE sc.is_deleted = FALSE ORDER BY a.name, sc.name`
  );

  // Per-school completeness for "critical" section
  const [schoolCompleteness] = await pool.query(
    `SELECT sc.id, sc.name, a.name AS affiliation_name,
            COUNT(DISTINCT s.id) AS student_count,
            COUNT(DISTINCT s.vehicle_id) AS vehicle_count,
            COUNT(DISTINCT CASE WHEN s.morning_enabled THEN s.id END) AS m_expected,
            COUNT(DISTINCT CASE WHEN ds.morning_done = TRUE THEN ds.student_id END) AS m_done,
            COUNT(DISTINCT CASE WHEN s.evening_enabled THEN s.id END) AS e_expected,
            COUNT(DISTINCT CASE WHEN ds.evening_done = TRUE THEN ds.student_id END) AS e_done
     FROM schools sc
     JOIN students s ON s.school_id = sc.id AND s.is_deleted = FALSE
     LEFT JOIN affiliations a ON a.id = sc.affiliation_id
     LEFT JOIN daily_status ds ON ds.student_id = s.id AND ds.check_date = ?
     WHERE sc.is_deleted = FALSE
     GROUP BY sc.id, sc.name, a.name`,
    [today]
  );
  const schools_not_complete = schoolCompleteness
    .filter(s => (s.m_expected > 0 && s.m_done < s.m_expected) || (s.e_expected > 0 && s.e_done < s.e_expected))
    .map(s => ({
      school_id: s.id, school_name: s.name, affiliation_name: s.affiliation_name,
      student_count: s.student_count, vehicle_count: s.vehicle_count,
      morning_done: s.m_done, morning_expected: s.m_expected, morning_pending: s.m_expected - s.m_done,
      evening_done: s.e_done, evening_expected: s.e_expected, evening_pending: s.e_expected - s.e_done,
    }))
    .sort((a, b) => (b.morning_pending + b.evening_pending) - (a.morning_pending + a.evening_pending));

  // ─── Phase 10.7B-1 — additive KPI fields ─────────────────────────────────
  //
  // New buckets that the upcoming province dashboard layout (10.7B-2) will
  // consume. EXISTING fields above are untouched so the current frontend
  // keeps rendering unchanged until cutover.
  //
  // Vehicle buckets are mutually exclusive by the SQL filters below:
  //   - online / stale / offline_smart split active rows by age
  //   - paused is its own row.status filter
  //   - no_location is the fleet minus any vehicle with a location row
  // Their sum should equal vehicle_total; an invariant warning logs (does
  // NOT throw) if it ever drifts.

  // 1. Fleet count — every active vehicle (was missing as a top-level KPI;
  //    legacy `total_vehicles` is roster-scoped and reports a different number).
  const [[{ vehicle_total }]] = await pool.query(
    `SELECT COUNT(*) AS vehicle_total FROM vehicles WHERE is_deleted = FALSE`
  );

  // 2. Alias of the existing roster-scoped total_vehicles semantic — kept
  //    under a clearer name so 10.7B-2 doesn't have to overload meaning.
  const vehicle_serving_students = total_vehicles;

  // 3. Vehicles that have ever sent a location (still in active fleet).
  const [[{ vehicle_trackable }]] = await pool.query(
    `SELECT COUNT(DISTINCT vll.vehicle_id) AS vehicle_trackable
     FROM   vehicle_latest_locations vll
     JOIN   vehicles v ON v.id = vll.vehicle_id AND v.is_deleted = FALSE`
  );

  // 4–7. Live status breakdown — joined to vehicles so soft-deleted vehicles
  //      cannot leak into the buckets. ONLINE_SECONDS_MAX and STALE_SECONDS_MAX
  //      are imported from vehicleLocation.service.js (single source of truth).
  const [[liveStats]] = await pool.query(
    `SELECT
       SUM(CASE WHEN vll.status = 'ACTIVE'
                 AND TIMESTAMPDIFF(SECOND, vll.received_at, NOW()) <= ?
                THEN 1 ELSE 0 END) AS vehicle_online,
       SUM(CASE WHEN vll.status = 'ACTIVE'
                 AND TIMESTAMPDIFF(SECOND, vll.received_at, NOW()) >  ?
                 AND TIMESTAMPDIFF(SECOND, vll.received_at, NOW()) <= ?
                THEN 1 ELSE 0 END) AS vehicle_stale,
       SUM(CASE WHEN vll.status = 'ACTIVE'
                 AND TIMESTAMPDIFF(SECOND, vll.received_at, NOW()) >  ?
                THEN 1 ELSE 0 END) AS vehicle_offline_smart,
       SUM(CASE WHEN vll.status = 'PAUSED' THEN 1 ELSE 0 END) AS vehicle_paused
     FROM   vehicle_latest_locations vll
     JOIN   vehicles v ON v.id = vll.vehicle_id AND v.is_deleted = FALSE`,
    [
      ONLINE_SECONDS_MAX,
      ONLINE_SECONDS_MAX,
      STALE_SECONDS_MAX,
      STALE_SECONDS_MAX,
    ]
  );
  const vehicle_online         = Number(liveStats.vehicle_online)         || 0;
  const vehicle_stale          = Number(liveStats.vehicle_stale)          || 0;
  const vehicle_offline_smart  = Number(liveStats.vehicle_offline_smart)  || 0;
  const vehicle_paused         = Number(liveStats.vehicle_paused)         || 0;

  // 8. Non-broadcast vehicles — computed in JS to avoid duplicating the
  //    fleet-count query. Always non-negative when the invariant holds.
  const vehicle_no_location = vehicle_total - vehicle_trackable;

  // Invariant — log a warning (never throw) if the buckets don't add up to
  // the fleet count. By design the SQL filters are mutually exclusive, but
  // a future MySQL upgrade or row-format quirk could break that quietly.
  const bucket_sum =
    vehicle_online + vehicle_stale + vehicle_offline_smart +
    vehicle_paused + vehicle_no_location;
  if (bucket_sum !== vehicle_total) {
    // eslint-disable-next-line no-console
    console.warn('[province.getDashboard] vehicle bucket invariant drift', {
      vehicle_total, vehicle_online, vehicle_stale, vehicle_offline_smart,
      vehicle_paused, vehicle_no_location, bucket_sum,
    });
  }

  // 9. school_total — alias of total_schools (existing). Both names returned
  //    so 10.7B-2 can cut over without touching callers in the same phase.
  const school_total = total_schools;

  // 10. Schools that have any daily_status row in the last 14 days.
  //     daily_status has no school_id column — join through students.
  const [[{ school_used_recently }]] = await pool.query(
    `SELECT COUNT(DISTINCT s.school_id) AS school_used_recently
     FROM   daily_status ds
     JOIN   students s ON s.id = ds.student_id AND s.is_deleted = FALSE
     JOIN   schools  sc ON sc.id = s.school_id AND sc.is_deleted = FALSE
     WHERE  ds.check_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
    [SCHOOL_USAGE_WINDOW_DAYS]
  );
  const school_not_using_recently = school_total - school_used_recently;

  // 12–13. Aliases for clearer downstream naming. Old names kept above.
  const emergency_7d = recent_emergencies;
  const leave_today  = leave_count;

  return {
    date: today,
    total_affiliations,
    total_schools,
    total_students,
    total_vehicles,
    morning_total,
    evening_total,
    morning_done: mDone,
    evening_done: eDone,
    morning_pending: morning_total - mDone,
    evening_pending: evening_total - eDone,
    morning_kpi: morning_total > 0 ? Math.round((mDone / morning_total) * 10000) / 100 : 0,
    evening_kpi: evening_total > 0 ? Math.round((eDone / evening_total) * 10000) / 100 : 0,
    recent_emergencies,
    leave_count,
    morning_leave,
    evening_leave,
    affiliations,
    schools: allSchools,
    schools_not_complete,

    // Phase 10.7B-1 — new additive fields (frontend cuts over in 10.7B-2)
    vehicle_total,
    vehicle_serving_students,
    vehicle_trackable,
    vehicle_online,
    vehicle_stale,
    vehicle_offline_smart,
    vehicle_paused,
    vehicle_no_location,
    school_total,
    school_used_recently,
    school_not_using_recently,
    emergency_7d,
    leave_today,
  };
}

/**
 * List all affiliations with counts and today's KPI.
 */
async function getAffiliations() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

  const [rows] = await pool.query(
    `SELECT a.id, a.name,
            (SELECT COUNT(*) FROM schools sc
             WHERE sc.affiliation_id = a.id AND sc.is_deleted = FALSE) AS school_count,
            (SELECT COUNT(*) FROM students s
             JOIN schools sc ON sc.id = s.school_id AND sc.affiliation_id = a.id
             WHERE s.is_deleted = FALSE) AS student_count,
            (SELECT COUNT(DISTINCT s.vehicle_id) FROM students s
             JOIN schools sc ON sc.id = s.school_id AND sc.affiliation_id = a.id
             WHERE s.is_deleted = FALSE AND s.vehicle_id IS NOT NULL) AS vehicle_count,
            (SELECT COUNT(*) FROM students s2
             JOIN schools sc2 ON sc2.id = s2.school_id AND sc2.affiliation_id = a.id
             WHERE s2.is_deleted = FALSE AND s2.morning_enabled = TRUE) AS morning_expected,
            (SELECT COUNT(*) FROM students s3
             JOIN schools sc3 ON sc3.id = s3.school_id AND sc3.affiliation_id = a.id
             WHERE s3.is_deleted = FALSE AND s3.evening_enabled = TRUE) AS evening_expected,
            (SELECT COUNT(DISTINCT CASE WHEN ds.morning_done = TRUE THEN ds.student_id END)
             FROM daily_status ds
             JOIN students s4 ON s4.id = ds.student_id
             JOIN schools sc4 ON sc4.id = s4.school_id AND sc4.affiliation_id = a.id
             WHERE ds.check_date = ? AND s4.is_deleted = FALSE) AS morning_done,
            (SELECT COUNT(DISTINCT CASE WHEN ds2.evening_done = TRUE THEN ds2.student_id END)
             FROM daily_status ds2
             JOIN students s5 ON s5.id = ds2.student_id
             JOIN schools sc5 ON sc5.id = s5.school_id AND sc5.affiliation_id = a.id
             WHERE ds2.check_date = ? AND s5.is_deleted = FALSE) AS evening_done,
            (SELECT COUNT(DISTINCT el.id)
             FROM emergency_logs el
             JOIN vehicles v ON v.id = el.vehicle_id
             JOIN students s6 ON s6.vehicle_id = v.id AND s6.is_deleted = FALSE
             JOIN schools sc6 ON sc6.id = s6.school_id AND sc6.affiliation_id = a.id
             WHERE DATE(el.reported_at) = ?) AS emergency_count
     FROM affiliations a
     WHERE a.is_deleted = FALSE
     ORDER BY a.name`,
    [today, today, today]
  );

  // Per-school 100% check: which schools have all morning/evening students done today
  const [schoolStatus] = await pool.query(
    `SELECT sc.affiliation_id,
            sc.id AS school_id,
            COUNT(DISTINCT CASE WHEN s.morning_enabled THEN s.id END) AS m_expected,
            COUNT(DISTINCT CASE WHEN ds.morning_done = TRUE THEN ds.student_id END) AS m_done,
            COUNT(DISTINCT CASE WHEN s.evening_enabled THEN s.id END) AS e_expected,
            COUNT(DISTINCT CASE WHEN ds.evening_done = TRUE THEN ds.student_id END) AS e_done
     FROM schools sc
     JOIN students s ON s.school_id = sc.id AND s.is_deleted = FALSE
     LEFT JOIN daily_status ds ON ds.student_id = s.id AND ds.check_date = ?
     WHERE sc.is_deleted = FALSE
     GROUP BY sc.affiliation_id, sc.id`,
    [today]
  );

  // Per-vehicle 100% check
  const [vehicleStatus] = await pool.query(
    `SELECT sc.affiliation_id,
            v.id AS vehicle_id,
            COUNT(DISTINCT s.id) AS total,
            COUNT(DISTINCT CASE WHEN ds.morning_done = TRUE THEN ds.student_id END) AS m_done,
            COUNT(DISTINCT CASE WHEN ds.evening_done = TRUE THEN ds.student_id END) AS e_done
     FROM vehicles v
     JOIN students s ON s.vehicle_id = v.id AND s.is_deleted = FALSE
     JOIN schools sc ON sc.id = s.school_id
     LEFT JOIN daily_status ds ON ds.student_id = s.id AND ds.check_date = ?
     WHERE v.is_deleted = FALSE
     GROUP BY sc.affiliation_id, v.id`,
    [today]
  );

  // Build per-affiliation 100% counts
  const aff100 = {};
  for (const s of schoolStatus) {
    const key = s.affiliation_id;
    if (!aff100[key]) aff100[key] = { schools100: 0, vehicles100: 0 };
    if (s.m_expected > 0 && s.m_done >= s.m_expected && s.e_expected > 0 && s.e_done >= s.e_expected) {
      aff100[key].schools100++;
    }
  }
  for (const v of vehicleStatus) {
    const key = v.affiliation_id;
    if (!aff100[key]) aff100[key] = { schools100: 0, vehicles100: 0 };
    if (v.total > 0 && v.m_done >= v.total && v.e_done >= v.total) {
      aff100[key].vehicles100++;
    }
  }

  return rows.map((r) => ({
    ...r,
    morning_kpi: r.morning_expected > 0 ? Math.round((r.morning_done / r.morning_expected) * 10000) / 100 : 0,
    evening_kpi: r.evening_expected > 0 ? Math.round((r.evening_done / r.evening_expected) * 10000) / 100 : 0,
    schools_at_100: aff100[r.id]?.schools100 ?? 0,
    vehicles_at_100: aff100[r.id]?.vehicles100 ?? 0,
  }));
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
async function getStudents({ search, grade, school_id, affiliation_id, vehicle_id, page = 1, per_page = 20, sort = 'first_name', order = 'asc' }) {
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
  if (vehicle_id) {
    where += ' AND s.vehicle_id = ?';
    params.push(vehicle_id);
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
            s.vehicle_id, v.plate_no, s.morning_enabled, s.evening_enabled,
            p.name AS parent_name, p.phone AS parent_phone
     FROM students s
     JOIN schools sc ON sc.id = s.school_id
     LEFT JOIN affiliations a ON a.id = sc.affiliation_id
     LEFT JOIN vehicles v ON v.id = s.vehicle_id
     LEFT JOIN parent_student ps ON ps.student_id = s.id AND ps.approved = TRUE
     LEFT JOIN parents p ON p.id = ps.parent_id AND p.is_deleted = FALSE
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
             WHERE s.vehicle_id = v.id AND s.is_deleted = FALSE) AS school_names,
            (SELECT vi.result FROM vehicle_inspections vi
             WHERE vi.vehicle_id = v.id ORDER BY vi.inspection_date DESC LIMIT 1) AS latest_inspection_result,
            (SELECT vi.inspection_date FROM vehicle_inspections vi
             WHERE vi.vehicle_id = v.id ORDER BY vi.inspection_date DESC LIMIT 1) AS latest_inspection_date
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

/**
 * getVehiclesAtRisk — top N vehicles needing attention, scored by inspection
 * + insurance state. Replicates the frontend riskScore() formula
 * (TransportDashboard.jsx:60-72) so a single source of intelligence powers
 * the Province "priority vehicles" widget.
 *
 * Scoring weights (additive — a single vehicle can hit multiple):
 *   FAILED inspection           +100  ('ไม่ผ่านตรวจ')
 *   no inspection on record     +80   ('ยังไม่ตรวจ')
 *   NEEDS_FIX                   +60   ('ต้องแก้ไข')
 *   insurance expired           +50   ('ประกันหมด')
 *   no insurance field          +40   ('ไม่มีข้อมูลประกัน')
 *   insurance expiring < 30d    +20   ('ประกันใกล้หมด')
 *
 * Only vehicles with ≥1 active student are considered (a vehicle with no
 * roster doesn't matter operationally).
 *
 * Ties broken by plate_no ASC (Thai locale-aware) for deterministic order
 * across re-fetches — keeps the widget from shuffling on every poll.
 */
async function getVehiclesAtRisk({ limit = 10 } = {}) {
  const topN = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

  const [rows] = await pool.query(`
    SELECT
      v.id,
      v.plate_no,
      v.insurance_expiry,
      (SELECT GROUP_CONCAT(DISTINCT sc.name ORDER BY sc.name SEPARATOR ', ')
        FROM students s
        JOIN schools sc ON sc.id = s.school_id AND sc.is_deleted = FALSE
        WHERE s.vehicle_id = v.id AND s.is_deleted = FALSE) AS school_names,
      (SELECT COUNT(*) FROM students s
        WHERE s.vehicle_id = v.id AND s.is_deleted = FALSE) AS student_count,
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
                  WHERE s.vehicle_id = v.id AND s.is_deleted = FALSE)
  `);

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
  getAffiliations,
  getSchools,
  getStudents,
  getVehicles,
  getStatusToday,
  getEmergencies,
  getVehiclesAtRisk,
};
