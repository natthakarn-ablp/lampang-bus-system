'use strict';

/**
 * vehicleTrip.service.js — several trips per round (owner decision 2026-11-12,
 * migration 062, FEATURE_MULTI_TRIP).
 *
 * A bus that cannot take every child at once drops the first group, then the
 * driver taps "เริ่มเที่ยวถัดไป" and picks a reason. Trip 1 is implicit; each
 * extra trip is one vehicle_trips row (trip_no 2…9). A check-in belongs to the
 * trip whose started_at it follows, so checkin_logs is never altered.
 *
 * "On board" = pupils whose LATEST checkin_logs row for this vehicle + session
 * today is CHECKED_IN (a void appends a non-CHECKED_IN row, so it does not
 * count) — the same definition the GPS stale alert uses.
 *
 * A next trip may start only when the bus is empty (on board = 0) and at least
 * one pupil boarded this round, so a trip always follows a completed group.
 * School, affiliation and province read the trips + reasons; parents do not.
 */

const env = require('../config/env');
const { logAudit } = require('../utils/audit');
const { isCalendarDate } = require('../utils/calendarDate');
const { todayBangkok } = require('../utils/thaiTime');

const REASONS = {
  SEATS: 'ที่นั่งไม่พอ',
  MULTI_SCHOOL: 'รับหลายโรงเรียน',
  LONG_ROUTE: 'เส้นทางไกล / หลายจุดรับ',
  OTHER: 'อื่น ๆ',
};
const MAX_TRIP = 9;
const REASON_TEXT_MAX = 200;

function enabled() {
  return env.features.multiTrip === true;
}

function httpError(message, statusCode, code) {
  const e = new Error(message);
  e.statusCode = statusCode;
  if (code) e.code = code;
  return e;
}

function assertSession(session) {
  if (session !== 'morning' && session !== 'evening') {
    throw httpError("session ต้องเป็น 'morning' หรือ 'evening'", 400);
  }
}

function reasonLabel(code, text) {
  if (code === 'OTHER' && text) return text;
  return REASONS[code] || code;
}

