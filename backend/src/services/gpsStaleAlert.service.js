'use strict';

/**
 * gpsStaleAlert.service.js — LINE alert when a bus's GPS is stuck or silent
 * (owner request 2026-11-12: "GPS ค้างจุดเดิมนานเกิน 20 นาทีให้แจ้งเตือนผ่านไลน์").
 *
 * Run by backend/scripts/gps-stale-alert.js from cron every few minutes. It is
 * NOT a per-ping hook: a phone that stopped sending never pings again, so only
 * a scheduled check can notice it.
 *
 * Which vehicles are checked — "a round in progress":
 *   at least one student whose LATEST checkin_logs row for this session today is
 *   CHECKED_IN (on board, not yet dropped off). A void appends a non-CHECKED_IN
 *   row, so a voided boarding does not count. The driver's "จบรอบ" button
 *   (checkout-all) and teachers' arrival records drop the count to zero.
 *
 * Two alerts, each sent at most ONCE per vehicle + day + session:
 *   STUCK     — fixes are still arriving, but every fix of the last N minutes
 *               (plus the last fix before that, so the whole span is covered)
 *               lies within R metres of the newest one.
 *   NO_SIGNAL — the vehicle sent GPS during this round, but nothing for N minutes.
 * A round where the driver never started GPS sends no alert: there is nothing
 * to compare and most vehicles would alert every day.
 *
 * Evening exception: children board at the school, and the bus may wait there.
 * While the bus has not moved more than R metres from where it was when the
 * first child boarded, STUCK is not raised.
 *
 * Positions are compared by distance, not by the phone's speed field — many
 * phones never send speed, and the older STALLED detector reads a missing speed
 * as "not moving".
 *
 * Delivery: the single LINE group already used for emergencies (LINE_GROUP_ID,
 * owner decision 2026-11-12). Parents are never messaged. A sent (or dev
 * dry-run) alert writes one audit_logs row whose entity_id is the dedupe key,
 * so no migration is needed. A failed push is not recorded and is retried on
 * the next run.
 */

const { pool } = require('../config/database');
const env = require('../config/env');
const { logAudit } = require('../utils/audit');
const { todayBangkok } = require('../utils/thaiTime');

const EARTH_RADIUS_M = 6371000;
const ENTITY_TYPE = 'gps_stale_alert';

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function settings(overrides = {}) {
  return {
    thresholdMin: env.tracking.gpsStaleAlertMinutes,
    radiusM: env.tracking.gpsStaleRadiusM,
    ...overrides,
  };
}

function currentSession(now = new Date()) {
  const hour = parseInt(
    now.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }),
    10,
  );
  return hour < env.app.driverSessionSwitchHour ? 'morning' : 'evening';
}

/**
 * Pure decision. `fixes` are newest-first: { lat, lng, ageS } where ageS is
 * seconds since the fix (computed by MySQL against the same clock that stored
 * it). `firstBoardAgeS` is seconds since the first CHECKED_IN of this round.
 *
 * Returns { kind: 'STUCK'|'NO_SIGNAL', newest } or { kind: null, reason }.
 */
function evaluate({ fixes, firstBoardAgeS, session, thresholdMin, radiusM }) {
  const thresholdS = thresholdMin * 60;
  if (!Array.isArray(fixes) || fixes.length === 0) return { kind: null, reason: 'NO_GPS_THIS_ROUND' };
  const newest = fixes[0];

  if (newest.ageS >= thresholdS) return { kind: 'NO_SIGNAL', newest };

  // Need at least one fix at or beyond the threshold, otherwise the stop has not
  // been observed for the full span yet (e.g. GPS was started 5 minutes ago).
  const anchorIdx = fixes.findIndex((f) => f.ageS >= thresholdS);
  if (anchorIdx === -1) return { kind: null, reason: 'NOT_ENOUGH_HISTORY' };
  const span = fixes.slice(0, anchorIdx + 1);
  const far = (f) => haversineMeters(newest.lat, newest.lng, f.lat, f.lng) > radiusM;
  if (span.some(far)) return { kind: null, reason: 'MOVING' };

  if (session === 'evening' && firstBoardAgeS != null) {
    const sinceBoarding = fixes.filter((f) => f.ageS <= firstBoardAgeS + 120);
    if (!sinceBoarding.some(far)) return { kind: null, reason: 'WAITING_WHERE_CHILDREN_BOARDED' };
  }
  return { kind: 'STUCK', newest };
}

