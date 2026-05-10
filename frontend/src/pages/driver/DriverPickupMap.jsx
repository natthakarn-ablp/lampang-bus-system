import { useEffect, useState, useCallback } from 'react';
import { Map as MapIcon, Sunrise, Sunset, X } from 'lucide-react';
import api from '../../api/axios';
import { AppCard, AlertBanner, StatusBadge } from '../../components/ui';
import PickupMap from '../../components/PickupMap';

const SESSION_LABEL = { morning: 'รอบเช้า', evening: 'รอบเย็น', both: 'ทั้งวัน' };

export default function DriverPickupMap() {
  const [points, setPoints] = useState([]);
  const [vehicle, setVehicle] = useState(null);
  const [sessionFilter, setSessionFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPoints = useCallback(async (filter) => {
    setLoading(true);
    setError(null);
    try {
      const qs = filter === 'all' ? '' : `?session=${filter}`;
      const res = await api.get(`/driver/pickup-points${qs}`);
      const payload = res.data?.data || {};
      setVehicle(payload.vehicle || null);
      setPoints(Array.isArray(payload.points) ? payload.points : []);
    } catch (err) {
      setError(err?.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPoints(sessionFilter); }, [fetchPoints, sessionFilter]);

  const selected = points.find(p => p.id === selectedId) || null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header strip — title + vehicle + session filter */}
      <header className="shrink-0 px-4 py-3 border-b border-surface-border bg-surface">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-ink leading-tight flex items-center gap-2">
              <MapIcon className="w-5 h-5 text-brand" strokeWidth={2} />
              แผนที่จุดรับส่ง
            </h1>
            {vehicle && (
              <p className="text-xs text-ink-muted truncate">
                {vehicle.plate_no} · {points.length} จุด
              </p>
            )}
          </div>
        </div>
        <SessionFilter value={sessionFilter} onChange={setSessionFilter} />
      </header>

      {/* Map fills remaining space */}
      <div className="flex-1 relative">
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <AlertBanner variant="danger" title="โหลดข้อมูลไม่สำเร็จ" className="max-w-sm">
              {error}
            </AlertBanner>
          </div>
        ) : loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-ink-muted">
            กำลังโหลด…
          </div>
        ) : (
          <>
            <PickupMap
              points={points}
              selectedPointId={selectedId}
              onMarkerClick={(p) => setSelectedId(p.id)}
              className="h-full w-full"
            />

            {/* Empty-state overlay — non-blocking; user can still pan around */}
            {points.length === 0 && (
              <div className="absolute top-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm pointer-events-none">
                <AppCard padding="md" className="pointer-events-auto">
                  <p className="text-sm font-semibold text-ink mb-1">ยังไม่มีจุดรับส่ง</p>
                  <p className="text-xs text-ink-muted">
                    ผู้ดูแลระบบจะเพิ่มจุดรับส่งให้รถคันนี้ในภายหลัง
                  </p>
                </AppCard>
              </div>
            )}

            {/* Selected-point card — overlays bottom of map on mobile,
                bottom-right on desktop */}
            {selected && (
              <div className="absolute bottom-3 left-3 right-3 sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-sm">
                <SelectedPointCard
                  point={selected}
                  onClose={() => setSelectedId(null)}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Session filter — three pill buttons ── */
function SessionFilter({ value, onChange }) {
  const options = [
    { key: 'all',     label: 'ทั้งหมด',  icon: null },
    { key: 'morning', label: 'รอบเช้า',  icon: Sunrise },
    { key: 'evening', label: 'รอบเย็น',  icon: Sunset  },
  ];
  return (
    <div className="flex gap-1.5 overflow-x-auto">
      {options.map(opt => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition border ${
              active
                ? 'bg-brand text-white border-brand'
                : 'bg-surface text-ink-muted border-surface-border hover:bg-surface-border'
            }`}
          >
            {opt.icon && <opt.icon className="w-3.5 h-3.5" strokeWidth={2} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Selected-point detail card ── */
function SelectedPointCard({ point, onClose }) {
  return (
    <AppCard padding="md" className="shadow-elevate">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink truncate">{point.label}</p>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge variant="neutral" size="sm">
              {SESSION_LABEL[point.session] || point.session || 'ทั้งวัน'}
            </StatusBadge>
            <span className="text-xs text-ink-muted">
              {(point.students?.length ?? 0)} คน
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 p-1 rounded-full hover:bg-surface-border transition"
          aria-label="ปิด"
        >
          <X className="w-4 h-4 text-ink-muted" strokeWidth={2} />
        </button>
      </div>

      {Array.isArray(point.students) && point.students.length > 0 && (
        <ul className="text-sm space-y-1 mb-3 max-h-40 overflow-y-auto">
          {point.students.map(s => (
            <li key={s.id} className="flex items-center gap-2 min-w-0">
              <span className="truncate text-ink">{s.first_name} {s.last_name}</span>
              {s.classroom && (
                <span className="text-xs text-ink-muted shrink-0">{s.classroom}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <a
        href={`https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full text-center text-sm font-medium text-white bg-brand hover:bg-brand-700 rounded-lg py-2 transition"
      >
        เปิดใน Google Maps →
      </a>
    </AppCard>
  );
}
