#!/usr/bin/env node
'use strict';

// Phase 11A — nightly route baseline refresh.
//
// Aggregates the last BASELINE_WINDOW_DAYS (default 14) of
// vehicle_location_history + geofence_events into route_baselines:
//   * typical_start / typical_end  — median shift start/end times
//   * typical_path                 — sampled polyline of the median trip
//   * sample_count                 — number of sessions used
//
// One row per (vehicle_id, session, day_of_week). Existing rows are
// upserted (ON DUPLICATE KEY UPDATE) so the table always reflects the
// most recent window.
//
// Run manually:
//   cd backend && node scripts/refresh-route-baselines.js
//
// Schedule (crontab -e):
//   30 3 * * *  cd /home/schoolbus/lampang-bus-system/backend && \
//               node scripts/refresh-route-baselines.js >> \
//               /home/schoolbus/logs/refresh-baselines.log 2>&1
//
// Exit codes: 0=OK, 1=error.

const { pool } = require('../src/config/database');
const env = require('../src/config/env');

const WINDOW_DAYS = env.tracking.baselineWindowDays;
const SAMPLE_EVERY_M = env.tracking.baselineSampleEveryM;
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

/**
 * Sample a polyline so consecutive waypoints are at least SAMPLE_EVERY_M
 * apart. Returns an array of {lat, lng, t} where t is seconds since the
 * first sample (relative timing, useful for LATE detection).
 */
