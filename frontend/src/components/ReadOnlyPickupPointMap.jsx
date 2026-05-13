import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { Map as MapIcon, Bus, Users, Clock } from 'lucide-react';
import { AppCard, AlertBanner, DashboardSection } from './ui';
import LoadingState from './LoadingState';
import './PickupMap.css';

// Vite + Leaflet default-icon workaround — same as PickupMap.jsx
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl       from 'leaflet/dist/images/marker-icon.png';
import shadowUrl     from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });

const LAMPANG_CENTER = [18.2884, 99.4906];

const SESSION_LABEL = { morning: 'เช้า', evening: 'เย็น', both: 'เช้าและเย็น' };

function formatSession(s) {
  return SESSION_LABEL[s] || (s || 'ไม่ระบุ');
}

function formatGradeSummary(g) {
  if (Array.isArray(g)) return g.length ? g.join(', ') : 'ไม่ระบุ';
  if (typeof g === 'string' && g.trim()) return g;
  return 'ไม่ระบุ';
}

function hasCoords(p) {
  return Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude);
}

// Row-key + map-key — pickup_point_id can repeat when one point serves
// multiple schools (one row per school). Combine with school_id to stay unique.
function rowKey(p) {
  return `${p.pickup_point_id}-${p.school_id || 'none'}`;
}

/**
 * ReadOnlyPickupPointMap — shared read-only viewer for affiliation /
 * province / transport. NO edit/create/delete affordances. Renders only
 * safe aggregate fields: label, session, plate_no, vehicle_type,
 * school_name, affiliation_name, student_count_in_scope, grade_summary.
 *
 * Never renders student names, phone numbers, addresses, or cid.
 */
export default function ReadOnlyPickupPointMap({
  points = [],
  loading = false,
  error = null,
  selectedKey = null,
  onSelect,
  showSchool = true,
  showAffiliation = false,
  emptyMessage = 'ยังไม่มีจุดรับส่งในขอบเขตนี้',
}) {
  const validPoints = useMemo(() => points.filter(hasCoords), [points]);
  const hasAnyPoints   = points.length > 0;
  const hasAnyCoords   = validPoints.length > 0;

  if (error) {
    return (
      <AlertBanner variant="danger" title="โหลดข้อมูลแผนที่จุดรับส่งไม่สำเร็จ">
        {error}
      </AlertBanner>
    );
  }

  if (loading) {
    return <LoadingState message="กำลังโหลดแผนที่และข้อมูล…" />;
  }

  if (!hasAnyPoints) {
    return <AlertBanner variant="info" title="ยังไม่มีจุดรับส่งในขอบเขตนี้">{emptyMessage}</AlertBanner>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
      {/* Left: list of points */}
      <DashboardSection title="รายการจุดรับส่ง" description={`${points.length} จุด`}>
        <div className="space-y-2 max-h-[50vh] lg:max-h-[60vh] overflow-y-auto pr-1">
          {points.map(p => {
            const key = rowKey(p);
            return (
              <PointRow
                key={key}
                point={p}
                selected={selectedKey === key}
                onClick={() => onSelect && onSelect(key, p)}
                showSchool={showSchool}
                showAffiliation={showAffiliation}
              />
            );
          })}
        </div>
      </DashboardSection>

      {/* Right: the map */}
      <DashboardSection title="แผนที่">
        <div className="h-[50vh] min-h-[320px] lg:h-[60vh] lg:min-h-[400px] rounded-xl overflow-hidden border border-surface-border">
          {hasAnyCoords ? (
            <InnerMap
              points={validPoints}
              selectedKey={selectedKey}
              onMarkerClick={(p) => onSelect && onSelect(rowKey(p), p)}
              showSchool={showSchool}
              showAffiliation={showAffiliation}
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center bg-surface text-ink-muted text-sm p-4 text-center">
              ยังไม่มีรายการที่มีพิกัดสำหรับแสดงบนแผนที่
            </div>
          )}
        </div>
      </DashboardSection>
    </div>
  );
}

