'use strict';

/**
 * GPS tracking windows (owner decision 2026-11-07).
 *
 * GPS is recorded only during the school runs, in Asia/Bangkok wall-clock
 * time. Default: 05:00–09:00 and 15:00–19:00. Configurable through
 * GPS_TRACKING_WINDOWS="HH:MM-HH:MM,HH:MM-HH:MM".
 *
 * Boundaries are at MINUTE resolution and inclusive at both ends:
 *   04:59:59 → outside · 05:00:00 → inside · 09:00:59 → inside · 09:01:00 → outside
 *
 * Applies to the routine location sender only (single + batch endpoints and
 * the live-location note). Emergency reporting is deliberately NOT gated.
 */

const { bangkokParts } = require('./thaiTime');

const DEFAULT_WINDOWS = '05:00-09:00,15:00-19:00';
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(hm) {
  const m = HM_RE.exec(String(hm || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Parse "05:00-09:00,15:00-19:00" → [{ start: 300, end: 540, label: '05:00–09:00' }, …].
 * An unparsable value falls back to the defaults (a typo in .env must not
 * silently switch GPS off for the whole province, nor on for 24 h).
 */
function parseWindows(value = DEFAULT_WINDOWS) {
  const parts = String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const part of parts) {
    const [a, b] = part.split('-');
    const start = toMinutes(a);
    const end = toMinutes(b);
    if (start == null || end == null || end < start) {
      return value === DEFAULT_WINDOWS ? [] : parseWindows(DEFAULT_WINDOWS);
    }
    out.push({ start, end, label: `${a.trim()}–${b.trim()}` });
  }
  return out.length ? out : (value === DEFAULT_WINDOWS ? [] : parseWindows(DEFAULT_WINDOWS));
}

function minuteOfDayBangkok(value) {
  const p = bangkokParts(value instanceof Date ? value : new Date(value));
  if (!p) return null;
  return Number(p.hour) * 60 + Number(p.minute);
}

/** Index of the window containing the instant, or -1. */
function windowIndexOf(value, windows = parseWindows(DEFAULT_WINDOWS)) {
  const m = minuteOfDayBangkok(value);
  if (m == null) return -1;
  return windows.findIndex(w => m >= w.start && m <= w.end);
}

function isWithinTrackingWindow(value, windows = parseWindows(DEFAULT_WINDOWS)) {
  return windowIndexOf(value, windows) >= 0;
}

/** Public shape for clients: [{ start: '05:00', end: '09:00' }, …] + label. */
function describeWindows(windows) {
  const fmt = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  return {
    windows: windows.map(w => ({ start: fmt(w.start), end: fmt(w.end) })),
    label: windows.map(w => w.label).join(', '),
  };
}

let cached = null;
/** Windows from env (parsed once per process). */
function configuredWindows() {
  if (!cached) {
    // Lazy require: keeps this util loadable in pure unit tests without env.
    const env = require('../config/env');
    cached = parseWindows(env.tracking.gpsTrackingWindows);
  }
  return cached;
}

/** { windows, label, in_window_now } for API responses. */
function trackingInfo(now = new Date(), windows = configuredWindows()) {
  return { ...describeWindows(windows), in_window_now: isWithinTrackingWindow(now, windows) };
}

module.exports = {
  DEFAULT_WINDOWS,
  parseWindows,
  isWithinTrackingWindow,
  windowIndexOf,
  describeWindows,
  configuredWindows,
  trackingInfo,
};
