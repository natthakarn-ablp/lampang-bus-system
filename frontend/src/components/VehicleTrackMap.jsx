import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Tooltip, useMap } from 'react-leaflet';
import './PickupMap.css';

/**
 * Route-history map for one vehicle-day (GPS replay).
 *
 *   • solid polyline per signal segment, coloured by time of day
 *     (morning run vs evening run, Bangkok clock)
 *   • dashed grey line across each signal gap (phone offline > 3 min) —
 *     we do NOT know the road taken there, so it is drawn as a straight hint
 *   • start / end markers, the vehicle's pickup points, and a moving marker
 *     at `cursorIndex` driven by the page's slider / play button
 *
 * Markers use CircleMarker / DivIcon (no PNG icon assets), so Leaflet's
 * default-icon path workaround is not needed here.
 */

const LAMPANG_CENTER = [18.2884, 99.4906];
export const TRACK_COLORS = {
  morning: '#2563EB',
  evening: '#EA580C',
  gap:     '#64748B',
  start:   '#16A34A',
  end:     '#DC2626',
  pickup:  '#7C3AED',
};

export function bangkokHour(iso) {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false })
    .format(new Date(iso));
  return Number(h) % 24;
}

export const periodOf = (iso) => (bangkokHour(iso) < 12 ? 'morning' : 'evening');

/** Split each segment into runs of the same period → [{ period, latlngs }]. */
function colouredRuns(points, segments) {
  const runs = [];
  for (const seg of segments) {
    let cur = null;
    for (let i = seg.start_index; i <= seg.end_index; i++) {
      const p = points[i];
      if (!p) continue;
      const period = periodOf(p.t);
      if (!cur || cur.period !== period) {
        // share the joining vertex so runs touch
        const join = cur ? [cur.latlngs[cur.latlngs.length - 1]] : [];
        cur = { period, latlngs: [...join] };
        runs.push(cur);
      }
      cur.latlngs.push([p.lat, p.lng]);
    }
  }
  return runs.filter((r) => r.latlngs.length >= 2);
}

const busIcon = L.divIcon({
  className: 'live-vehicle-marker',
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
      <circle cx="15" cy="15" r="11" fill="#0F172A" stroke="#ffffff" stroke-width="3"/>
      <rect x="10" y="9.5" width="10" height="9" rx="2" fill="#ffffff"/>
      <rect x="11.5" y="11" width="7" height="3" rx="0.5" fill="#0F172A"/>
      <circle cx="12" cy="20" r="1.4" fill="#ffffff"/><circle cx="18" cy="20" r="1.4" fill="#ffffff"/>
    </svg>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

export default function VehicleTrackMap({
  points = [],
  segments = [],
  gaps = [],
  pickupPoints = [],
  cursorIndex = null,
  className = 'h-full w-full',
}) {
  const runs = useMemo(() => colouredRuns(points, segments), [points, segments]);
  const gapLines = useMemo(() => {
    const out = [];
    for (let i = 1; i < segments.length; i++) {
      // gaps[i - 1] separates segments[i - 1] and segments[i]; the break
      // between the morning and evening windows is not drawn.
      if (gaps[i - 1]?.kind === 'break') continue;
      const a = points[segments[i - 1].end_index];
      const b = points[segments[i].start_index];
      if (a && b) out.push([[a.lat, a.lng], [b.lat, b.lng]]);
    }
    return out;
  }, [points, segments, gaps]);
  const first = points[0];
  const last = points[points.length - 1];
  const cursor = cursorIndex != null ? points[cursorIndex] : null;

  return (
    <div className={`pickup-page-map relative z-0 isolate ${className}`} style={{ minHeight: 320 }}>
      <MapContainer
        center={LAMPANG_CENTER}
        zoom={12}
        scrollWheelZoom
        className="!relative !z-0 h-full w-full"
        style={{ height: '100%', width: '100%', zIndex: 0 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {runs.map((r, i) => (
          <Polyline
            key={`run-${i}`}
            positions={r.latlngs}
            pathOptions={{ color: TRACK_COLORS[r.period], weight: 5, opacity: 0.85 }}
          />
        ))}
        {gapLines.map((g, i) => (
          <Polyline
            key={`gap-${i}`}
            positions={g}
            pathOptions={{ color: TRACK_COLORS.gap, weight: 3, opacity: 0.9, dashArray: '6 8' }}
          >
            <Tooltip sticky>ช่วงสัญญาณขาด (ไม่ทราบเส้นทางจริง)</Tooltip>
          </Polyline>
        ))}
        {pickupPoints.map((pp) => (
          <CircleMarker
            key={`pp-${pp.id}`}
            center={[pp.latitude, pp.longitude]}
            radius={6}
            pathOptions={{ color: '#ffffff', weight: 2, fillColor: TRACK_COLORS.pickup, fillOpacity: 0.95 }}
          >
            <Tooltip>{pp.sequence != null ? `จุดรับส่ง ${pp.sequence}` : 'จุดรับส่ง'}{pp.label ? ` · ${pp.label}` : ''}</Tooltip>
          </CircleMarker>
        ))}
        {first && (
          <CircleMarker
            center={[first.lat, first.lng]}
            radius={8}
            pathOptions={{ color: '#ffffff', weight: 3, fillColor: TRACK_COLORS.start, fillOpacity: 1 }}
          >
            <Tooltip>จุดเริ่มต้น</Tooltip>
          </CircleMarker>
        )}
        {last && last !== first && (
          <CircleMarker
            center={[last.lat, last.lng]}
            radius={8}
            pathOptions={{ color: '#ffffff', weight: 3, fillColor: TRACK_COLORS.end, fillOpacity: 1 }}
          >
            <Tooltip>จุดสิ้นสุด</Tooltip>
          </CircleMarker>
        )}
        {cursor && <Marker position={[cursor.lat, cursor.lng]} icon={busIcon} zIndexOffset={1000} />}
        <FitToTrack points={points} pickupPoints={pickupPoints} />
      </MapContainer>
    </div>
  );
}

function FitToTrack({ points, pickupPoints }) {
  const map = useMap();
  const fittedFor = useRef(null);
  useEffect(() => {
    const coords = points.map((p) => [p.lat, p.lng]);
    if (!coords.length) pickupPoints.forEach((pp) => coords.push([pp.latitude, pp.longitude]));
    if (!coords.length) return;
    const key = `${coords.length}:${coords[0]}:${coords[coords.length - 1]}`;
    if (fittedFor.current === key) return;
    fittedFor.current = key;
    map.fitBounds(L.latLngBounds(coords), { padding: [32, 32], maxZoom: 16 });
  }, [points, pickupPoints, map]);
  return null;
}
