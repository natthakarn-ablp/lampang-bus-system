import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { Pencil, Trash2, Users } from 'lucide-react';
import { coordReasonLabel, isPlottable, coordProblem } from '../utils/pickupPointChecks';
import './PickupMap.css';

const LAMPANG_CENTER = [18.2884, 99.4906];

// Hex mirrors of the Tailwind tokens (canvas markers cannot read classes).
const COLOR = {
  ok: '#1D4ED8',      // brand
  warn: '#D97706',    // warn (darkened for contrast on map tiles)
  danger: '#DC2626',  // danger
  ring: '#111827',
};

function markerTone(check) {
  if (!check) return 'ok';
  if (check.coords) return 'danger';
  if (check.empty || check.dup.length) return 'warn';
  return 'ok';
}

/**
 * AdminPickupPointMap — admin map for the pickup-point check page.
 *
 * Markers are canvas CircleMarkers (one <canvas>, not one DOM node per point),
 * which keeps a few thousand points responsive without a clustering plugin.
 * Colour = check result: blue normal, amber no-students / near-duplicate, red
 * bad coordinates (outside Lampang — missing/zero points cannot be drawn and
 * are listed by the page instead).
 *
 * The popup carries the same edit / students / delete actions as the table
 * row; the page owns those handlers.
 */
export default function AdminPickupPointMap({
  points = [],
  checks,
  selectedId = null,
  onSelect,
  onEdit,
  onDelete,
  onStudents,
  sessionLabels = {},
}) {
  const plottable = useMemo(() => points.filter(isPlottable), [points]);

  return (
    <div className="pickup-page-map relative z-0 isolate h-full w-full">
      <MapContainer
        center={LAMPANG_CENTER}
        zoom={11}
        scrollWheelZoom
        preferCanvas
        className="!relative !z-0 h-full w-full"
        style={{ height: '100%', width: '100%', zIndex: 0 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Markers
          points={plottable}
          checks={checks}
          selectedId={selectedId}
          onSelect={onSelect}
          onEdit={onEdit}
          onDelete={onDelete}
          onStudents={onStudents}
          sessionLabels={sessionLabels}
        />
      </MapContainer>
    </div>
  );
}

function Markers({ points, checks, selectedId, onSelect, onEdit, onDelete, onStudents, sessionLabels }) {
  const map = useMap();
  const layers = useRef(new Map());

  // Fit to the points that are inside Lampang, so one typo'd point in another
  // province does not zoom the whole view out to the country.
  const fitKey = points.map(p => p.id).join(',');
  useEffect(() => {
    const inside = points.filter(p => coordProblem(p) === null);
    const use = inside.length ? inside : points;
    if (use.length === 0) {
      map.setView(LAMPANG_CENTER, 10);
      return;
    }
    map.fitBounds(L.latLngBounds(use.map(p => [p.latitude, p.longitude])), { padding: [32, 32], maxZoom: 18 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);

  // Focus: fly to the selected point and open its popup.
  useEffect(() => {
    if (selectedId == null) return;
    const p = points.find(x => x.id === selectedId);
    if (!p) return;
    map.flyTo([p.latitude, p.longitude], Math.max(map.getZoom(), 16), { duration: 0.5 });
    const layer = layers.current.get(selectedId);
    if (layer) {
      layer.bringToFront();
      const t = setTimeout(() => layer.openPopup(), 550);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, map]);

  return points.map(p => {
    const check = checks?.get(p.id);
    const tone = markerTone(check);
    const selected = p.id === selectedId;
    return (
      <CircleMarker
        key={p.id}
        center={[p.latitude, p.longitude]}
        radius={selected ? 11 : 7}
        pathOptions={{
          color: selected ? COLOR.ring : '#ffffff',
          weight: selected ? 3 : 2,
          fillColor: COLOR[tone],
          fillOpacity: 0.9,
        }}
        ref={el => { if (el) layers.current.set(p.id, el); else layers.current.delete(p.id); }}
        eventHandlers={{ click: () => onSelect && onSelect(p.id) }}
      >
        <Popup>
          <PointPopup
            point={p}
            check={check}
            sessionLabels={sessionLabels}
            onEdit={onEdit}
            onDelete={onDelete}
            onStudents={onStudents}
          />
        </Popup>
      </CircleMarker>
    );
  });
}

function PointPopup({ point: p, check, sessionLabels, onEdit, onDelete, onStudents }) {
  const issues = [];
  if (check?.coords) issues.push(coordReasonLabel(check.coords));
  if (check?.empty) issues.push('ไม่มีนักเรียน');
  if (check?.dup.length) issues.push(`ใกล้จุดอื่นของรถคันเดียวกัน ${check.dup.length} จุด`);
  const schools = Array.isArray(p.school_names) ? p.school_names : [];

  return (
    <div className="min-w-[210px] max-w-[260px] text-ink">
      <p className="font-semibold mb-1 break-words">{p.label || `จุดที่ ${p.id}`}</p>
      <dl className="text-xs space-y-0.5 mb-2">
        <Row k="ทะเบียนรถ" v={p.plate_no || p.vehicle_id || 'ไม่ระบุ'} />
        <Row k="โรงเรียน" v={schools.length ? schools.join(', ') : 'ไม่ระบุ'} />
        <Row k="รอบ" v={sessionLabels[p.session] || p.session || 'ไม่ระบุ'} />
        <Row k="นักเรียน" v={`${Number(p.student_count || 0)} คน`} />
        <Row k="พิกัด" v={`${Number(p.latitude).toFixed(5)}, ${Number(p.longitude).toFixed(5)}`} />
      </dl>
      {issues.length > 0 && (
        <ul className="text-xs text-danger-ink bg-danger-soft rounded px-2 py-1 mb-2 list-disc list-inside">
          {issues.map(t => <li key={t}>{t}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        <PopupButton onClick={() => onStudents && onStudents(p)} label={`จัดการนักเรียนของจุด ${p.label}`}>
          <Users className="w-3.5 h-3.5" aria-hidden="true" /> นักเรียน
        </PopupButton>
        <PopupButton tone="brand" onClick={() => onEdit && onEdit(p)} label={`แก้ไขจุด ${p.label}`}>
          <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> แก้ไข
        </PopupButton>
        <PopupButton tone="danger" onClick={() => onDelete && onDelete(p)} label={`ลบจุด ${p.label}`}>
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> ลบ
        </PopupButton>
      </div>
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`}
        target="_blank"
        rel="noopener noreferrer"
        className="focus-ring inline-flex items-center min-h-[44px] mt-1 text-xs text-brand-700 font-medium hover:underline"
      >
        เปิดใน Google Maps
      </a>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex gap-1">
      <dt className="text-ink-muted shrink-0">{k}:</dt>
      <dd className="min-w-0 break-words">{v}</dd>
    </div>
  );
}

const TONE = {
  neutral: 'border-surface-border text-ink hover:bg-surface',
  brand: 'border-brand/40 text-brand-700 hover:bg-brand-50',
  danger: 'border-danger/40 text-danger-ink hover:bg-danger-soft',
};

function PopupButton({ tone = 'neutral', onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`focus-ring inline-flex items-center gap-1 rounded-md border bg-white px-2.5 min-h-[44px] text-xs font-medium transition ${TONE[tone]}`}
    >
      {children}
    </button>
  );
}

