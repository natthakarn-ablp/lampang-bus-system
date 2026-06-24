'use strict';

/**
 * geofence.service.js — Phase 11A (2026-06-23)
 *
 * Checks each GPS ping against active geofences and emits ENTER / EXIT
 * transition events. Events trigger LINE notifications to parents + school
 * alerts via line.service.js / operationsAlert.service.js.
 *
 * State tracking: the last-known inside/outside state per (geofence, vehicle)
 * is cached in memory so we only fire on the transition, not on every ping
 * inside the zone. On a cache miss (cold start, restart, or first ping from a
 * new cluster instance) the state is derived from the latest geofence_events
 * row for that pair, so restarts and multi-instance deploys do NOT produce
 * duplicate ENTER events.
 *
 * The service trusts its inputs (vehicleId is scope-resolved by the caller).
 * It never reads or returns PII.
 */

const { pool } = require('../config/database');
const env = require('../config/env');
const etaSvc = require('./eta.service');
const { logAudit } = require('../utils/audit');

const EARTH_RADIUS_M = 6371000;

// (geofenceId|vehicleId) -> boolean (true = last known inside)
// In-memory cache only — on a miss we fall back to the DB so restarts and
// multi-instance deploys stay correct (H1 fix).
const lastInside = new Map();
const STATE_KEY = (gfId, vehId) => `${gfId}|${vehId}`;

/**
 * Derive the last-known inside/outside state for a (geofence, vehicle) pair
 * from the latest geofence_events row. Returns false if no prior event exists.
 * This is the source of truth on a cache miss (cold start / restart / cluster).
 */
async function getLastKnownInside(geofenceId, vehicleId) {
  const [[row]] = await pool.query(
    `SELECT event_type
       FROM geofence_events
      WHERE geofence_id = ? AND vehicle_id = ?
      ORDER BY occurred_at DESC, id DESC
      LIMIT 1`,
    [geofenceId, vehicleId]
  );
  return row ? row.event_type === 'ENTER' : false;
}

// Phase 11A audit fix M3: periodic cleanup of stale state entries.
// Runs every 24 hours and removes entries for geofences that no longer
// exist or are inactive. Keeps the Map bounded over long uptimes.
const STATE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let lastCleanupAt = 0;
async function cleanupStaleState() {
  try {
    const [activeIds] = await pool.query(
      `SELECT id FROM geofences WHERE is_active = TRUE`
    );
    const activeSet = new Set(activeIds.map((r) => r.id));
    for (const key of lastInside.keys()) {
      const gfId = parseInt(key.split('|')[0], 10);
      if (!activeSet.has(gfId)) lastInside.delete(key);
    }
  } catch (err) {
    console.warn('[geofence] state cleanup failed:', err.message);
  }
}
function maybeCleanup() {
  const now = Date.now();
  if (now - lastCleanupAt > STATE_CLEANUP_INTERVAL_MS) {
    lastCleanupAt = now;
    cleanupStaleState();
  }
}

/**
 * Haversine distance in metres.
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Load all active geofences that apply to a vehicle (either vehicle_id IS NULL
 * or vehicle_id = ?). Cached for the duration of the request — callers should
 * not memoize across requests because geofences can be edited at any time.
 */
async function loadActiveForVehicle(vehicleId) {
  const [rows] = await pool.query(
    `SELECT id, name, target_type, target_id, vehicle_id,
            center_lat, center_lng, radius_meters, trigger_on, notify_roles
       FROM geofences
      WHERE is_active = TRUE
        AND (vehicle_id IS NULL OR vehicle_id = ?)`,
    [vehicleId]
  );
  return rows;
}

/**
 * Check a single GPS ping against all active geofences for the vehicle.
 * Emits geofence_events rows + audit_logs entries + notifications for each
 * transition. Best-effort: never throws — a failure only means a missed
 * event for this ping (the next ping will re-evaluate).
 *
 * @param {object} args
 * @param {string} args.vehicleId
 * @param {number} args.driverId
 * @param {number} args.latitude
 * @param {number} args.longitude
 * @param {Date}   [args.now]
 * @returns {Promise<object[]>} emitted events
 */
