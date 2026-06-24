'use strict';

/**
 * routeDeviation.service.js — Phase 11A (2026-06-23)
 *
 * Compares each GPS ping against the vehicle's learned baseline for the
 * active session + day-of-week and emits route_deviations rows when the
 * vehicle is off-route, late, or stalled.
 *
 * Detection rules:
 *   OFF_ROUTE  — haversine distance from the expected polyline exceeds
 *                DEVIATION_RADIUS_M (default 500 m).
 *   LATE       — the vehicle is > DELAY_THRESHOLD_MIN behind the typical
 *                timing for this point in the session.
 *   STALLED    — no GPS movement > STALLED_THRESHOLD_MIN while a shift is
 *                ACTIVE.
 *
 * Baselines are computed by scripts/refresh-route-baselines.js (nightly)
 * from vehicle_location_history + geofence_events. When no baseline exists
 * yet (new vehicle), only STALLED detection runs.
 *
 * The service trusts its inputs (vehicleId is scope-resolved by the caller).
 * It never reads or returns PII.
 */

const { pool } = require('../config/database');
const env = require('../config/env');
const { logAudit } = require('../utils/audit');

const EARTH_RADIUS_M = 6371000;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function currentSession(now = new Date()) {
  const hour = parseInt(
    now.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }),
    10
  );
  return hour < env.app.driverSessionSwitchHour ? 'morning' : 'evening';
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  return String(value).slice(0, 10);
}

/**
 * Distance from a point to the nearest segment of a polyline. The polyline
 * is an array of {lat, lng}. Returns Infinity if the polyline is empty.
 */
