import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Route as RouteIcon, ArrowLeft, Play, Pause, Gauge, Clock, WifiOff, MapPin, CalendarDays,
} from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import { AppCard, AlertBanner, DashboardSection, FormField } from '../../components/ui';
import VehicleTrackMap, { TRACK_COLORS } from '../../components/VehicleTrackMap';

/**
 * ประวัติเส้นทางรถ — GPS route replay for one vehicle and one Bangkok day.
 *
 * One page for four roles; `role` picks the API prefix whose scope the
 * backend enforces (same scope as that role's ตำแหน่งปัจจุบัน page):
 *   school       /api/school/…        vehicles of the school (grade teacher: own grade)
 *   affiliation  /api/affiliation/…   vehicles of schools in the affiliation
 *   province     /api/province/…      every vehicle
 *   admin        /api/admin/…         every vehicle
 *
 * URL: ?vehicle=<id>&date=YYYY-MM-DD so a link from the live page opens
 * straight on a vehicle, and a reload keeps the selection.
 *
 * History is kept for the retention window (7 days by default) and GPS is
 * recorded only inside the tracking windows (05:00–09:00, 15:00–19:00), both
 * reported by the API and shown on the page. No student data is requested.
 */

const LIVE_PATH = {
  school: '/school/live-vehicles',
  affiliation: '/affiliation/live-vehicles',
  province: '/province/live-vehicles',
  admin: '/admin/live-vehicles',
};

// Pickup points of the vehicle from the endpoint each role already uses.
// Only id / label / sequence / coordinates are kept — never student names.
async function fetchPickupPoints(role, vehicleId) {
  const q = encodeURIComponent(vehicleId);
  let rows = [];
  if (role === 'admin') {
    const res = await api.get(`/admin/pickup-points?vehicle_id=${q}&per_page=100`);
    rows = Array.isArray(res.data?.data) ? res.data.data : [];
  } else if (role === 'province' || role === 'affiliation') {
    const res = await api.get(`/${role}/pickup-map?vehicle_id=${q}`);
    rows = (res.data?.data?.points || []).map((p) => ({ ...p, id: p.pickup_point_id }));
  } else if (role === 'school') {
    const res = await api.get('/school/pickup-points');
    rows = (Array.isArray(res.data?.data) ? res.data.data : []).filter((p) => p.vehicle_id === vehicleId);
  }
  const seen = new Set();
  const out = [];
  for (const p of rows) {
    const lat = Number(p.latitude);
    const lng = Number(p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ id: p.id, label: p.label || '', sequence: p.sequence ?? null, latitude: lat, longitude: lng });
  }
  return out;
}

const timeTh = (iso) => (iso
  ? new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
  : '–');
const timeThSec = (iso) => (iso
  ? new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Bangkok' })
  : '–');
const dayTh = (ymd, opts) => new Date(`${ymd}T12:00:00+07:00`)
  .toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', ...opts });
