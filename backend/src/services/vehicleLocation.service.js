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
const { toBangkokSqlDateTime } = require('../utils/thaiTime');

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
 * Append a batch of buffered GPS fixes (recorded while the driver's phone had
 * no signal) to the history trail, then move the latest-location row forward
 * ONLY if the newest fix is newer than what is already stored — a late flush
 * of old points must never drag a live marker backwards.
 *
 * `points` are already validated by the route and carry `recordedAt`, a
 * Bangkok wall-clock SQL literal (toBangkokSqlDateTime), like the single
 * endpoint. Idempotent per (vehicle_id, recorded_at) without a schema change:
 * duplicates inside the batch are collapsed and fixes already in the trail are
 * skipped by a pre-check, so a retried flush does not double the route.
 * (Two flushes racing each other could still both insert; the driver app
 * flushes one batch at a time, and the replay de-duplicates on read.)
 *
 * Returns { inserted: [recordedAt…], duplicates: [recordedAt…], latest_updated }.
 */
async function appendHistoryBatch({ vehicleId, driverId, points, source = 'web' }) {
  const seen = new Set();
  const unique = [];
  const duplicates = [];
  for (const p of points) {
    if (seen.has(p.recordedAt)) { duplicates.push(p.recordedAt); continue; }
    seen.add(p.recordedAt);
    unique.push(p);
  }
  if (!unique.length) return { inserted: [], duplicates, latest_updated: false };

  const [existingRows] = await pool.query(
    `SELECT recorded_at FROM vehicle_location_history
     WHERE vehicle_id = ? AND recorded_at IN (${unique.map(() => '?').join(',')})`,
    [vehicleId, ...unique.map(p => p.recordedAt)]
  );
  const existing = new Set((existingRows || []).map(r => (
    r.recorded_at instanceof Date ? toBangkokSqlDateTime(r.recorded_at) : String(r.recorded_at)
  )));
  const fresh = [];
  for (const p of unique) {
    if (existing.has(p.recordedAt)) duplicates.push(p.recordedAt);
    else fresh.push(p);
  }

  if (fresh.length) {
    await pool.query(
      `INSERT INTO vehicle_location_history
         (vehicle_id, driver_id, latitude, longitude, accuracy_meters,
          speed_mps, heading_deg, recorded_at, source)
       VALUES ${fresh.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      fresh.flatMap(p => [vehicleId, driverId, p.latitude, p.longitude, p.accuracyMeters,
        p.speedMps, p.headingDeg, p.recordedAt, source])
    );
  }

  // Newest accepted fix (SQL literals of one fixed shape sort chronologically).
  const newest = fresh.reduce((a, b) => (a == null || b.recordedAt > a.recordedAt ? b : a), null);
  let latestUpdated = false;
  if (newest) {
    // received_at = the fix's own time (capped at now): a buffered point
    // describes where the bus WAS, so viewers must not see it as "online now".
    const nowSql = toBangkokSqlDateTime(new Date());
    const receivedAt = newest.recordedAt < nowSql ? newest.recordedAt : nowSql;
    const newer = 'VALUES(recorded_at) > recorded_at';
    // recorded_at is assigned LAST: MySQL evaluates the SET list left to
    // right with already-updated values, so every IF above it still compares
    // against the stored (old) recorded_at. status is left alone so a flush
    // never undoes a driver's explicit Stop.
    const [r] = await pool.query(
      `INSERT INTO vehicle_latest_locations
         (vehicle_id, driver_id, latitude, longitude, accuracy_meters,
          speed_mps, heading_deg, recorded_at, received_at, source, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
       ON DUPLICATE KEY UPDATE
         driver_id       = IF(${newer}, VALUES(driver_id),       driver_id),
         latitude        = IF(${newer}, VALUES(latitude),        latitude),
         longitude       = IF(${newer}, VALUES(longitude),       longitude),
         accuracy_meters = IF(${newer}, VALUES(accuracy_meters), accuracy_meters),
         speed_mps       = IF(${newer}, VALUES(speed_mps),       speed_mps),
         heading_deg     = IF(${newer}, VALUES(heading_deg),     heading_deg),
         received_at     = IF(${newer}, VALUES(received_at),     received_at),
         source          = IF(${newer}, VALUES(source),          source),
         recorded_at     = IF(${newer}, VALUES(recorded_at),     recorded_at)`,
      [vehicleId, driverId, newest.latitude, newest.longitude, newest.accuracyMeters,
        newest.speedMps, newest.headingDeg, newest.recordedAt, receivedAt, source]
    );
    // affectedRows: 1 = inserted, 2 = updated, 0 = unchanged (stored row newer).
    latestUpdated = Number(r && r.affectedRows) > 0;
  }

  return { inserted: fresh.map(p => p.recordedAt), duplicates, latest_updated: latestUpdated };
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

/**
 * The ONE definition of "which vehicles may this viewer see". The live list
 * (listForSchool / listForAffiliation / listAll) and the route-history replay
 * (findVehicleInScope) both build their WHERE from here, so a viewer can
 * replay exactly the vehicles it can see live — never more.
 *
 *   { schoolId, gradeFilter? }  vehicles carrying a (grade-filtered) pupil of the school
 *   { affiliationId }           vehicles carrying a pupil of any school in the affiliation
 *   { all: true }               every vehicle (province / admin)
 *
 * Returns a fragment that starts with " AND " (or is empty) and its params.
 * The caller supplies `v` as the vehicles alias.
 */
function vehicleScopeSql({ schoolId = null, gradeFilter = null, affiliationId = null, all = false } = {}) {
  if (schoolId) {
    const eq = gradeFilter ? gradeEquivalents(gradeFilter) : null;
    const subqueryGrade = eq ? ` AND s.grade IN (${eq.map(() => '?').join(',')})` : '';
    return {
      sql: `
       AND v.id IN (
         SELECT DISTINCT s.vehicle_id FROM students s
         WHERE s.school_id = ? AND s.is_deleted = FALSE AND s.vehicle_id IS NOT NULL${subqueryGrade}
       )`,
      params: eq ? [schoolId, ...eq] : [schoolId],
    };
  }
  if (affiliationId) {
    return {
      sql: `
       AND v.id IN (
         SELECT DISTINCT s.vehicle_id FROM students s
         JOIN schools sc ON sc.id = s.school_id
         WHERE sc.affiliation_id = ?
           AND s.is_deleted = FALSE
           AND s.vehicle_id IS NOT NULL
       )`,
      params: [affiliationId],
    };
  }
  // Fail CLOSED: an empty/unresolved scope (e.g. a missing school id) must never
  // widen to "every vehicle". Province/admin opt in explicitly with { all: true }.
  if (all === true) return { sql: '', params: [] };
  throw new Error('vehicleScopeSql: no scope given (pass schoolId, affiliationId or all:true)');
}

/**
 * One vehicle, only if it is inside the viewer's scope (see vehicleScopeSql).
 * Returns { vehicle_id, plate_no, vehicle_type } or null. No driver phone,
 * no student data.
 */
async function findVehicleInScope(vehicleId, scope) {
  if (!vehicleId) return null;
  const s = vehicleScopeSql(scope);
  const [rows] = await pool.query(
    `SELECT v.id AS vehicle_id, v.plate_no, v.vehicle_type
     FROM vehicles v
     WHERE v.is_deleted = FALSE AND v.id = ?${s.sql}
     LIMIT 1`,
    [vehicleId, ...s.params]
  );
  return rows[0] || null;
}

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
  const scope = vehicleScopeSql({ schoolId, gradeFilter });
  const [rows] = await pool.query(
    `${SELECT_VEHICLE_BASE}
     FROM vehicles v
     LEFT JOIN vehicle_latest_locations vll ON vll.vehicle_id = v.id
     WHERE v.is_deleted = FALSE${scope.sql}
     ORDER BY v.plate_no`,
    scope.params
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
     WHERE v.is_deleted = FALSE${vehicleScopeSql({ affiliationId }).sql}
     ORDER BY v.plate_no`,
    [affiliationId, ...vehicleScopeSql({ affiliationId }).params]
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
async function maybeAuditView({ userId, entityId, ipAddress, userAgent, entityType = 'live_vehicles' }) {
  try {
    const [rows] = await pool.query(
      `SELECT 1 FROM audit_logs
       WHERE  user_id     = ?
         AND  action      = 'VIEW'
         AND  entity_type = ?
         AND  entity_id   = ?
         AND  created_at  > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
       LIMIT  1`,
      [userId, entityType, String(entityId)]
    );
    if (rows.length) return false;
    await logAudit({
      userId, action: 'VIEW',
      entityType,
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
  appendHistoryBatch,
  pauseLocation,
  // viewer-side
  listForSchool,
  listForAffiliation,
  listAll,
  findVehicleInScope,
  vehicleScopeSql,
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