/** Vehicles with at least one child on board in this session today. */
async function findActiveRounds(db, session) {
  const [rows] = await db.query(
    `SELECT cl.vehicle_id,
            COUNT(*) AS on_board
       FROM checkin_logs cl
       JOIN (SELECT student_id, MAX(id) AS last_id
               FROM checkin_logs
              WHERE check_date = CURDATE() AND session = ?
              GROUP BY student_id) last ON last.last_id = cl.id
      WHERE cl.status = 'CHECKED_IN'
        AND cl.vehicle_id IS NOT NULL
      GROUP BY cl.vehicle_id`,
    [session],
  );
  return rows.map((r) => ({ vehicleId: r.vehicle_id, onBoard: Number(r.on_board) }));
}

async function loadRoundContext(db, vehicleId, session) {
  const [[board]] = await db.query(
    `SELECT TIMESTAMPDIFF(SECOND, MIN(checked_at), NOW()) AS first_board_age_s
       FROM checkin_logs
      WHERE vehicle_id = ? AND check_date = CURDATE() AND session = ? AND status = 'CHECKED_IN'`,
    [vehicleId, session],
  );
  const firstBoardAgeS = board && board.first_board_age_s != null ? Number(board.first_board_age_s) : null;
  // Fixes from 10 minutes before the first boarding (GPS is usually started just
  // before), capped at 4 hours so one query stays small (a fix every ~15 s).
  const lookbackS = Math.min(4 * 3600, (firstBoardAgeS ?? 0) + 600);
  const [rows] = await db.query(
    `SELECT latitude, longitude,
            TIMESTAMPDIFF(SECOND, recorded_at, NOW()) AS age_s,
            DATE_FORMAT(recorded_at, '%H:%i') AS hhmm
       FROM vehicle_location_history
      WHERE vehicle_id = ?
        AND recorded_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)
        AND recorded_at <= DATE_ADD(NOW(), INTERVAL 1 MINUTE)
      ORDER BY recorded_at DESC
      LIMIT 2000`,
    [vehicleId, lookbackS],
  );
  const fixes = rows.map((r) => ({
    lat: Number(r.latitude), lng: Number(r.longitude), ageS: Math.max(0, Number(r.age_s)), hhmm: r.hhmm,
  }));
  return { firstBoardAgeS, fixes };
}

async function loadVehicleLabel(db, vehicleId, session) {
  const [[v]] = await db.query('SELECT plate_no FROM vehicles WHERE id = ?', [vehicleId]);
  // Schools of the children on board (names only — no student data leaves the system).
  const [schools] = await db.query(
    `SELECT DISTINCT sc.name
       FROM checkin_logs cl
       JOIN (SELECT student_id, MAX(id) AS last_id
               FROM checkin_logs
              WHERE check_date = CURDATE() AND session = ? AND vehicle_id = ?
              GROUP BY student_id) last ON last.last_id = cl.id
       JOIN students s ON s.id = cl.student_id
       JOIN schools sc ON sc.id = s.school_id
      WHERE cl.status = 'CHECKED_IN'
      ORDER BY sc.name
      LIMIT 5`,
    [session, vehicleId],
  );
  return { plateNo: (v && v.plate_no) || vehicleId, schools: schools.map((s) => s.name) };
}

function dedupeKey(vehicleId, dateStr, session, kind) {
  return `${vehicleId}:${dateStr}:${session === 'morning' ? 'M' : 'E'}:${kind}`;
}

async function alreadyAlerted(db, key) {
  const [rows] = await db.query(
    'SELECT 1 FROM audit_logs WHERE entity_type = ? AND entity_id = ? LIMIT 1',
    [ENTITY_TYPE, key],
  );
  return rows.length > 0;
}