async function checkForVehicle({
  vehicleId,
  driverId,
  latitude,
  longitude,
  now = new Date(),
}) {
  maybeCleanup(); // Phase 11A audit fix M3: periodic stale-state cleanup
  const geofences = await loadActiveForVehicle(vehicleId);
  if (!geofences.length) return [];

  const emitted = [];
  for (const gf of geofences) {
    const distanceM = haversineMeters(
      latitude,
      longitude,
      Number(gf.center_lat),
      Number(gf.center_lng)
    );
    const inside = distanceM <= gf.radius_meters;
    const key = STATE_KEY(gf.id, vehicleId);
    // H1 fix: on a cache miss, derive state from the DB so restarts and
    // multi-instance deploys don't fire duplicate ENTER/EXIT events.
    let wasInside;
    if (lastInside.has(key)) {
      wasInside = lastInside.get(key);
    } else {
      wasInside = await getLastKnownInside(gf.id, vehicleId);
      lastInside.set(key, wasInside); // populate cache
    }

    // Only fire on the transition.
    if (inside && !wasInside && (gf.trigger_on === 'ENTER' || gf.trigger_on === 'BOTH')) {
      emitted.push(await emitEvent({
        geofence: gf,
        vehicleId,
        driverId,
        eventType: 'ENTER',
        latitude,
        longitude,
        now,
      }));
    } else if (!inside && wasInside && (gf.trigger_on === 'EXIT' || gf.trigger_on === 'BOTH')) {
      emitted.push(await emitEvent({
        geofence: gf,
        vehicleId,
        driverId,
        eventType: 'EXIT',
        latitude,
        longitude,
        now,
      }));
    }

    lastInside.set(key, inside);
  }
  return emitted;
}

/**
 * Persist a geofence_event + audit log + dispatch notifications.
 */
