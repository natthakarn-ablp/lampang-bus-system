import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, RotateCw, Truck, Building2, Wifi } from 'lucide-react';

const POLL_INTERVAL = 30_000; // 30s background refresh
const TICK_INTERVAL = 1_000;  // 1s freshness ticker (re-render only)
import api from '../../api/axios';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import { safePct, kpiColor } from '../../utils/kpi';
import { PAGE_TITLES, UI_MESSAGES } from '../../constants/uiLabels';
import { useAuth } from '../../hooks/useAuth';
import useRecentDays from '../../hooks/useRecentDays';
import {
  AppCard, RiskCard, StatusBadge,
  TodayBanner, TodoCards, KpiRingCard, DayBars, RankBars, FoldSection, RoleChip,
  pctOf, pctTone,
} from '../../components/ui';
import PageHeader from '../../components/PageHeader';
import { PageTransition } from '../../lib/motion';

export default function ProvinceDashboard() {
  const { features } = useAuth();
  const navigate = useNavigate();
  const participationOn = !!features?.participationCases;
  const [data, setData] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [atRiskVehicles, setAtRiskVehicles] = useState([]);
  const [newCases, setNewCases] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const recentDays = useRecentDays('province', 7);

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [dashRes, incRes, atRiskRes, partRes] = await Promise.all([
        api.get('/province/dashboard').catch((e) => e),
        api.get('/province/emergencies?per_page=5&page=1').catch(() => null),
        api.get('/province/vehicles-at-risk?limit=10').catch(() => null),
        // Counts only (no case bodies). Called only while the feature is on —
        // with the flag off the router is not mounted.
        participationOn ? api.get('/participation/summary').catch(() => null) : Promise.resolve(null),
      ]);
      // A failed dashboard call used to leave data null, which rendered
      // "ไม่มีข้อมูล" — telling the province there is nothing to report when
      // in fact nothing was fetched.
      if (dashRes?.data?.data) { setData(dashRes.data.data); setError(null); }
      else setError(dashRes?.response?.data?.message || 'โหลดข้อมูลภาพรวมจังหวัดไม่สำเร็จ');
      const incList = incRes?.data?.data;
      setIncidents(Array.isArray(incList) ? incList : []);
      const atRiskList = atRiskRes?.data?.data;
      setAtRiskVehicles(Array.isArray(atRiskList) ? atRiskList : []);
      setNewCases(Number(partRes?.data?.data?.by_status?.SUBMITTED) || 0);
      setLastSyncedAt(Date.now());
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [participationOn]);

  // Background data refresh — silent, doesn't blank the page
  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, POLL_INTERVAL);
    return () => clearInterval(t);
  }, [fetchAll]);

  // 1-second ticker for the freshness "X seconds ago" indicator
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_INTERVAL);
    return () => clearInterval(t);
  }, []);

  if (loading) return <LoadingState message={UI_MESSAGES.LOADING} />;
  if (error && !data) return <ErrorState title="โหลดข้อมูลไม่สำเร็จ" message={error} onRetry={fetchAll} />;
  if (!data) return <EmptyState title={UI_MESSAGES.NO_DATA} description="ยังไม่มีข้อมูลภาพรวมสำหรับวันนี้" />;

  const affs = data.affiliations ?? [];
  const problemSchools = data.schools_not_complete ?? [];
  // recent_emergencies counts the last 7 days (province.service.js), not today.
  const emergencies7d = Number(data.recent_emergencies) || 0;
  // Per-affiliation emergency_count is TODAY's. Not summed: a bus shared by two
  // affiliations would be counted twice — only "any today" is used.
  const emergencyToday = affs.some(a => Number(a.emergency_count) > 0);

  const mTotal = data.morning_total || 0;
  const eTotal = data.evening_total || 0;
  const mDone = data.morning_done || 0;
  const eDone = data.evening_done || 0;
  const mPct = pctOf(mDone, mTotal);
  const ePct = pctOf(eDone, eTotal);
  const morningStarted = mDone > 0;
  const eveningStarted = eDone > 0;
  const schoolTotal = data.school_total ?? data.total_schools ?? 0;
  const schoolUsed = data.school_used_recently ?? 0;
  const schoolPct = pctOf(schoolUsed, schoolTotal);

  const dateLabel = data.date
    ? new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  // ── Banner: one sentence, one tone ──
  let banner;
  if (!morningStarted && !eveningStarted) {
    banner = { variant: 'neutral', title: 'ยังไม่เริ่มรับส่งวันนี้', sub: 'รอข้อมูลรอบเช้าจากคนขับ', cta: { label: 'ดูรายงานวันนี้', to: '/reports/daily' } };
  } else if (emergencyToday) {
    banner = {
      variant: 'danger',
      title: 'มีเหตุฉุกเฉินวันนี้',
      sub: `ส่งเช้าแล้ว ${mPct ?? 0}%${eveningStarted ? ` · รับเย็นแล้ว ${ePct ?? 0}%` : ' · รอบเย็นยังไม่เริ่ม'}`,
      cta: { label: 'ดูเหตุฉุกเฉิน', to: '/province/emergencies' },
    };
  } else {
    const worst = eveningStarted ? Math.min(mPct ?? 100, ePct ?? 100) : (mPct ?? 100);
    const tone = pctTone(worst);
    const sub = `ส่งเช้าแล้ว ${mPct ?? 0}% (${mDone.toLocaleString('th-TH')} / ${mTotal.toLocaleString('th-TH')} คน)`
      + (eveningStarted ? ` · รับเย็นแล้ว ${ePct ?? 0}%` : ' · รอบเย็นยังไม่เริ่ม')
      + ' · ไม่มีเหตุฉุกเฉินวันนี้';
    banner = {
      variant: tone,
      title: tone === 'success' ? 'ภาพรวมวันนี้ปกติ'
        : problemSchools.length > 0
          ? `${problemSchools.length.toLocaleString('th-TH')} โรงเรียนยังมีนักเรียนรอรับส่ง`
          : `ยังรอส่ง-รับอีก ${(Math.max(0, mTotal - mDone) + (eveningStarted ? Math.max(0, eTotal - eDone) : 0)).toLocaleString('th-TH')} คน`,
      sub,
      cta: { label: 'ดูรายงานวันนี้', to: '/reports/daily' },
    };
  }

  // ── Todos (never repeat the banner topic) ──
  const todos = [
    {
      key: 'risk', variant: atRiskVehicles.some(v => v.risk_score >= 100) ? 'danger' : 'warn',
      count: atRiskVehicles.length, title: 'รถต้องแก้เอกสาร',
      sub: atRiskVehicles.slice(0, 2).map(v => v.plate_no).join(' · ') || 'ทั้งจังหวัด',
      cta: { label: 'ดูรายการรถ', to: '/province/vehicles' },
    },
    participationOn && {
      key: 'cases', variant: 'info', count: newCases, title: 'เรื่องใหม่จากการมีส่วนร่วม',
      sub: 'ยังไม่มีผู้รับเรื่อง', cta: { label: 'เปิดอ่าน', to: '/participation' },
    },
    {
      key: 'unused', variant: 'neutral', count: data.school_not_using_recently ?? 0,
      title: 'โรงเรียนยังไม่ใช้ระบบ', sub: `ไม่มีการใช้งานใน 14 วัน · จาก ${schoolTotal.toLocaleString('th-TH')} โรงเรียน`,
      cta: { label: 'ดูรายชื่อ', to: '/province/schools' },
    },
  ].filter(Boolean);

  // ── Ranking: morning completion per affiliation, lowest first ──
  const rankRows = affs
    .map(a => {
      const p = a.morning_expected > 0
        ? Math.round((a.morning_done / a.morning_expected) * 100)
        : (a.morning_kpi != null ? Math.round(a.morning_kpi) : null);
      return { a, p };
    })
    .filter(x => x.p != null)
    .sort((x, y) => x.p - y.p)
    .map(({ a, p }) => ({
      key: a.id,
      label: a.name,
      width: p,
      text: a.morning_expected > 0 ? `${p}% (${a.morning_done}/${a.morning_expected})` : `${p}%`,
      variant: pctTone(p),
    }));

  const scale = [
    { k: 'นักเรียน', v: data.total_students },
    { k: 'โรงเรียน', v: data.total_schools ?? data.school_total },
    { k: 'สังกัด', v: data.total_affiliations },
    { k: 'รถรับส่ง', v: data.vehicle_serving_students ?? data.total_vehicles },
  ];

  return (
    <PageTransition>
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col gap-2">
        <RoleChip role="province" />
        <PageHeader
          title={PAGE_TITLES.PROVINCE_DASHBOARD}
          subtitle="ภาพรวมการเดินรถและงานที่ต้องติดตามทั้งจังหวัด"
          meta={dateLabel ? `ข้อมูล ณ ${dateLabel}` : undefined}
          actions={
            <FreshnessPill
              lastSyncedAt={lastSyncedAt}
              now={now}
              refreshing={refreshing}
              onRefresh={fetchAll}
            />
          }
        />
      </div>

      {/* Scale of the system — context for every number below */}
      <div className="flex flex-wrap gap-2 -mt-3">
        {scale.map(s => (
          <span key={s.k} className="bg-surface-raised border border-surface-border rounded-full px-4 py-1.5 text-sm text-ink-muted">
            <strong className="text-ink tabular-nums">{Number(s.v ?? 0).toLocaleString('th-TH')}</strong> {s.k}
          </span>
        ))}
      </div>

      <TodayBanner {...banner} />

      <TodoCards items={todos} />

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiRingCard
          label="ส่งเช้า"
          pct={morningStarted ? mPct : null}
          value={morningStarted ? undefined : '—'}
          variant={morningStarted ? pctTone(mPct) : 'neutral'}
          sub={`${mDone.toLocaleString('th-TH')} / ${mTotal.toLocaleString('th-TH')} คน`}
          chip={morningStarted ? undefined : 'ยังไม่เริ่มรอบ'}
        />
        <KpiRingCard
          label="รับเย็น"
          pct={eveningStarted ? ePct : null}
          value={eveningStarted ? undefined : '—'}
          variant={eveningStarted ? pctTone(ePct) : 'neutral'}
          sub={eveningStarted ? `${eDone.toLocaleString('th-TH')} / ${eTotal.toLocaleString('th-TH')} คน` : `${eTotal.toLocaleString('th-TH')} คนใช้บริการรอบเย็น`}
          chip={eveningStarted ? undefined : 'ยังไม่เริ่มรอบ'}
        />
        <KpiRingCard
          label="โรงเรียนที่ใช้งาน"
          pct={schoolPct}
          value={schoolPct == null ? '—' : undefined}
          variant="info"
          sub={`${schoolUsed.toLocaleString('th-TH')} / ${schoolTotal.toLocaleString('th-TH')} โรงเรียน · ใน 14 วัน`}
        />
        <KpiRingCard
          label="เหตุฉุกเฉิน 7 วัน"
          value={emergencies7d}
          variant={emergencyToday ? 'danger' : emergencies7d > 0 ? 'warn' : 'success'}
          sub={emergencies7d > 0 ? `ล่าสุด ${incidents[0]?.plate_no || '-'}` : 'ไม่มีเหตุ'}
          onClick={emergencies7d > 0 ? () => navigate('/province/emergencies') : undefined}
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DayBars
          title="การรับส่งทั้งจังหวัด 7 วันล่าสุด (%)"
          days={recentDays || []}
          note="คิดจากจำนวนผู้ใช้บริการปัจจุบัน"
        />
        <RankBars
          title="ส่งเช้าแยกตามสังกัด"
          sub="วันนี้ เรียงจากน้อยไปมาก"
          rows={rankRows}
          link={{ label: 'ดูทุกสังกัด', to: '/province/affiliations' }}
          empty="ยังไม่มีข้อมูลรอบเช้าวันนี้"
        />
      </section>

      <section className="flex flex-col gap-3">
        <FoldSection
          title="สัญญาณรถ (GPS)"
          subtitle={`ออนไลน์ ${data.vehicle_online ?? 0} · สัญญาณเก่า ${data.vehicle_stale ?? 0} · ออฟไลน์ ${data.vehicle_offline_smart ?? 0} · ยังไม่มีข้อมูล ${data.vehicle_no_location ?? 0}`}
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <SignalStat label="รถทั้งหมด" value={data.vehicle_total} />
            <SignalStat label="ติดตามได้" value={data.vehicle_trackable} tone="text-success-ink" />
            <SignalStat label="ออนไลน์" value={data.vehicle_online} tone="text-success-ink" />
            <SignalStat label="สัญญาณเก่า" value={data.vehicle_stale} tone="text-warn-ink" />
            <SignalStat label="ออฟไลน์" value={data.vehicle_offline_smart} tone="text-danger-ink" />
            <SignalStat label="หยุดส่ง" value={data.vehicle_paused} />
            <SignalStat label="ยังไม่มีข้อมูลตำแหน่ง" value={data.vehicle_no_location} tone="text-warn-ink" />
          </div>
        </FoldSection>

        <FoldSection
          title="โรงเรียนที่ยังมีนักเรียนรอรับส่ง"
          subtitle={problemSchools.length > 0 ? `${problemSchools.length} โรงเรียน` : 'ไม่มีโรงเรียนค้าง'}
        >
          {problemSchools.length === 0 ? (
            <p className="text-sm text-ink-muted text-center py-4">ไม่มีโรงเรียนค้าง</p>
          ) : (
            <div className="space-y-2">
              {problemSchools.map(s => {
                const pending = (s.morning_pending || 0) + (s.evening_pending || 0);
                const level = pending > 50 ? 'high' : pending > 20 ? 'medium' : 'low';
                return (
                  <RiskCard
                    key={s.school_id}
                    level={level}
                    icon={Building2}
                    title={s.school_name}
                    subtitle={`${s.student_count} คน · ${s.vehicle_count} คัน`}
                    meta={`รอ ${pending}`}
                  />
                );
              })}
            </div>
          )}
        </FoldSection>

        <FoldSection
          title="สรุปรายสังกัด"
          subtitle={`${affs.length} สังกัด · ส่งเช้า รับเย็น และเหตุฉุกเฉินวันนี้`}
        >
          <div className="space-y-2">
            {affs.map(a => (
              <AppCard key={a.id} padding="md" className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink text-sm truncate">{a.name}</p>
                  <p className="text-xs text-ink-muted">{a.school_count} ร.ร. · {a.student_count} คน · {a.vehicle_count} คัน</p>
                </div>
                <div className="flex items-center gap-3 text-sm shrink-0">
                  <span className={`font-semibold ${kpiColor(a.morning_kpi)}`}>เช้า {safePct(a.morning_kpi)}</span>
                  <span className={`font-semibold ${kpiColor(a.evening_kpi)}`}>เย็น {safePct(a.evening_kpi)}</span>
                  {a.emergency_count > 0 && (
                    <StatusBadge variant="danger" size="sm" icon={AlertTriangle}>
                      {a.emergency_count}
                    </StatusBadge>
                  )}
                </div>
              </AppCard>
            ))}
          </div>
        </FoldSection>

        <FoldSection
          title="รถที่ต้องติดตาม"
          subtitle={atRiskVehicles.length > 0 ? `${atRiskVehicles.length} คัน เรียงตามความเร่งด่วน` : 'ไม่มีรถต้องติดตาม'}
        >
          {atRiskVehicles.length === 0 ? (
            <p className="text-sm text-ink-muted text-center py-4">ไม่มีรถต้องติดตาม</p>
          ) : (
            <div className="space-y-2">
              {atRiskVehicles.map(v => <VehicleAtRiskRow key={v.id} vehicle={v} />)}
            </div>
          )}
        </FoldSection>

        <FoldSection
          title="เหตุฉุกเฉินล่าสุด"
          subtitle={incidents.length > 0 ? `${incidents.length} รายการล่าสุด` : 'ไม่มีเหตุล่าสุด'}
        >
          {incidents.length === 0 ? (
            <p className="text-sm text-ink-muted text-center py-4">ไม่มีเหตุล่าสุด</p>
          ) : (
            <div className="space-y-2">
              {incidents.map(em => <IncidentEntry key={em.id} em={em} />)}
            </div>
          )}
        </FoldSection>
      </section>
    </div>
    </PageTransition>
  );
}

