'use strict';

/**
 * vehicleTrack.service.js — GPS route history (replay), read-only.
 *
 * Reads vehicle_location_history (migration 040). No schema change.
 *
 *   getTrack(vehicleId, 'YYYY-MM-DD')      one Bangkok day: ordered points
 *                                           (downsampled to ≤ MAX_POINTS),
 *                                           segments split at signal gaps,
 *                                           distance, first/last, max speed.
 *   getRecentDays(vehicleId, 7)            per-day summary of the last N days
 *                                           (points, km, start, end, gaps) —
 *                                           N = retention (7 days by default).
 *
 * Scope is NOT decided here: routes resolve the viewer's scope and call
 * vehicleLocation.findVehicleInScope() first — the same SQL that drives the
 * live-vehicle list — so a viewer can only replay a vehicle it can see live.
 *
 * Privacy: the response carries coordinates, time, speed and accuracy only.
 * No student, parent, driver phone or address data is selected.
 *
 * Time: the pool runs at +07:00, so a DATETIME literal is Bangkok wall-clock
 * time and `recorded_at >= 'YYYY-MM-DD 00:00:00'` is the Bangkok day. The
 * day bounds are built as literals here, never from a UTC ISO string.
 */

const { pool } = require('../config/database');
const { toBangkokDate, todayBangkok } = require('../utils/thaiTime');
const { windowIndexOf, configuredWindows } = require('../utils/gpsTrackingWindow');

/**
 * A silence counts as a SIGNAL GAP (phone lost signal / app closed mid-run)
 * only when it starts and ends inside the same tracking window. A silence
 * that spans the time between windows (e.g. 09:00 → 15:00) is just the break
 * between the morning and evening runs: no dashed line, not counted as
 * "สัญญาณขาด".
 */
function defaultIsSignalGap(fromMs, toMs, windows = configuredWindows()) {
  const a = windowIndexOf(new Date(fromMs), windows);
  return a >= 0 && a === windowIndexOf(new Date(toMs), windows)
    && toBangkokDate(new Date(fromMs)) === toBangkokDate(new Date(toMs));
}

const GAP_SECONDS       = 3 * 60;    // > 3 min without a fix = signal gap (new segment)
const MAX_POINTS        = 2000;      // downsample ceiling for one day
const MAX_ROWS_DAY      = 20000;     // hard read cap for one day (≈ a fix every 4.3 s for 24 h)
const MAX_ROWS_RANGE    = 120000;    // hard read cap for the recent-days summary
const LOW_ACCURACY_M    = 200;       // same threshold as the live LOW_ACCURACY overlay
const MAX_PLAUSIBLE_MPS = 45;        // ≈ 160 km/h: a faster jump is a GPS spike, not driving
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/* ─── dates / validation ─────────────────────────────────────────────────── */

/** Calendar arithmetic on a 'YYYY-MM-DD' (UTC-midnight, so no TZ drift). */
function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const pad = (v) => String(v).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function nextDay(day) { return addDays(day, 1); }

/** First Bangkok day still inside the retention window (today counts as day 1). */
function oldestRetainedDay(retentionDays, today = todayBangkok()) {
  return addDays(today, -(Math.max(1, retentionDays) - 1));
}

/**
 * 'YYYY-MM-DD' that is a real calendar date, not after today (Bangkok) and,
 * when retentionDays is given, not older than the retention window.
 */
function validateDay(value, today = todayBangkok(), retentionDays = null) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return { ok: false, message: 'วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD' };
  const [, y, m, d] = value.match(DAY_RE).map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 2000) {
    return { ok: false, message: 'วันที่ไม่ถูกต้อง' };
  }
  if (value > today) return { ok: false, message: 'ยังไม่มีข้อมูลของวันในอนาคต' };
  if (retentionDays && value < oldestRetainedDay(retentionDays, today)) {
    return { ok: false, message: `ระบบเก็บประวัติเส้นทางย้อนหลัง ${retentionDays} วัน` };
  }
  return { ok: true };
}

/* ─── pure geometry / summarising (unit-tested) ─────────────────────────── */

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6_371_000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Normalise raw rows → [{ lat, lng, t (ms), speed, acc }], sorted, with
 * duplicate timestamps collapsed and unusable fixes dropped (bad coords,
 * Null Island, accuracy worse than LOW_ACCURACY_M).
 */
