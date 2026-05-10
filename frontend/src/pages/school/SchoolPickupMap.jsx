import { useEffect, useMemo, useState, useCallback } from 'react';
import { Map as MapIcon, Bus, Users, Sunrise, Sunset } from 'lucide-react';
import api from '../../api/axios';
import { AppCard, AlertBanner, StatusBadge, DashboardSection } from '../../components/ui';
import PickupMap from '../../components/PickupMap';

const SESSION_LABEL = { morning: 'รอบเช้า', evening: 'รอบเย็น', both: 'ทั้งวัน' };

export default function SchoolPickupMap() {
  const [points, setPoints] = useState([]);
  const [sessionFilter, setSessionFilter] = useState('all');
  const [vehicleFilter, setVehicleFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPoints = useCallback(async (sf) => {
    setLoading(true);
    setError(null);
    try {
      const qs = sf === 'all' ? '' : `?session=${sf}`;
      const res = await api.get(`/school/pickup-points${qs}`);
      const list = res.data?.data;
      setPoints(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err?.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPoints(sessionFilter); }, [fetchPoints, sessionFilter]);

  // Vehicle dropdown options derived from the loaded points (so the
  // filter only shows vehicles that actually serve this school).
  const vehicleOptions = useMemo(() => {
    const seen = new Map();
    points.forEach(p => {
      if (p.vehicle_id && !seen.has(p.vehicle_id)) {
        seen.set(p.vehicle_id, p.plate_no || p.vehicle_id);
      }
    });
    return Array.from(seen, ([id, plate]) => ({ id, plate }));
  }, [points]);

  const filteredPoints = useMemo(() => {
    if (vehicleFilter === 'all') return points;
    return points.filter(p => p.vehicle_id === vehicleFilter);
  }, [points, vehicleFilter]);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl sm:text-3xl font-semibold text-ink leading-tight flex items-center gap-2">
          <MapIcon className="w-6 h-6 text-brand" strokeWidth={2} />
          แผนที่จุดรับส่ง
        </h1>
        <p className="text-sm text-ink-muted mt-1">
          จุดรับส่งของนักเรียนในโรงเรียน · {filteredPoints.length} จุด
        </p>
      </header>

      {/* Filter strip */}
      <div className="flex flex-wrap items-center gap-3">
        <SessionFilter value={sessionFilter} onChange={setSessionFilter} />
        {vehicleOptions.length > 0 && (
          <select
            value={vehicleFilter}
            onChange={e => setVehicleFilter(e.target.value)}
            className="text-sm border border-surface-border rounded-lg px-3 py-1.5 bg-surface text-ink"
          >
            <option value="all">รถทุกคัน</option>
            {vehicleOptions.map(v => (
              <option key={v.id} value={v.id}>{v.plate}</option>
            ))}
          </select>
        )}
      </div>

      {error ? (
        <AlertBanner variant="danger" title="โหลดข้อมูลไม่สำเร็จ">{error}</AlertBanner>
      ) : loading ? (
        <p className="text-ink-muted py-10 text-center">กำลังโหลด…</p>
      ) : filteredPoints.length === 0 ? (
        <AlertBanner variant="info" title="ยังไม่มีจุดรับส่ง">
          ผู้ดูแลระบบจะเพิ่มจุดรับส่งของรถที่ให้บริการโรงเรียนนี้ในภายหลัง
        </AlertBanner>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
          {/* Left/top: list of points (click → highlight on map) */}
          <DashboardSection title="รายการจุดรับส่ง" description={`${filteredPoints.length} จุด`}>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {filteredPoints.map(p => (
                <PickupPointRow
                  key={p.id}
                  point={p}
                  selected={selectedId === p.id}
                  onClick={() => setSelectedId(p.id)}
                />
              ))}
            </div>
          </DashboardSection>

          {/* Right/bottom: the map */}
          <DashboardSection title="แผนที่">
            <div className="h-[60vh] min-h-[400px] rounded-xl overflow-hidden border border-surface-border">
              <PickupMap
                points={filteredPoints}
                selectedPointId={selectedId}
                onMarkerClick={(p) => setSelectedId(p.id)}
              />
            </div>
          </DashboardSection>
        </div>
      )}
    </div>
  );
}

/* ── Session filter pill row (shared shape with DriverPickupMap) ── */
function SessionFilter({ value, onChange }) {
  const options = [
    { key: 'all',     label: 'ทั้งหมด',  icon: null },
    { key: 'morning', label: 'รอบเช้า',  icon: Sunrise },
    { key: 'evening', label: 'รอบเย็น',  icon: Sunset  },
  ];
  return (
    <div className="flex gap-1.5">
      {options.map(opt => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition border ${
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

/* ── Pickup-point row (clickable; highlight = selected on map) ── */
function PickupPointRow({ point, selected, onClick }) {
  const studentCount = Array.isArray(point.students) ? point.students.length : 0;
  const previewNames = (point.students || []).slice(0, 3)
    .map(s => `${s.first_name} ${s.last_name}`).join(', ');

  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full text-left transition rounded-xl ${
        selected ? 'ring-2 ring-brand' : 'hover:shadow-md'
      }`}
    >
      <AppCard padding="sm">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="font-semibold text-ink truncate">{point.label}</p>
          <StatusBadge variant="neutral" size="sm">
            {SESSION_LABEL[point.session] || point.session || 'ทั้งวัน'}
          </StatusBadge>
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-muted mb-1">
          <span className="inline-flex items-center gap-1">
            <Bus className="w-3.5 h-3.5" strokeWidth={2} />
            {point.plate_no || '-'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="w-3.5 h-3.5" strokeWidth={2} />
            {studentCount} คน
          </span>
        </div>
        {previewNames && (
          <p className="text-xs text-ink-muted truncate">
            {previewNames}{studentCount > 3 && ` …`}
          </p>
        )}
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="text-xs text-brand font-medium mt-2 inline-block hover:underline"
        >
          เปิดใน Google Maps →
        </a>
      </AppCard>
    </button>
  );
}
