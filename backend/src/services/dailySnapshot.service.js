'use strict';

/**
 * dailySnapshot.service.js — system-wide daily_snapshots row.
 *
 * Shared by POST /api/admin/snapshots/run (manual/baseline button) and
 * backend/scripts/daily-snapshot.js (cron, run_type 'auto'). The metric
 * queries were moved here verbatim from admin.routes.js so both paths measure
 * the same thing.
 *
 * Note on idempotency: uk_date_scope is (snapshot_date, scope_type, scope_id)
 * and scope_id is NULL for 'system', and MySQL treats NULLs as distinct in a
 * unique key — so `REPLACE INTO` never actually replaces a system row. The cron
 * path therefore checks for an existing row itself and never overwrites one
 * (a manual or baseline snapshot taken that day wins).
 */

const { todayBangkok } = require('../utils/thaiTime');

async function computeSystemMetrics(db, snapshotDate) {
  const [[students]] = await db.query(
    `SELECT COUNT(*) AS total,
            SUM(vehicle_id IS NOT NULL) AS with_vehicle
     FROM students WHERE is_deleted = FALSE`
  );

  const [[parentCoverage]] = await db.query(
    `SELECT COUNT(DISTINCT ps.student_id) AS cnt
     FROM parent_student ps JOIN students s ON s.id = ps.student_id AND s.is_deleted = FALSE
     WHERE ps.approved = TRUE`
  );

  const [[vehicleStats]] = await db.query(
    `SELECT COUNT(*) AS total,
            SUM(insurance_expiry IS NOT NULL AND insurance_expiry >= CURDATE()) AS with_insurance
     FROM vehicles WHERE is_deleted = FALSE`
  );

  const [[inspectionStats]] = await db.query(
    `SELECT COUNT(DISTINCT sub.vehicle_id) AS inspected, SUM(sub.result = 'PASSED') AS passed
     FROM (
       SELECT vi.vehicle_id, vi.result FROM vehicle_inspections vi
       INNER JOIN (SELECT vehicle_id, MAX(inspection_date) AS md FROM vehicle_inspections GROUP BY vehicle_id) lat
       ON vi.vehicle_id = lat.vehicle_id AND vi.inspection_date = lat.md
     ) sub`
  );

  const [[completion]] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM students WHERE is_deleted=FALSE AND morning_enabled=TRUE) AS m_total,
       (SELECT COUNT(DISTINCT student_id) FROM daily_status WHERE check_date=? AND morning_done=TRUE) AS m_done,
       (SELECT COUNT(*) FROM students WHERE is_deleted=FALSE AND evening_enabled=TRUE) AS e_total,
       (SELECT COUNT(DISTINCT student_id) FROM daily_status WHERE check_date=? AND evening_done=TRUE) AS e_done`,
    [snapshotDate, snapshotDate]
  );

  const [[userStats]] = await db.query(
    `SELECT COUNT(*) AS total, SUM(is_active AND last_login IS NOT NULL) AS active
     FROM users WHERE is_deleted = FALSE`
  );

  const [[emergencyStats]] = await db.query(
    `SELECT COUNT(*) AS cnt FROM emergency_logs
     WHERE DATE(reported_at) = ? AND is_deleted = FALSE`, [snapshotDate]
  );

  return {
    total_students: students.total,
    students_with_vehicle: students.with_vehicle,
    students_with_parent: parentCoverage.cnt,
    total_vehicles: vehicleStats.total,
    vehicles_with_insurance: vehicleStats.with_insurance || 0,
    vehicles_inspected: inspectionStats.inspected || 0,
    vehicles_passed: inspectionStats.passed || 0,
    morning_total: completion.m_total,
    morning_done: completion.m_done,
    evening_total: completion.e_total,
    evening_done: completion.e_done,
    emergency_count: emergencyStats.cnt,
    active_users: userStats.active || 0,
    total_users: userStats.total,
  };
}

async function writeSystemSnapshot(db, {
  snapshotDate, metrics, isBaseline = false, baselineNote = null, runType = 'manual',
  researchPhase = null, createdBy = null,
}) {
  const m = metrics;
  await db.query(
    `REPLACE INTO daily_snapshots
     (snapshot_date, scope_type, scope_id,
      total_students, students_with_vehicle, students_with_parent,
      total_vehicles, vehicles_with_insurance, vehicles_inspected, vehicles_passed,
      morning_total, morning_done, evening_total, evening_done,
      emergency_count, active_users, total_users,
      is_baseline, baseline_note, run_type, research_phase, created_by)
     VALUES (?, 'system', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshotDate,
      m.total_students, m.students_with_vehicle, m.students_with_parent,
      m.total_vehicles, m.vehicles_with_insurance,
      m.vehicles_inspected, m.vehicles_passed,
      m.morning_total, m.morning_done, m.evening_total, m.evening_done,
      m.emergency_count, m.active_users, m.total_users,
      isBaseline, baselineNote, runType, researchPhase, createdBy,
    ]
  );
}

/**
 * Cron entry: take today's (Bangkok) automatic snapshot unless a system
 * snapshot for that date already exists. Returns { status, snapshotDate, metrics? }.
 */
async function runDailySnapshot(db, { date = null, now = new Date(), dryRun = false } = {}) {
  const snapshotDate = date || todayBangkok(now);
  const [existing] = await db.query(
    `SELECT id, run_type FROM daily_snapshots
      WHERE snapshot_date = ? AND scope_type = 'system' LIMIT 1`,
    [snapshotDate]
  );
  if (existing.length) {
    return { status: 'EXISTS', snapshotDate, existingRunType: existing[0].run_type };
  }
  const metrics = await computeSystemMetrics(db, snapshotDate);
  if (dryRun) return { status: 'DRY_RUN', snapshotDate, metrics };
  await writeSystemSnapshot(db, { snapshotDate, metrics, runType: 'auto' });
  const { logAudit } = require('../utils/audit');
  await logAudit({
    action: 'CREATE', entityType: 'daily_snapshot', entityId: snapshotDate,
    newValue: { date: snapshotDate, run_type: 'auto', is_baseline: false, research_phase: null },
    userAgent: 'daily-snapshot', conn: db,
  });
  return { status: 'CREATED', snapshotDate, metrics };
}

module.exports = { computeSystemMetrics, writeSystemSnapshot, runDailySnapshot };