function normaliseRows(rows) {
  const out = [];
  let dropped = 0;
  for (const r of rows || []) {
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    const t = r.recorded_at instanceof Date ? r.recorded_at.getTime() : Date.parse(r.recorded_at);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(t)
        || (lat === 0 && lng === 0) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { dropped++; continue; }
    const acc = r.accuracy_meters == null ? null : Number(r.accuracy_meters);
    if (acc != null && acc > LOW_ACCURACY_M) { dropped++; continue; }
    const speed = r.speed_mps == null || !Number.isFinite(Number(r.speed_mps)) ? null : Number(r.speed_mps);
    out.push({ lat, lng, t, speed, acc });
  }
  out.sort((a, b) => a.t - b.t);
  const deduped = [];
  for (const p of out) {
    if (deduped.length && deduped[deduped.length - 1].t === p.t) { dropped++; continue; }
    deduped.push(p);
  }
  return { points: deduped, dropped };
}

/**
 * Split into segments at gaps > GAP_SECONDS and measure them.
 * Distance skips implausible jumps (GPS spikes) so one bad fix cannot add
 * kilometres. Returns per-segment index ranges into `points`.
 */
function summarise(points, { isSignalGap = defaultIsSignalGap } = {}) {
  const segments = [];
  const gaps = [];
  let totalM = 0;
  let maxMps = 0;
  let seg = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.speed != null && p.speed >= 0 && p.speed <= MAX_PLAUSIBLE_MPS) maxMps = Math.max(maxMps, p.speed);
    const prev = i > 0 ? points[i - 1] : null;
    const dtS = prev ? (p.t - prev.t) / 1000 : 0;
    if (!seg || dtS > GAP_SECONDS) {
      if (seg) {
        segments.push(seg);
        gaps.push({ from: prev.t, to: p.t, seconds: Math.round(dtS), kind: isSignalGap(prev.t, p.t) ? 'signal' : 'break' });
      }
      seg = { start: i, end: i, meters: 0 };
      continue;
    }
    const d = haversineMeters(prev.lat, prev.lng, p.lat, p.lng);
    if (dtS > 0 && d / dtS <= MAX_PLAUSIBLE_MPS) {
      seg.meters += d;
      totalM += d;
      // A device that never reports speed still gets a max speed from motion,
      // but only over ≥ 10 s so two jittery fixes a second apart do not count.
      if (dtS >= 10) maxMps = Math.max(maxMps, d / dtS);
    }
    seg.end = i;
  }
  if (seg) segments.push(seg);
  return {
    segments,
    gaps,
    distance_m: totalM,
    max_speed_mps: maxMps,
    // only real signal gaps count; the break between runs is not "offline"
    signal_gaps: gaps.filter((g) => g.kind === 'signal'),
    offline_seconds: gaps.filter((g) => g.kind === 'signal').reduce((s, g) => s + g.seconds, 0),
  };
}

/**
 * Pick ≤ max indices, keeping every segment's first and last point so gaps
 * stay exactly where they were. Budget is shared in proportion to each
 * segment's point count; inside a segment the stride is uniform in index
 * (≈ uniform in time at a steady ping rate), which keeps the replay slider
 * honest.
 */
function downsampleIndices(segments, totalPoints, max = MAX_POINTS) {
  if (totalPoints <= max) {
    const all = [];
    for (let i = 0; i < totalPoints; i++) all.push(i);
    return all;
  }
  const keep = [];
  const fixed = segments.reduce((s, g) => s + (g.end > g.start ? 2 : 1), 0);
  const spare = Math.max(0, max - fixed);
  const interiorTotal = segments.reduce((s, g) => s + Math.max(0, g.end - g.start - 1), 0);
  for (const g of segments) {
    keep.push(g.start);
    const interior = Math.max(0, g.end - g.start - 1);
    const budget = interiorTotal > 0 ? Math.floor((spare * interior) / interiorTotal) : 0;
    if (budget > 0 && interior > 0) {
      const step = interior / budget;
      let last = g.start;
      for (let k = 0; k < budget; k++) {
        const idx = g.start + 1 + Math.floor(k * step);
        if (idx > last && idx < g.end) { keep.push(idx); last = idx; }
      }
    }
    if (g.end > g.start) keep.push(g.end);
  }
  return keep;
}

const round = (n, d) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);
const iso = (ms) => new Date(ms).toISOString();