const minutesTh = (sec) => {
  const m = Math.round((sec || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`;
};
const kmTh = (km) => `${Number(km || 0).toLocaleString('th-TH', { maximumFractionDigits: 1 })} กม.`;

export default function VehicleTrackReplay({ role = 'province' }) {
  const [params, setParams] = useSearchParams();
  const vehicleId = params.get('vehicle') || '';
  const dateParam = params.get('date') || '';

  const [vehicles, setVehicles] = useState([]);
  const [vehiclesError, setVehiclesError] = useState(null);
  const [days, setDays] = useState(null);
  const [daysError, setDaysError] = useState(null);
  const [track, setTrack] = useState(null);
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackError, setTrackError] = useState(null);
  const [pickupPoints, setPickupPoints] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef(null);

  const setQuery = useCallback((patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  }, [params, setParams]);

  /* vehicles for the selector — same list (and scope) as the live page */
  useEffect(() => {
    let cancelled = false;
    api.get(`/${role}/live-vehicles`)
      .then((res) => { if (!cancelled) setVehicles(res.data?.data?.vehicles || []); })
      .catch((err) => { if (!cancelled) setVehiclesError(err?.response?.data?.message || 'โหลดรายการรถไม่สำเร็จ'); });
    return () => { cancelled = true; };
  }, [role]);

  /* the retention window's day summaries for the chosen vehicle */
  useEffect(() => {
    if (!vehicleId) { setDays(null); return undefined; }
    let cancelled = false;
    setDays(null);
    setDaysError(null);
    api.get(`/${role}/vehicles/${encodeURIComponent(vehicleId)}/track-days`)
      .then((res) => { if (!cancelled) setDays(res.data?.data || null); })
      .catch((err) => { if (!cancelled) setDaysError(err?.response?.data?.message || 'โหลดข้อมูลรายวันไม่สำเร็จ'); });
    fetchPickupPoints(role, vehicleId)
      .then((pp) => { if (!cancelled) setPickupPoints(pp); })
      .catch(() => { if (!cancelled) setPickupPoints([]); });
    return () => { cancelled = true; };
  }, [role, vehicleId]);

  /* default day: the one in the URL, else the latest day that has data, else today */
  const selectedDate = useMemo(() => {
    if (dateParam) return dateParam;
    const list = days?.days || [];
    const withData = [...list].reverse().find((d) => d.point_count > 0);
    return withData?.date || days?.to || '';
  }, [dateParam, days]);

  /* the chosen day's track */
  useEffect(() => {
    if (!vehicleId || !selectedDate) { setTrack(null); return undefined; }
    let cancelled = false;
    setTrackLoading(true);
    setTrackError(null);
    setPlaying(false);
    api.get(`/${role}/vehicles/${encodeURIComponent(vehicleId)}/track?date=${selectedDate}`)
      .then((res) => {
        if (cancelled) return;
        const data = res.data?.data || null;
        setTrack(data);
        setCursor(data?.points?.length ? data.points.length - 1 : 0);
      })
      .catch((err) => { if (!cancelled) { setTrack(null); setTrackError(err?.response?.data?.message || 'โหลดเส้นทางไม่สำเร็จ'); } })
      .finally(() => { if (!cancelled) setTrackLoading(false); });
    return () => { cancelled = true; };
  }, [role, vehicleId, selectedDate]);

  /* play: walk the marker along the route in ~40 s whatever the point count */
  const points = useMemo(() => track?.points || [], [track]);
  useEffect(() => {
    if (!playing) return undefined;
    const step = Math.max(1, Math.round(points.length / 400));
    playRef.current = setInterval(() => {
      setCursor((c) => {
        if (c + step >= points.length - 1) { setPlaying(false); return points.length - 1; }
        return c + step;
      });
    }, 100);
    return () => clearInterval(playRef.current);
  }, [playing, points.length]);

  const togglePlay = () => {
    if (!points.length) return;
    if (!playing && cursor >= points.length - 1) setCursor(0);
    setPlaying((p) => !p);
  };

  const vehicle = track?.vehicle || vehicles.find((v) => v.vehicle_id === vehicleId) || null;
  const plate = vehicle?.plate_no || vehicleId;
  const summary = track?.summary;
  const cursorPoint = points[cursor] || null;
  const signalGaps = (track?.gaps || []).filter((g) => g.kind !== 'break');
  const retentionDays = days?.retention_days || track?.retention_days || 7;
  const windowsLabel = (days?.tracking || track?.tracking)?.label || '05:00–09:00, 15:00–19:00';

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <PageHeader
        title="ประวัติเส้นทางรถ"
        subtitle={vehicle ? `${plate}${vehicle.vehicle_type ? ` · ${vehicle.vehicle_type}` : ''}` : 'เลือกรถเพื่อดูเส้นทางย้อนหลัง'}
        icon={RouteIcon}
        actions={(
          <Link
            to={LIVE_PATH[role]}
            className="focus-ring inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl border border-surface-border bg-surface-raised text-sm font-medium text-ink hover:bg-surface"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2} />
            ตำแหน่งปัจจุบัน
          </Link>
        )}
      />

      <AppCard padding="md">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,320px)_1fr] gap-4 items-start">
          <FormField label="รถรับส่ง" helper={vehiclesError || undefined}>
            {(ctrl) => (
              <select
                {...ctrl}
                value={vehicleId}
                onChange={(e) => setQuery({ vehicle: e.target.value, date: '' })}
                className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink"
              >
                <option value="">เลือกรถ</option>
                {vehicleId && !vehicles.some((v) => v.vehicle_id === vehicleId) && (
                  <option value={vehicleId}>{plate}</option>
                )}
                {vehicles.map((v) => (
                  <option key={v.vehicle_id} value={v.vehicle_id}>
                    {v.plate_no || v.vehicle_id}{v.vehicle_type ? ` · ${v.vehicle_type}` : ''}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <p className="text-xs text-ink-muted leading-relaxed md:pt-7">
            <CalendarDays className="inline w-3.5 h-3.5 mr-1 -mt-0.5" strokeWidth={2} />
            เก็บประวัติย้อนหลัง {retentionDays} วัน · บันทึกตำแหน่งเฉพาะช่วง {windowsLabel} น.
            · เส้นประ = ช่วงสัญญาณขาดเกิน 3 นาที (ไม่ทราบเส้นทางจริง)
          </p>
        </div>
      </AppCard>

      {!vehicleId ? (
        <AlertBanner variant="info" title="ยังไม่ได้เลือกรถ">
          เลือกรถจากรายการด้านบน หรือกดปุ่ม "ประวัติเส้นทาง" จากหน้าตำแหน่งปัจจุบัน
        </AlertBanner>
      ) : (
        <>
          <DashboardSection title={`${retentionDays} วันล่าสุด`} description="แตะวันที่เพื่อดูเส้นทางของวันนั้น">
            {daysError ? (
              <ErrorState title="โหลดข้อมูลรายวันไม่สำเร็จ" message={daysError} />
            ) : !days ? (
              <LoadingState compact />
            ) : (
              <DayPicker days={days.days} selected={selectedDate} onSelect={(d) => setQuery({ date: d })} />
            )}
          </DashboardSection>

          {trackError && <ErrorState title="โหลดเส้นทางไม่สำเร็จ" message={trackError} />}

          {trackLoading && !track ? (
            <LoadingState />
          ) : track && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <SummaryTile icon={RouteIcon} label="ระยะทาง" value={kmTh(summary.distance_km)} />
                <SummaryTile icon={Clock} label="เวลาเริ่ม–สิ้นสุด" value={summary.first_at ? `${timeTh(summary.first_at)}–${timeTh(summary.last_at)} น.` : '–'} />
                <SummaryTile
                  icon={WifiOff}
                  label="ช่วงสัญญาณขาด"
                  value={summary.gap_count ? `${summary.gap_count} ช่วง · ${minutesTh(summary.offline_seconds)}` : 'ไม่มี'}
                />
                <SummaryTile icon={Gauge} label="ความเร็วสูงสุด" value={summary.point_count ? `${Math.round(summary.max_speed_kmh || 0)} กม./ชม.` : '–'} />
              </div>

              {summary.point_count === 0 ? (
                <AlertBanner variant="info" title="ไม่มีข้อมูล">
                  วันที่ {dayTh(selectedDate, { day: 'numeric', month: 'long' })} ไม่มีตำแหน่งที่บันทึกไว้ของรถคันนี้
                  (คนขับอาจไม่ได้เปิดส่งตำแหน่ง หรืออยู่นอกช่วงเวลาติดตาม)
                </AlertBanner>
              ) : null}

              <DashboardSection
                title={`เส้นทาง ${dayTh(selectedDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
                description={`${summary.point_count.toLocaleString('th-TH')} จุดตำแหน่ง${summary.downsampled ? ` · แสดง ${summary.point_count_returned.toLocaleString('th-TH')} จุด` : ''}`}
              >
                <div className="space-y-3">
                  <div className="h-[52vh] min-h-[320px] lg:h-[58vh] lg:min-h-[420px] rounded-xl overflow-hidden border border-surface-border">
                    <VehicleTrackMap
                      points={points}
                      segments={track.segments || []}
                      gaps={track.gaps || []}
                      pickupPoints={pickupPoints}
                      cursorIndex={points.length ? cursor : null}
                    />
                  </div>
                  <Legend hasPickup={pickupPoints.length > 0} />
                  {points.length > 0 && (
                    <div className="flex items-end gap-3">
                      <button
                        type="button"
                        onClick={togglePlay}
                        aria-label={playing ? 'หยุดเล่นเส้นทาง' : 'เล่นเส้นทาง'}
                        className="focus-ring shrink-0 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-xl bg-brand text-white font-semibold hover:bg-brand-700"
                      >
                        {playing ? <Pause className="w-4 h-4" strokeWidth={2.4} /> : <Play className="w-4 h-4" strokeWidth={2.4} />}
                        {playing ? 'หยุด' : 'เล่น'}
                      </button>
                      <FormField
                        className="flex-1 min-w-0"
                        label={cursorPoint
                          ? `เวลา ${timeThSec(cursorPoint.t)} น.${cursorPoint.speed_kmh != null ? ` · ${Math.round(cursorPoint.speed_kmh)} กม./ชม.` : ''}`
                          : 'เวลา'}
                      >
                        {(ctrl) => (
                          <input
                            {...ctrl}
                            type="range"
                            min={0}
                            max={Math.max(0, points.length - 1)}
                            value={cursor}
                            onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }}
                            className="w-full accent-brand min-h-[44px]"
                          />
                        )}
                      </FormField>
                    </div>
                  )}
                </div>
              </DashboardSection>

              {signalGaps.length > 0 && (
                <DashboardSection title="ช่วงสัญญาณขาด" description="ไม่ได้รับตำแหน่งเกิน 3 นาที">
                  <ul className="divide-y divide-surface-border text-sm">
                    {signalGaps.map((g) => (
                      <li key={g.from} className="flex items-center justify-between gap-3 py-2 tabular-nums">
                        <span className="text-ink">{timeTh(g.from)}–{timeTh(g.to)} น.</span>
                        <span className="text-ink-muted">{minutesTh(g.seconds)}</span>
                      </li>
                    ))}
                  </ul>
                </DashboardSection>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function DayPicker({ days = [], selected, onSelect }) {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-7 gap-2" role="list">
      {days.map((d) => {
        const has = d.point_count > 0;
        const active = d.date === selected;
        return (
          <button
            key={d.date}
            type="button"
            role="listitem"
            onClick={() => onSelect(d.date)}
            aria-pressed={active}
            className={`focus-ring min-h-[64px] rounded-xl border px-2 py-2 text-center transition ${
              active
                ? 'border-brand bg-brand text-white'
                : has
                  ? 'border-surface-border bg-surface-raised text-ink hover:border-brand'
                  : 'border-dashed border-surface-border bg-surface text-ink-muted'
            }`}
          >
            <span className="block text-xs">{dayTh(d.date, { weekday: 'short' })}</span>
            <span className="block text-base font-semibold tabular-nums">{dayTh(d.date, { day: 'numeric', month: 'short' })}</span>
            <span className={`block text-[11px] tabular-nums ${active ? 'text-white/90' : ''}`}>
              {has ? kmTh(d.distance_km) : 'ไม่มีข้อมูล'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SummaryTile({ icon: Icon, label, value }) {
  return (
    <AppCard padding="sm">
      <p className="flex items-center gap-1.5 text-xs text-ink-muted">
        <Icon className="w-3.5 h-3.5" strokeWidth={2} />
        {label}
      </p>
      <p className="mt-1 text-base sm:text-lg font-semibold text-ink tabular-nums leading-snug">{value}</p>
    </AppCard>
  );
}

function Legend({ hasPickup }) {
  const item = (style, label) => (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-6 h-0 border-t-4" style={style} aria-hidden="true" />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
      {item({ borderColor: TRACK_COLORS.morning }, 'รอบเช้า')}
      {item({ borderColor: TRACK_COLORS.evening }, 'รอบเย็น')}
      {item({ borderColor: TRACK_COLORS.gap, borderTopStyle: 'dashed', borderTopWidth: 3 }, 'ช่วงสัญญาณขาด')}
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-full" style={{ background: TRACK_COLORS.start }} aria-hidden="true" />จุดเริ่มต้น
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-full" style={{ background: TRACK_COLORS.end }} aria-hidden="true" />จุดสิ้นสุด
      </span>
      {hasPickup && (
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" style={{ color: TRACK_COLORS.pickup }} strokeWidth={2.4} aria-hidden="true" />จุดรับส่ง
        </span>
      )}
    </div>
  );
}