function samplePolyline(rows) {
  if (!rows.length) return [];
  const out = [{
    lat: Number(rows[0].latitude),
    lng: Number(rows[0].longitude),
    t: 0,
  }];
  let lastLat = Number(rows[0].latitude);
  let lastLng = Number(rows[0].longitude);
  const t0 = new Date(rows[0].recorded_at).getTime();
  for (let i = 1; i < rows.length; i++) {
    const lat = Number(rows[i].latitude);
    const lng = Number(rows[i].longitude);
    const d = haversineMeters(lastLat, lastLng, lat, lng);
    if (d < SAMPLE_EVERY_M) continue;
    out.push({
      lat,
      lng,
      t: Math.round((new Date(rows[i].recorded_at).getTime() - t0) / 1000),
    });
    lastLat = lat;
    lastLng = lng;
  }
  return out;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compute the median "start" and "end" times for a session from
 * geofence_events: ENTER at the first pickup point = start, ENTER at the
 * school = end. Falls back to first/last GPS ping of the session if no
 * geofence events exist yet.
 */
async function sessionBounds(vehicleId, session, dayOfWeek, dateFrom, dateTo) {
  // Try geofence-based bounds first (more meaningful).
  const [events] = await pool.query(
    `SELECT gfe.occurred_at, g.target_type
       FROM geofence_events gfe
       JOIN geofences g ON g.id = gfe.geofence_id
      WHERE gfe.vehicle_id = ?
        AND gfe.event_type = 'ENTER'
        AND DAYOFWEEK(gfe.occurred_at) = ?
        AND gfe.occurred_at BETWEEN ? AND ?
      ORDER BY gfe.occurred_at`,
    [vehicleId, dayOfWeek + 1, dateFrom, dateTo]
  );

  const startTimes = [];
  const endTimes = [];
  for (const ev of events) {
    const t = new Date(ev.occurred_at);
    const seconds = t.getHours() * 3600 + t.getMinutes() * 60 + t.getSeconds();
    if (ev.target_type === 'PICKUP_POINT' || ev.target_type === 'DEPOT') {
      startTimes.push(seconds);
    } else if (ev.target_type === 'SCHOOL') {
      endTimes.push(seconds);
    }
  }

  // Fallback: use first/last GPS ping of the day for this session.
  if (!startTimes.length || !endTimes.length) {
    const [pings] = await pool.query(
      `SELECT recorded_at
         FROM vehicle_location_history
        WHERE vehicle_id = ?
          AND DAYOFWEEK(recorded_at) = ?
          AND recorded_at BETWEEN ? AND ?
        ORDER BY recorded_at`,
      [vehicleId, dayOfWeek + 1, dateFrom, dateTo]
    );
    if (!pings.length) return { startSec: null, endSec: null, sessionCount: 0 };
    const switchHour = env.app.driverSessionSwitchHour;
    for (const p of pings) {
      const t = new Date(p.recorded_at);
      const seconds = t.getHours() * 3600 + t.getMinutes() * 60 + t.getSeconds();
      const hour = t.getHours();
      const isMorning = hour < switchHour;
      if (session === 'morning' && isMorning) {
        startTimes.push(seconds);
        endTimes.push(seconds);
      } else if (session === 'evening' && !isMorning) {
        startTimes.push(seconds);
        endTimes.push(seconds);
      }
    }
    if (!startTimes.length) return { startSec: null, endSec: null, sessionCount: 0 };
  }

  // sessionCount = distinct days observed (rough heuristic).
  const sessionCount = Math.max(
    startTimes.length,
    endTimes.length
  );

  return {
    startSec: median(startTimes),
    endSec: median(endTimes),
    sessionCount,
  };
}

function secondsToTime(seconds) {
  if (seconds == null) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Build the typical polyline for a session by sampling the most recent
 * qualifying day's GPS trail (the day closest to now that has ≥ 20 pings
 * in the session window).
 */
async function typicalPath(vehicleId, session, dayOfWeek, dateFrom, dateTo) {
  const switchHour = env.app.driverSessionSwitchHour;
  const [days] = await pool.query(
    `SELECT DATE(recorded_at) AS d, COUNT(*) AS n
       FROM vehicle_location_history
      WHERE vehicle_id = ?
        AND DAYOFWEEK(recorded_at) = ?
        AND recorded_at BETWEEN ? AND ?
      GROUP BY DATE(recorded_at)
      HAVING n >= 20
      ORDER BY d DESC
      LIMIT 1`,
    [vehicleId, dayOfWeek + 1, dateFrom, dateTo]
  );
  if (!days.length) return { path: null, sampleCount: 0 };
  const day = days[0].d;
  const [rows] = await pool.query(
    `SELECT latitude, longitude, recorded_at
       FROM vehicle_location_history
      WHERE vehicle_id = ?
        AND DATE(recorded_at) = ?
        AND HOUR(recorded_at) ${session === 'morning' ? '<' : '>='} ?
      ORDER BY recorded_at`,
    [vehicleId, day, switchHour]
  );
  return {
    path: samplePolyline(rows),
    sampleCount: rows.length,
  };
}

async function refreshAll() {
  const dateTo = new Date();
  const dateFrom = new Date(dateTo.getTime() - WINDOW_DAYS * 86400 * 1000);
  const dateFromStr = dateFrom.toISOString().slice(0, 19).replace('T', ' ');
  const dateToStr = dateTo.toISOString().slice(0, 19).replace('T', ' ');

  console.log(`[refresh-baselines] window=${WINDOW_DAYS}d from=${dateFromStr} to=${dateToStr}`);

  // Only refresh baselines for vehicles that actually have GPS history.
  const [vehicles] = await pool.query(
    `SELECT DISTINCT vehicle_id
       FROM vehicle_location_history
      WHERE recorded_at BETWEEN ? AND ?`,
    [dateFromStr, dateToStr]
  );
  console.log(`[refresh-baselines] vehicles with history: ${vehicles.length}`);

  let upserted = 0;
  let skipped = 0;
  const sessions = ['morning', 'evening'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (const v of vehicles) {
    const vehicleId = v.vehicle_id;
    for (let dow = 0; dow < 7; dow++) {
      for (const session of sessions) {
        const { startSec, endSec, sessionCount } =
          await sessionBounds(vehicleId, session, dow, dateFromStr, dateToStr);
        if (sessionCount < 3) { skipped++; continue; }

        const { path, sampleCount } =
          await typicalPath(vehicleId, session, dow, dateFromStr, dateToStr);

        const typicalStart = secondsToTime(startSec);
        const typicalEnd = secondsToTime(endSec);
        const typicalPathJson = path && path.length >= 2 ? JSON.stringify(path) : null;

        await pool.query(
          `INSERT INTO route_baselines
             (vehicle_id, session, day_of_week,
              typical_start, typical_end, typical_path, sample_count)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             typical_start = VALUES(typical_start),
             typical_end   = VALUES(typical_end),
             typical_path  = VALUES(typical_path),
             sample_count  = VALUES(sample_count)`,
          [
            vehicleId, session, dow,
            typicalStart, typicalEnd, typicalPathJson,
            Math.min(sessionCount, sampleCount || sessionCount),
          ]
        );
        upserted++;
      }
    }
    if (upserted % 14 === 0) {
      console.log(`[refresh-baselines]   ${vehicleId} done (cumulative upserts=${upserted})`);
    }
  }

  console.log(`[refresh-baselines] DONE upserted=${upserted} skipped=${skipped} (skipped = <3 sessions)`);
}

(async () => {
  try {
    await refreshAll();
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('[refresh-baselines] FAILED:', err);
    try { await pool.end(); } catch {}
    process.exit(1);
  }
})();
