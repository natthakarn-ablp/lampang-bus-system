/**
 * pickupPointChecks — the admin "ตรวจสอบ" rules for pickup points.
 *
 * Pure functions so the map, the chips and the table all read one answer.
 *
 *   coords  — missing / non-numeric, exactly (0,0) or either axis 0, or outside
 *             the Lampang province bounding box below
 *   empty   — no student assigned (student_count === 0)
 *   dup     — another live point on the SAME vehicle within DUP_RADIUS_M
 *
 * LAMPANG_BOUNDS: the province spans roughly 17.24–19.43 N and 98.96–100.09 E
 * (Thoen/Mae Phrik in the south, Wang Nuea in the north, Ngao in the east).
 * The box adds a small margin so points near the border are not flagged; it is
 * a sanity check for typos and swapped lat/lng, not a boundary polygon.
 */

export const LAMPANG_BOUNDS = { minLat: 17.2, maxLat: 19.6, minLng: 98.9, maxLng: 100.2 };
export const DUP_RADIUS_M = 30;

export const CHECK_LABEL = {
  coords: 'พิกัดผิด',
  empty: 'ไม่มีนักเรียน',
  dup: 'จุดซ้ำ',
};

const COORD_REASON = {
  missing: 'ไม่มีพิกัด',
  zero: 'พิกัดเป็นศูนย์',
  invalid: 'พิกัดไม่ถูกต้อง',
  outside: 'อยู่นอกจังหวัดลำปาง',
};

function num(v) {
  if (v === null || v === undefined || v === '') return NaN;
  return typeof v === 'number' ? v : Number(v);
}

/** 'missing' | 'invalid' | 'zero' | 'outside' | null */
export function coordProblem(p) {
  const lat = num(p?.latitude);
  const lng = num(p?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'missing';
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return 'invalid';
  if (lat === 0 || lng === 0) return 'zero';
  const b = LAMPANG_BOUNDS;
  if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) return 'outside';
  return null;
}

export function coordReasonLabel(code) {
  return COORD_REASON[code] || '';
}

/** True when the point can be drawn on a map at all (outside-province still can). */
export function isPlottable(p) {
  const c = coordProblem(p);
  return c === null || c === 'outside';
}

export function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// 30 m of latitude ≈ 0.00027°; a slightly wider window keeps the sweep exact.
const LAT_WINDOW = (DUP_RADIUS_M / 111000) * 1.2;

/**
 * Run every check over the full set.
 * Returns { byId: Map<id, {coords, empty, dup:number[]}>, counts:{coords,empty,dup,any} }.
 * Duplicate detection sorts each vehicle's points by latitude and only compares
 * neighbours inside a latitude window, so it stays near O(n log n).
 */
export function runPickupChecks(points = []) {
  const byId = new Map();
  for (const p of points) {
    byId.set(p.id, {
      coords: coordProblem(p),
      empty: Number(p.student_count || 0) === 0,
      dup: [],
    });
  }

  const byVehicle = new Map();
  for (const p of points) {
    if (byId.get(p.id).coords !== null && byId.get(p.id).coords !== 'outside') continue;
    const key = p.vehicle_id || '';
    if (!byVehicle.has(key)) byVehicle.set(key, []);
    byVehicle.get(key).push({ id: p.id, latitude: num(p.latitude), longitude: num(p.longitude) });
  }
  for (const list of byVehicle.values()) {
    list.sort((a, b) => a.latitude - b.latitude);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].latitude - list[i].latitude <= LAT_WINDOW; j++) {
        if (distanceMeters(list[i], list[j]) <= DUP_RADIUS_M) {
          byId.get(list[i].id).dup.push(list[j].id);
          byId.get(list[j].id).dup.push(list[i].id);
        }
      }
    }
  }

  const counts = { coords: 0, empty: 0, dup: 0, any: 0 };
  for (const r of byId.values()) {
    const c = r.coords !== null;
    const d = r.dup.length > 0;
    if (c) counts.coords++;
    if (r.empty) counts.empty++;
    if (d) counts.dup++;
    if (c || r.empty || d) counts.any++;
  }
  return { byId, counts };
}

/** Does this point's result match a chip key ('' = all)? */
export function matchesCheck(result, key) {
  if (!key) return true;
  if (!result) return false;
  if (key === 'coords') return result.coords !== null;
  if (key === 'empty') return result.empty;
  if (key === 'dup') return result.dup.length > 0;
  if (key === 'any') return result.coords !== null || result.empty || result.dup.length > 0;
  return true;
}