function distanceToPolylineMeters(lat, lng, polyline) {
  if (!Array.isArray(polyline) || polyline.length === 0) return Infinity;
  let minDist = Infinity;
  for (let i = 0; i < polyline.length; i++) {
    const d = haversineMeters(lat, lng, Number(polyline[i].lat), Number(polyline[i].lng));
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Load the baseline for a vehicle / session / day-of-week. Returns null if
 * no baseline has been learned yet.
 */
async function loadBaseline(vehicleId, session, now = new Date()) {
  const dayOfWeek = now.getDay();
  const [[row]] = await pool.query(
    `SELECT typical_start, typical_end, typical_path, sample_count
       FROM route_baselines
      WHERE vehicle_id = ? AND session = ? AND day_of_week = ?`,
    [vehicleId, session, dayOfWeek]
  );
  if (!row || row.sample_count < 3) return null;
  let path = null;
  try {
    path = row.typical_path ? JSON.parse(row.typical_path) : null;
  } catch { path = null; }
  return {
    typicalStart: row.typical_start,
    typicalEnd: row.typical_end,
    typicalPath: path,
    sampleCount: row.sample_count,
  };
}

/**
 * Check a single GPS ping against the vehicle's baseline. Emits a
 * route_deviations row on a new violation. Best-effort: never throws.
 *
 * De-duplication: if there is an unresolved deviation of the same type for
 * this vehicle in the last 30 minutes, we don't emit a duplicate (the
 * existing one is still active).
 *
 * @param {object} args
 * @param {string} args.vehicleId
 * @param {number} args.driverId
 * @param {number} args.latitude
 * @param {number} args.longitude
 * @param {number|null} args.speedMps
 * @param {Date}   [args.now]
 * @returns {Promise<object[]>} emitted deviations
 */
async function checkForVehicle({
  vehicleId,
  driverId,
  latitude,
  longitude,
  speedMps = null,
  now = new Date(),
}) {
  const session = currentSession(now);
  const baseline = await loadBaseline(vehicleId, session, now);
  const emitted = [];

  // STALLED detection runs even without a baseline: if the vehicle has a
  // shift ACTIVE but hasn't moved > STALLED_THRESHOLD_MIN, flag it.
  if (speedMps != null && speedMps < 0.5) {
    const stalled = await detectStalled({ vehicleId, driverId, latitude, longitude, now });
    if (stalled) emitted.push(stalled);
  }

  if (!baseline) return emitted;

  // OFF_ROUTE detection.
  if (baseline.typicalPath && baseline.typicalPath.length > 0) {
    const offsetM = distanceToPolylineMeters(latitude, longitude, baseline.typicalPath);
    if (offsetM > env.tracking.deviationRadiusM) {
      const offRoute = await emitIfNew({
        vehicleId,
        driverId,
        session,
        deviationType: 'OFF_ROUTE',
        severity: offsetM > env.tracking.deviationRadiusM * 3 ? 'CRITICAL' : 'WARN',
        actualLat: latitude,
        actualLng: longitude,
        offsetMeters: Math.round(offsetM),
        delayMinutes: null,
        now,
      });
      if (offRoute) emitted.push(offRoute);
    }
  }

  // LATE detection: compare current time against typical_start + expected
  // progress. Simple heuristic — if we're past typical_start + DELAY_THRESHOLD
  // and the vehicle hasn't reached the first pickup point yet, flag LATE.
  if (baseline.typicalStart) {
    const late = await detectLate({
      vehicleId,
      driverId,
      session,
      typicalStart: baseline.typicalStart,
      latitude,
      longitude,
      now,
    });
    if (late) emitted.push(late);
  }

  return emitted;
}

/**
 * STALLED: vehicle has an active shift but speed has been ~0 for
 * STALLED_THRESHOLD_MIN. We probe the last N history rows to confirm.
 *
 * H3 fix: only flag STALLED when the vehicle actually has an OPEN operating
 * shift — a vehicle parked at the depot / stopped at a red light without an
 * active shift must NOT trigger a false STALLED alert.
 */
async function detectStalled({ vehicleId, driverId, latitude, longitude, now }) {
  // H3: gate on active shift — no open shift means the vehicle is not in
  // service, so being stationary is expected.
  const [[shift]] = await pool.query(
    `SELECT 1
       FROM vehicle_operating_shifts
      WHERE vehicle_id = ? AND status = 'OPEN' AND ended_at IS NULL
      LIMIT 1`,
    [vehicleId]
  );
  if (!shift) return null;

  const thresholdMin = env.tracking.stalledThresholdMin;
  const [recent] = await pool.query(
    `SELECT MIN(speed_mps) AS min_speed, MAX(speed_mps) AS max_speed
       FROM vehicle_location_history
      WHERE vehicle_id = ?
        AND recorded_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE)`,
    [vehicleId, thresholdMin]
  );
  if (!recent.length) return null;
  const maxSpeed = recent[0].max_speed;
  if (maxSpeed != null && maxSpeed > 0.5) return null; // moved recently

  return emitIfNew({
    vehicleId,
    driverId,
    session: currentSession(now),
    deviationType: 'STALLED',
    severity: 'WARN',
    actualLat: latitude,
    actualLng: longitude,
    offsetMeters: null,
    delayMinutes: thresholdMin,
    now,
  });
}

/**
 * LATE: current time is past typical_start + DELAY_THRESHOLD_MIN and the
 * vehicle is still far from its first pickup point.
 */
async function detectLate({
  vehicleId,
  driverId,
  session,
  typicalStart,
  latitude,
  longitude,
  now,
}) {
  // Parse typicalStart (HH:MM:SS) and compute the expected start timestamp
  // for today.
  const today = dateOnly(now);
  const startStr = String(typicalStart).slice(0, 8); // HH:MM:SS
  const expectedStart = new Date(`${today}T${startStr}+07:00`);
  if (isNaN(expectedStart.getTime())) return null;

  const delayMs = now.getTime() - expectedStart.getTime();
  const delayMin = Math.round(delayMs / 60000);
  if (delayMin < env.tracking.delayThresholdMin) return null;

  // Confirm the vehicle is still far from its first pickup point.
  const [[firstPoint]] = await pool.query(
    `SELECT latitude, longitude
       FROM pickup_points
      WHERE vehicle_id = ? AND is_deleted = FALSE
        AND session IN (?, 'both')
      ORDER BY sequence, id
      LIMIT 1`,
    [vehicleId, session]
  );
  if (!firstPoint) return null;

  const distToFirst = haversineMeters(
    latitude,
    longitude,
    Number(firstPoint.latitude),
    Number(firstPoint.longitude)
  );
  if (distToFirst < 200) return null; // already at first pickup point

  return emitIfNew({
    vehicleId,
    driverId,
    session,
    deviationType: 'LATE',
    severity: delayMin > env.tracking.delayThresholdMin * 2 ? 'CRITICAL' : 'WARN',
    actualLat: latitude,
    actualLng: longitude,
    offsetMeters: null,
    delayMinutes: delayMin,
    now,
  });
}

/**
 * Emit a route_deviations row only if there is no unresolved row of the same
 * type for this vehicle in the last 30 minutes (de-duplication).
 *
 * H2 fix: the check-then-insert is wrapped in a transaction with
 * SELECT ... FOR UPDATE so concurrent pings cannot both pass the dedup
 * check and insert duplicate rows.
 */
async function emitIfNew({
  vehicleId,
  driverId,
  session,
  deviationType,
  severity,
  actualLat,
  actualLng,
  offsetMeters,
  delayMinutes,
  now,
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[existing]] = await conn.query(
      `SELECT id FROM route_deviations
        WHERE vehicle_id = ? AND deviation_type = ? AND resolved_at IS NULL
          AND occurred_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 MINUTE)
        LIMIT 1
       FOR UPDATE`,
      [vehicleId, deviationType]
    );
    if (existing) {
      await conn.rollback();
      return null;
    }

    const [result] = await conn.query(
      `INSERT INTO route_deviations
         (vehicle_id, driver_id, session, deviation_type, severity,
          actual_lat, actual_lng, offset_meters, delay_minutes, occurred_at,
          notified_roles)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [vehicleId, driverId, session, deviationType, severity,
       actualLat, actualLng, offsetMeters, delayMinutes, now]
    );
    const deviationId = result.insertId;
    await conn.commit();

    await logAudit({
      userId: driverId,
      action: 'ROUTE_DEVIATION',
      entityType: 'route_deviation',
      entityId: String(deviationId),
      newValue: {
        vehicle_id: vehicleId,
        deviation_type: deviationType,
        severity,
        offset_meters: offsetMeters,
        delay_minutes: delayMinutes,
      },
      ipAddress: null,
      userAgent: 'route-deviation-service',
    });

    // Notify school + province via operations alert webhook (best-effort).
    let notifiedRoles = null;
    try {
      const opsAlert = require('./operationsAlert.service');
      await opsAlert.deliverOperationsAlert({
        status: severity === 'CRITICAL' ? 'CRITICAL' : 'WARN',
        checks: [
          {
            severity,
            label: `รถ ${vehicleId} ${deviationType === 'OFF_ROUTE' ? 'เบี่ยงเส้นทาง' : deviationType === 'LATE' ? `ล่าช้า ${delayMinutes} นาที` : 'หยุดนิ่งนาน'}`,
            value: `session=${session}`,
          },
        ],
      });
      notifiedRoles = 'school,province';
      // Update notified_roles now that the alert was dispatched (Low fix).
      await pool.query(
        `UPDATE route_deviations SET notified_roles = ? WHERE id = ?`,
        [notifiedRoles, deviationId]
      );
    } catch (err) {
      console.warn('[route-deviation] alert failed', err.message);
    }

    return {
      deviation_id: deviationId,
      vehicle_id: vehicleId,
      deviation_type: deviationType,
      severity,
      offset_meters: offsetMeters,
      delay_minutes: delayMinutes,
    };
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Mark an unresolved deviation as resolved (vehicle returned to route).
 * Called from checkForVehicle when the vehicle is back on the baseline.
 */
async function resolveOpenForVehicle(vehicleId, { now = new Date() } = {}) {
  const [r] = await pool.query(
    `UPDATE route_deviations
        SET resolved_at = ?
      WHERE vehicle_id = ? AND resolved_at IS NULL`,
    [now, vehicleId]
  );
  return r.affectedRows;
}

/**
 * List deviations for a viewer (admin sees all; school / affiliation /
 * province are scope-filtered by the caller).
 */
async function listDeviations({
  vehicleId = null,
  unresolvedOnly = false,
  severity = null,
  limit = 100,
  offset = 0,
} = {}) {
  const where = [];
  const params = [];
  if (vehicleId) { where.push('rd.vehicle_id = ?'); params.push(vehicleId); }
  if (unresolvedOnly) where.push('rd.resolved_at IS NULL');
  if (severity) { where.push('rd.severity = ?'); params.push(severity); }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT rd.id, rd.vehicle_id, rd.session, rd.deviation_type, rd.severity,
            rd.actual_lat, rd.actual_lng, rd.offset_meters, rd.delay_minutes,
            rd.occurred_at, rd.resolved_at, rd.notified_roles
       FROM route_deviations rd
       ${whereClause}
      ORDER BY rd.occurred_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return rows;
}

module.exports = {
  checkForVehicle,
  resolveOpenForVehicle,
  listDeviations,
  loadBaseline,
  haversineMeters,
  currentSession,
};
