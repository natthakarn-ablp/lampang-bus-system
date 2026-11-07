/**
 * Client mirror of backend/src/utils/gpsTrackingWindow.js.
 *
 * GPS is recorded only inside the school-run windows, Bangkok wall-clock,
 * minute resolution, inclusive at both ends (04:59 out, 05:00 in, 09:00 in,
 * 09:01 out). The server is the authority — it ignores fixes outside the
 * windows — and returns its configured windows in every location response,
 * which the driver app adopts via setWindows().
 */

export const DEFAULT_TRACKING_WINDOWS = [
  { start: '05:00', end: '09:00' },
  { start: '15:00', end: '19:00' },
];

const toMin = (hm) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export function normaliseWindows(windows) {
  const list = Array.isArray(windows) ? windows : [];
  const ok = list
    .map((w) => ({ start: toMin(w?.start), end: toMin(w?.end), label: `${w?.start}–${w?.end}` }))
    .filter((w) => w.start != null && w.end != null && w.end >= w.start);
  return ok.length ? ok : normaliseWindows(DEFAULT_TRACKING_WINDOWS);
}

/** Bangkok minute-of-day of an instant. */
export function bangkokMinuteOfDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date instanceof Date ? date : new Date(date));
  const h = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value);
  return h * 60 + m;
}

export function isWithinTrackingWindow(date = new Date(), windows = DEFAULT_TRACKING_WINDOWS) {
  const t = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(t.getTime())) return false;
  const m = bangkokMinuteOfDay(t);
  return normaliseWindows(windows).some((w) => m >= w.start && m <= w.end);
}

export function windowsLabel(windows = DEFAULT_TRACKING_WINDOWS) {
  return normaliseWindows(windows).map((w) => w.label).join(', ');
}
