'use strict';

/**
 * vehicleLocation.service.js — Phase 7.2
 *
 * Live Vehicle Location Dashboard MVP. Latest-only (no history table).
 * Scope is JWT-derived in the routes; this service trusts its inputs.
 *
 * Status thresholds (server-side, computed on read):
 *   ONLINE       received_at ≥ NOW() - 60s   AND status='ACTIVE'
 *   STALE        60s < age ≤ 5min            AND status='ACTIVE'
 *   OFFLINE      age > 5min                  AND status='ACTIVE'  (or no row)
 *   PAUSED       row.status = 'PAUSED'       (driver explicitly stopped)
 *   LOW_ACCURACY accuracy_meters > 200       (overlay flag)
 */

const { pool } = require('../config/database');
const { logAudit } = require('../utils/audit');
const { gradeEquivalents } = require('../utils/gradeScope');

const ONLINE_SECONDS_MAX = 60;        // ≤ 60s = ONLINE
const STALE_SECONDS_MAX  = 5 * 60;    // ≤ 5min = STALE; > 5min = OFFLINE
const LOW_ACCURACY_M     = 200;       // > 200m = LOW_ACCURACY overlay

/**
 * Pick the active driver_id for a vehicle (used by the sender route to
 * stamp UPSERTs). One row in driver_vehicle_assignments with is_active=TRUE.
 * Returns null if no active assignment.
 */
async function getActiveDriverIdForVehicle(vehicleId) {
  const [rows] = await pool.query(
    `SELECT driver_id
     FROM   driver_vehicle_assignments
     WHERE  vehicle_id = ? AND is_active = TRUE
     LIMIT  1`,
    [vehicleId]
  );
  return rows.length ? rows[0].driver_id : null;
}

/**
 * UPSERT the latest-location row for a vehicle. Server-trusted call:
 * caller must have already resolved vehicleId from JWT scope.
 */
