import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Map, Building2, GraduationCap, Bus, AlertTriangle,
  Sunrise, Sunset, BellRing, Activity, FileText, RefreshCw,
} from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import PageHeader from '../../components/PageHeader';
import { SkeletonKpiGrid } from '../../components/Skeleton';
import { relativeTime } from '../../utils/datetime';
import {
  AppCard, StatusBadge,
  TodayBanner, TodoCards, KpiRingCard, DayBars, RankBars, FoldSection, RoleChip,
  pctOf, pctTone,
} from '../../components/ui';
import useRecentDays from '../../hooks/useRecentDays';
import { PAGE_TITLES, UI_MESSAGES } from '../../constants/uiLabels';
import { PageTransition } from '../../lib/motion';

const REFRESH_INTERVAL_MS = 30_000;

export default function AffiliationDashboard() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [schools, setSchools] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [atRiskVehicles, setAtRiskVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notified, setNotified] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const requestInFlight = useRef(false);
  const recentDays = useRecentDays('reports');

  // Folds the banner/todo buttons can open. FoldSection owns its own open
  // state, so a fold is re-mounted (key) with defaultOpen when asked to open.
  const [openFold, setOpenFold] = useState({});
  const foldRefs = { schools: useRef(null), vehicles: useRef(null), emergencies: useRef(null) };
  function openAndScroll(name) {
    setOpenFold(prev => ({ ...prev, [name]: (prev[name] || 0) + 1 }));
    setTimeout(() => foldRefs[name].current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  const refreshDashboard = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setRefreshing(true);
    try {
      const [dashRes, schoolsRes, incRes, atRiskRes] = await Promise.all([
        api.get('/affiliation/dashboard').catch(() => null),
        api.get('/affiliation/schools').catch(() => null),
        api.get('/affiliation/emergencies?per_page=5&page=1').catch(() => null),
        api.get('/affiliation/vehicles-at-risk?limit=10').catch(() => null),
      ]);
      if (dashRes) {
        setData(dashRes.data.data);
        setLastUpdatedAt(new Date());
      }
      if (schoolsRes) {
        const schoolList = schoolsRes.data?.data;
        setSchools(Array.isArray(schoolList) ? schoolList : []);
      }
      if (incRes) {
        const incList = incRes.data?.data;
        setIncidents(Array.isArray(incList) ? incList : []);
      }
      if (atRiskRes) {
        const atRiskList = atRiskRes.data?.data;
        setAtRiskVehicles(Array.isArray(atRiskList) ? atRiskList : []);
      }
    } finally {
      requestInFlight.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshDashboard();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshDashboard();
    };
    const timer = setInterval(refreshWhenVisible, REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => {
      refreshWhenVisible();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshDashboard]);

  async function notifySchool(s) {
    const msg = `แจ้งเตือนจากสังกัด: โรงเรียน${s.school_name} ยังมีข้อมูลนักเรียนค้าง (เช้า ${s.morning_pending || 0} คน, เย็น ${s.evening_pending || 0} คน) กรุณาตรวจสอบและดำเนินการในระบบ`;
    try {
      await navigator.clipboard.writeText(msg);
      await api.post('/affiliation/notify-school', {
        school_id: s.school_id, school_name: s.school_name, message: msg, method: 'copy',
      });
      setNotified(prev => ({ ...prev, [s.school_id]: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) }));
      toast.success('คัดลอกข้อความแล้ว — ส่งผ่าน LINE/โทรศัพท์ได้เลย');
    } catch { toast.error('ไม่สำเร็จ'); }
  }

  const dateLabel = data?.date
    ? `วันที่ ${new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}`
    : null;
  const freshnessLabel = lastUpdatedAt
    ? `อัปเดตล่าสุด ${lastUpdatedAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`
    : null;

  return (
    <PageTransition>
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col gap-2">
        <RoleChip role="affiliation" />
        <PageHeader
          title={PAGE_TITLES.AFFILIATION_DASHBOARD}
          subtitle={data?.affiliation?.name}
          meta={[dateLabel, freshnessLabel].filter(Boolean).join(' · ') || undefined}
          icon={Map}
          iconColor="indigo"
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <Link to="/affiliation/live-vehicles" className="focus-ring inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl border border-surface-border bg-surface-raised text-sm font-medium text-ink hover:bg-surface transition">
                <Activity className="w-4 h-4" strokeWidth={2} aria-hidden="true" /> ตำแหน่งปัจจุบัน
              </Link>
              <Link to="/reports/daily" className="focus-ring inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl border border-surface-border bg-surface-raised text-sm font-medium text-ink hover:bg-surface transition">
                <FileText className="w-4 h-4" strokeWidth={2} aria-hidden="true" /> รายงาน
              </Link>
              <button
                type="button"
                onClick={refreshDashboard}
                disabled={refreshing}
                aria-label="รีเฟรชข้อมูลแดชบอร์ด"
                title="รีเฟรชข้อมูลแดชบอร์ด"
                className="focus-ring inline-flex h-11 w-11 items-center justify-center rounded-xl border border-surface-border bg-surface-raised text-ink-muted transition hover:bg-surface hover:text-ink disabled:cursor-wait disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          )}
        />
      </div>

      {loading ? (
        <SkeletonKpiGrid count={4} />
      ) : !data ? (
        <p className="text-ink-muted py-10 text-center">{UI_MESSAGES.NO_DATA}</p>
      ) : (() => {
        const problemSchools = data.schools_not_complete ?? [];
        const mTotal = data.morning_total ?? 0;
        const eTotal = data.evening_total ?? 0;
        const mDone = data.morning_done ?? 0;
        const eDone = data.evening_done ?? 0;
        const mPending = data.morning_pending ?? Math.max(0, mTotal - mDone);
        const ePending = data.evening_pending ?? Math.max(0, eTotal - eDone);
        const mPct = pctOf(mDone, mTotal);
        const ePct = pctOf(eDone, eTotal);
        const emerg7 = data.emergency_7d ?? data.recent_emergencies ?? 0;
        const schoolTotal = data.school_total ?? data.total_schools ?? schools.length;
        const usedRecently = data.school_used_recently ?? 0;

        // ── Banner: one sentence, one tone ──
        const notChecked = problemSchools.filter(s => (s.morning_done || 0) === 0 && (s.morning_expected || 0) > 0);
        let banner;
        if (mTotal + eTotal === 0 || (mDone === 0 && eDone === 0 && notChecked.length === 0)) {
          banner = { variant: 'neutral', title: 'ยังไม่เริ่มรอบวันนี้', sub: 'รอข้อมูลการเช็กชื่อรอบเช้าจากโรงเรียนในสังกัด' };
        } else if (notChecked.length > 0) {
          const names = notChecked.slice(0, 2).map(s => s.school_name).join(' · ');
          const more = notChecked.length > 2 ? ` และอีก ${notChecked.length - 2} โรงเรียน` : '';
          banner = {
            variant: 'danger',
            title: `${notChecked.length} โรงเรียนยังไม่เช็กชื่อรอบเช้า`,
            sub: `${names}${more}`,
            cta: { label: 'ดูโรงเรียนที่ต้องติดตาม', onClick: () => openAndScroll('schools') },
            topic: 'schools',
          };
        } else if (mPending + ePending > 0) {
          banner = {
            variant: 'warn',
            title: ePending > 0 && mPending === 0
              ? `รอบเย็นยังรอรับ ${ePending.toLocaleString('th-TH')} คน`
              : `ยังรอส่ง-รับอีก ${(mPending + ePending).toLocaleString('th-TH')} คน`,
            sub: `ส่งเช้าแล้ว ${mDone.toLocaleString('th-TH')} จาก ${mTotal.toLocaleString('th-TH')} คน`
              + (problemSchools.length > 0 ? ` · ${problemSchools.length} โรงเรียนยังมีรายการค้าง` : ''),
            cta: problemSchools.length > 0 ? { label: 'ดูโรงเรียนที่ต้องติดตาม', onClick: () => openAndScroll('schools') } : undefined,
            topic: 'schools',
          };
        } else {
          banner = { variant: 'success', title: 'ทุกโรงเรียนในสังกัดรับส่งครบแล้ว', sub: `ส่งเช้า ${mDone.toLocaleString('th-TH')} คน · รับเย็น ${eDone.toLocaleString('th-TH')} คน` };
        }

        // ── Todos: never repeat the banner's topic ──
        const todos = [
          banner.topic !== 'schools' && {
            key: 'risk-schools', variant: 'warn', count: data.at_risk_schools ?? 0,
            title: 'โรงเรียนที่ต้องติดตาม', sub: 'ยังมีนักเรียนรอส่งหรือรอรับ',
            cta: { label: 'ดูรายชื่อ', onClick: () => openAndScroll('schools') },
          },
          {
            key: 'risk-vehicles', variant: atRiskVehicles.some(v => v.risk_score >= 100) ? 'danger' : 'warn',
            count: atRiskVehicles.length,
            title: 'รถต้องแก้เอกสาร', sub: atRiskVehicles[0]?.risk_reasons?.[0] || 'ประกันหรือเอกสารรถต้องตรวจ',
            cta: { label: 'ดูรายการรถ', onClick: () => openAndScroll('vehicles') },
          },
          {
            key: 'missing-vehicle-data', variant: 'info', count: data.schools_missing_vehicle_data ?? 0,
            title: 'โรงเรียนข้อมูลรถไม่ครบถ้วน', sub: 'นักเรียนบางคนยังไม่ผูกกับรถ',
            cta: { label: 'ดูโรงเรียน', to: '/affiliation/schools' },
          },
          {
            key: 'not-using', variant: 'info', count: data.school_not_using_recently ?? 0,
            title: 'โรงเรียนยังไม่ใช้ระบบ', sub: 'ไม่มีข้อมูลเช็กชื่อใน 14 วัน',
            cta: { label: 'ดูโรงเรียน', to: '/affiliation/schools' },
          },
        ].filter(Boolean);

        // ── Rank: schools to follow, morning done/expected lowest first ──
        const rankRows = problemSchools
          .filter(s => (s.morning_expected || 0) > 0)
          .map(s => ({ s, pct: pctOf(s.morning_done || 0, s.morning_expected) }))
          .sort((a, b) => a.pct - b.pct)
          .slice(0, 6)
          .map(({ s, pct }) => ({
            key: s.school_id,
            label: s.school_name,
            width: pct,
            text: (s.morning_done || 0) === 0 ? 'ยังไม่เช็กชื่อ' : `${pct}% (${s.morning_done}/${s.morning_expected})`,
            variant: (s.morning_done || 0) === 0 ? 'danger' : pctTone(pct),
          }));

        const eveningNotStarted = eDone === 0 && mDone > 0;

        return (
        <>
          <TodayBanner variant={banner.variant} title={banner.title} sub={banner.sub} cta={banner.cta} />

          <TodoCards items={todos} />

          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiRingCard
              label="ส่งเช้า" pct={mPct} value="–" variant={mPct == null ? 'neutral' : pctTone(mPct)}
              sub={`${mDone.toLocaleString('th-TH')} / ${mTotal.toLocaleString('th-TH')} คน`}
            />
            {eveningNotStarted ? (
              <KpiRingCard label="รับเย็น" value="–" variant="neutral" chip="ยังไม่เริ่ม"
                sub={`ยังไม่เริ่มรอบ · ${eTotal.toLocaleString('th-TH')} คน`} />
            ) : (
              <KpiRingCard
                label="รับเย็น" pct={ePct} value="–" variant={ePct == null ? 'neutral' : pctTone(ePct)}
                sub={`${eDone.toLocaleString('th-TH')} / ${eTotal.toLocaleString('th-TH')} คน`}
              />
            )}
            <KpiRingCard
              label="โรงเรียนที่ใช้งาน" pct={pctOf(usedRecently, schoolTotal)} value="–" variant="info"
              sub={`${usedRecently} / ${schoolTotal} โรงเรียน · 14 วัน`}
            />
            <KpiRingCard
              label="เหตุฉุกเฉิน 7 วัน" value={emerg7}
              variant={emerg7 > 0 ? 'danger' : 'success'}
              chip={emerg7 > 0 ? 'ต้องรีบ' : 'ไม่มีเหตุ'}
              sub={emerg7 > 0 ? (incidents[0] ? `${incidents[0].plate_no || '-'} · ${relativeTime(incidents[0].reported_at)}` : 'ดูรายละเอียดด้านล่าง') : 'ไม่มีเหตุในสังกัด'}
              onClick={emerg7 > 0 ? () => openAndScroll('emergencies') : undefined}
            />
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DayBars
              title="การรับส่งทั้งสังกัด 7 วันล่าสุด (%)"
              days={recentDays || []}
              note={recentDays == null ? 'กำลังโหลด…' : undefined}
            />
            <RankBars
              title="โรงเรียนที่ต้องติดตาม"
              sub="ส่งเช้าวันนี้ เรียงจากน้อยไปมาก"
              rows={rankRows}
              empty="ทุกโรงเรียนส่งเช้าครบแล้ว"
              link={{ label: 'ดูทุกโรงเรียน', to: '/affiliation/schools' }}
            />
          </section>

          <section className="flex flex-col gap-3">
            <div ref={foldRefs.schools}>
              <FoldSection
                key={`schools-${openFold.schools || 0}`}
                defaultOpen={!!openFold.schools}
                title={`โรงเรียนที่ยังมีรายการค้าง ${problemSchools.length} โรงเรียน`}
                subtitle="ความคืบหน้ารายโรงเรียน พร้อมปุ่มแจ้งเตือนโรงเรียน"
              >
                {problemSchools.length === 0 ? (
                  <p className="py-6 text-center text-sm text-ink-muted">ไม่มีโรงเรียนค้าง</p>
                ) : (
                  <div className="space-y-3">
                    {problemSchools.map(s => (
                      <SchoolRiskRow
                        key={s.school_id}
                        school={s}
                        notifiedAt={notified[s.school_id]}
                        onNotify={() => notifySchool(s)}
                      />
                    ))}
                  </div>
                )}
              </FoldSection>
            </div>

            <SchoolReadinessFold schools={schools} totals={data} />

            <div ref={foldRefs.vehicles}>
              <FoldSection
                key={`vehicles-${openFold.vehicles || 0}`}
                defaultOpen={!!openFold.vehicles}
                title={`รถที่ต้องติดตาม ${atRiskVehicles.length} คัน`}
                subtitle="ประกันหรือเอกสารรถที่ต้องตรวจสอบ"
              >
                {atRiskVehicles.length === 0 ? (
                  <p className="py-6 text-center text-sm text-ink-muted">ไม่มีรถต้องติดตาม</p>
                ) : (
                  <ul className="divide-y divide-surface-border rounded-xl border border-surface-border">
                    {atRiskVehicles.map(v => (
                      <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                        <span className="inline-flex items-center gap-2 font-medium text-ink">
                          <Bus className="w-4 h-4 text-ink-muted" strokeWidth={2} aria-hidden="true" />{v.plate_no}
                        </span>
                        <StatusBadge variant={v.risk_score >= 100 ? 'danger' : 'warn'} size="sm">
                          {(v.risk_reasons || []).join(' · ') || `คะแนนความเสี่ยง ${v.risk_score}`}
                        </StatusBadge>
                      </li>
                    ))}
                  </ul>
                )}
              </FoldSection>
            </div>

            <div ref={foldRefs.emergencies}>
              <FoldSection
                key={`emergencies-${openFold.emergencies || 0}`}
                defaultOpen={!!openFold.emergencies}
                title="เหตุฉุกเฉินล่าสุด"
                subtitle={incidents.length > 0 ? `${incidents.length} รายการล่าสุด` : 'ไม่มีเหตุล่าสุด'}
              >
                {incidents.length === 0 ? (
                  <p className="py-6 text-center text-sm text-ink-muted">ไม่มีเหตุล่าสุด</p>
                ) : (
                  <ul className="divide-y divide-surface-border rounded-xl border border-surface-border">
                    {incidents.map(em => (
                      <li key={em.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                        <span className="inline-flex items-center gap-2 font-medium text-ink">
                          <AlertTriangle className="w-4 h-4 text-danger-ink" strokeWidth={2} aria-hidden="true" />{em.plate_no || '-'}
                        </span>
                        <span className="text-sm text-ink-muted">{relativeTime(em.reported_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Link to="/affiliation/emergencies" className="focus-ring mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-brand-700 hover:underline">
                  ดูเหตุฉุกเฉินทั้งหมด →
                </Link>
              </FoldSection>
            </div>
          </section>
        </>
        );
      })()}
    </div>
    </PageTransition>
  );
}

function SchoolReadinessFold({ schools, totals }) {
  const withData = schools.filter(s => Number(s.student_count) > 0).length;
  const loggedInWaiting = schools.filter(s => Number(s.student_count) === 0 && s.last_login_at).length;
  const notStarted = Math.max(0, schools.length - withData - loggedInWaiting);

  return (
    <FoldSection
      title="สถานะโรงเรียนในสังกัด"
      subtitle={`มีข้อมูล ${withData} · เข้าระบบแล้วรอนำเข้า ${loggedInWaiting} · ยังไม่เข้าใช้ ${notStarted} · รถ ${totals?.total_vehicles ?? 0} คัน (นับไม่ซ้ำคัน)`}
    >
      {schools.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">ยังไม่มีข้อมูลโรงเรียนในสังกัด</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-surface-border bg-surface-raised divide-y divide-surface-border">
          {schools.map(school => {
            const hasData = Number(school.student_count) > 0;
            const hasLoggedIn = Boolean(school.last_login_at);
            const status = hasData
              ? { variant: 'success', label: 'มีข้อมูลนักเรียนแล้ว' }
              : hasLoggedIn
                ? { variant: 'warn', label: 'เข้าสู่ระบบแล้ว รอนำเข้าข้อมูล' }
                : { variant: 'neutral', label: 'ยังไม่เข้าใช้' };
            return (
              <div key={school.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{school.name}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    นักเรียน {school.student_count ?? 0} คน · รถที่ผูกกับนักเรียน {school.vehicle_count ?? 0} คัน
                    {school.last_login_at ? ` · เข้าระบบ ${relativeTime(school.last_login_at)}` : ''}
                  </p>
                </div>
                <StatusBadge variant={status.variant} size="sm" className="self-start shrink-0 sm:self-auto">
                  {status.label}
                </StatusBadge>
              </div>
            );
          })}
        </div>
      )}
      <Link to="/affiliation/schools" className="focus-ring mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-brand-700 hover:underline">
        <Building2 className="w-4 h-4 mr-1.5" strokeWidth={2} aria-hidden="true" /> ไปหน้าโรงเรียนในสังกัด →
      </Link>
    </FoldSection>
  );
}

/* ── School risk row with notify CTA ── */
function SchoolRiskRow({ school: s, notifiedAt, onNotify }) {
  const mTotal = s.morning_expected || 0;
  const mDone = s.morning_done || 0;
  const mPend = s.morning_pending || 0;
  const mPct = mTotal > 0 ? Math.round((mDone / mTotal) * 100) : 0;
  const eTotal = s.evening_expected || 0;
  const eDone = s.evening_done || 0;
  const ePend = s.evening_pending || 0;
  const ePct = eTotal > 0 ? Math.round((eDone / eTotal) * 100) : 0;
  const totalPending = mPend + ePend;
  const level = totalPending > 50 ? 'high' : totalPending > 20 ? 'medium' : 'low';
  const RISK = {
    high:   { variant: 'danger', label: 'เสี่ยงสูง',     border: 'border-danger/30' },
    medium: { variant: 'warn',   label: 'เสี่ยงปานกลาง', border: 'border-warn/30'   },
    low:    { variant: 'success', label: 'เสี่ยงน้อย',    border: 'border-success/30' },
  }[level];

  return (
    <AppCard padding="md" className={RISK.border}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-base font-semibold text-ink truncate">{s.school_name}</p>
            <StatusBadge variant={RISK.variant} size="sm" icon={AlertTriangle} className="shrink-0">
              {RISK.label}
            </StatusBadge>
          </div>
          <div className="flex items-center gap-3 text-xs text-ink-muted mt-1">
            <span className="inline-flex items-center gap-1"><GraduationCap className="w-3.5 h-3.5" strokeWidth={2} /> {s.student_count ?? '-'} คน</span>
            <span className="inline-flex items-center gap-1"><Bus className="w-3.5 h-3.5" strokeWidth={2} /> {s.vehicle_count ?? '-'} คัน</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onNotify}
          className={`focus-ring shrink-0 inline-flex items-center gap-1.5 min-h-[44px] text-sm font-medium px-3 rounded-xl transition border ${
            notifiedAt
              ? 'bg-success-soft text-success-ink border-success/30'
              : 'bg-brand-50 text-brand-700 border-brand-200 hover:bg-brand-100'
          }`}
        >
          <BellRing className="w-4 h-4" strokeWidth={2} />
          {notifiedAt ? `แจ้งแล้ว ${notifiedAt}` : 'แจ้งเตือน'}
        </button>
      </div>

      <SessionBar icon={Sunrise} label="ส่งเช้า" done={mDone} total={mTotal} pending={mPend} pct={mPct} doneLabel="ส่งแล้ว" />
      <div className="h-2" />
      <SessionBar icon={Sunset}  label="รับเย็น" done={eDone} total={eTotal} pending={ePend} pct={ePct} doneLabel="รับแล้ว" />
    </AppCard>
  );
}

function SessionBar({ icon: Icon, label, done, total, pending, pct, doneLabel }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          <Icon className="w-4 h-4 text-ink-muted" strokeWidth={2} />{label}
        </span>
        <span className="text-ink-muted tabular-nums">{done}/{total} ({pct}%)</span>
      </div>
      <div className="flex w-full h-2.5 rounded-full overflow-hidden bg-surface">
        {done > 0 && <div className="bg-success h-full" style={{ width: `${pct}%` }} />}
        {pending > 0 && <div className="bg-danger/80 h-full" style={{ width: `${100 - pct}%` }} />}
      </div>
      <div className="flex justify-between text-xs mt-0.5">
        <span className="text-success-ink font-medium">{doneLabel} {done}</span>
        <span className="text-danger-ink font-medium">รอ {pending}</span>
      </div>
    </div>
  );
}