/** Assemble the public day-track payload from raw rows (pure). */
function buildTrack(rows, { maxPoints = MAX_POINTS, isSignalGap } = {}) {
  const { points, dropped } = normaliseRows(rows);
  const sum = summarise(points, isSignalGap ? { isSignalGap } : {});
  const keep = downsampleIndices(sum.segments, points.length, maxPoints);
  const remap = new Map(keep.map((orig, i) => [orig, i]));
  const out = keep.map((i) => {
    const p = points[i];
    return {
      lat: round(p.lat, 6),
      lng: round(p.lng, 6),
      t: iso(p.t),
      speed_kmh: p.speed == null ? null : round(p.speed * 3.6, 1),
      accuracy_m: p.acc,
    };
  });
  return {
    points: out,
    segments: sum.segments.map((g) => ({
      start_index: remap.get(g.start),
      end_index: remap.get(g.end),
      start_at: iso(points[g.start].t),
      end_at: iso(points[g.end].t),
      point_count: g.end - g.start + 1,
      distance_km: round(g.meters / 1000, 2),
    })),
    // gaps[i] sits between segments[i] and segments[i + 1]
    gaps: sum.gaps.map((g) => ({ from: iso(g.from), to: iso(g.to), seconds: g.seconds, kind: g.kind })),
    summary: {
      point_count: points.length,
      point_count_returned: out.length,
      dropped_points: dropped,
      downsampled: out.length < points.length,
      distance_km: round(sum.distance_m / 1000, 2),
      first_at: points.length ? iso(points[0].t) : null,
      last_at: points.length ? iso(points[points.length - 1].t) : null,
      max_speed_kmh: round(sum.max_speed_mps * 3.6, 1),
      gap_count: sum.signal_gaps.length,
      break_count: sum.gaps.length - sum.signal_gaps.length,
      offline_seconds: sum.offline_seconds,
      gap_threshold_seconds: GAP_SECONDS,
    },
  };
}

/** Per-Bangkok-day summary of raw rows (pure). */
function buildDays(rows) {
  const byDay = new Map();
  for (const r of rows || []) {
    const day = r.day || toBangkokDate(r.recorded_at);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(r);
  }
  const days = [];
  for (const [date, dayRows] of [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const { points } = normaliseRows(dayRows);
    if (!points.length) continue;
    const s = summarise(points);
    days.push({
      date,
      point_count: points.length,
      distance_km: round(s.distance_m / 1000, 2),
      first_at: iso(points[0].t),
      last_at: iso(points[points.length - 1].t),
      gap_count: s.signal_gaps.length,
    });
  }
  return days;
}

/* ─── DB reads ───────────────────────────────────────────────────────────── */

async function getTrack(vehicleId, day) {
  const [rows] = await pool.query(
    `SELECT latitude, longitude, accuracy_meters, speed_mps, recorded_at
     FROM vehicle_location_history
     WHERE vehicle_id = ? AND recorded_at >= ? AND recorded_at < ?
     ORDER BY recorded_at ASC
     LIMIT ${MAX_ROWS_DAY}`,
    [vehicleId, `${day} 00:00:00`, `${nextDay(day)} 00:00:00`]
  );
  const track = buildTrack(rows);
  track.summary.truncated = rows.length >= MAX_ROWS_DAY;
  return track;
}

/**
 * Per-day summary for the last `days` Bangkok days (today included), oldest
 * first. Days without data are returned with point_count 0 so the picker can
 * show them greyed out.
 */
async function getRecentDays(vehicleId, days, today = todayBangkok()) {
  const n = Math.max(1, Math.min(31, days));
  const from = addDays(today, -(n - 1));
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(recorded_at, '%Y-%m-%d') AS day,
            latitude, longitude, accuracy_meters, speed_mps, recorded_at
     FROM vehicle_location_history
     WHERE vehicle_id = ? AND recorded_at >= ? AND recorded_at < ?
     ORDER BY recorded_at ASC
     LIMIT ${MAX_ROWS_RANGE}`,
    [vehicleId, `${from} 00:00:00`, `${nextDay(today)} 00:00:00`]
  );
  const built = buildDays(rows);
  const withData = new Map(built.map(d => [d.date, d]));
  const list = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(from, i);
    list.push(withData.get(date) || {
      date, point_count: 0, distance_km: 0, first_at: null, last_at: null, gap_count: 0,
    });
  }
  return {
    from,
    to: today,
    days: list,
    summary: {
      day_count: built.length,
      distance_km: round(built.reduce((s, d) => s + d.distance_km, 0), 2),
      point_count: built.reduce((s, d) => s + d.point_count, 0),
      truncated: rows.length >= MAX_ROWS_RANGE,
    },
  };
}

module.exports = {
  GAP_SECONDS,
  MAX_POINTS,
  LOW_ACCURACY_M,
  addDays,
  nextDay,
  oldestRetainedDay,
  validateDay,
  haversineMeters,
  normaliseRows,
  summarise,
  downsampleIndices,
  buildTrack,
  buildDays,
  getTrack,
  getRecentDays,
};
