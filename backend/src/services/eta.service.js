'use strict';

/**
 * eta.service.js — Phase 11A (2026-06-23)
 *
 * Predicts each vehicle's ETA at every pickup point on its route, using the
 * vehicle's recent GPS speed + the haversine distance to the pickup point.
 * Predictions are cached in `eta_predictions` (UPSERT per ping) so reads are
 * O(1) for parent / school / admin dashboards.
 *
 * Confidence:
 *   HIGH    vehicle is moving at a believable speed and < 2 km away
 *   MEDIUM  vehicle is moving but far / sparse data
 *   LOW     vehicle is stationary or accuracy is poor
 *   UNKNOWN no recent GPS data for this vehicle
 *
 * The service trusts its inputs (vehicleId / pickupPointId are scope-resolved
 * by the caller). It never reads or returns PII.
 */

const { pool } = require('../config/database');
const env = require('../config/env');

const EARTH_RADIUS_M = 6371000;
const MIN_CONFIDENCE_SPEED_MPS = env.tracking.etaMinConfidenceSpeedMps;

/**
 * Haversine distance in metres between two lat/lng points.
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a)));
}

/**
 * Resolve the current session (morning | evening) from Bangkok local hour.
 * Mirrors the convention in driver.routes.js (DRIVER_SESSION_SWITCH_HOUR).
 */
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
 * Compute and cache ETA predictions for one vehicle against all of its
 * pickup points for the active session. Called from the /vehicle-location
 * hook after a GPS upsert. Best-effort: never throws — a failure only means
 * the cached ETA is stale until the next ping.
 *
 * @param {object} args
 * @param {string} args.vehicleId
 * @param {number} args.latitude
 * @param {number} args.longitude
 * @param {number|null} args.speedMps
 * @param {number|null} args.accuracyMeters
 * @param {Date}   [args.now]
 */
async function refreshForVehicle({
  vehicleId,
  latitude,
  longitude,
  speedMps = null,
  accuracyMeters = null,
  now = new Date(),
}) {
  const session = currentSession(now);
  const today = dateOnly(now);

  // Pull the vehicle's pickup points for this session (or 'both').
  const [points] = await pool.query(
    `SELECT id, label, latitude, longitude, sequence
       FROM pickup_points
      WHERE vehicle_id = ?
        AND is_deleted = FALSE
        AND session IN (?, 'both')
      ORDER BY sequence, id`,
    [vehicleId, session]
  );
  if (!points.length) return [];

  // Use the reported speed if plausible, else fall back to a conservative
  // urban average (default 8 m/s ≈ 29 km/h, configurable via
  // ETA_FALLBACK_SPEED_MPS) so ETA is still useful when the driver app
  // omits speed. This is separate from etaMinConfidenceSpeedMps (which is
  // a confidence threshold, not a fallback speed).
  const fallbackSpeed = env.tracking.etaFallbackSpeedMps || 8;
  const effectiveSpeed = speedMps != null && speedMps > 0 ? speedMps : fallbackSpeed;

  const results = [];
  for (const p of points) {
    const distanceM = haversineMeters(latitude, longitude, Number(p.latitude), Number(p.longitude));
    const etaSeconds = Math.round(distanceM / effectiveSpeed);
    const confidence = classifyConfidence({
      speedMps,
      accuracyMeters,
      distanceM,
      etaSeconds,
    });

    await pool.query(
      `INSERT INTO eta_predictions
         (vehicle_id, pickup_point_id, session, eta_date,
          eta_seconds, eta_at, distance_meters, confidence, computed_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND), ?, ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
         eta_seconds     = VALUES(eta_seconds),
         eta_at          = VALUES(eta_at),
         distance_meters = VALUES(distance_meters),
         confidence      = VALUES(confidence),
         computed_at     = CURRENT_TIMESTAMP(3)`,
      [vehicleId, p.id, session, today, etaSeconds, etaSeconds, distanceM, confidence]
    );

    results.push({
      pickup_point_id: p.id,
      label: p.label,
      sequence: p.sequence,
      session,
      eta_seconds: etaSeconds,
      distance_meters: distanceM,
      confidence,
    });
  }
  return results;
}

function classifyConfidence({ speedMps, accuracyMeters, distanceM, etaSeconds }) {
  if (speedMps == null || speedMps < MIN_CONFIDENCE_SPEED_MPS) return 'LOW';
  if (accuracyMeters != null && accuracyMeters > 200) return 'LOW';
  if (distanceM <= 2000 && etaSeconds <= 600) return 'HIGH';
  if (distanceM <= 8000) return 'MEDIUM';
  return 'LOW';
}

