import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import './PickupMap.css';
import {
  getStatusMeta,
  getStatusHelpText,
  formatRelativeTime,
  LOW_ACCURACY_RING,
  LOW_ACCURACY_LABEL,
} from '../utils/liveVehicleStatus';

// Lampang centroid — fallback when no live coordinates yet.
const LAMPANG_CENTER = [18.2884, 99.4906];

/**
 * Phase 7.8 — DivIcon now varies fill-opacity by status so STALE /
 * OFFLINE / PAUSED markers fade into the map relative to fully-bright
 * ONLINE markers. PAUSED keeps a distinct slate hue so a deliberate
 * driver Stop reads differently from a lost connection on the map.
 */
function buildVehicleIcon(status, lowAccuracy) {
  const meta = getStatusMeta(status);
  const fill = meta.color;
  const opacity = meta.opacity;
  // PAUSED gets a dashed inner ring to look "intentional" vs OFFLINE solid
  const innerStroke = status === 'PAUSED' ? 'stroke-dasharray="2 2"' : '';
  const accRing = lowAccuracy
    ? `<circle cx="14" cy="14" r="12" fill="none" stroke="${LOW_ACCURACY_RING}" stroke-width="2" stroke-dasharray="3 3"/>`
    : '';
  const html = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
      ${accRing}
      <circle cx="14" cy="14" r="8" fill="${fill}" fill-opacity="${opacity}"
              stroke="#ffffff" stroke-width="2" ${innerStroke}/>
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
 * Reusable live vehicle map (used by School / Affiliation / Province /
 * Admin viewer pages).
 *
 * Props:
 *   vehicles  [{ vehicle_id, plate_no, vehicle_type, driver_name,
 *                latitude, longitude, accuracy_meters, recorded_at,
 *                received_at, seconds_since_seen, status, low_accuracy }]
 *   selectedVehicleId  string | null
 *   onMarkerClick      (vehicle) => void
 *   className          string
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
          const meta = getStatusMeta(v.status);
          const help = getStatusHelpText(v);
          const icon = buildVehicleIcon(v.status, !!v.low_accuracy);
          return (
            <Marker
              key={v.vehicle_id}
              position={[lat, lng]}
              icon={icon}
              title={`${v.plate_no || v.vehicle_id} · ${meta.label}`}
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
                    <span className="font-medium" style={{ color: meta.color }}>
                      {meta.label}
                    </span>
                    {v.low_accuracy && (
                      <span className="ml-1 text-xs" style={{ color: LOW_ACCURACY_RING }}>
                        · {LOW_ACCURACY_LABEL}
                      </span>
                    )}
                  </p>
                  {help && (
                    <p className="text-xs text-ink-muted mb-1 italic">{help}</p>
                  )}
                  <p className="text-xs text-ink-muted">
                    {formatRelativeTime(v.seconds_since_seen)}
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