async function upsertLocation({
  vehicleId,
  driverId,
  latitude,
  longitude,
  accuracyMeters = null,
  speedMps = null,
  headingDeg = null,
  recordedAt,
  source = 'web',
}) {
  await pool.query(
    `INSERT INTO vehicle_latest_locations
       (vehicle_id, driver_id, latitude, longitude, accuracy_meters,
        speed_mps, heading_deg, recorded_at, received_at, source, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), ?, 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       driver_id       = VALUES(driver_id),
       latitude        = VALUES(latitude),
       longitude       = VALUES(longitude),
       accuracy_meters = VALUES(accuracy_meters),
       speed_mps       = VALUES(speed_mps),
       heading_deg     = VALUES(heading_deg),
       recorded_at     = VALUES(recorded_at),
       received_at     = CURRENT_TIMESTAMP(3),
       source          = VALUES(source),
       status          = 'ACTIVE'`,
    [vehicleId, driverId, latitude, longitude, accuracyMeters,
     speedMps, headingDeg, recordedAt, source]
  );

  // Phase 11A — append to the history trail. Best-effort: a failure here
  // only means a gap in the trail (ETA / deviation will be slightly less
  // accurate for this ping); the latest-location row is already written.
  // The history table is created by migration 040 and only exists when the
  // intelligent tracking layer is in use, so wrap in try/catch + a table
  // probe to avoid spamming errors on systems that haven't run 040 yet.
  try {
    await pool.query(
      `INSERT INTO vehicle_location_history
         (vehicle_id, driver_id, latitude, longitude, accuracy_meters,
          speed_mps, heading_deg, recorded_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [vehicleId, driverId, latitude, longitude, accuracyMeters,
       speedMps, headingDeg, recordedAt, source]
    );
  } catch (err) {
    // ER_NO_SUCH_TABLE = migration 040 not applied yet — silent.
    // Other errors = log once, never throw.
    if (String(err.code || '') !== 'ER_NO_SUCH_TABLE') {
      console.warn('[vehicleLocation] history insert failed:', err.message);
    }
  }
}

/**
 * Driver hit Stop. Flip status to PAUSED so viewers show "หยุดส่งแล้ว"
 * instead of treating it as offline. The row is kept for last-seen.
 * No-op if no row exists yet.
 */
async function pauseLocation(vehicleId) {
  const [r] = await pool.query(
    `UPDATE vehicle_latest_locations
     SET    status = 'PAUSED'
     WHERE  vehicle_id = ?`,
    [vehicleId]
  );
  return r.affectedRows > 0;
}

/**
 * Compute a status string from a row + now.
 * Returns one of: ONLINE | STALE | OFFLINE | PAUSED.
 * LOW_ACCURACY is a separate overlay flag (returned as boolean).
 */
function computeStatus(row, nowMs) {
  // No row, or LEFT JOIN gave a row with no live data → OFFLINE.
  // (`null <= 60` is truthy in JS, so we MUST short-circuit before
  // the age ladder; otherwise vehicles never broadcast appear ONLINE.)
  if (!row || !row.received_at) {
    return { status: 'OFFLINE', low_accuracy: false, seconds_since_seen: null };
  }
  if (row.status === 'PAUSED') {
    return {
      status: 'PAUSED',
      low_accuracy: false,
      seconds_since_seen: ageSeconds(row, nowMs),
    };
  }
  const age = ageSeconds(row, nowMs);
  let status;
  if (age <= ONLINE_SECONDS_MAX)      status = 'ONLINE';
  else if (age <= STALE_SECONDS_MAX)  status = 'STALE';
  else                                status = 'OFFLINE';
  return {
    status,
    low_accuracy: row.accuracy_meters != null && row.accuracy_meters > LOW_ACCURACY_M,
    seconds_since_seen: age,
  };
}

function ageSeconds(row, nowMs) {
  if (!row || !row.received_at) return null;
  const t = new Date(row.received_at).getTime();
  return Math.max(0, Math.floor((nowMs - t) / 1000));
}

/**
 * Project a SELECTed row + computed status into the public response shape.
 * NEVER include phone/cid_hash/line_user_id/dropoff_address/password_hash.
 */
function toPublicVehicle(row, nowMs, { includeStudentCountInScope = false } = {}) {
  const live = computeStatus(row, nowMs);
  const out = {
    vehicle_id:        row.vehicle_id,
    plate_no:          row.plate_no,
    vehicle_type:      row.vehicle_type || null,
    driver_name:       row.driver_name || null,    // first/last only — no phone
    latitude:          row.latitude != null ? Number(row.latitude) : null,
    longitude:         row.longitude != null ? Number(row.longitude) : null,
    accuracy_meters:   row.accuracy_meters,
    speed_mps:         row.speed_mps,
    heading_deg:       row.heading_deg,
    recorded_at:       row.recorded_at,
    received_at:       row.received_at,
    seconds_since_seen: live.seconds_since_seen,
    status:            live.status,
    low_accuracy:      live.low_accuracy,
  };
  if (includeStudentCountInScope) {
    out.student_count_in_scope = Number(row.student_count_in_scope || 0);
  }
  return out;
}

/* ─── Scope-resolved viewer queries ───────────────────────────────────────── */

const SELECT_VEHICLE_BASE = `
  SELECT v.id            AS vehicle_id,
         v.plate_no,
         v.vehicle_type,
         vll.latitude, vll.longitude, vll.accuracy_meters,
         vll.speed_mps, vll.heading_deg,
         vll.recorded_at, vll.received_at, vll.status,
         (SELECT d.name FROM driver_vehicle_assignments dva
          JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
          WHERE dva.vehicle_id = v.id AND dva.is_active = TRUE
          LIMIT 1) AS driver_name`;

/**
 * Vehicles serving a single school.
 * Reuses the existing scope chain (students.vehicle_id + s.school_id).
 *
 * Phase 7.11.3 — optional `gradeFilter` (Thai canonical) further
 * narrows the inner subquery to students of one grade so a homeroom
 * teacher sees only vehicles carrying her grade. null = full school.
 */
async function listForSchool(schoolId, gradeFilter = null) {
  // Tolerant grade match (see gradeScope.js). With an exact `= ?` a teacher whose
  // pupils are stored as 'ประถมศึกษาปีที่ 4' gets an empty vehicle list and no
  // indication that a filter, rather than reality, emptied it.
  const eq = gradeFilter ? gradeEquivalents(gradeFilter) : null;
  const subqueryGrade = eq ? ` AND s.grade IN (${eq.map(() => '?').join(',')})` : '';
  const params = eq ? [schoolId, ...eq] : [schoolId];
  const [rows] = await pool.query(
    `${SELECT_VEHICLE_BASE}
     FROM vehicles v
     LEFT JOIN vehicle_latest_locations vll ON vll.vehicle_id = v.id
     WHERE v.is_deleted = FALSE
       AND v.id IN (
         SELECT DISTINCT s.vehicle_id FROM students s
         WHERE s.school_id = ? AND s.is_deleted = FALSE AND s.vehicle_id IS NOT NULL${subqueryGrade}
       )
     ORDER BY v.plate_no`,
    params
  );
  const now = Date.now();
  return rows.map(r => toPublicVehicle(r, now));
}

/**
 * Vehicles serving any school in an affiliation. Per user decision in
 * Phase 7 plan: a vehicle is visible to affiliation X if any of its
 * students belongs to a school in affiliation X — even if that vehicle
 * also serves schools in other affiliations.
 */
async function listForAffiliation(affiliationId) {
  const [rows] = await pool.query(
    `${SELECT_VEHICLE_BASE},
            (SELECT COUNT(*) FROM students s
             JOIN schools sc ON sc.id = s.school_id
             WHERE s.vehicle_id = v.id
               AND s.is_deleted = FALSE
               AND sc.affiliation_id = ?) AS student_count_in_scope
     FROM vehicles v
     LEFT JOIN vehicle_latest_locations vll ON vll.vehicle_id = v.id
     WHERE v.is_deleted = FALSE
       AND v.id IN (
         SELECT DISTINCT s.vehicle_id FROM students s
         JOIN schools sc ON sc.id = s.school_id
         WHERE sc.affiliation_id = ?
           AND s.is_deleted = FALSE
           AND s.vehicle_id IS NOT NULL
       )
     ORDER BY v.plate_no`,
    [affiliationId, affiliationId]
  );
  const now = Date.now();
  return rows.map(r => toPublicVehicle(r, now, { includeStudentCountInScope: true }));
}

/**
 * All vehicles (province / admin). No scope filter beyond is_deleted.
 */
async function listAll() {
  const [rows] = await pool.query(
    `${SELECT_VEHICLE_BASE},
            (SELECT COUNT(*) FROM students s
             WHERE s.vehicle_id = v.id AND s.is_deleted = FALSE) AS student_count_in_scope
     FROM vehicles v
     LEFT JOIN vehicle_latest_locations vll ON vll.vehicle_id = v.id
     WHERE v.is_deleted = FALSE
     ORDER BY v.plate_no`,
    []
  );
  const now = Date.now();
  return rows.map(r => toPublicVehicle(r, now, { includeStudentCountInScope: true }));
}

/**
 * Audit a viewer page-load with a 5-minute dedup window. Used only by
 * aggregate viewers (affiliation/province/admin). Returns true if a new
 * audit row was written, false if skipped due to dedup. Errors are
 * swallowed (audit must never block a viewer GET).
 */
async function maybeAuditView({ userId, entityId, ipAddress, userAgent }) {
  try {
    const [rows] = await pool.query(
      `SELECT 1 FROM audit_logs
       WHERE  user_id     = ?
         AND  action      = 'VIEW'
         AND  entity_type = 'live_vehicles'
         AND  entity_id   = ?
         AND  created_at  > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
       LIMIT  1`,
      [userId, String(entityId)]
    );
    if (rows.length) return false;
    await logAudit({
      userId, action: 'VIEW',
      entityType: 'live_vehicles',
      entityId: String(entityId),
      ipAddress, userAgent,
    });
    return true;
  } catch (err) {
    // Never let audit failure break a viewer page
    // eslint-disable-next-line no-console
    console.error('[vehicleLocation] audit skipped:', err?.message);
    return false;
  }
}

module.exports = {
  // sender-side
  getActiveDriverIdForVehicle,
  upsertLocation,
  pauseLocation,
  // viewer-side
  listForSchool,
  listForAffiliation,
  listAll,
  maybeAuditView,
  // exposed for tests / debugging
  computeStatus,
  toPublicVehicle,
  // Phase 10.7B-1 — threshold constants exported so other services
  // (e.g. province.service.js dashboard buckets) share the single source
  // of truth and don't drift from computeStatus() semantics.
  ONLINE_SECONDS_MAX,
  STALE_SECONDS_MAX,
};
