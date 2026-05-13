import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bus, Activity, Pause, WifiOff, AlertTriangle,
  Users, MapPin, Search, ShieldAlert,
} from 'lucide-react';
import api from '../../api/axios';
import { AppCard, AlertBanner, StatusBadge, DashboardSection } from '../../components/ui';
import LiveVehicleMap from '../../components/LiveVehicleMap';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import {
  getStatusMeta,
  getStatusHelpText,
  formatRelativeTime,
  formatAbsoluteThaiDateTime,
  formatThaiTime,
  hasVehicleCoords,
  isViewerDataStale,
} from '../../utils/liveVehicleStatus';

const POLL_INTERVAL_MS = 15_000;
const STALE_THRESHOLD_MS = 45_000;

// Sort priority: surface problematic vehicles first.
const SORT_PRIORITY = {
  OFFLINE: 0,
  PAUSED:  1,
  STALE:   2,
  ONLINE:  3,
};

const FILTERS = [
  { key: 'all',           label: 'ทั้งหมด' },
  { key: 'ONLINE',        label: 'ออนไลน์' },
  { key: 'STALE',         label: 'สัญญาณเก่า' },
  { key: 'PAUSED',        label: 'หยุดส่ง' },
  { key: 'OFFLINE',       label: 'ออฟไลน์' },
  { key: 'low_accuracy',  label: 'ความแม่นยำต่ำ' },
  { key: 'never_sent',    label: 'ยังไม่เคยส่งตำแหน่ง' },
];

