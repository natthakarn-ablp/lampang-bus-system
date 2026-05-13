import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Map as MapIcon, Bus, Activity, Pause, WifiOff, AlertTriangle,
  Users, MapPin,
} from 'lucide-react';
import api from '../../api/axios';
import { AppCard, AlertBanner, StatusBadge, DashboardSection, LiveKpiCard } from '../../components/ui';
import LiveVehicleMap from '../../components/LiveVehicleMap';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import {
  getStatusMeta,
  getStatusHelpText,
  formatRelativeTime,
  formatThaiTime,
  hasVehicleCoords,
  isViewerDataStale,
} from '../../utils/liveVehicleStatus';

const POLL_INTERVAL_MS = 15_000;
const STALE_THRESHOLD_MS = 45_000;

export default function ProvinceLiveVehicles() {
  const [vehicles, setVehicles]       = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [firstLoadError, setFirstLoadError] = useState(null);
  const [pollWarn, setPollWarn]       = useState(null);
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );
  const [selectedId, setSelectedId]   = useState(null);
  const [lastFetchAt, setLastFetchAt] = useState(null);
  const hasDataRef = useRef(false);

  const fetchOnce = useCallback(async () => {
    try {
      const res = await api.get('/province/live-vehicles');
      const list = res.data?.data?.vehicles;
      setVehicles(Array.isArray(list) ? list : []);
      setGeneratedAt(res.data?.data?.generated_at || null);
      setLastFetchAt(Date.now());
      hasDataRef.current = true;
      setPollWarn(null);
      setFirstLoadError(null);
    } catch (err) {
      const msg = err?.response?.data?.message || 'โหลดข้อมูลตำแหน่งรถระดับจังหวัดไม่สำเร็จ';
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
      if (hasVehicleCoords(v)) withCoords++;
      if (!v.received_at)      neverSent++;
    }
    return { online, stale, paused, offline, students, withCoords, neverSent };
  }, [vehicles]);

  const hasAnyCoords = useMemo(() => vehicles.some(hasVehicleCoords), [vehicles]);
  const dataStale = isViewerDataStale(lastFetchAt, STALE_THRESHOLD_MS);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl sm:text-3xl font-semibold text-ink leading-tight flex items-center gap-2">
          <MapIcon className="w-6 h-6 text-brand" strokeWidth={2} />
          ตำแหน่งปัจจุบัน
        </h1>
        <p className="text-sm text-ink-muted mt-1">
          แสดงตำแหน่งล่าสุดของรถรับส่งในภาพรวมระดับจังหวัด · อัปเดตทุก 15 วินาที
          {generatedAt && (
            <span className="ml-1 text-ink-muted">
              · ข้อมูล {formatThaiTime(generatedAt)} น.
            </span>
          )}
        </p>
      </header>

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

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <LiveKpiCard icon={Bus}            label="รถทั้งหมด"               value={vehicles.length}    variant="neutral" />
        <LiveKpiCard icon={Users}          label="นักเรียนที่เกี่ยวข้อง"     value={counts.students}    variant="brand"   />
        <LiveKpiCard icon={Activity}       label="ออนไลน์"                  value={counts.online}      variant="success" />
        <LiveKpiCard icon={AlertTriangle}  label="สัญญาณเก่า"               value={counts.stale}       variant="warn"    />
        <LiveKpiCard icon={Pause}          label="หยุดส่ง"                  value={counts.paused}      variant="neutral" />
        <LiveKpiCard icon={WifiOff}        label="ออฟไลน์ / ยังไม่มีข้อมูล"   value={counts.offline}     variant="neutral" />
      </div>

      {!loading && vehicles.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <LiveKpiCard icon={MapPin}     label="กำลังมีพิกัดจริง"     value={counts.withCoords} variant="success" />
          <LiveKpiCard icon={WifiOff}    label="ยังไม่เคยส่งตำแหน่ง"  value={counts.neverSent}  variant="neutral" />
        </div>
      )}

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
          title="โหลดข้อมูลตำแหน่งรถระดับจังหวัดไม่สำเร็จ"
          message={firstLoadError}
        />
      )}

      {loading && !hasDataRef.current ? (
        <LoadingState />
      ) : vehicles.length === 0 ? (
        <AlertBanner variant="info" title="ยังไม่มีรถรับส่งในขอบเขตนี้">
          เมื่อมีนักเรียนถูกผูกกับรถรับส่ง รถคันนั้นจะปรากฏที่นี่
        </AlertBanner>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
          <DashboardSection title="รายการรถ" description={`${vehicles.length} คัน`}>
            <div className="space-y-2 max-h-[50vh] lg:max-h-[60vh] overflow-y-auto pr-1">
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

          <DashboardSection title="แผนที่">
            {!hasAnyCoords ? (
              <AlertBanner variant="info" title="ยังไม่มีรถที่กำลังส่งตำแหน่ง">
                เมื่อคนขับเปิด "เริ่มส่งตำแหน่ง" จากหน้า Dashboard ของตน รถจะปรากฏบนแผนที่ทันที
              </AlertBanner>
            ) : (
              <div className="h-[55vh] min-h-[340px] lg:h-[60vh] lg:min-h-[400px] rounded-xl overflow-hidden border border-surface-border">
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
          <span>{formatRelativeTime(vehicle.seconds_since_seen)}</span>
          {vehicle.accuracy_meters != null && (
            <span>±{vehicle.accuracy_meters} ม.</span>
          )}
        </div>
        {help && (
          <p className="text-xs text-ink-muted mt-1 italic">{help}</p>
        )}
      </AppCard>
    </div>
  );
}