function buildMessage({ kind, plateNo, schools, onBoard, session, thresholdMin, newest }) {
  const round = session === 'morning' ? 'รอบเช้า' : 'รอบเย็น';
  const lines = ['⚠️ แจ้งเตือน GPS รถรับส่งนักเรียน', `รถ ${plateNo} (${round})`];
  lines.push(kind === 'STUCK'
    ? `ตำแหน่งรถไม่เปลี่ยนเกิน ${thresholdMin} นาที`
    : `ไม่ได้รับตำแหน่งจากรถเกิน ${thresholdMin} นาที (มือถือคนขับอาจปิดหน้าจอ ไม่มีสัญญาณ หรือหยุดส่งตำแหน่ง)`);
  lines.push(`นักเรียนบนรถ (ยังไม่บันทึกส่ง) ${onBoard} คน`);
  if (schools.length) lines.push(`โรงเรียน: ${schools.join(', ')}`);
  if (newest) {
    lines.push(`ตำแหน่งล่าสุด ${newest.hhmm} น.`);
    lines.push(`https://www.google.com/maps?q=${newest.lat.toFixed(6)},${newest.lng.toFixed(6)}`);
  }
  lines.push('', 'กรุณาติดต่อคนขับหรือโรงเรียนเพื่อตรวจสอบ');
  return lines.join('\n');
}

/**
 * One pass. `apply=false` evaluates and reports without sending or writing.
 * Returns { session, checked, alerts: [{vehicleId, kind, key, delivery}], skipped: [...] }.
 */
async function runOnce({
  db = pool,
  apply = false,
  now = new Date(),
  push = null,
  overrides = {},
} = {}) {
  const cfg = settings(overrides);
  const session = currentSession(now);
  const dateStr = todayBangkok(now);
  const sendToGroup = push || require('./line.service').pushToEmergencyGroup;

  const rounds = await findActiveRounds(db, session);
  const result = { session, checked: rounds.length, alerts: [], skipped: [] };

  for (const round of rounds) {
    try {
      const ctx = await loadRoundContext(db, round.vehicleId, session);
      const decision = evaluate({ ...ctx, session, thresholdMin: cfg.thresholdMin, radiusM: cfg.radiusM });
      if (!decision.kind) {
        result.skipped.push({ vehicleId: round.vehicleId, reason: decision.reason });
        continue;
      }
      const key = dedupeKey(round.vehicleId, dateStr, session, decision.kind);
      if (await alreadyAlerted(db, key)) {
        result.skipped.push({ vehicleId: round.vehicleId, reason: 'ALREADY_ALERTED', kind: decision.kind });
        continue;
      }
      const label = await loadVehicleLabel(db, round.vehicleId, session);
      const text = buildMessage({
        kind: decision.kind, ...label, onBoard: round.onBoard, session,
        thresholdMin: cfg.thresholdMin, newest: decision.newest,
      });
      if (!apply) {
        result.alerts.push({ vehicleId: round.vehicleId, kind: decision.kind, key, delivery: 'dry-run', text });
        continue;
      }
      const delivery = await sendToGroup(text);
      const delivered = Boolean(delivery && (delivery.sent || delivery.dryRun));
      if (delivered) {
        await logAudit({
          action: 'ROUTE_DEVIATION',
          entityType: ENTITY_TYPE,
          entityId: key,
          newValue: {
            vehicle_id: round.vehicleId, kind: decision.kind, session, on_board: round.onBoard,
            threshold_min: cfg.thresholdMin, radius_m: cfg.radiusM, delivery: delivery.sent ? 'sent' : 'dry-run',
          },
          userAgent: 'gps-stale-alert',
          conn: db,
          required: true,
        });
      }
      result.alerts.push({ vehicleId: round.vehicleId, kind: decision.kind, key, delivery: delivered ? 'sent' : 'failed', detail: delivery });
    } catch (err) {
      result.skipped.push({ vehicleId: round.vehicleId, reason: 'ERROR', error: err.message });
    }
  }
  return result;
}

module.exports = {
  runOnce,
  evaluate,
  buildMessage,
  dedupeKey,
  currentSession,
  haversineMeters,
  ENTITY_TYPE,
};