export default function AdminLiveVehicles() {
  const [vehicles, setVehicles]       = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [firstLoadError, setFirstLoadError] = useState(null);
  const [pollWarn, setPollWarn]       = useState(null);
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );
  const [selectedId, setSelectedId]   = useState(null);
  const [search, setSearch]           = useState('');
  const [filter, setFilter]           = useState('all');
  const [lastFetchAt, setLastFetchAt] = useState(null);
  const hasDataRef = useRef(false);

  const fetchOnce = useCallback(async () => {
    try {
      const res = await api.get('/admin/live-vehicles');
      const list = res.data?.data?.vehicles;
      setVehicles(Array.isArray(list) ? list : []);
      setGeneratedAt(res.data?.data?.generated_at || null);
      setLastFetchAt(Date.now());
      hasDataRef.current = true;
      setPollWarn(null);
      setFirstLoadError(null);
    } catch (err) {
      const msg = err?.response?.data?.message
        || 'โหลดข้อมูลตำแหน่งรถสำหรับผู้ดูแลระบบไม่สำเร็จ';
      if (hasDataRef.current) {
        setPollWarn('โหลดข้อมูลรอบล่าสุดไม่สำเร็จ กำลังใช้ข้อมูลครั้งล่าสุดที่โหลดได้');
      } else {
        setFirstLoadError(msg);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchOnce().finally(() => { if (!cancelled) setLoading(false); });

    const id = setInterval(() => {
      if (!cancelled) fetchOnce();
    }, POLL_INTERVAL_MS);

    const onOnline  = () => setBrowserOnline(true);
    const onOffline = () => setBrowserOnline(false);
    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);

    const tick = setInterval(() => setLastFetchAt(prev => prev), 5_000);

    return () => {
      cancelled = true;
      clearInterval(id);
      clearInterval(tick);
      window.removeEventListener('online',  onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [fetchOnce]);

  // Aggregate counts (full set, not filtered — KPIs show system-wide health)
  const counts = useMemo(() => {
    let online = 0, stale = 0, offline = 0, paused = 0,
        students = 0, withCoords = 0, neverSent = 0,
        lowAcc = 0, staleOver5 = 0;
    for (const v of vehicles) {
      switch (v.status) {
        case 'ONLINE':  online++;  break;
        case 'STALE':   stale++;   break;
        case 'PAUSED':  paused++;  break;
        case 'OFFLINE':
        default:        offline++; break;
      }
      students += Number(v.student_count_in_scope || 0);
      if (hasVehicleCoords(v))  withCoords++;
      if (!v.received_at)       neverSent++;
      if (v.low_accuracy)       lowAcc++;
      if (v.seconds_since_seen != null && v.seconds_since_seen > 300) staleOver5++;
    }
    return { online, stale, paused, offline, students, withCoords, neverSent, lowAcc, staleOver5 };
  }, [vehicles]);

  // Filtered + sorted list (search + status filter, then problematic-first sort)
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = vehicles.filter(v => {
      if (q) {
        const hay = `${v.plate_no || ''} ${v.vehicle_id || ''} ${v.driver_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      switch (filter) {
        case 'all':           return true;
        case 'ONLINE':
        case 'STALE':
        case 'OFFLINE':
        case 'PAUSED':        return v.status === filter;
        case 'low_accuracy':  return !!v.low_accuracy;
        case 'never_sent':    return !v.received_at;
        default:              return true;
      }
    });
    out = [...out].sort((a, b) => {
      const pa = SORT_PRIORITY[a.status] ?? 99;
      const pb = SORT_PRIORITY[b.status] ?? 99;
      if (pa !== pb) return pa - pb;
      const ar = a.received_at ? 1 : 0;
      const br = b.received_at ? 1 : 0;
      if (ar !== br) return ar - br;
      const aSec = a.seconds_since_seen ?? -1;
      const bSec = b.seconds_since_seen ?? -1;
      return bSec - aSec;
    });
    return out;
  }, [vehicles, search, filter]);

  const hasAnyCoords = useMemo(() => visible.some(hasVehicleCoords), [visible]);
  const dataStale = isViewerDataStale(lastFetchAt, STALE_THRESHOLD_MS);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl sm:text-3xl font-semibold text-ink leading-tight flex items-center gap-2">
          <ShieldAlert className="w-6 h-6 text-brand" strokeWidth={2} />
          ตรวจสอบตำแหน่งรถ
        </h1>
        <p className="text-sm text-ink-muted mt-1">
          หน้าสำหรับผู้ดูแลระบบใช้ตรวจสอบสถานะการส่งตำแหน่งของรถรับส่งทั้งหมด · อัปเดตทุก 15 วินาที
          {generatedAt && (
            <span className="ml-1 text-ink-muted">
              · ข้อมูล {formatThaiTime(generatedAt)} น.
            </span>
          )}
        </p>
      </header>

      <AlertBanner variant="info" title="หน้าสำหรับสนับสนุน/ตรวจสอบเท่านั้น">
        ใช้ดูสถานะการส่งตำแหน่งของรถ ไม่ใช่หน้าหลักสำหรับงานประจำวัน หน้านี้ไม่มีปุ่มแก้ไข
        และทุกการเปิดดูจะถูกบันทึกใน audit log อัตโนมัติ
      </AlertBanner>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <KpiCard icon={Bus}            label="รถทั้งหมด"               value={vehicles.length} variant="neutral" />
        <KpiCard icon={Users}          label="นักเรียนที่เกี่ยวข้อง"     value={counts.students} variant="brand"   />
        <KpiCard icon={Activity}       label="ออนไลน์"                  value={counts.online}   variant="success" />
        <KpiCard icon={AlertTriangle}  label="สัญญาณเก่า"               value={counts.stale}    variant="warn"    />
        <KpiCard icon={Pause}          label="หยุดส่ง"                  value={counts.paused}   variant="neutral" />
        <KpiCard icon={WifiOff}        label="ออฟไลน์ / ยังไม่มีข้อมูล"   value={counts.offline}  variant="neutral" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard icon={MapPin}        label="กำลังมีพิกัดจริง"        value={counts.withCoords}  variant="success" />
        <KpiCard icon={WifiOff}       label="ยังไม่เคยส่งตำแหน่ง"     value={counts.neverSent}   variant="neutral" />
        <KpiCard icon={AlertTriangle} label="ความแม่นยำต่ำ"           value={counts.lowAcc}      variant="warn"    />
        <KpiCard icon={Pause}         label="ไม่อัปเดตเกิน 5 นาที"     value={counts.staleOver5}  variant="warn"    />
      </div>

      {!browserOnline && (
        <AlertBanner variant="warn" title="อุปกรณ์ออฟไลน์">
          ไม่สามารถอัปเดตตำแหน่งรถได้จนกว่าจะกลับมาออนไลน์
        </AlertBanner>
      )}
      {browserOnline && dataStale && hasDataRef.current && (
        <AlertBanner variant="warn" title="ข้อมูลอาจไม่เป็นปัจจุบัน">
          ไม่ได้รับข้อมูลใหม่เกิน 45 วินาที อาจเกิดจากอินเทอร์เน็ตไม่เสถียรหรือแท็บเบราว์เซอร์พักการทำงาน
        </AlertBanner>
      )}
      {pollWarn && hasDataRef.current && (
        <AlertBanner variant="warn" title="โหลดรอบล่าสุดไม่สำเร็จ">{pollWarn}</AlertBanner>
      )}
      {firstLoadError && !hasDataRef.current && (
        <ErrorState
          title="โหลดข้อมูลตำแหน่งรถสำหรับผู้ดูแลระบบไม่สำเร็จ"
          message={firstLoadError}
        />
      )}

      {loading && !hasDataRef.current ? (
        <LoadingState />
      ) : vehicles.length === 0 ? (
        <AlertBanner variant="info" title="ยังไม่มีรถรับส่งในขอบเขตนี้">
          เมื่อมีรถรับส่งถูกบันทึกในระบบ รถคันนั้นจะปรากฏที่นี่
        </AlertBanner>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" strokeWidth={2} />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="ค้นหา ทะเบียน / vehicle_id / ชื่อคนขับ…"
                className="w-full text-sm border border-surface-border rounded-lg pl-9 pr-3 py-2 bg-surface text-ink"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {FILTERS.map(opt => {
                const active = filter === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setFilter(opt.key)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition border ${
                      active
                        ? 'bg-brand text-white border-brand'
                        : 'bg-surface text-ink-muted border-surface-border hover:bg-surface-border'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {visible.length === 0 ? (
            <AlertBanner variant="info" title="ไม่พบรถตามเงื่อนไขที่เลือก">
              ลองเปลี่ยนตัวกรองหรือล้างคำค้นหา
            </AlertBanner>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
              <DashboardSection
                title="รายการรถ"
                description={`${visible.length} / ${vehicles.length} คัน`}
              >
                <div className="space-y-2 max-h-[50vh] lg:max-h-[60vh] overflow-y-auto pr-1">
                  {visible.map(v => (
                    <VehicleRow
                      key={v.vehicle_id}
                      vehicle={v}
                      selected={selectedId === v.vehicle_id}
                      onClick={() => setSelectedId(v.vehicle_id)}
                    />
                  ))}
                </div>
              </DashboardSection>

              <DashboardSection title="แผนที่">
                {!hasAnyCoords ? (
                  <AlertBanner variant="info" title="ยังไม่มีรถที่กำลังส่งตำแหน่ง">
                    รถที่ผ่านตัวกรองไม่มีพิกัดจริงแสดงบนแผนที่
                  </AlertBanner>
                ) : (
                  <div className="h-[55vh] min-h-[340px] lg:h-[60vh] lg:min-h-[400px] rounded-xl overflow-hidden border border-surface-border">
                    <LiveVehicleMap
                      vehicles={visible}
                      selectedVehicleId={selectedId}
                      onMarkerClick={(v) => setSelectedId(v.vehicle_id)}
                    />
                  </div>
                )}
              </DashboardSection>
            </div>
          )}
        </>
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
  const meta = getStatusMeta(vehicle.status);
  const help = getStatusHelpText(vehicle);
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
          <div className="min-w-0">
            <p className="font-semibold text-ink truncate">
              {vehicle.plate_no || vehicle.vehicle_id}
            </p>
            <p className="text-[11px] text-ink-muted font-mono truncate">
              {vehicle.vehicle_id}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end max-w-[55%]">
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

        {/* Last-seen — admin gets BOTH absolute (for support) + relative */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-muted tabular-nums">
          <span>{formatRelativeTime(vehicle.seconds_since_seen)}</span>
          <span className="text-ink-muted/70">·</span>
          <span className="font-mono">{formatAbsoluteThaiDateTime(vehicle.received_at)}</span>
          {vehicle.accuracy_meters != null && (
            <>
              <span className="text-ink-muted/70">·</span>
              <span>±{vehicle.accuracy_meters} ม.</span>
            </>
          )}
        </div>

        {help && (
          <p className="text-xs text-ink-muted mt-1 italic">{help}</p>
        )}
      </AppCard>
    </div>
  );
}
