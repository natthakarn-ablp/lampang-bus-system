import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import './PickupMap.css';

// Lampang centroid — fallback when no live coordinates yet.
const LAMPANG_CENTER = [18.2884, 99.4906];

// Status → color (hex). Mirrors the project palette so the marker dot
// reads consistently with the StatusBadge variants used elsewhere.
const STATUS_COLOR = {
  ONLINE:  '#16a34a',  // success
  STALE:   '#d97706',  // warn
  OFFLINE: '#6b7280',  // neutral
  PAUSED:  '#475569',  // slate
};
const LOW_ACCURACY_RING = '#0284c7'; // info — overlay ring when low_accuracy

const STATUS_LABEL = {
  ONLINE:  'ออนไลน์',
  STALE:   'สัญญาณเก่า',
  OFFLINE: 'ออฟไลน์',
  PAUSED:  'หยุดส่ง',
};

/**
 * Build a small DivIcon dot whose fill color reflects the vehicle's
 * status. A second concentric ring is drawn when low_accuracy is true
 * so it's visible at a glance without claiming a separate status.
 */
function buildVehicleIcon(status, lowAccuracy) {
  const color = STATUS_COLOR[status] || STATUS_COLOR.OFFLINE;
  const ring = lowAccuracy
    ? `<circle cx="14" cy="14" r="12" fill="none" stroke="${LOW_ACCURACY_RING}" stroke-width="2" stroke-dasharray="3 3"/>`
    : '';
  const html = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
      ${ring}
      <circle cx="14" cy="14" r="8" fill="${color}" stroke="#ffffff" stroke-width="2"/>
    </svg>`;
  return L.divIcon({
    className: 'live-vehicle-marker',
    html,
    iconSize:   [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -10],
  });
}

/**
 * Format Thai relative-time given seconds_since_seen (server-computed).
 * null → "ยังไม่มีข้อมูล".
 */
function formatRelative(secs) {
  if (secs == null) return 'ยังไม่มีข้อมูล';
  if (secs < 60)   return `เมื่อ ${secs} วินาทีที่แล้ว`;
  if (secs < 3600) return `เมื่อ ${Math.floor(secs / 60)} นาทีที่แล้ว`;
  const hrs = Math.floor(secs / 3600);
  return `เมื่อ ${hrs} ชั่วโมงที่แล้ว`;
}

/**
 * Phase 7.4 — Reusable live vehicle map.
 *
 * Props:
 *   vehicles  [{ vehicle_id, plate_no, vehicle_type, driver_name,
 *                latitude, longitude, accuracy_meters, recorded_at,
 *                received_at, seconds_since_seen, status, low_accuracy }]
 *   selectedVehicleId  string | null  — when set, fly to this marker
 *   onMarkerClick      (vehicle) => void
 *   className          string
 *
 * Behavior:
 *   • only vehicles with finite latitude+longitude are rendered as
 *     markers; rows without coords are caller's responsibility (list)
 *   • auto-fit bounds ONCE on first valid marker load only — markers
 *     moving on subsequent polls do NOT re-pan the map (privacy of
 *     scroll context + UX)
 *   • Popup lists plate / type / driver / status / time + accuracy.
 *     Never PII.
 */
export default function LiveVehicleMap({
  vehicles = [],
  selectedVehicleId = null,
  onMarkerClick,
  className = 'h-full w-full',
}) {
  const validVehicles = useMemo(
    () => vehicles.filter(v =>
      Number.isFinite(Number(v.latitude)) && Number.isFinite(Number(v.longitude))
    ),
    [vehicles]
  );

  return (
    <div
      className={`pickup-page-map relative z-0 isolate ${className}`}
      style={{ minHeight: 320 }}
    >
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
        {validVehicles.map(v => {
          const lat = Number(v.latitude);
          const lng = Number(v.longitude);
          const icon = buildVehicleIcon(v.status, !!v.low_accuracy);
          return (
            <Marker
              key={v.vehicle_id}
              position={[lat, lng]}
              icon={icon}
              eventHandlers={{
                click: () => onMarkerClick && onMarkerClick(v),
              }}
            >
              <Popup>
                <div className="min-w-[200px]">
                  <p className="font-semibold text-ink mb-0.5">{v.plate_no || v.vehicle_id}</p>
                  {v.vehicle_type && (
                    <p className="text-xs text-ink-muted mb-1.5">{v.vehicle_type}</p>
                  )}
                  {v.driver_name && (
                    <p className="text-xs text-ink mb-1">คนขับ: {v.driver_name}</p>
                  )}
                  <p className="text-xs mb-1">
                    สถานะ:{' '}
                    <span className="font-medium" style={{ color: STATUS_COLOR[v.status] || STATUS_COLOR.OFFLINE }}>
                      {STATUS_LABEL[v.status] || v.status || 'ไม่ทราบ'}
                    </span>
                    {v.low_accuracy && (
                      <span className="ml-1 text-xs" style={{ color: LOW_ACCURACY_RING }}>
                        · ความแม่นยำต่ำ
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {formatRelative(v.seconds_since_seen)}
                  </p>
                  {v.accuracy_meters != null && (
                    <p className="text-xs text-ink-muted">
                      ±{v.accuracy_meters} เมตร
                    </p>
                  )}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brand font-medium hover:underline mt-1.5 inline-block"
                  >
                    เปิดใน Google Maps →
                  </a>
                </div>
              </Popup>
            </Marker>
          );
        })}
        <FitOnce vehicles={validVehicles} />
        <FlyToSelected vehicles={validVehicles} selectedVehicleId={selectedVehicleId} />
      </MapContainer>
    </div>
  );
}

/**
 * Fit-to-bounds exactly once: the first time we receive ≥1 valid
 * vehicle. After that, marker movement does not re-pan the map (the
 * spec says explicitly "auto fit bounds on first valid marker load
 * only — do not keep re-centering every 15s because marker movement
 * should not make map jump").
 */
function FitOnce({ vehicles }) {
  const map = useMap();
  const fittedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current) return;
    if (vehicles.length === 0) return;
    const bounds = L.latLngBounds(
      vehicles.map(v => [Number(v.latitude), Number(v.longitude)])
    );
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    fittedRef.current = true;
  }, [vehicles, map]);
  return null;
}

/**
 * Imperative fly-to when a list-row is clicked. Decoupled from
 * FitOnce so the user-driven selection always pans even after the
 * initial fit has completed.
 */
function FlyToSelected({ vehicles, selectedVehicleId }) {
  const map = useMap();
  useEffect(() => {
    if (!selectedVehicleId) return;
    const v = vehicles.find(x => x.vehicle_id === selectedVehicleId);
    if (!v) return;
    map.flyTo(
      [Number(v.latitude), Number(v.longitude)],
      Math.max(map.getZoom(), 15),
      { duration: 0.5 }
    );
  }, [selectedVehicleId, vehicles, map]);
  return null;
}