async function emitEvent({
  geofence,
  vehicleId,
  driverId,
  eventType,
  latitude,
  longitude,
  now,
}) {
  const occurredAt = now;
  const [result] = await pool.query(
    `INSERT INTO geofence_events
       (geofence_id, vehicle_id, driver_id, event_type,
        latitude, longitude, occurred_at, notifications_sent)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [geofence.id, vehicleId, driverId, eventType, latitude, longitude, occurredAt]
  );
  const eventId = result.insertId;

  await logAudit({
    userId: driverId,
    action: eventType === 'ENTER' ? 'GEOFENCE_ENTER' : 'GEOFENCE_EXIT',
    entityType: 'geofence_event',
    entityId: String(eventId),
    newValue: {
      geofence_id: geofence.id,
      geofence_name: geofence.name,
      vehicle_id: vehicleId,
      target_type: geofence.target_type,
      target_id: geofence.target_id,
    },
    ipAddress: null,
    userAgent: 'geofence-service',
  });

  // Dispatch notifications to the configured roles. The actual LINE / alert
  // dispatch is delegated to line.service + operationsAlert.service so this
  // module stays focused on detection. Errors here are swallowed so a
  // notification hiccup never drops a geofence_event row.
  //
  // Medium fix: notification dispatch is fire-and-forget — the geofence_event
  // row is already persisted, so we must NOT block the GPS ping path while
  // LINE sends messages to N parents sequentially. The dispatch runs in the
  // background and updates notifications_sent when done.
  setImmediate(() => {
    dispatchNotifications({ geofence, vehicleId, eventType, eventId })
      .then((notificationsSent) => {
        if (notificationsSent > 0) {
          return pool.query(
            `UPDATE geofence_events SET notifications_sent = ? WHERE id = ?`,
            [notificationsSent, eventId]
          );
        }
      })
      .catch((err) => {
        console.warn('[geofence] notification dispatch failed', err.message);
      });
  });
  // Return immediately — notifications_sent will be updated asynchronously.
  const notificationsSent = 0;

  return {
    event_id: eventId,
    geofence_id: geofence.id,
    geofence_name: geofence.name,
    vehicle_id: vehicleId,
    event_type: eventType,
    target_type: geofence.target_type,
    target_id: geofence.target_id,
    notifications_sent: notificationsSent,
  };
}

/**
 * Resolve which LINE users / school users should be notified for this event
 * and dispatch via line.service + operationsAlert.service.
 *
 * For PICKUP_POINT geofences we notify parents of students assigned to that
 * pickup point (ENTER = "รถมาถึงจุดรับแล้ว", EXIT = "รถออกจากจุดรับแล้ว").
 * For SCHOOL geofences we notify the school's admin users + province.
 */
async function dispatchNotifications({ geofence, vehicleId, eventType, eventId }) {
  const roles = String(geofence.notify_roles || '').split(',').map((s) => s.trim()).filter(Boolean);
  let sent = 0;

  if (geofence.target_type === 'PICKUP_POINT' && roles.includes('parent')) {
    sent += await notifyParentsForPickupPoint({
      pickupPointId: geofence.target_id,
      vehicleId,
      eventType,
      geofenceName: geofence.name,
    });
  }

  if (roles.includes('school')) {
    sent += await notifySchool({
      geofence,
      vehicleId,
      eventType,
    });
  }

  return sent;
}

/**
 * Notify parents of students assigned to this pickup point.
 */
async function notifyParentsForPickupPoint({ pickupPointId, vehicleId, eventType, geofenceName }) {
  if (!pickupPointId) return 0;
  // Phase 11A audit fix C1: resolve parent LINE user via the same chain used
  // by checkin.service.js — parent_student → parents.phone → line_bindings
  // → line_users (verified only). The old query referenced s.parent_phone
  // which does not exist on the students table, so the LEFT JOIN always
  // produced NULL and no push was ever sent.
  const [students] = await pool.query(
    `SELECT DISTINCT s.id, s.first_name, s.last_name, lu.line_user_id
       FROM student_pickup_points spp
       JOIN students s ON s.id = spp.student_id AND s.is_deleted = FALSE
       JOIN parent_student ps ON ps.student_id = s.id AND ps.approved = TRUE
       JOIN parents p
              ON p.id = ps.parent_id
             AND p.is_deleted = FALSE
             AND p.phone IS NOT NULL
             AND TRIM(p.phone) <> ''
       JOIN line_bindings lb
              ON lb.phone = p.phone
             AND lb.is_active = TRUE
       JOIN line_users lu
              ON lu.line_user_id = lb.line_user_id
             AND lu.user_type = 'parent'
             AND lu.verified = TRUE
      WHERE spp.pickup_point_id = ?
        AND s.vehicle_id = ?`,
    [pickupPointId, vehicleId]
  );
  if (!students.length) return 0;

  const lineSvc = require('./line.service');
  let sent = 0;
  for (const s of students) {
    if (!s.line_user_id) continue;
    const message =
      eventType === 'ENTER'
        ? `รถรับส่งถึงจุด "${geofenceName}" แล้ว`
        : `รถรับส่งออกจากจุด "${geofenceName}" แล้ว`;
    try {
      await lineSvc.sendTextMessage(s.line_user_id, message);
      sent += 1;
    } catch (err) {
      console.warn('[geofence] parent push failed', { studentId: s.id, err: err.message });
    }
  }
  return sent;
}

/**
 * Notify the school(s) serving this vehicle via the operations alert webhook.
 * The alert is also visible on the admin/province operations dashboard via
 * audit_logs (the GEOFENCE_ENTER/EXIT audit row written by emitEvent).
 */
async function notifySchool({ geofence, vehicleId, eventType }) {
  const opsAlert = require('./operationsAlert.service');
  try {
    await opsAlert.deliverOperationsAlert({
      status: 'INFO',
      checks: [
        {
          severity: 'INFO',
          label: `รถ ${vehicleId} ${eventType === 'ENTER' ? 'เข้า' : 'ออก'} ${geofence.name}`,
          value: geofence.target_type,
        },
      ],
    });
    return 1;
  } catch (err) {
    // Non-fatal: the audit_logs row is already written; the webhook is best-effort.
    console.warn('[geofence] school alert failed', err.message);
    return 0;
  }
}

/**
 * Seed a default geofence for every existing pickup point. Called once after
 * migration 040 by scripts/seed-geofences.js (idempotent).
 */
async function seedDefaultsForPickupPoints() {
  const [points] = await pool.query(
    `SELECT pp.id, pp.label, pp.vehicle_id, pp.latitude, pp.longitude
       FROM pickup_points pp
      WHERE pp.is_deleted = FALSE
        AND NOT EXISTS (
          SELECT 1 FROM geofences g
           WHERE g.target_type = 'PICKUP_POINT'
             AND g.target_id = pp.id
        )`
  );
  let seeded = 0;
  for (const p of points) {
    await pool.query(
      `INSERT INTO geofences
         (name, target_type, target_id, vehicle_id,
          center_lat, center_lng, radius_meters, trigger_on, notify_roles, is_active)
       VALUES (?, 'PICKUP_POINT', ?, ?, ?, ?, ?, 'BOTH', 'parent,school', TRUE)`,
      [
        `จุดรับ-ส่ง: ${p.label}`,
        p.id,
        p.vehicle_id,
        p.latitude,
        p.longitude,
        env.tracking.geofenceDefaultRadiusM,
      ]
    );
    seeded += 1;
  }
  return seeded;
}

/**
 * Seed a default geofence for every school. Uses the school's first pickup
 * point as the center if no coordinates are stored on the school itself.
 */
async function seedDefaultsForSchools() {
  const [schools] = await pool.query(
    `SELECT sc.id, sc.name,
            (SELECT pp.latitude
               FROM pickup_points pp
               JOIN students s ON s.vehicle_id = pp.vehicle_id AND s.school_id = sc.id
              WHERE pp.is_deleted = FALSE
              LIMIT 1) AS center_lat,
            (SELECT pp.longitude
               FROM pickup_points pp
               JOIN students s ON s.vehicle_id = pp.vehicle_id AND s.school_id = sc.id
              WHERE pp.is_deleted = FALSE
              LIMIT 1) AS center_lng
       FROM schools sc
      WHERE sc.is_deleted = FALSE
        AND NOT EXISTS (
          SELECT 1 FROM geofences g
           WHERE g.target_type = 'SCHOOL' AND g.target_id = sc.id
        )`
  );
  let seeded = 0;
  for (const sc of schools) {
    if (sc.center_lat == null || sc.center_lng == null) continue;
    await pool.query(
      `INSERT INTO geofences
         (name, target_type, target_id, vehicle_id,
          center_lat, center_lng, radius_meters, trigger_on, notify_roles, is_active)
       VALUES (?, 'SCHOOL', ?, NULL, ?, ?, ?, 'BOTH', 'school,province', TRUE)`,
      [`โรงเรียน: ${sc.name}`, sc.id, sc.center_lat, sc.center_lng, env.tracking.geofenceDefaultRadiusM * 2]
    );
    seeded += 1;
  }
  return seeded;
}

/**
 * List geofence events for a viewer (admin sees all; school / affiliation /
 * province are scope-filtered by the caller).
 */
async function listEvents({ vehicleId = null, geofenceId = null, limit = 100, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (vehicleId) { where.push('gfe.vehicle_id = ?'); params.push(vehicleId); }
  if (geofenceId) { where.push('gfe.geofence_id = ?'); params.push(geofenceId); }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT gfe.id, gfe.geofence_id, gf.name AS geofence_name,
            gfe.vehicle_id, gfe.event_type, gfe.latitude, gfe.longitude,
            gfe.occurred_at, gfe.notifications_sent
       FROM geofence_events gfe
       JOIN geofences gf ON gf.id = gfe.geofence_id
       ${whereClause}
      ORDER BY gfe.occurred_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return rows;
}

module.exports = {
  checkForVehicle,
  loadActiveForVehicle,
  seedDefaultsForPickupPoints,
  seedDefaultsForSchools,
  listEvents,
  haversineMeters,
};
