import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Map as MapIcon, Bus, Activity, Pause, WifiOff, AlertTriangle,
  Users, MapPin,
} from 'lucide-react';
import api from '../../api/axios';
import { AppCard, AlertBanner, StatusBadge, DashboardSection } from '../../components/ui';
import LiveVehicleMap from '../../components/LiveVehicleMap';

const POLL_INTERVAL_MS = 15_000;

const STATUS_META = {
  ONLINE:  { label: 'ออนไลน์',     variant: 'success' },
  STALE:   { label: 'สัญญาณเก่า',  variant: 'warn'    },
  OFFLINE: { label: 'ออฟไลน์',     variant: 'neutral' },
  PAUSED:  { label: 'หยุดส่ง',     variant: 'neutral' },
};

function formatRelative(secs) {
  if (secs == null) return 'ยังไม่มีข้อมูล';
  if (secs < 60)   return `เมื่อ ${secs} วินาทีที่แล้ว`;
  if (secs < 3600) return `เมื่อ ${Math.floor(secs / 60)} นาทีที่แล้ว`;
  const hrs = Math.floor(secs / 3600);
  return `เมื่อ ${hrs} ชั่วโมงที่แล้ว`;
}

function hasCoords(v) {
  return Number.isFinite(Number(v.latitude)) && Number.isFinite(Number(v.longitude));
}