/* ── Domain-specific sub-components ── */

function SignalStat({ label, value, tone = 'text-ink' }) {
  const n = Number(value) || 0;
  return (
    <div className="rounded-xl border border-surface-border bg-surface px-3 py-2">
      <p className="text-xs text-ink-muted inline-flex items-center gap-1"><Wifi className="w-3.5 h-3.5" aria-hidden="true" />{label}</p>
      <p className={`text-xl font-bold tabular-nums ${n > 0 ? tone : 'text-ink-muted'}`}>{n.toLocaleString('th-TH')}</p>
    </div>
  );
}

/* ── Incident feed entry: compact emergency row ── */
function IncidentEntry({ em }) {
  const when = em.reported_at
    ? new Date(em.reported_at).toLocaleString('th-TH', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      })
    : '-';
  return (
    <AppCard padding="sm" className="flex items-start gap-3">
      <AlertTriangle className="w-4 h-4 text-danger-ink shrink-0 mt-0.5" strokeWidth={2.2} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center flex-wrap gap-2 mb-0.5">
          <span className="font-semibold text-ink">{em.plate_no || '-'}</span>
          <StatusBadge variant={em.channel === 'line' ? 'info' : 'neutral'} size="sm">
            {em.channel === 'line' ? 'LINE' : 'เว็บ'}
          </StatusBadge>
          <span className="ml-auto text-xs text-ink-muted whitespace-nowrap">{when}</span>
        </div>
        {em.detail && <p className="text-sm text-ink-muted truncate">{em.detail}</p>}
      </div>
    </AppCard>
  );
}

