import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import './PickupMap.css';

// Vite + Leaflet default-icon workaround. Without this the standard
// blue marker icons resolve to broken URLs in production builds.
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl       from 'leaflet/dist/images/marker-icon.png';
import shadowUrl     from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });

// Lampang province centroid — sane default when the user hasn't supplied
// a center and there are no points to fit to (e.g. empty state).
const LAMPANG_CENTER = [18.2884, 99.4906];

const SESSION_LABEL = { morning: 'รอบเช้า', evening: 'รอบเย็น', both: 'ทั้งวัน' };

/**
 * PickupMap — Leaflet wrapper for the Phase 6 pickup-points feature.
 *
 * Props:
 *   points          [{ id, label, latitude, longitude, session, students[] }]
 *   center          [lat, lng] (optional; defaults to Lampang)
 *   zoom            number (default 13)
 *   selectedPointId number | null — render this marker visually larger
 *   onMarkerClick   (point) => void
 *   className       string — passed to the MapContainer wrapper
 *
 * The component auto-fits the map bounds to the supplied points when
 * `points` changes (via the inner FitBounds child). When no points are
 * given, it stays at `center` + `zoom`.
 */
export default function PickupMap({
  points = [],
  center,
  zoom = 13,
  selectedPointId = null,
  onMarkerClick,
  className = 'h-full w-full',
}) {
  const initialCenter = center || LAMPANG_CENTER;

  // Filter out points with missing/invalid coords defensively.
  const validPoints = useMemo(
    () => points.filter(p =>
      Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
    ),
    [points]
  );

  return (
    <div
      className={`pickup-page-map relative z-0 isolate ${className}`}
      style={{ minHeight: 320 }}
    >
    <MapContainer
      center={initialCenter}
      zoom={zoom}
      scrollWheelZoom
      className="!relative !z-0 h-full w-full"
      style={{ height: '100%', width: '100%', zIndex: 0 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {validPoints.map(p => (
        <Marker
          key={p.id}
          position={[p.latitude, p.longitude]}
          eventHandlers={{
            click: () => onMarkerClick && onMarkerClick(p),
          }}
        >
          <Popup>
            <div className="min-w-[180px]">
              <p className="font-semibold text-ink mb-1">{p.label}</p>
              <p className="text-xs text-ink-muted mb-2">
                {SESSION_LABEL[p.session] || p.session || 'ทั้งวัน'}
                {Array.isArray(p.students) && ` · ${p.students.length} คน`}
              </p>
              {Array.isArray(p.students) && p.students.length > 0 && (
                <ul className="text-xs space-y-0.5 mb-2 max-h-32 overflow-y-auto">
                  {p.students.slice(0, 5).map(s => (
                    <li key={s.id} className="truncate">
                      {s.first_name} {s.last_name}
                      {s.classroom && <span className="text-ink-muted"> · {s.classroom}</span>}
                    </li>
                  ))}
                  {p.students.length > 5 && (
                    <li className="text-ink-muted">…และอีก {p.students.length - 5} คน</li>
                  )}
                </ul>
              )}
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-brand font-medium hover:underline"
              >
                เปิดใน Google Maps →
              </a>
            </div>
          </Popup>
        </Marker>
      ))}
      <FitBounds points={validPoints} selectedPointId={selectedPointId} />
    </MapContainer>
    </div>
  );
}

/* ── FitBounds: pan/zoom map to fit supplied markers; or fly to selected ── */
function FitBounds({ points, selectedPointId }) {
  const map = useMap();

  useEffect(() => {
    if (selectedPointId != null) {
      const sel = points.find(p => p.id === selectedPointId);
      if (sel) {
        map.flyTo([sel.latitude, sel.longitude], Math.max(map.getZoom(), 15), {
          duration: 0.5,
        });
        return;
      }
    }
    if (points.length > 0) {
      const bounds = L.latLngBounds(points.map(p => [p.latitude, p.longitude]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
    // No points → stay at initial center+zoom; no-op.
  }, [points, selectedPointId, map]);

  return null;
}