/** Boarded-this-round and currently-on-board counts for one vehicle. */
async function boardingCounts(db, vehicleId, session) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS boarded,
            COALESCE(SUM(cl.status = 'CHECKED_IN'), 0) AS on_board
       FROM checkin_logs cl
       JOIN (SELECT student_id, MAX(id) AS last_id
               FROM checkin_logs
              WHERE vehicle_id = ? AND check_date = CURDATE() AND session = ?
              GROUP BY student_id) last ON last.last_id = cl.id
      WHERE cl.status IN ('CHECKED_IN', 'CHECKED_OUT')`,
    [vehicleId, session],
  );
  return { boarded: Number(row?.boarded || 0), onBoard: Number(row?.on_board || 0) };
}

/**
 * Pupils who boarded (CHECKED_IN rows) in the CURRENT trip: rows after the
 * trip's after_log_id (the highest checkin_logs.id when it started), or all of
 * today's round while still on trip 1. Ids, not timestamps — a boarding in the
 * same second as the trip start must stay in the earlier trip.
 * A next trip needs at least one — so trips cannot be stacked empty.
 */
async function boardedThisTrip(db, vehicleId, session, currentTrip) {
  const [[row]] = await db.query(
    `SELECT COUNT(DISTINCT cl.student_id) AS n
       FROM checkin_logs cl
      WHERE cl.vehicle_id = ? AND cl.check_date = CURDATE() AND cl.session = ?
        AND cl.status = 'CHECKED_IN'
        AND cl.id > COALESCE(
              (SELECT after_log_id FROM vehicle_trips
                WHERE vehicle_id = ? AND check_date = CURDATE() AND session = ? AND trip_no = ?),
              0)`,
    [vehicleId, session, vehicleId, session, currentTrip],
  );
  return Number(row?.n || 0);
}

async function listTrips(db, vehicleId, session) {
  const [rows] = await db.query(
    `SELECT trip_no, reason_code, reason_text, started_at
       FROM vehicle_trips
      WHERE vehicle_id = ? AND check_date = CURDATE() AND session = ?
      ORDER BY trip_no`,
    [vehicleId, session],
  );
  return rows.map((r) => ({
    trip_no: Number(r.trip_no), reason_code: r.reason_code, reason_text: r.reason_text,
    reason_label: reasonLabel(r.reason_code, r.reason_text), started_at: r.started_at,
  }));
}

/** What the driver's trip card needs. */
async function getTripState(db, vehicleId, session) {
  assertSession(session);
  const trips = await listTrips(db, vehicleId, session);
  const { boarded, onBoard } = await boardingCounts(db, vehicleId, session);
  const currentTrip = trips.length ? trips[trips.length - 1].trip_no : 1;
  const thisTrip = await boardedThisTrip(db, vehicleId, session, currentTrip);
  return {
    session,
    current_trip: currentTrip,
    trips,
    boarded,
    on_board: onBoard,
    boarded_this_trip: thisTrip,
    can_start_next: thisTrip > 0 && onBoard === 0 && currentTrip < MAX_TRIP,
    reasons: Object.entries(REASONS).map(([code, label]) => ({ code, label })),
  };
}

/** Start trip N+1. Locks the vehicle row so two taps cannot both create it. */
async function startNextTrip(db, { vehicleId, session, reasonCode, reasonText, actorId, ip = null, userAgent = null }) {
  assertSession(session);
  if (!Object.prototype.hasOwnProperty.call(REASONS, reasonCode)) throw httpError('กรุณาเลือกเหตุผล', 400);
  const text = String(reasonText ?? '').trim().replace(/\s+/g, ' ');
  if (reasonCode === 'OTHER' && !text) throw httpError('กรุณาพิมพ์เหตุผล', 400);
  if (text.length > REASON_TEXT_MAX) throw httpError(`เหตุผลยาวได้ไม่เกิน ${REASON_TEXT_MAX} ตัวอักษร`, 400);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SELECT id FROM vehicles WHERE id = ? FOR UPDATE', [vehicleId]);
    const [[last]] = await conn.query(
      `SELECT COALESCE(MAX(trip_no), 1) AS trip_no FROM vehicle_trips
        WHERE vehicle_id = ? AND check_date = CURDATE() AND session = ?`,
      [vehicleId, session],
    );
    const current = Number(last.trip_no);
    if (current >= MAX_TRIP) throw httpError(`เริ่มได้ไม่เกิน ${MAX_TRIP} เที่ยวต่อรอบ`, 409, 'TRIP_LIMIT');
    const { onBoard } = await boardingCounts(conn, vehicleId, session);
    if (await boardedThisTrip(conn, vehicleId, session, current) === 0) {
      throw httpError(current === 1
        ? 'ยังไม่มีนักเรียนขึ้นรถในรอบนี้ เริ่มเที่ยวแรกได้เลยโดยไม่ต้องกดปุ่มนี้'
        : `เที่ยวที่ ${current} ยังไม่มีนักเรียนขึ้นรถ`, 409, 'NO_TRIP_YET');
    }
    if (onBoard > 0) throw httpError(`ยังมีนักเรียนบนรถ ${onBoard} คน กรุณาส่งลงให้ครบก่อนเริ่มเที่ยวถัดไป`, 409, 'STILL_ON_BOARD');

    const tripNo = current + 1;
    const [[mark]] = await conn.query(
      `SELECT COALESCE(MAX(id), 0) AS last_id FROM checkin_logs
        WHERE vehicle_id = ? AND check_date = CURDATE() AND session = ?`,
      [vehicleId, session],
    );
    await conn.query(
      `INSERT INTO vehicle_trips (vehicle_id, check_date, session, trip_no, reason_code, reason_text, started_by, after_log_id)
       VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?)`,
      [vehicleId, session, tripNo, reasonCode, text || null, actorId, Number(mark?.last_id || 0)],
    );
    await logAudit({
      userId: actorId, action: 'CREATE', entityType: 'vehicle_trip', entityId: `${vehicleId}:${session}:${tripNo}`,
      newValue: { vehicle_id: vehicleId, session, trip_no: tripNo, reason_code: reasonCode, reason_text: text || null },
      ipAddress: ip, userAgent, conn, required: true,
    });
    await conn.commit();
    return { trip_no: tripNo, reason_code: reasonCode, reason_label: reasonLabel(reasonCode, text) };
  } catch (err) {
    try { await conn.rollback(); } catch { /* keep original */ }
    if (err && err.code === 'ER_DUP_ENTRY') throw httpError('เที่ยวนี้ถูกเริ่มไปแล้ว กรุณาโหลดหน้าใหม่', 409, 'TRIP_EXISTS');
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Trip summary rows for a date range, limited to the vehicles given by
 * `vehicleScopeSql` (a SELECT returning vehicle ids, with its params).
 * One row per vehicle + date + session that had extra trips:
 * { check_date, session, vehicle_id, plate_no, trips (total incl. trip 1), reasons: [label…] }.
 */
async function tripSummary(db, { dateFrom, dateTo, vehicleScopeSql, vehicleScopeParams = [] }) {
  const [rows] = await db.query(
    `SELECT DATE_FORMAT(t.check_date, '%Y-%m-%d') AS check_date, t.session, t.vehicle_id, v.plate_no,
            t.trip_no, t.reason_code, t.reason_text
       FROM vehicle_trips t
       JOIN vehicles v ON v.id = t.vehicle_id
      WHERE t.check_date BETWEEN ? AND ?
        AND t.vehicle_id IN (${vehicleScopeSql})
      ORDER BY t.check_date DESC, v.plate_no, t.session, t.trip_no
      LIMIT 5000`,
    [dateFrom, dateTo, ...vehicleScopeParams],
  );
  const out = new Map();
  for (const r of rows) {
    const k = `${r.check_date}|${r.session}|${r.vehicle_id}`;
    if (!out.has(k)) {
      out.set(k, { check_date: r.check_date, session: r.session, vehicle_id: r.vehicle_id, plate_no: r.plate_no, trips: 1, reasons: [] });
    }
    const row = out.get(k);
    row.trips = Math.max(row.trips, Number(r.trip_no));
    const label = reasonLabel(r.reason_code, r.reason_text);
    if (!row.reasons.includes(label)) row.reasons.push(label);
  }
  return [...out.values()];
}

/** ?date_from&date_to (YYYY-MM-DD, Bangkok), default today, at most 31 days. */
function parseRange(query = {}) {
  const today = todayBangkok();
  const from = query.date_from || today;
  const to = query.date_to || from;
  if (!isCalendarDate(from) || !isCalendarDate(to)) throw httpError('วันที่ไม่ถูกต้อง', 400);
  if (from > to) throw httpError('วันที่เริ่มต้องไม่หลังวันที่สิ้นสุด', 400);
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  if (days > 31) throw httpError('เลือกช่วงวันที่ได้ไม่เกิน 31 วัน', 400);
  return { dateFrom: from, dateTo: to };
}

module.exports = {
  parseRange,
  REASONS,
  MAX_TRIP,
  enabled,
  getTripState,
  startNextTrip,
  tripSummary,
  reasonLabel,
  _boardingCounts: boardingCounts,
};
