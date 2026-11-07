import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Map, Building2, GraduationCap, Bus, AlertTriangle, BellRing, Activity, FileText, RefreshCw, ChevronRight,
} from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import PageHeader from '../../components/PageHeader';
import { SkeletonKpiGrid } from '../../components/Skeleton';
import { relativeTime } from '../../utils/datetime';
import { StatusBadge, AlertBanner, DayBars, FoldSection, RoleChip } from '../../components/ui';
import {
  StatusHero, ActionList, StatTile, StatGrid, SectionCard, TravelLeaveSummary,
  roundStatus, dayStatus, SESSION_LABEL,
} from '../../components/dashboard';
import useRecentDays, { RECENT_DAYS_FAILED } from '../../hooks/useRecentDays';
import { PAGE_TITLES, UI_MESSAGES } from '../../constants/uiLabels';
import { PageTransition } from '../../lib/motion';

const REFRESH_INTERVAL_MS = 30_000;
const AT_RISK_LIST_LIMIT = 10;
const SCHOOL_LIST_VISIBLE = 5;

// What each feed is called in the load-failure banner.
const SECTION_LABELS = {
  dashboard: 'ภาพรวมวันนี้',
  schools: 'สถานะโรงเรียนในสังกัด',
  incidents: 'เหตุฉุกเฉินล่าสุด',
  atRisk: 'รถที่ต้องติดตาม',
};
const UNAVAILABLE_SUB = 'โหลดข้อมูลไม่สำเร็จ';
const num = n => Number(n || 0).toLocaleString('th-TH');

// Resolve to { ok, res } instead of throwing, so one failed feed does not hide
// the others and is never mistaken for an empty one.
const settle = promise => promise.then(res => ({ ok: true, res }), () => ({ ok: false }));

/**
 * Which schools need a phone call, and why. Uses the same time-aware rule as
 * the hero (roundStatus): a school is only listed for a round that is past its
 * due time (amber) or closed today / an earlier day (red / amber). Before or
 * during a round nobody is "late", so the list stays empty and calm.
 */
function schoolFollowUps(problemSchools, { date, isSchoolDay }) {
  const rows = [];
  for (const s of problemSchools) {
    const reasons = [];
    let worst = 'warn';
    let notStarted = false;
    let pending = 0;
    for (const session of ['morning', 'evening']) {
      const done = s[`${session}_done`] || 0;
      const expected = s[`${session}_expected`] || 0;
      const st = roundStatus({ session, done, expected, date, isSchoolDay });
      if (st.tone !== 'warn' && st.tone !== 'danger') continue;
      pending += st.pending;
      if (st.tone === 'danger') worst = 'danger';
      if (done === 0) {
        notStarted = true;
        reasons.push(`ยังไม่เช็กชื่อ${SESSION_LABEL[session]} (${num(expected)} คน)`);
      } else {
        reasons.push(`${SESSION_LABEL[session]}ค้าง ${num(st.pending)} คน (${num(done)}/${num(expected)})`);
      }
    }
    if (reasons.length === 0) continue;
    rows.push({ school: s, reasons, tone: worst, notStarted, pending });
  }
  return rows.sort((a, b) =>
    (Number(b.notStarted) - Number(a.notStarted)) || (b.pending - a.pending));
}