export default function ProvinceLiveVehicles() {
  const [vehicles, setVehicles]       = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [selectedId, setSelectedId]   = useState(null);

  const fetchOnce = useCallback(async () => {
    try {
      const res = await api.get('/province/live-vehicles');
      const list = res.data?.data?.vehicles;
      setVehicles(Array.isArray(list) ? list : []);
      setGeneratedAt(res.data?.data?.generated_at || null);
      setError(null);
    } catch (err) {
      setError(err?.response?.data?.message || 'โหลดข้อมูลตำแหน่งรถระดับจังหวัดไม่สำเร็จ');
    }
  }, []);

  // First fetch + 15s polling with cancellation flag.
  // Backend writes audit_logs.action='VIEW' on the first hit per 5-min
  // window (verified live in Phase 7.5 hot-path smoke).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchOnce().finally(() => { if (!cancelled) setLoading(false); });

    const id = setInterval(() => {
      if (!cancelled) fetchOnce();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [fetchOnce]);

  const counts = useMemo(() => {
    let online = 0, stale = 0, offline = 0, paused = 0,
        students = 0, withCoords = 0, neverSent = 0;
    for (const v of vehicles) {
      switch (v.status) {
        case 'ONLINE':  online++;  break;
        case 'STALE':   stale++;   break;
        case 'PAUSED':  paused++;  break;
        case 'OFFLINE':
        default:        offline++; break;
      }
      students += Number(v.student_count_in_scope || 0);
      if (hasCoords(v)) withCoords++;
      if (!v.received_at) neverSent++;
    }
    return { online, stale, paused, offline, students, withCoords, neverSent };
  }, [vehicles]);

  const hasAnyCoords = useMemo(() => vehicles.some(hasCoords), [vehicles]);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl sm:text-3xl font-semibold text-ink leading-tight flex items-center gap-2">
          <MapIcon className="w-6 h-6 text-brand" strokeWidth={2} />
          ตำแหน่งปัจจุบัน
        </h1>
        <p className="text-sm text-ink-muted mt-1">
          แสดงตำแหน่งล่าสุดของรถรับส่งนักเรียนในภาพรวมระดับจังหวัด · อัปเดตทุก 15 วินาที
          {generatedAt && (
            <span className="ml-1 text-ink-muted">
              · ข้อมูล {new Date(generatedAt).toLocaleTimeString('th-TH', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Bangkok',
              })} น.
            </span>
          )}
        </p>
      </header>

      {/* Province aggregate banner — at-a-glance breakdown for executive view */}
      {!loading && vehicles.length > 0 && (
        <AppCard padding="sm" className="bg-surface-alt">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm tabular-nums">
            <span className="font-semibold text-ink">รวมระดับจังหวัด</span>
            <span className="text-success">● ออนไลน์ {counts.online}</span>
            <span className="text-warn">● สัญญาณเก่า {counts.stale}</span>
            <span className="text-ink-muted">● หยุดส่ง {counts.paused}</span>
            <span className="text-ink-muted">● ออฟไลน์ {counts.offline}</span>
          </div>
        </AppCard>
      )}

      {/* KPI strip — province has a denser readout than school/affiliation */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={Bus}            label="รถทั้งหมด"               value={vehicles.length}    variant="neutral" />
        <KpiCard icon={Users}          label="นักเรียนที่เกี่ยวข้อง"     value={counts.students}    variant="brand"   />
        <KpiCard icon={Activity}       label="ออนไลน์"                  value={counts.online}      variant="success" />
        <KpiCard icon={AlertTriangle}  label="สัญญาณเก่า"               value={counts.stale}       variant="warn"    />
        <KpiCard icon={Pause}          label="หยุดส่ง"                  value={counts.paused}      variant="neutral" />
        <KpiCard icon={WifiOff}        label="ออฟไลน์ / ยังไม่มีข้อมูล"   value={counts.offline}     variant="neutral" />
      </div>

      {/* Optional secondary metrics — broadcast coverage */}
      {!loading && vehicles.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard icon={MapPin}     label="กำลังมีพิกัดจริง"     value={counts.withCoords} variant="success" />
          <KpiCard icon={WifiOff}    label="ยังไม่เคยส่งตำแหน่ง"  value={counts.neverSent}  variant="neutral" />
        </div>
      )}

      {error && (
        <AlertBanner variant="danger" title="โหลดข้อมูลตำแหน่งรถระดับจังหวัดไม่สำเร็จ">
          {error}
        </AlertBanner>
      )}

      {loading ? (
        <p className="text-ink-muted py-10 text-center">กำลังโหลด…</p>
      ) : vehicles.length === 0 ? (
        <AlertBanner variant="info" title="ยังไม่มีรถรับส่งในระบบจังหวัด">
          เมื่อมีนักเรียนถูกผูกกับรถรับส่ง รถคันนั้นจะปรากฏที่นี่
        </AlertBanner>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
          {/* Left: full-province vehicle list */}
          <DashboardSection title="รายการรถ" description={`${vehicles.length} คัน`}>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {vehicles.map(v => (
                <VehicleRow
                  key={v.vehicle_id}
                  vehicle={v}
                  selected={selectedId === v.vehicle_id}
                  onClick={() => setSelectedId(v.vehicle_id)}
                />
              ))}
            </div>
          </DashboardSection>

          {/* Right: map */}
          <DashboardSection title="แผนที่">
            {!hasAnyCoords ? (
              <AlertBanner variant="info" title="ยังไม่มีรถที่กำลังส่งตำแหน่ง">
                เมื่อคนขับเปิด "เริ่มส่งตำแหน่ง" จากหน้า Dashboard ของตน รถจะปรากฏบนแผนที่ทันที
              </AlertBanner>
            ) : (
              <div className="h-[60vh] min-h-[400px] rounded-xl overflow-hidden border border-surface-border">
                <LiveVehicleMap
                  vehicles={vehicles}
                  selectedVehicleId={selectedId}
                  onMarkerClick={(v) => setSelectedId(v.vehicle_id)}
                />
              </div>
            )}
          </DashboardSection>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function KpiCard({ icon: Icon, label, value, variant }) {
  const tone = variant === 'success' ? 'text-success'
             : variant === 'warn'    ? 'text-warn'
             : variant === 'brand'   ? 'text-brand'
             : 'text-ink-muted';
  return (
    <AppCard padding="sm">
      <div className="flex items-center gap-3">
        <div className={`shrink-0 ${tone}`}>
          <Icon className="w-5 h-5" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-ink-muted leading-tight truncate">{label}</p>
          <p className="text-xl font-semibold text-ink tabular-nums">{value}</p>
        </div>
      </div>
    </AppCard>
  );
}

function VehicleRow({ vehicle, selected, onClick }) {
  const meta = STATUS_META[vehicle.status] || STATUS_META.OFFLINE;
  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
  };
  const studentCount = Number(vehicle.student_count_in_scope || 0);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKey}
      className={`block w-full text-left transition rounded-xl cursor-pointer ${
        selected ? 'ring-2 ring-brand' : 'hover:shadow-md'
      }`}
    >
      <AppCard padding="sm">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="font-semibold text-ink truncate">
            {vehicle.plate_no || vehicle.vehicle_id}
          </p>
          <div className="flex items-center gap-1 shrink-0">
            <StatusBadge variant={meta.variant} size="sm">{meta.label}</StatusBadge>
            {vehicle.low_accuracy && (
              <StatusBadge variant="info" size="sm">ความแม่นยำต่ำ</StatusBadge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-muted mb-1 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Bus className="w-3.5 h-3.5" strokeWidth={2} />
            {vehicle.vehicle_type || '-'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="w-3.5 h-3.5" strokeWidth={2} />
            <span className="tabular-nums">{studentCount}</span> คน
          </span>
          {vehicle.driver_name && (
            <span className="truncate">คนขับ: {vehicle.driver_name}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-muted tabular-nums">
          <span>{formatRelative(vehicle.seconds_since_seen)}</span>
          {vehicle.accuracy_meters != null && (
            <span>±{vehicle.accuracy_meters} ม.</span>
          )}
        </div>
        {!hasCoords(vehicle) && (
          <p className="text-xs text-ink-muted mt-1 italic">
            ยังไม่เคยส่งตำแหน่ง
          </p>
        )}
      </AppCard>
    </div>
  );
}