/* ── List row — pure read-only; no edit/delete controls ─────────────────── */
function PointRow({ point, selected, onClick, showSchool, showAffiliation }) {
  return (
    <AppCard
      as="button"
      padding="md"
      onClick={onClick}
      className={`w-full text-left transition ${
        selected
          ? 'ring-2 ring-brand border-brand'
          : 'hover:shadow-elevate hover:-translate-y-0.5'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <MapIcon className="w-4 h-4 text-brand shrink-0" strokeWidth={2} />
            <p className="font-semibold text-ink truncate">{point.label || 'ไม่ระบุชื่อจุด'}</p>
          </div>
          <p className="text-xs text-ink-muted flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" strokeWidth={2} />
              {formatSession(point.session)}
            </span>
            {point.plate_no && (
              <span className="inline-flex items-center gap-1">
                <Bus className="w-3 h-3" strokeWidth={2} />
                {point.plate_no}
                {point.vehicle_type && <span className="text-ink-muted">({point.vehicle_type})</span>}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Users className="w-3 h-3" strokeWidth={2} />
              {Number(point.student_count_in_scope || 0)} คน
            </span>
          </p>
        </div>
        {!hasCoords(point) && (
          <span className="shrink-0 text-[11px] text-warn bg-warn-soft px-2 py-0.5 rounded">
            ไม่มีพิกัด
          </span>
        )}
      </div>
      <div className="mt-2 text-xs text-ink-muted space-y-0.5">
        {showSchool && point.school_name && (
          <p className="truncate">โรงเรียน: <span className="text-ink">{point.school_name}</span></p>
        )}
        {showAffiliation && point.affiliation_name && (
          <p className="truncate">สังกัด: <span className="text-ink">{point.affiliation_name}</span></p>
        )}
        <p className="truncate">ระดับชั้น: <span className="text-ink">{formatGradeSummary(point.grade_summary)}</span></p>
      </div>
    </AppCard>
  );
}

/* ── Map ────────────────────────────────────────────────────────────────── */
function InnerMap({ points, selectedKey, onMarkerClick, showSchool, showAffiliation }) {
  return (
    <div className="pickup-page-map relative z-0 isolate h-full w-full" style={{ minHeight: 320 }}>
      <MapContainer
        center={LAMPANG_CENTER}
        zoom={13}
        scrollWheelZoom
        className="!relative !z-0 h-full w-full"
        style={{ height: '100%', width: '100%', zIndex: 0 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.map(p => (
          <Marker
            key={rowKey(p)}
            position={[p.latitude, p.longitude]}
            eventHandlers={{ click: () => onMarkerClick && onMarkerClick(p) }}
          >
            <Popup>
              <div className="min-w-[200px]">
                <p className="font-semibold text-ink mb-1">{p.label || 'ไม่ระบุชื่อจุด'}</p>
                <p className="text-xs text-ink-muted mb-1">
                  {formatSession(p.session)}
                  {p.plate_no && <> · {p.plate_no}</>}
                  {p.vehicle_type && <> ({p.vehicle_type})</>}
                </p>
                {showSchool && p.school_name && (
                  <p className="text-xs mb-0.5"><span className="text-ink-muted">โรงเรียน:</span> {p.school_name}</p>
                )}
                {showAffiliation && p.affiliation_name && (
                  <p className="text-xs mb-0.5"><span className="text-ink-muted">สังกัด:</span> {p.affiliation_name}</p>
                )}
                <p className="text-xs mb-0.5">
                  <span className="text-ink-muted">จำนวนนักเรียน:</span> {Number(p.student_count_in_scope || 0)} คน
                </p>
                <p className="text-xs mb-2">
                  <span className="text-ink-muted">ระดับชั้น:</span> {formatGradeSummary(p.grade_summary)}
                </p>
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
        <FitBounds points={points} selectedKey={selectedKey} />
      </MapContainer>
    </div>
  );
}

/* ── FitBounds: pan/zoom to fit markers, or fly-to on selection ─────────── */
function FitBounds({ points, selectedKey }) {
  const map = useMap();
  useEffect(() => {
    if (selectedKey) {
      const sel = points.find(p => rowKey(p) === selectedKey);
      if (sel && hasCoords(sel)) {
        map.flyTo([sel.latitude, sel.longitude], Math.max(map.getZoom(), 15), { duration: 0.5 });
        return;
      }
    }
    if (points.length > 0) {
      const bounds = L.latLngBounds(points.map(p => [p.latitude, p.longitude]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
  }, [points, selectedKey, map]);
  return null;
}

// Expose the helpers so page wrappers can reuse them for KPI hints.
export { formatSession, formatGradeSummary, hasCoords, rowKey };
