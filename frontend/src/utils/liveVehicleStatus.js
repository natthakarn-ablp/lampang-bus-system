/**
 * Phase 7.8 — shared formatters + status metadata for the live-vehicle
 * pages (Driver sender + School/Affiliation/Province/Admin viewers).
 *
 * Keeping this in one place so the four viewer pages render the same
 * Thai labels, the same color/opacity per status, and the same stale/
 * offline thresholds — avoids drift when copy is edited in one page
 * but forgotten elsewhere.
 *
 * Hard rules respected here:
 *   • no PII fields ever referenced
 *   • no console logging of coordinates
 *   • no localStorage / sessionStorage
 */

/* ── Status metadata ─────────────────────────────────────────────────────
 * `variant`   — maps to StatusBadge variants (success/warn/neutral/info)
 * `color`     — hex used by Leaflet DivIcon SVG fill
 * `opacity`   — marker visual prominence (1.0 ONLINE → fades by status)
 * `helpText`  — popup/list-row copy that distinguishes WHY a vehicle is
 *               not green (e.g. PAUSED is deliberate vs OFFLINE = lost)
 */
export const STATUS_META = {
  ONLINE: {
    label:    'ออนไลน์',
    variant:  'success',
    color:    '#16a34a',
    opacity:  1.0,
    helpText: null,
  },
  STALE: {
    label:    'สัญญาณเก่า',
    variant:  'warn',
    color:    '#d97706',
    opacity:  0.85,
    helpText: 'สัญญาณเก่า — ตำแหน่งอาจไม่ใช่ปัจจุบัน',
  },
  OFFLINE: {
    label:    'ออฟไลน์',
    variant:  'neutral',
    color:    '#6b7280',
    opacity:  0.55,
    helpText: 'ออฟไลน์ · ตำแหน่งล่าสุดอาจเก่า',
  },
  PAUSED: {
    label:    'หยุดส่ง',
    variant:  'neutral',
    color:    '#475569',
    opacity:  0.65,
    helpText: 'หยุดส่งโดยคนขับ',
  },
};

export const LOW_ACCURACY_RING = '#0284c7';
export const LOW_ACCURACY_LABEL = 'ความแม่นยำต่ำ';

export function getStatusMeta(status) {
  return STATUS_META[status] || STATUS_META.OFFLINE;
}

/**
 * Help-text shown beside the status badge in lists / popups. Differs
 * from the bare label because it answers WHY a row is not online —
 * "ยังไม่เคยส่งตำแหน่ง" reads very differently from "ออฟไลน์ · ตำแหน่ง
 * ล่าสุดอาจเก่า" even though both surface as status='OFFLINE' on the
 * server.
 */
export function getStatusHelpText(vehicle) {
  if (!vehicle) return null;
  if (!vehicle.received_at) return 'ยังไม่เคยส่งตำแหน่ง';
  return getStatusMeta(vehicle.status).helpText;
}

/* ── Formatters ────────────────────────────────────────────────────────── */

export function formatRelativeTime(secs) {
  if (secs == null) return 'ยังไม่มีข้อมูล';
  if (secs < 60)   return `เมื่อ ${secs} วินาทีที่แล้ว`;
  if (secs < 3600) return `เมื่อ ${Math.floor(secs / 60)} นาทีที่แล้ว`;
  const hrs = Math.floor(secs / 3600);
  return `เมื่อ ${hrs} ชั่วโมงที่แล้ว`;
}

export function formatAbsoluteThaiDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function formatThaiTime(ts) {
  if (!ts) return null;
  return new Date(ts).toLocaleTimeString('th-TH', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Bangkok',
  });
}

/* ── Predicates ────────────────────────────────────────────────────────── */

export function hasVehicleCoords(v) {
  return v
    && Number.isFinite(Number(v.latitude))
    && Number.isFinite(Number(v.longitude));
}

/**
 * Phase 7.8 — true if the client has not received a fresh poll within
 * `thresholdMs` (default 45s, vs the 15s polling interval that means
 * we missed at least 2 polls). Used to surface a "ข้อมูลอาจไม่เป็น
 * ปัจจุบัน" ribbon when the browser tab was backgrounded or the
 * network dropped.
 */
export function isViewerDataStale(lastSuccessfulFetchAtMs, thresholdMs = 45_000) {
  if (!lastSuccessfulFetchAtMs) return false;
  return Date.now() - lastSuccessfulFetchAtMs > thresholdMs;
}
