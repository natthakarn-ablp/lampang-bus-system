import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, RotateCw, Truck, Building2, Wifi } from 'lucide-react';

const POLL_INTERVAL = 30_000; // 30s background refresh
const TICK_INTERVAL = 1_000;  // 1s freshness ticker (re-render only)
import api from '../../api/axios';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import { PAGE_TITLES, UI_MESSAGES } from '../../constants/uiLabels';
import { useAuth } from '../../hooks/useAuth';
import useRecentDays, { RECENT_DAYS_FAILED } from '../../hooks/useRecentDays';
import {
  AppCard, RiskCard, StatusBadge, DayBars, FoldSection, RoleChip, tone,
} from '../../components/ui';
import {
  StatusHero, ActionList, StatTile, StatGrid, SectionCard, TravelLeaveSummary,
  roundStatus, dayStatus,
} from '../../components/dashboard';
import PageHeader from '../../components/PageHeader';
import { PageTransition } from '../../lib/motion';

export default function ProvinceDashboard() {
  const { features } = useAuth();
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

  const fmt = n => Number(n || 0).toLocaleString('th-TH');
  const affs = data.affiliations ?? [];
  const problemSchools = data.schools_not_complete ?? [];
  // recent_emergencies counts the last 7 days (province.service.js), not today.
  const emergencies7d = Number(data.recent_emergencies) || 0;
  // Per-affiliation emergency_count is TODAY's. Not summed: a bus shared by two
  // affiliations would be counted twice — only "any today" is used.
  const emergencyToday = affs.some(a => Number(a.emergency_count) > 0);

  const schoolTotal = data.school_total ?? data.total_schools ?? 0;
  const schoolUsed = data.school_used_recently ?? 0;
  const dateIso = data.date ? String(data.date).slice(0, 10) : undefined;
  const dateLabel = dateIso
    ? new Date(`${dateIso}T12:00:00+07:00`).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  // ── Hero: one status per round for the whole province ──
  const isSchoolDay = typeof data.is_school_day === 'boolean' ? data.is_school_day : undefined;
  const mStatus = roundStatus({ session: 'morning', done: data.morning_done, expected: data.morning_total, date: dateIso, isSchoolDay, conflict: data.morning_conflict });
  const eStatus = roundStatus({ session: 'evening', done: data.evening_done, expected: data.evening_total, date: dateIso, isSchoolDay, conflict: data.evening_conflict });

  // ── Per-affiliation status: who needs follow-up ──
  const TONE_RANK = { danger: 0, warn: 1, info: 2, neutral: 3, success: 4 };
  const affRows = affs.map(a => {
    const m = roundStatus({ session: 'morning', done: a.morning_done, expected: a.morning_expected, date: dateIso, isSchoolDay, conflict: a.morning_conflict });
    const e = roundStatus({ session: 'evening', done: a.evening_done, expected: a.evening_expected, date: dateIso, isSchoolDay, conflict: a.evening_conflict });
    const worst = TONE_RANK[e.tone] < TONE_RANK[m.tone] ? e : m;
    return { a, m, e, worst, needsFollowUp: worst.tone === 'warn' || worst.tone === 'danger', pendingTotal: m.pending + e.pending };
  }).sort((x, y) => (TONE_RANK[x.worst.tone] - TONE_RANK[y.worst.tone]) || (y.pendingTotal - x.pendingTotal));
  const followUp = affRows.filter(r => r.needsFollowUp);

  // Most "not confirmed" pupils come from schools that have not started using
  // the system at all; when that is most schools, say so and list it first.
  const schoolUnused = Number(data.school_not_using_recently) || 0;
  const adoptionGap = schoolTotal > 0 && schoolUnused * 2 > schoolTotal;
  const baseDay = dayStatus([mStatus, eStatus]);
  const heroDay = emergencyToday
    ? { tone: 'danger', headline: 'มีเหตุฉุกเฉินวันนี้', sub: 'ตรวจสอบเหตุและติดต่อสังกัดที่เกี่ยวข้อง', focus: null }
    : baseDay.kind === 'summary' && adoptionGap
      ? { ...baseDay, sub: `โรงเรียน ${fmt(schoolUnused)} จาก ${fmt(schoolTotal)} แห่งยังไม่เริ่มใช้ระบบ` }
      : baseDay;
  const heroAction = emergencyToday
    ? { label: 'ดูเหตุฉุกเฉิน', to: '/province/emergencies' }
    : followUp.length > 0
      ? { label: 'ดูสังกัดที่ต้องติดตาม', to: '/province/affiliations' }
      : { label: 'ดูรายงานวันนี้', to: '/reports/daily' };

  const offlineVehicles = (Number(data.vehicle_stale) || 0) + (Number(data.vehicle_no_location) || 0);
  const riskUrgent = atRiskVehicles.some(v => v.risk_score >= 100);

  // ── ActionList: each row says what to do and links to where ──
  const unusedItem = {
    // Warn (not info) when most schools are not using the system, so it sorts
    // above the other follow-ups: it is the reason the round numbers are low.
    key: 'unused', tone: adoptionGap ? 'warn' : 'info', count: schoolUnused,
    title: 'โรงเรียนที่ยังไม่เริ่มใช้ระบบ',
    sub: `ไม่มีการใช้งานใน 14 วัน จาก ${fmt(schoolTotal)} โรงเรียน · ติดต่อให้เริ่มเช็กชื่อ`,
    to: '/province/schools', actionLabel: 'ดูรายชื่อ',
  };
  const actions = [
    adoptionGap && unusedItem,
    {
      key: 'emergency', tone: emergencyToday ? 'danger' : 'warn', count: emergencies7d,
      title: emergencyToday ? 'เหตุฉุกเฉินใน 7 วัน (มีเหตุวันนี้ ต้องตรวจสอบ)' : 'เหตุฉุกเฉินในรอบ 7 วัน',
      sub: incidents[0]?.plate_no ? `ล่าสุดรถ ${incidents[0].plate_no} · ตรวจผลการแก้ไข` : 'ตรวจผลการแก้ไข',
      to: '/province/emergencies', actionLabel: 'ดูเหตุฉุกเฉิน',
    },
    {
      key: 'followup', tone: followUp.some(r => r.worst.tone === 'danger') ? 'danger' : 'warn', count: followUp.length,
      title: 'สังกัดที่ยังรับส่งไม่ครบ',
      sub: `${followUp.slice(0, 2).map(r => r.a.name).join(' · ')}${followUp.length > 2 ? ' …' : ''} · โทรติดตามสังกัด`,
      to: '/province/affiliations', actionLabel: 'ดูทุกสังกัด',
    },
    {
      key: 'risk', tone: riskUrgent ? 'danger' : 'warn', count: atRiskVehicles.length,
      title: 'รถต้องแก้เอกสาร',
      sub: `${atRiskVehicles.slice(0, 2).map(v => v.plate_no).join(' · ') || 'ประกัน/ตรวจสภาพมีปัญหา'} · แจ้งเจ้าของรถ`,
      to: '/province/vehicles', actionLabel: 'ดูรายการรถ',
    },
    participationOn && {
      key: 'cases', tone: 'info', count: newCases, title: 'เรื่องใหม่จากการมีส่วนร่วม',
      sub: 'ยังไม่มีผู้รับเรื่อง', to: '/participation', actionLabel: 'เปิดอ่าน',
    },
    {
      key: 'offline', tone: 'info', count: offlineVehicles, title: 'รถที่ระบบติดตามไม่เห็นสัญญาณ',
      sub: `สัญญาณเก่า ${fmt(data.vehicle_stale)} · ยังไม่มีตำแหน่ง ${fmt(data.vehicle_no_location)} คัน`,
      to: '/province/live-vehicles', actionLabel: 'ดูแผนที่รถ',
    },
    !adoptionGap && unusedItem,
  ].filter(Boolean);

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

      <StatusHero
        eyebrow="ทั้งจังหวัดวันนี้"
        rounds={[
          { status: mStatus, to: '/reports/daily', title: 'รอบเช้า (ส่งถึงโรงเรียน)' },
          { status: eStatus, to: '/reports/daily', title: 'รอบเย็น (ส่งถึงบ้าน)' },
        ]}
        day={heroDay}
        action={heroAction}
      />

      <ActionList items={actions} hideWhenEmpty afterAlert={heroDay.tone === 'warn' || heroDay.tone === 'danger'} />

      <SectionCard
        title="ความคืบหน้าแยกตามสังกัด"
        sub={followUp.length > 0 ? `${fmt(followUp.length)} จาก ${fmt(affs.length)} สังกัดต้องติดตาม` : `${fmt(affs.length)} สังกัด`}
        action={<Link to="/province/affiliations" className="focus-ring text-sm font-semibold text-brand-700 rounded">ดูทุกสังกัด</Link>}
        empty={affRows.length === 0}
      >
        <ul className="divide-y divide-surface-border">
          {affRows.map(({ a, m, e }) => (
            <li key={a.id} className="py-3 first:pt-0 last:pb-0">
              <p className="font-semibold text-ink text-pretty">{a.name}</p>
              <p className="text-sm text-ink-muted">{fmt(a.school_count)} โรงเรียน · {fmt(a.student_count)} คน · {fmt(a.vehicle_count)} คัน</p>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[['เช้า', m], ['เย็น', e]].map(([name, s]) => {
                  const t = tone(s.tone);
                  return (
                    <div key={name} className="min-w-0">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="tabular-nums text-ink"><strong className="text-lg">{name} {fmt(s.done)}</strong><span className="text-ink-muted"> / {fmt(s.expected)}</span></span>
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold shrink-0 ${t.soft} ${t.ink} ${t.border}`}>{s.label}</span>
                      </div>
                      {s.expected > 0 && !['not_yet', 'off_day', 'unavailable'].includes(s.state) && (
                        <div className="mt-1 h-2 rounded-full bg-surface overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={s.expected} aria-valuenow={s.done} aria-label={`${a.name} ${name}`}>
                          <div className="h-full rounded-full" style={{ width: `${s.pct ?? 0}%`, backgroundColor: t.ring }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {Number(a.emergency_count) > 0 && (
                <p className="mt-2 text-sm font-semibold text-danger-ink inline-flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" aria-hidden="true" />เหตุฉุกเฉินวันนี้ {fmt(a.emergency_count)} รายการ
                </p>
              )}
            </li>
          ))}
        </ul>
      </SectionCard>

      <StatGrid label="ขนาดของระบบ">
        <StatTile label="นักเรียน" value={data.total_students ?? 0} unit="คน" />
        <StatTile label="โรงเรียน" value={data.total_schools ?? data.school_total ?? 0} sub={`ใช้ระบบแล้ว ${fmt(schoolUsed)} แห่งใน 14 วัน`} />
        <StatTile label="สังกัด" value={data.total_affiliations ?? affs.length} />
        <StatTile label="รถรับส่ง" value={data.vehicle_serving_students ?? data.total_vehicles ?? 0} unit="คัน" />
      </StatGrid>

      {/* Self-travel / leave: in context under the round numbers, hidden when all 0. */}
      <TravelLeaveSummary data={error ? null : data} />

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DayBars
          title="การรับส่งทั้งจังหวัด 7 วันล่าสุด (%)"
          days={recentDays || []}
          failed={recentDays === RECENT_DAYS_FAILED}
          note="คิดจากจำนวนผู้ใช้บริการปัจจุบัน"
        />
      </section>

      <section className="flex flex-col gap-3" aria-label="รายละเอียดเพิ่มเติม">
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

        {problemSchools.length > 0 && (
          <FoldSection title="โรงเรียนที่ยังมีนักเรียนรอรับส่ง" subtitle={`${problemSchools.length} โรงเรียน`}>
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
          </FoldSection>
        )}

        {atRiskVehicles.length > 0 && (
          <FoldSection title="รถที่ต้องติดตาม" subtitle={`${atRiskVehicles.length} คัน เรียงตามความเร่งด่วน`}>
            <div className="space-y-2">
              {atRiskVehicles.map(v => <VehicleAtRiskRow key={v.id} vehicle={v} />)}
            </div>
          </FoldSection>
        )}

        {incidents.length > 0 && (
          <FoldSection title="เหตุฉุกเฉินล่าสุด" subtitle={`${incidents.length} รายการล่าสุด`}>
            <div className="space-y-2">
              {incidents.map(em => <IncidentEntry key={em.id} em={em} />)}
            </div>
          </FoldSection>
        )}
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