/* ── Priority vehicle row: plate + driver + roster + priority badge + reasons ── */
const REASON_VARIANT = {
  'ไม่ผ่านตรวจ':      'danger',
  'ประกันหมด':        'danger',
  'ยังไม่ตรวจ':       'warn',
  'ต้องแก้ไข':        'warn',
  'ประกันใกล้หมด':    'warn',
  'ไม่มีข้อมูลประกัน': 'neutral',
};

function priorityBadge(score) {
  if (score >= 100) return { variant: 'danger',  label: 'เร่งด่วน' };
  if (score >=  60) return { variant: 'warn',    label: 'ต้องติดตาม' };
  if (score >=  20) return { variant: 'neutral', label: 'ข้อมูลไม่ครบ' };
  return                   { variant: 'success', label: 'พร้อมใช้งาน' };
}

function VehicleAtRiskRow({ vehicle: v }) {
  const priority = priorityBadge(v.risk_score);
  return (
    <AppCard padding="sm">
      <div className="flex items-start gap-3">
        <Truck className="w-4 h-4 text-ink-muted shrink-0 mt-0.5" strokeWidth={2} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <div className="min-w-0">
              <p className="font-semibold text-ink truncate">{v.plate_no}</p>
              <p className="text-xs text-ink-muted truncate">
                {v.driver_name} · {v.student_count} คน
              </p>
            </div>
            <StatusBadge variant={priority.variant} size="sm">
              {priority.label}
            </StatusBadge>
          </div>
          {v.school_names && v.school_names !== '-' && (
            <p className="text-xs text-ink-muted truncate mt-0.5">{v.school_names}</p>
          )}
          {Array.isArray(v.risk_reasons) && v.risk_reasons.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {v.risk_reasons.map(r => (
                <StatusBadge key={r} variant={REASON_VARIANT[r] || 'neutral'} size="sm">
                  {r}
                </StatusBadge>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppCard>
  );
}

/* ── Freshness pill: live "X seconds ago" + colored dot + manual refresh ── */
function FreshnessPill({ lastSyncedAt, now, refreshing, onRefresh }) {
  if (!lastSyncedAt) return null;
  const ageSec = Math.max(0, Math.floor((now - lastSyncedAt) / 1000));

  const dotCls = ageSec < 60   ? 'bg-success'
               : ageSec < 300  ? 'bg-warn'
               :                  'bg-danger';

  const ageLabel = ageSec < 5    ? 'อัปเดตล่าสุด'
                 : ageSec < 60   ? `${ageSec} วินาทีที่แล้ว`
                 : ageSec < 3600 ? `${Math.floor(ageSec / 60)} นาทีที่แล้ว`
                 :                 `${Math.floor(ageSec / 3600)} ชั่วโมงที่แล้ว`;

  return (
    <div className="shrink-0 flex items-center gap-2 text-xs text-ink-muted bg-surface border border-surface-border rounded-full pl-2.5 pr-1 py-1">
      <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} aria-hidden="true" />
      <span className="hidden sm:inline tabular-nums">{ageLabel}</span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="focus-ring tap-target ml-1 p-1 rounded-full hover:bg-surface-border active:bg-surface-border transition disabled:opacity-50"
        aria-label="รีเฟรชข้อมูล"
      >
        <RotateCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} strokeWidth={2.2} />
      </button>
    </div>
  );
}