/**
 * Read cached ETAs for a vehicle (today, active session). Used by parent /
 * school / admin ETA endpoints. Returns [] when the feature is off.
 */
async function getForVehicle(vehicleId, { session = null, now = new Date() } = {}) {
  if (!env.features.eta) return [];
  const sess = session || currentSession(now);
  const today = dateOnly(now);
  const [rows] = await pool.query(
    `SELECT ep.pickup_point_id, pp.label, pp.sequence, ep.session,
            ep.eta_seconds, ep.eta_at, ep.distance_meters, ep.confidence,
            ep.computed_at,
            TIMESTAMPDIFF(SECOND, ep.computed_at, CURRENT_TIMESTAMP(3)) AS age_seconds
       FROM eta_predictions ep
       JOIN pickup_points pp ON pp.id = ep.pickup_point_id AND pp.is_deleted = FALSE
      WHERE ep.vehicle_id = ?
        AND ep.session = ?
        AND ep.eta_date = ?
      ORDER BY pp.sequence, pp.id`,
    [vehicleId, sess, today]
  );
  return rows;
}

/**
 * Read cached ETA for a single student's pickup point. Used by the parent
 * /api/parent/children/:id/eta endpoint. Returns an object with either ETA
 * data or a structured error code so the frontend can show a meaningful
 * message instead of a generic "no data".
 *
 * Return shapes:
 *   { ...eta fields }                    — ETA available
 *   { error: 'feature_disabled' }        — FEATURE_ETA=false
 *   { error: 'student_not_found' }       — student doesn't exist
 *   { error: 'no_vehicle' }              — student has no vehicle assigned
 *   { error: 'no_pickup_point' }         — student has no pickup point linked
 *   { error: 'vehicle_offline' }         — vehicle has no GPS today / no ETA row
 */
async function getForStudent(studentId, { now = new Date() } = {}) {
  if (!env.features.eta) return { error: 'feature_disabled' };
  const sess = currentSession(now);
  const today = dateOnly(now);

  // Step 1: verify student exists and has a vehicle.
  const [[student]] = await pool.query(
    `SELECT s.id, s.vehicle_id
       FROM students s
      WHERE s.id = ? AND s.is_deleted = FALSE`,
    [studentId]
  );
  if (!student) return { error: 'student_not_found' };
  if (!student.vehicle_id) return { error: 'no_vehicle' };

  // Step 2: verify student has a pickup point linked.
  const [[spp]] = await pool.query(
    `SELECT spp.pickup_point_id
       FROM student_pickup_points spp
       JOIN pickup_points pp ON pp.id = spp.pickup_point_id AND pp.is_deleted = FALSE
      WHERE spp.student_id = ?
      LIMIT 1`,
    [studentId]
  );
  if (!spp) return { error: 'no_pickup_point' };

  // Step 3: fetch the cached ETA prediction.
  // Returns plate_no (low sensitivity — parents already know their child's
  // vehicle) but NOT the internal vehicle_id (which is an implementation
  // detail that must not leak to parent-facing endpoints).
  const [[row]] = await pool.query(
    `SELECT ep.pickup_point_id, pp.label, ep.session,
            ep.eta_seconds, ep.eta_at, ep.distance_meters, ep.confidence,
            ep.computed_at,
            TIMESTAMPDIFF(SECOND, ep.computed_at, CURRENT_TIMESTAMP(3)) AS age_seconds,
            v.plate_no
       FROM students s
       JOIN student_pickup_points spp ON spp.student_id = s.id
       JOIN pickup_points pp ON pp.id = spp.pickup_point_id AND pp.is_deleted = FALSE
       JOIN eta_predictions ep
         ON ep.pickup_point_id = pp.id
        AND ep.vehicle_id = s.vehicle_id
        AND ep.session = ?
        AND ep.eta_date = ?
       JOIN vehicles v ON v.id = s.vehicle_id
      WHERE s.id = ?
        AND s.is_deleted = FALSE
      LIMIT 1`,
    [sess, today, studentId]
  );
  if (!row) return { error: 'vehicle_offline' };
  return row;
}

module.exports = {
  refreshForVehicle,
  getForVehicle,
  getForStudent,
  currentSession,
  haversineMeters,
};