export default function AffiliationDashboard() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [schools, setSchools] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [atRiskVehicles, setAtRiskVehicles] = useState([]);
  // Full at-risk count; the list itself is capped at AT_RISK_LIST_LIMIT (QA aff-01).
  const [atRiskTotal, setAtRiskTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // section key -> true while its last request failed; those sections show "—"
  const [failed, setFailed] = useState({});
  const [notified, setNotified] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [showAllSchools, setShowAllSchools] = useState(false);
  const requestInFlight = useRef(false);
  const recentDays = useRecentDays('reports');

  // Folds the hero / action buttons can open. FoldSection owns its own open
  // state, so a fold is re-mounted (key) with defaultOpen when asked to open.
  const [openFold, setOpenFold] = useState({});
  const foldRefs = { schools: useRef(null), vehicles: useRef(null), emergencies: useRef(null) };
  function openAndScroll(name) {
    if (name === 'schools') setShowAllSchools(true);
    else setOpenFold(prev => ({ ...prev, [name]: (prev[name] || 0) + 1 }));
    setTimeout(() => foldRefs[name].current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  const refreshDashboard = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setRefreshing(true);
    try {
      const [dash, schoolsRes, incRes, atRiskRes] = await Promise.all([
        settle(api.get('/affiliation/dashboard')),
        settle(api.get('/affiliation/schools')),
        settle(api.get('/affiliation/emergencies?per_page=5&page=1')),
        settle(api.get(`/affiliation/vehicles-at-risk?limit=${AT_RISK_LIST_LIMIT}`)),
      ]);
      if (dash.ok) {
        setData(dash.res.data.data);
        setLastUpdatedAt(new Date());
      }
      if (schoolsRes.ok) {
        const schoolList = schoolsRes.res.data?.data;
        setSchools(Array.isArray(schoolList) ? schoolList : []);
      }
      if (incRes.ok) {
        const incList = incRes.res.data?.data;
        setIncidents(Array.isArray(incList) ? incList : []);
      }
      if (atRiskRes.ok) {
        const atRiskList = atRiskRes.res.data?.data;
        const list = Array.isArray(atRiskList) ? atRiskList : [];
        setAtRiskVehicles(list);
        const total = Number(atRiskRes.res.data?.meta?.total);
        setAtRiskTotal(Number.isFinite(total) ? total : list.length);
      }
      setFailed({
        dashboard: !dash.ok, schools: !schoolsRes.ok, incidents: !incRes.ok, atRisk: !atRiskRes.ok,
      });
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
  const failedSections = Object.keys(SECTION_LABELS).filter(key => failed[key]);
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

      {!loading && failedSections.length > 0 && (
        <AlertBanner variant="danger" title="โหลดข้อมูลบางส่วนไม่สำเร็จ">
          <div className="space-y-2">
            <p>ส่วนที่โหลดไม่ได้: {failedSections.map(key => SECTION_LABELS[key]).join(' · ')} — ตัวเลขของส่วนนี้แสดงเป็น “—” จนกว่าจะโหลดสำเร็จ</p>
            <button
              type="button"
              onClick={refreshDashboard}
              disabled={refreshing}
              className="focus-ring inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-danger/40 bg-surface-raised px-4 text-sm font-semibold text-danger-ink transition hover:bg-danger-soft disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} strokeWidth={2} aria-hidden="true" />
              ลองใหม่
            </button>
          </div>
        </AlertBanner>
      )}

      {loading ? (
        <SkeletonKpiGrid count={4} />
      ) : !data && !failed.dashboard ? (
        <p className="text-ink-muted py-10 text-center">{UI_MESSAGES.NO_DATA}</p>
      ) : (() => {
        // A failed dashboard feed must read "—", not the zeros an empty object
        // would produce; the other feeds still render if they loaded.
        const dashOk = !failed.dashboard;
        const today = dashOk ? data : {};
        const problemSchools = today.schools_not_complete ?? [];
        const emerg7 = today.emergency_7d ?? today.recent_emergencies ?? 0;
        const schoolTotal = today.school_total ?? today.total_schools ?? schools.length;
        const usedRecently = today.school_used_recently ?? 0;
        // No school-day calendar exists; the backend flags Saturday/Sunday as
        // not a school day, and then nothing is "late" (QA aff-04).
        const isSchoolDay = dashOk ? today.is_school_day : undefined;
        const offDay = dashOk && isSchoolDay === false;
        const when = { date: today.date, isSchoolDay };

        // ── Hero: one status per round, time-aware ──
        const mStatus = roundStatus({
          session: 'morning', done: today.morning_done, expected: today.morning_total,
          ...when, unavailable: !dashOk,
        });
        const eStatus = roundStatus({
          session: 'evening', done: today.evening_done, expected: today.evening_total,
          ...when, unavailable: !dashOk,
        });
        const day = dayStatus([mStatus, eStatus], { emergencies: 0 });

        // ── Schools: complete / in progress / not started (holiday-aware) ──
        const follow = dashOk ? schoolFollowUps(problemSchools, when) : [];
        const activeSession = ['open', 'overdue', 'closed'].includes(eStatus.phase) ? 'evening' : 'morning';
        const schoolsInPlay = schools.filter(s => Number(s.student_count) > 0).length;
        const sessionRows = problemSchools.filter(s => (s[`${activeSession}_expected`] || 0) > 0 && (s[`${activeSession}_done`] || 0) < s[`${activeSession}_expected`]);
        const sNotStarted = sessionRows.filter(s => (s[`${activeSession}_done`] || 0) === 0).length;
        const sInProgress = sessionRows.length - sNotStarted;
        const sComplete = Math.max(0, schoolsInPlay - sessionRows.length);
        const showSchoolCounts = dashOk && !failed.schools && !offDay && schoolsInPlay > 0;

        const heroAction = follow.length > 0
          ? { label: 'ดูโรงเรียนที่ต้องติดตาม', onClick: () => openAndScroll('schools') }
          : undefined;

        // ── ActionList: each row says what to do ──
        const notStartedRows = follow.filter(f => f.notStarted);
        const followOthers = follow.filter(f => !f.notStarted);
        const notStartedTone = notStartedRows.some(f => f.tone === 'danger') ? 'danger' : 'warn';
        const names = list => list.slice(0, 2).map(f => f.school.school_name).join(' · ')
          + (list.length > 2 ? ` และอีก ${list.length - 2} โรงเรียน` : '');
        const riskDanger = atRiskVehicles.some(v => v.risk_score >= 100);
        const todos = [
          {
            key: 'emergencies', tone: 'danger', count: emerg7,
            title: 'เหตุฉุกเฉินใน 7 วันที่ผ่านมา',
            sub: failed.incidents && !dashOk ? UNAVAILABLE_SUB : 'ตรวจสอบเหตุและผลการแก้ไขกับโรงเรียน/คนขับ',
            unavailable: !dashOk,
            to: '/affiliation/emergencies', actionLabel: 'ดูเหตุฉุกเฉิน',
          },
          {
            key: 'not-started', tone: notStartedTone, count: notStartedRows.length,
            title: 'โรงเรียนยังไม่เช็กชื่อ',
            sub: dashOk ? `โทรหรือแจ้งโรงเรียนให้เช็กชื่อ · ${names(notStartedRows)}` : UNAVAILABLE_SUB,
            unavailable: !dashOk,
            onClick: () => openAndScroll('schools'), actionLabel: 'ดูรายชื่อ',
          },
          {
            key: 'follow', tone: 'warn', count: followOthers.length,
            title: 'โรงเรียนที่ยังมีนักเรียนค้าง',
            sub: dashOk ? `ติดตามให้โรงเรียนยืนยันที่เหลือ · ${names(followOthers)}` : UNAVAILABLE_SUB,
            unavailable: !dashOk,
            onClick: () => openAndScroll('schools'), actionLabel: 'ดูรายชื่อ',
          },
          {
            key: 'risk-vehicles', tone: riskDanger ? 'danger' : 'warn', count: atRiskTotal,
            title: 'รถต้องแก้เอกสาร',
            sub: failed.atRisk
              ? UNAVAILABLE_SUB
              : `ประกันหรือผลตรวจสภาพหมดอายุ — แจ้งเจ้าของรถให้ต่ออายุ${atRiskVehicles[0]?.risk_reasons?.[0] ? ` · เช่น ${atRiskVehicles[0].risk_reasons[0]}` : ''}`,
            unavailable: !!failed.atRisk,
            onClick: () => openAndScroll('vehicles'), actionLabel: 'ดูรายการรถ',
          },
          {
            key: 'missing-vehicle-data', tone: 'info', count: today.schools_missing_vehicle_data ?? 0,
            title: 'โรงเรียนที่ผูกนักเรียนกับรถไม่ครบ',
            sub: dashOk ? `จาก ${num(schoolTotal)} โรงเรียน · แจ้งโรงเรียนให้ผูกรถให้นักเรียนที่ใช้รถ` : UNAVAILABLE_SUB,
            unavailable: !dashOk,
            to: '/affiliation/schools', actionLabel: 'ดูโรงเรียน',
          },
          {
            key: 'not-using', tone: 'info', count: today.school_not_using_recently ?? 0,
            title: 'โรงเรียนที่ยังไม่เริ่มใช้ระบบ',
            sub: dashOk ? `จาก ${num(schoolTotal)} โรงเรียน · ไม่มีการเช็กชื่อใน 14 วัน ติดต่อให้เริ่มเช็กชื่อ` : UNAVAILABLE_SUB,
            unavailable: !dashOk,
            to: '/affiliation/schools', actionLabel: 'ดูโรงเรียน',
          },
        ];

        const visibleFollow = showAllSchools ? follow : follow.slice(0, SCHOOL_LIST_VISIBLE);

        return (
        <>
          <StatusHero
            eyebrow={[today.affiliation?.name, dateLabel].filter(Boolean).join(' · ') || undefined}
            rounds={[
              { status: mStatus, title: 'รอบเช้า · ส่งถึงโรงเรียน' },
              { status: eStatus, title: 'รอบเย็น · ส่งถึงบ้าน' },
            ]}
            day={day}
            action={heroAction}
          >
            {showSchoolCounts && (
              <p className="mt-4 text-sm text-ink" aria-label={`สถานะโรงเรียน ${SESSION_LABEL[activeSession]}`}>
                <span className="font-semibold">{SESSION_LABEL[activeSession]} · {num(schoolsInPlay)} โรงเรียน:</span>{' '}
                เช็กชื่อครบ <b className="tabular-nums">{num(sComplete)}</b>
                {' · '}ยังค้าง <b className="tabular-nums">{num(sInProgress)}</b>
                {' · '}ยังไม่เริ่ม <b className="tabular-nums">{num(sNotStarted)}</b>
              </p>
            )}
            {offDay && <p className="mt-4 text-sm text-ink-muted">วันนี้เป็นวันหยุด ไม่ต้องติดตามโรงเรียน</p>}
          </StatusHero>

          <ActionList items={todos} afterAlert={day.tone === 'warn' || day.tone === 'danger'} />

          <div ref={foldRefs.schools}>
            <SectionCard
              title="โรงเรียนที่ต้องติดตาม"
              sub="เรียงจากโรงเรียนที่ยังไม่เช็กชื่อและมีนักเรียนค้างมากที่สุด"
              empty={follow.length === 0}
            >
              <ul className="flex flex-col gap-2">
                {visibleFollow.map(f => (
                  <FollowRow
                    key={f.school.school_id}
                    row={f}
                    notifiedAt={notified[f.school.school_id]}
                    onNotify={() => notifySchool(f.school)}
                  />
                ))}
              </ul>
              {follow.length > SCHOOL_LIST_VISIBLE && (
                <button
                  type="button"
                  onClick={() => setShowAllSchools(v => !v)}
                  className="focus-ring mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-brand-700 hover:underline"
                >
                  {showAllSchools ? 'แสดงเฉพาะ 5 โรงเรียนแรก' : `แสดงทั้งหมด ${num(follow.length)} โรงเรียน`}
                </button>
              )}
            </SectionCard>
          </div>

          <StatGrid label="ตัวเลขหลักวันนี้">
            <StatTile
              label="โรงเรียนที่ใช้ระบบ" icon={Building2}
              value={usedRecently} unit={`/ ${num(schoolTotal)}`}
              sub="เช็กชื่อภายใน 14 วัน" unavailable={!dashOk}
              to="/affiliation/schools"
            />
            <StatTile label="นักเรียนที่ใช้รถ" icon={GraduationCap} value={today.total_students} unit="คน" unavailable={!dashOk} />
            <StatTile label="รถ" icon={Bus} value={today.total_vehicles} unit="คัน" sub="นับไม่ซ้ำคัน" unavailable={!dashOk} to="/affiliation/vehicles" />
            <StatTile
              label="เหตุฉุกเฉิน 7 วัน" icon={AlertTriangle}
              value={emerg7} unit="ครั้ง" unavailable={!dashOk}
              tone={emerg7 > 0 ? 'danger' : 'calm'}
              sub={emerg7 > 0 ? 'ดูรายละเอียดเพื่อติดตามผล' : 'ไม่มีเหตุในสังกัด'}
              to={emerg7 > 0 ? '/affiliation/emergencies' : undefined}
            />
          </StatGrid>

          <TravelLeaveSummary data={dashOk ? today : {}} />

          <section className="flex flex-col gap-3">
            <DayBars
              title="การรับส่งทั้งสังกัด 7 วันล่าสุด (%)"
              days={recentDays || []}
              failed={recentDays === RECENT_DAYS_FAILED}
              note={recentDays == null ? 'กำลังโหลด…' : undefined}
            />

            <SchoolReadinessFold schools={schools} totals={today} schoolsFailed={!!failed.schools} totalsFailed={!dashOk} />

            <div ref={foldRefs.vehicles}>
              <FoldSection
                key={`vehicles-${openFold.vehicles || 0}`}
                defaultOpen={!!openFold.vehicles}
                title={`รถที่ต้องติดตาม ${failed.atRisk ? '—' : atRiskTotal.toLocaleString('th-TH')} คัน`}
                subtitle={atRiskTotal > atRiskVehicles.length
                  ? `ประกันหรือเอกสารรถที่ต้องตรวจสอบ · แสดง ${atRiskVehicles.length} คันที่เร่งด่วนที่สุด`
                  : 'ประกันหรือเอกสารรถที่ต้องตรวจสอบ'}
              >
                {failed.atRisk ? (
                  <p className="py-6 text-center text-sm text-ink-muted">{UNAVAILABLE_SUB}</p>
                ) : atRiskVehicles.length === 0 ? (
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
                <Link to="/affiliation/vehicles" className="focus-ring mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-brand-700 hover:underline">
                  ไปหน้ารถในสังกัด →
                </Link>
              </FoldSection>
            </div>

            <div ref={foldRefs.emergencies}>
              <FoldSection
                key={`emergencies-${openFold.emergencies || 0}`}
                defaultOpen={!!openFold.emergencies}
                title="เหตุฉุกเฉินล่าสุด"
                subtitle={failed.incidents ? UNAVAILABLE_SUB : incidents.length > 0 ? `${incidents.length} รายการล่าสุด` : 'ไม่มีเหตุล่าสุด'}
              >
                {failed.incidents ? (
                  <p className="py-6 text-center text-sm text-ink-muted">{UNAVAILABLE_SUB}</p>
                ) : incidents.length === 0 ? (
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

/* ── One school to follow up: why, and what to do ── */
function FollowRow({ row, notifiedAt, onNotify }) {
  const { school: s, reasons, tone } = row;
  const border = tone === 'danger' ? 'border-danger/30' : 'border-warn/30';
  return (
    <li className={`rounded-2xl border bg-surface-raised p-3 sm:p-4 ${border}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold text-ink text-pretty">{s.school_name}</p>
          {reasons.map(r => (
            <p key={r} className={`text-sm text-pretty ${tone === 'danger' ? 'text-danger-ink' : 'text-warn-ink'}`}>{r}</p>
          ))}
          <p className="mt-0.5 text-xs text-ink-muted">
            นักเรียน {s.student_count ?? '-'} คน · รถ {s.vehicle_count ?? '-'} คัน
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={onNotify}
            className={`focus-ring inline-flex items-center gap-1.5 min-h-[44px] text-sm font-medium px-3 rounded-xl transition border ${
              notifiedAt
                ? 'bg-success-soft text-success-ink border-success/30'
                : 'bg-brand-50 text-brand-700 border-brand-200 hover:bg-brand-100'
            }`}
          >
            <BellRing className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
            {notifiedAt ? `แจ้งแล้ว ${notifiedAt}` : 'คัดลอกข้อความแจ้งโรงเรียน'}
          </button>
          <Link
            to="/affiliation/status"
            className="focus-ring inline-flex items-center gap-1 min-h-[44px] text-sm font-medium px-3 rounded-xl border border-surface-border bg-surface-raised text-ink hover:bg-surface transition"
          >
            ดูสถานะรายคัน <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </li>
  );
}

function SchoolReadinessFold({ schools, totals, schoolsFailed, totalsFailed }) {
  const withData = schools.filter(s => Number(s.student_count) > 0).length;
  const loggedInWaiting = schools.filter(s => Number(s.student_count) === 0 && s.last_login_at).length;
  const notStarted = Math.max(0, schools.length - withData - loggedInWaiting);
  const schoolCounts = schoolsFailed
    ? 'มีข้อมูล — · เข้าระบบแล้วรอนำเข้า — · ยังไม่เข้าใช้ —'
    : `มีข้อมูล ${withData} · เข้าระบบแล้วรอนำเข้า ${loggedInWaiting} · ยังไม่เข้าใช้ ${notStarted}`;
  const vehicleCount = totalsFailed ? '—' : (totals?.total_vehicles ?? 0);

  return (
    <FoldSection
      title="สถานะโรงเรียนในสังกัด"
      subtitle={`${schoolCounts} · รถ ${vehicleCount} คัน (นับไม่ซ้ำคัน)`}
    >
      {schoolsFailed ? (
        <p className="py-6 text-center text-sm text-ink-muted">โหลดข้อมูลไม่สำเร็จ</p>
      ) : schools.length === 0 ? (
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
