import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, Bus, AlertTriangle, ChevronDown, Users,
  // Phase 10.7E-1 — icons for the action row
  Search, FileText,
  // Phase 10.8C — override button icon
  CheckCircle2, RefreshCw,
} from 'lucide-react';
import api from '../../api/axios';
import StudentStatusTable from '../../components/StudentStatusTable';
import { useToast } from '../../components/Toast';
import PlateSearchInput from '../../components/PlateSearchInput';
import PageHeader from '../../components/PageHeader';
import SchoolOverrideModal from '../../components/SchoolOverrideModal';
import {
  AppCard, StatusBadge, ConfirmDialog, AlertBanner,
  DayBars, RankBars, FoldSection, RoleChip,
  pctOf, pctTone,
} from '../../components/ui';
import {
  PAGE_TITLES, SECTION_TITLES, STATUS, UI_MESSAGES,
} from '../../constants/uiLabels';
// Phase 10.7E-1 — teacher (grade-scoped) accounts are read-only; the
// SchoolLayout already renders a scope chip above every school page. We only
// use isGradeTeacher() to hide write-only actions from teacher accounts.
import { useAuth } from '../../hooks/useAuth';
import useRecentDays, { RECENT_DAYS_FAILED } from '../../hooks/useRecentDays';
import { isGradeTeacher, getGradeScope } from '../../utils/authScope';
import {
  StatusHero, ActionList, StatTile, StatGrid, SectionCard, TravelLeaveSummary,
  roundStatus, dayStatus,
} from '../../components/dashboard';
import { PageTransition } from '../../lib/motion';
import { formatGradeClass } from '../../utils/student';

// What each feed is called in the load-failure banner.
const SECTION_LABELS = {
  dashboard: 'ตัวเลขภาพรวมวันนี้',
  status: 'สถานะรถรายคัน',
  leaves: 'รายการลา',
  roster: 'คำขอรายชื่อจากคนขับ',
};
const UNAVAILABLE_SUB = 'โหลดข้อมูลไม่สำเร็จ';

// Resolve to { ok, value } instead of throwing, so one failed feed does not
// hide the others and is never mistaken for an empty one.
const settle = promise => promise.then(r => ({ ok: true, value: r.data.data }), () => ({ ok: false }));

const isMorningLeave = (s) => s.leave_session === 'morning' || s.leave_session === 'both';
const isEveningLeave = (s) => s.leave_session === 'evening' || s.leave_session === 'both';

/** Riders expected and done on one bus for one round (leave excluded). */
function vehicleRound(vehicle, session) {
  const students = vehicle.students || [];
  const expected = session === 'evening'
    ? students.filter(s => s.evening_enabled && !isEveningLeave(s) && !s.evening_self)
    : students.filter(s => s.morning_enabled && !isMorningLeave(s) && !s.morning_self);
  const done = expected.filter(s => (session === 'evening' ? s.evening_done : s.morning_done)).length;
  return { expected: expected.length, done, pending: expected.length - done };
}

export default function SchoolDashboard() {
  const { user } = useAuth();
  const isTeacher = isGradeTeacher(user);
  const toast = useToast();

  const [data, setData] = useState(null);
  const [statusData, setStatusData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedVehicle, setExpandedVehicle] = useState(null);
  const [plateSearch, setPlateSearch] = useState('');
  // Phase 10.8C — override modal open state. Refetches the feeds on save so
  // the banner, KPIs and per-vehicle list all reflect the new row at once.
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [leaves, setLeaves] = useState([]);
  const [leaveLoading, setLeaveLoading] = useState({});
  // Pending roster requests (driver asks to add/remove a rider). null = unknown.
  const [rosterPending, setRosterPending] = useState(null);
  // section key -> true while its last request failed; those sections show "—"
  const [failed, setFailed] = useState({});
  const [retrying, setRetrying] = useState(false);
  // A fold opened from the banner / a todo button is re-mounted open (its key
  // changes) and scrolled into view.
  const [forced, setForced] = useState({ vehicles: 0, leaves: 0 });
  const vehiclesRef = useRef(null);
  const leavesRef = useRef(null);

  const recentDays = useRecentDays('reports', 7);

  function refetchDashboard() {
    return Promise.all([
      settle(api.get('/school/dashboard')),
      settle(api.get('/school/status-today')),
      settle(api.get('/school/leaves')),
    ]).then(([dash, status, lv]) => {
      if (dash.ok) setData(dash.value);
      if (status.ok) setStatusData(status.value);
      if (lv.ok) setLeaves(lv.value || []);
      setFailed(prev => ({ ...prev, dashboard: !dash.ok, status: !status.ok, leaves: !lv.ok }));
    });
  }

  useEffect(() => {
    refetchDashboard().finally(() => setLoading(false));
  }, []);

  const loadRosterPending = useCallback(() => {
    // Grade teachers cannot approve requests, so the count would be a dead end.
    if (isTeacher) return Promise.resolve();
    return api.get('/school/roster-requests', { params: { status: 'pending' } })
      .then(r => {
        setRosterPending(Number(r.data?.meta?.total ?? (r.data?.data || []).length) || 0);
        setFailed(prev => ({ ...prev, roster: false }));
      })
      .catch(() => setFailed(prev => ({ ...prev, roster: true })));
  }, [isTeacher]);

  useEffect(() => { loadRosterPending(); }, [loadRosterPending]);

  function retryFailed() {
    setRetrying(true);
    Promise.all([refetchDashboard(), loadRosterPending()]).finally(() => setRetrying(false));
  }

  // Cancelling a leave is destructive and was behind a bare confirm(), which
  // could not name the pupil or the date being cancelled.
  const [confirmLeave, setConfirmLeave] = useState(null);

  async function handleCancelLeave(leaveId) {
    if (!leaveId) return;
    setConfirmLeave(null);
    setLeaveLoading(prev => ({ ...prev, [leaveId]: true }));
    try {
      await api.delete(`/school/leaves/${leaveId}`);
      toast.success('ยกเลิกการลาสำเร็จ');
      setLeaves(prev => prev.filter(l => l.id !== leaveId));
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถยกเลิกการลาได้');
    } finally {
      setLeaveLoading(prev => ({ ...prev, [leaveId]: false }));
    }
  }

  function toggleVehicle(vehicleId) {
    setExpandedVehicle(prev => (prev === vehicleId ? null : vehicleId));
  }

  function openFold(name, ref) {
    setForced(prev => ({ ...prev, [name]: prev[name] + 1 }));
    // Wait for the re-mounted (open) section to render before scrolling.
    setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  const failedSections = Object.keys(SECTION_LABELS).filter(key => failed[key]);
  // A failed dashboard feed must read "—", never the zeros a missing payload
  // would default to. `dash` is null whenever the last load of it failed.
  const dashOk = !failed.dashboard;
  const dash = dashOk ? data : null;

  const vehicles = statusData?.vehicles || [];
  const filtered = vehicles.filter(v => !plateSearch || v.plate_no.toLowerCase().includes(plateSearch.toLowerCase()));

  // ── Today's numbers ───────────────────────────────────────────────────────
  // After the API's decorateDaily, *_total already excludes leave and
  // self-travel, so it IS the expected count (do not subtract leave again).
  const mLeave = dash?.morning_leave ?? 0;
  const eLeave = dash?.evening_leave ?? 0;
  const emerg7d = dash?.recent_emergencies ?? 0;
  const gradeScope = getGradeScope(user);

  const roundOpts = { date: dash?.date, isSchoolDay: dash?.is_school_day, unavailable: !dashOk };
  const morning = roundStatus({ session: 'morning', done: dash?.morning_done, expected: dash?.morning_total, conflict: dash?.morning_conflict, ...roundOpts });
  const evening = roundStatus({ session: 'evening', done: dash?.evening_done, expected: dash?.evening_total, conflict: dash?.evening_conflict, ...roundOpts });
  const day = dashOk ? dayStatus([morning, evening]) : null;

  // The round that needs attention now (hero focus), else the one in progress.
  const rankSession = day?.focus
    || ([morning, evening].find(r => r.pending > 0 && ['in_progress', 'waiting', 'overdue', 'not_delivered'].includes(r.state))?.session)
    || (['open', 'overdue', 'closed'].includes(evening.phase) ? 'evening' : 'morning');
  const focusRound = rankSession === 'evening' ? evening : morning;
  const focusName = rankSession === 'evening' ? 'รอบเย็น' : 'รอบเช้า';

  // Hero action: grade teachers go and check names; the school opens the buses still waiting.
  const hasPending = dashOk && focusRound.pending > 0 && ['in_progress', 'overdue', 'not_delivered', 'incomplete_record'].includes(focusRound.state);
  let heroAction;
  if (hasPending) {
    heroAction = isTeacher
      ? { label: 'เช็กชื่อวันนี้', to: '/school/teacher-check' }
      : { label: 'ดูรถที่ยังค้าง', onClick: () => openFold('vehicles', vehiclesRef) };
  }

  // ── ต้องทำวันนี้ ───────────────────────────────────────────────────────────
  const c = dash?.completeness;
  const noVehicle = c && Number.isFinite(c.students_total) && Number.isFinite(c.students_with_vehicle)
    ? Math.max(0, c.students_total - c.students_with_vehicle) : 0;
  const noParent = c && Number.isFinite(c.students_total) && Number.isFinite(c.students_with_parent)
    ? Math.max(0, c.students_total - c.students_with_parent) : 0;
  const actions = [
    { key: 'emergency', tone: 'danger', count: emerg7d, title: 'เหตุฉุกเฉินใน 7 วัน', sub: dashOk ? 'ตรวจรายละเอียดและผลการแก้ไข' : UNAVAILABLE_SUB, unavailable: !dashOk, to: '/school/emergencies', actionLabel: 'ดูเหตุฉุกเฉิน' },
    !isTeacher && (failed.roster || rosterPending != null) && { key: 'roster', tone: 'warn', count: rosterPending ?? 0, title: 'คำขอรายชื่อจากคนขับ รอโรงเรียนอนุมัติ', sub: failed.roster ? UNAVAILABLE_SUB : 'คนขับขอเพิ่มหรือลบนักเรียนในรถ', unavailable: !!failed.roster, to: '/school/approvals', actionLabel: 'ตรวจคำขอ' },
    { key: 'no-vehicle', tone: 'warn', count: noVehicle, title: 'นักเรียนที่ยังไม่ผูกกับรถ', sub: dashOk ? 'เลือกรถให้นักเรียน เพื่อให้นับในการรับส่ง' : UNAVAILABLE_SUB, unavailable: !dashOk, to: '/school/students?has_vehicle=no', actionLabel: 'ดูรายชื่อ' },
    { key: 'no-parent', tone: 'info', count: noParent, title: 'นักเรียนที่ข้อมูลผู้ปกครองไม่ครบ', sub: dashOk ? 'เติมเบอร์ผู้ปกครองเพื่อให้แจ้งเตือนได้' : UNAVAILABLE_SUB, unavailable: !dashOk, to: '/school/students', actionLabel: 'ดูรายชื่อ' },
    !isTeacher && { key: 'leaves', tone: 'info', count: leaves.length, title: 'รายการลาของวันนี้', sub: failed.leaves ? UNAVAILABLE_SUB : 'ยกเลิกได้หากบันทึกผิด', unavailable: !!failed.leaves, onClick: failed.leaves ? undefined : () => openFold('leaves', leavesRef), actionLabel: 'ดูรายการลา' },
  ].filter(Boolean);

  // ── Buses / pupils still waiting in the round in focus ────────────────────
  const waitingBuses = vehicles
    .map(v => ({ v, r: vehicleRound(v, rankSession) }))
    .filter(x => x.r.pending > 0)
    .sort((a, b) => b.r.pending - a.r.pending);
  const waitingPupils = vehicles.flatMap(v => (v.students || []).filter(s => (
    rankSession === 'evening'
      ? s.evening_enabled && !isEveningLeave(s) && !s.evening_self && !s.evening_done
      : s.morning_enabled && !isMorningLeave(s) && !s.morning_self && !s.morning_done
  )));
  const roundNotRunning = ['not_yet', 'off_day', 'no_riders', 'unavailable'].includes(focusRound.state);

  const rankRows = vehicles
    .map(v => ({ v, r: vehicleRound(v, rankSession) }))
    .filter(x => x.r.expected > 0)
    .sort((a, b) => (b.r.pending - a.r.pending) || (a.r.done / a.r.expected - b.r.done / b.r.expected))
    .slice(0, 6)
    .map(({ v, r }) => {
      const pct = pctOf(r.done, r.expected);
      return {
        key: v.vehicle_id || v.plate_no,
        label: v.plate_no || 'ยังไม่ระบุรถ',
        width: pct ?? 0,
        text: `${r.done}/${r.expected} คน`,
        variant: pctTone(pct),
      };
    });

  // Data completeness, one number for the fold's subtitle.
  const completenessPct = (() => {
    if (!c) return null;
    const items = [
      { done: c.students_with_vehicle, total: c.students_total },
      { done: c.students_with_parent,  total: c.students_total },
      { done: c.vehicles_inspected,    total: c.vehicles_total },
      { done: c.vehicles_insured,      total: c.vehicles_total },
    ];
    // Only fields the backend actually sent — a missing one would give NaN.
    const usable = items.filter(i => Number.isFinite(i.done) && Number.isFinite(i.total));
    return usable.length
      ? Math.round(usable.reduce((s, i) => s + (i.total > 0 ? i.done / i.total : 1), 0) / usable.length * 100)
      : null;
  })();

  const btnSecondary = 'flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 whitespace-nowrap bg-surface-raised hover:bg-surface active:bg-surface-border text-ink text-sm font-medium px-3.5 py-2 rounded-lg transition border border-surface-border min-h-[44px]';
  const dateText = data?.date
    ? new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;
  const heroEyebrow = [
    gradeScope ? `ชั้น ${gradeScope}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <PageTransition>
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="space-y-2">
        <RoleChip role="school" />
        <PageHeader
          title={PAGE_TITLES.SCHOOL_DASHBOARD}
          subtitle={data?.school
            ? `${data.school.name}${data.school.affiliation_name ? ' · ' + data.school.affiliation_name : ''}${gradeScope ? ` · ชั้น ${gradeScope}` : ''}`
            : null}
          meta={dateText ? `วันที่ ${dateText}` : null}
          icon={Building2}
          iconColor="green"
        />

        {/* Quick actions. "รถรับส่ง" is hidden for grade-teacher accounts,
            which are read-only (the backend 403s). */}
        <div className="flex flex-wrap items-stretch gap-2">
          <Link
            to="/school/teacher-check"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 bg-success-ink hover:opacity-90 text-white text-sm font-semibold px-4 py-2 rounded-lg transition min-h-[44px]"
          >
            <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
            เช็กชื่อวันนี้
          </Link>
          <Link to="/school/students" className={btnSecondary}>
            <Search className="w-4 h-4" strokeWidth={2} />
            นักเรียน
          </Link>
          {!isTeacher && (
            <Link to="/school/vehicles" className={btnSecondary}>
              <Bus className="w-4 h-4" strokeWidth={2} />
              รถรับส่ง
            </Link>
          )}
          <Link to="/reports/daily" className={btnSecondary}>
            <FileText className="w-4 h-4" strokeWidth={2} />
            {/* "รายงานวันนี้" broke mid-word at 390px (live QA vis-14). */}
            <span className="sm:hidden">รายงาน</span><span className="hidden sm:inline">รายงานวันนี้</span>
          </Link>
        </div>
      </div>

      {overrideOpen && (
        <SchoolOverrideModal
          vehicles={statusData?.vehicles || []}
          onClose={() => setOverrideOpen(false)}
          onSaved={() => refetchDashboard()}
        />
      )}

      {!loading && failedSections.length > 0 && (
        <AlertBanner variant="danger" title="โหลดข้อมูลบางส่วนไม่สำเร็จ">
          <div className="space-y-2">
            <p>ส่วนที่โหลดไม่ได้: {failedSections.map(key => SECTION_LABELS[key]).join(' · ')} — ตัวเลขของส่วนนี้แสดงเป็น “—” จนกว่าจะโหลดสำเร็จ</p>
            <button
              type="button"
              onClick={retryFailed}
              disabled={retrying}
              className="focus-ring inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-danger/40 bg-surface-raised px-4 text-sm font-semibold text-danger-ink transition hover:bg-danger-soft disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} strokeWidth={2} aria-hidden="true" />
              ลองใหม่
            </button>
          </div>
        </AlertBanner>
      )}

      {loading ? (
        <StatusHero loading rounds={[]} />
      ) : (
        <>
          <div className="motion-safe:animate-fade-in-up">
            <StatusHero
              eyebrow={heroEyebrow}
              rounds={[{ status: morning }, { status: evening }]}
              day={day || { tone: 'neutral', headline: 'ยังไม่มีข้อมูลวันนี้', sub: UNAVAILABLE_SUB }}
              action={heroAction}
            />
          </div>

          <ActionList title="ต้องทำวันนี้" items={actions} afterAlert={dashOk && !!day && (day.tone === 'warn' || day.tone === 'danger')} emptyText="วันนี้ไม่มีงานค้าง" />

          {/* Grade teacher: their own pupils still waiting, and a way to act. */}
          {isTeacher && !roundNotRunning && waitingPupils.length > 0 && (
            <SectionCard
              title={`นักเรียน${gradeScope ? ` ชั้น ${gradeScope}` : ''} ที่ยังรอ${focusName}`}
              sub={`${waitingPupils.length.toLocaleString('th-TH')} คน ยังไม่ยืนยัน`}
              action={<Link to="/school/teacher-check" className="focus-ring inline-flex min-h-[44px] items-center rounded-lg bg-success-ink px-3 text-sm font-semibold text-white">เช็กชื่อวันนี้</Link>}
            >
              <ul className="flex flex-col divide-y divide-surface-border">
                {waitingPupils.slice(0, 8).map(s => (
                  <li key={s.id} className="py-2 text-sm text-ink">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-ink-muted"> · {formatGradeClass(s.grade, s.classroom, '')}</span>
                  </li>
                ))}
              </ul>
              {waitingPupils.length > 8 && <p className="pt-2 text-sm text-ink-muted">และอีก {(waitingPupils.length - 8).toLocaleString('th-TH')} คน ดูทั้งหมดในหน้าเช็กชื่อ</p>}
            </SectionCard>
          )}

          {/* School: buses that still have pupils waiting in the round in focus. */}
          {!isTeacher && !roundNotRunning && waitingBuses.length > 0 && (
            <SectionCard
              title={`รถที่ยังค้าง (${focusName})`}
              sub={`${waitingBuses.length.toLocaleString('th-TH')} คัน · เรียงจากค้างมากไปน้อย`}
              action={<button type="button" onClick={() => openFold('vehicles', vehiclesRef)} className="focus-ring inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold text-brand-700 hover:underline">ดูรายชื่อในรถ</button>}
            >
              <ul className="flex flex-col divide-y divide-surface-border">
                {waitingBuses.slice(0, 5).map(({ v, r }) => (
                  <li key={v.vehicle_id || v.plate_no} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0 truncate font-semibold text-ink">{v.plate_no || 'ยังไม่ระบุรถ'}</span>
                    <span className="shrink-0 text-sm tabular-nums text-ink-muted">
                      ส่งแล้ว {r.done}/{r.expected} คน · <span className="font-semibold text-warn-ink">ค้าง {r.pending}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {/* Self-travel / leave, in context under the round numbers. */}
          <TravelLeaveSummary data={failed.dashboard ? {} : data} />

          {/* Secondary facts, calm */}
          <StatGrid cols={4} label="ตัวเลขประกอบวันนี้">
            <StatTile label="นักเรียนทั้งหมด" value={dash?.total_students} unit="คน" unavailable={!dashOk} icon={Users} />
            <StatTile label="รถรับส่ง" value={dash?.total_vehicles} unit="คัน" unavailable={!dashOk} icon={Bus} to={isTeacher ? undefined : '/school/vehicles'} />
            <StatTile label="นักเรียนลา" value={mLeave + eLeave} unit="ครั้ง" sub={`เช้า ${mLeave} · เย็น ${eLeave}`} unavailable={!dashOk} />
            <StatTile label="เหตุฉุกเฉิน 7 วัน" value={emerg7d} unit="รายการ" tone={emerg7d > 0 ? 'danger' : 'calm'} unavailable={!dashOk} to="/school/emergencies" />
          </StatGrid>

          {/* Two charts: the last school days, and the buses to chase now */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DayBars
              title="การรับส่ง 7 วันล่าสุด (%)"
              days={recentDays || []}
              failed={recentDays === RECENT_DAYS_FAILED}
              note="แสดงเฉพาะวันที่มีการเช็กชื่อ"
            />
            <RankBars
              title={`รายรถวันนี้ (${rankSession === 'evening' ? 'รอบเย็น' : 'รอบเช้า'})`}
              sub="เรียงจากค้างมากไปน้อย"
              rows={rankRows}
              link={{ label: 'ดูรถทั้งหมด', to: '/school/vehicles' }}
              empty={failed.status ? UNAVAILABLE_SUB : 'ยังไม่มีรถที่มีนักเรียนในรอบนี้'}
            />
          </section>

          {/* Details — folded */}
          <section className="space-y-3">
            <div ref={vehiclesRef} className="scroll-mt-4">
              <FoldSection
                key={`vehicles-${forced.vehicles}`}
                defaultOpen={forced.vehicles > 0}
                title={SECTION_TITLES.VEHICLE_STATUS}
                subtitle={failed.status ? `— คัน · ${UNAVAILABLE_SUB}` : `${vehicles.length} คัน · กดเพื่อดูรายชื่อนักเรียนในแต่ละคัน`}
              >
                {failed.status ? (
                  <p className="py-8 text-center text-ink-muted">{UNAVAILABLE_SUB}</p>
                ) : (
                <div className="space-y-3">
                  <PlateSearchInput value={plateSearch} onChange={setPlateSearch} suggestions={vehicles} />
                  {filtered.length === 0 ? (
                    <p className="py-8 text-center text-ink-muted">{UI_MESSAGES.VEHICLE_NOT_FOUND}</p>
                  ) : (
                    <div className="space-y-2">
                      {filtered.map(vehicle => (
                        <VehicleRow
                          key={vehicle.vehicle_id || '__none'}
                          vehicle={vehicle}
                          isExpanded={expandedVehicle === vehicle.vehicle_id}
                          onToggle={() => toggleVehicle(vehicle.vehicle_id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
                )}
              </FoldSection>
            </div>

            {/* Leave list with cancel — school can cancel leaves recorded in error */}
            {leaves.length > 0 && !isTeacher && (
              <div ref={leavesRef} className="scroll-mt-4">
                <FoldSection
                  key={`leaves-${forced.leaves}`}
                  defaultOpen={forced.leaves > 0}
                  title="รายการลา"
                  subtitle={`${leaves.length} รายการ`}
                >
                  <div className="space-y-2">
                    {leaves.map(lv => (
                      <div key={lv.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-surface border border-surface-border">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink truncate">{lv.student_name}</p>
                          <p className="text-xs text-ink-muted">
                            {formatGradeClass(lv.grade, lv.classroom, '')} · {lv.plate_no}
                            {lv.session && ` · ${lv.session === 'morning' ? 'เช้า' : lv.session === 'evening' ? 'เย็น' : 'ทั้งวัน'}`}
                            {lv.reason && ` · ${lv.reason}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setConfirmLeave(lv.id)}
                          disabled={!!leaveLoading[lv.id]}
                          className="shrink-0 text-xs font-medium text-danger-ink hover:text-danger-ink/80 disabled:opacity-50 px-2.5 py-1 rounded border border-danger/30 hover:bg-danger-soft transition min-h-[36px]"
                        >
                          {leaveLoading[lv.id] ? 'กำลัง...' : 'ยกเลิก'}
                        </button>
                      </div>
                    ))}
                  </div>
                </FoldSection>
              </div>
            )}

            {c && (
              <FoldSection
                title="ความครบถ้วนข้อมูล"
                subtitle={completenessPct === null ? 'ยังคำนวณไม่ได้' : `${completenessPct}% ครบถ้วน`}
              >
                <CompletenessCard c={c} />
              </FoldSection>
            )}
          </section>

          {/* Rare action, kept out of the way but never an empty box: it says what it is for. */}
          {!isTeacher && (
            <SectionCard
              collapsible
              title="ยืนยันแทนคนขับ"
              sub="ใช้เมื่อคนขับเช็กชื่อไม่ได้และมีเหตุจำเป็น ต้องระบุเหตุผล"
            >
              <p className="text-sm text-ink-muted mb-3">เช็กชื่อประจำวันใช้ปุ่ม “เช็กชื่อวันนี้” ด้านบน ส่วนนี้สำหรับยืนยันแทนคนขับเท่านั้น และบันทึกไว้ในประวัติการแก้ไข</p>
              <button type="button" onClick={() => setOverrideOpen(true)} className={btnSecondary}>
                <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                ยืนยันแทนคนขับ
              </button>
            </SectionCard>
          )}
        </>
      )}
    </div>
      <ConfirmDialog
        open={Boolean(confirmLeave)}
        title="ยกเลิกการลานี้?"
        itemName={confirmLeave?.student_name || confirmLeave?.name || ''}
        description="นักเรียนจะกลับมาอยู่ในรายการรับ-ส่งตามปกติ และการกระทำนี้ถูกบันทึกใน audit log"
        confirmLabel="ยกเลิกการลา"
        loading={Boolean(confirmLeave && leaveLoading[confirmLeave.id ?? confirmLeave])}
        onConfirm={() => handleCancelLeave(confirmLeave?.id ?? confirmLeave)}
        onCancel={() => setConfirmLeave(null)}
      />
    </PageTransition>
  );
}

/* ── Domain-specific sub-components ── */

function CompletenessCard({ c }) {
  const items = [
    // ลิงก์พาไปที่รายชื่อ "ที่ยังไม่ผูกรถ" โดยตรง — เดิมพาไปหน้ารายชื่อทั้งหมด
    // ซึ่งโรงเรียนที่มีนักเรียนหลายร้อยคนต้องไล่หาเองทีละหน้า
    { label: 'นักเรียนมีรถ',     done: c.students_with_vehicle, total: c.students_total, link: '/school/students?has_vehicle=no', linkLabel: 'ดูที่ยังไม่ผูก' },
    { label: 'ผู้ปกครองครบ',     done: c.students_with_parent,  total: c.students_total, link: '/school/students', linkLabel: 'ดูรายชื่อ' },
    { label: 'รถผ่านตรวจสภาพ',   done: c.vehicles_inspected,    total: c.vehicles_total, link: '/school/vehicles', linkLabel: 'ดูรถ' },
    { label: 'ประกันภัยครบ',     done: c.vehicles_insured,      total: c.vehicles_total, link: '/school/vehicles', linkLabel: 'ดูรถ' },
  ];
  const overallPct = items.reduce((s, i) => s + (i.total > 0 ? i.done / i.total : 1), 0) / items.length * 100;
  const overallTone = overallPct >= 90 ? 'text-success-ink' : overallPct >= 60 ? 'text-warn-ink' : 'text-danger-ink';

  return (
    <AppCard padding="md">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-ink">ความครบถ้วนข้อมูล</h2>
        <span className={`text-sm font-semibold tabular-nums ${overallTone}`}>{Math.round(overallPct)}%</span>
      </div>
      <div className="space-y-2.5">
        {items.map(item => {
          const pct = item.total > 0 ? Math.round((item.done / item.total) * 100) : 100;
          const missing = item.total - item.done;
          const tone = pct >= 90 ? 'text-success-ink' : pct >= 60 ? 'text-warn-ink' : 'text-danger-ink';
          const bar  = pct >= 90 ? 'bg-success' : pct >= 60 ? 'bg-warn'    : 'bg-danger';
          return (
            <div key={item.label}>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-ink-muted">{item.label}</span>
                <span className={`font-medium ${tone}`}>
                  {item.done}/{item.total} ({pct}%)
                  {missing > 0 && (
                    <Link to={item.link} className="ml-1 text-brand-700 hover:underline">{item.linkLabel}</Link>
                  )}
                </span>
              </div>
              <div className="w-full bg-surface rounded-full h-2">
                <div className={`h-2 rounded-full transition-all ${bar}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </AppCard>
  );
}

function VehicleRow({ vehicle, isExpanded, onToggle }) {
  const isMorningLeave = (s) => s.leave_session === 'morning' || s.leave_session === 'both';
  const isEveningLeave = (s) => s.leave_session === 'evening' || s.leave_session === 'both';
  const mEnabled = vehicle.students.filter(s => s.morning_enabled && !isMorningLeave(s) && !s.morning_self);
  const mDone = mEnabled.filter(s => s.morning_done).length;
  const mPending = mEnabled.length - mDone;
  const eEnabled = vehicle.students.filter(s => s.evening_enabled && !isEveningLeave(s) && !s.evening_self);
  const eDone = eEnabled.filter(s => s.evening_done).length;
  const ePending = eEnabled.length - eDone;
  const leaveCount = vehicle.students.filter(s => s.leave_session).length;
  const allMorningDone = mPending === 0 && mEnabled.length > 0;
  const allEveningDone = ePending === 0 && eEnabled.length > 0;
  // Semantic status: pairs an icon + soft background + accessible label so the
  // row state is never communicated by color alone (DESIGN.md No Color-Only
  // Status Rule). Replaces the former bare colored vertical strip.
  const status = allMorningDone && allEveningDone
    ? { Icon: CheckCircle2, cls: 'bg-success-soft text-success-ink', label: 'ครบแล้ว' }
    : mPending + ePending > 0
    ? { Icon: AlertTriangle, cls: 'bg-warn-soft text-warn-ink', label: 'มีรายการค้าง' }
    : { Icon: Bus, cls: 'bg-surface text-ink-muted', label: 'ยังไม่เริ่ม' };
  const StatusIcon = status.Icon;

  return (
    <AppCard padding="none" className="overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-surface transition"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${status.cls}`}
            title={status.label}
          >
            <StatusIcon className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">{status.label}</span>
          </span>
          <div className="min-w-0">
            <h3 className="font-semibold text-ink text-base truncate">{vehicle.plate_no}</h3>
            <p className="text-sm text-ink-muted">{vehicle.students.length} คน{leaveCount > 0 ? ` · ลา ${leaveCount}` : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          <SessionPill label="เช้า" done={mDone} total={mEnabled.length} pending={mPending} />
          <SessionPill label="เย็น" done={eDone} total={eEnabled.length} pending={ePending} />
          <ChevronDown className={`w-4 h-4 text-ink-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`} strokeWidth={2} />
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-surface-border p-4">
          <StudentStatusTable
            students={vehicle.students}
            caption={`สถานะนักเรียนในรถ ${vehicle.plate_no || ''}`}
            rowClassName={s => (s.leave_session ? 'bg-warn-soft/40' : '')}
            renderStatus={(s, session) => (
              session === 'morning'
                ? <StudentStatus enabled={s.morning_enabled} done={s.morning_done} ts={s.morning_ts} leave={isMorningLeave(s)} selfLabel={s.morning_self ? 'มาเอง' : null} />
                : <StudentStatus enabled={s.evening_enabled} done={s.evening_done} ts={s.evening_ts} leave={isEveningLeave(s)} selfLabel={s.evening_self ? 'กลับเอง' : null} />
            )}
          />
        </div>
      )}
    </AppCard>
  );
}

function SessionPill({ label, done, total, pending }) {
  if (total === 0) return <span className="text-ink-muted text-xs">{label} -</span>;
  const allDone = pending === 0;
  return (
    <StatusBadge variant={allDone ? 'success' : 'warn'} size="sm">
      {label} {done}/{total}
      {pending > 0 && <span className="text-danger-ink font-semibold ml-0.5">({pending})</span>}
    </StatusBadge>
  );
}

function StudentStatus({ enabled, done, ts, leave, selfLabel }) {
  if (selfLabel) return <StatusBadge variant="neutral" size="sm">{selfLabel}</StatusBadge>;
  if (!enabled) return <span className="text-ink-muted text-xs">-</span>;
  if (leave) return <StatusBadge variant="warn" size="sm">{STATUS.LEAVE}</StatusBadge>;
  if (done) return (
    <span className="inline-flex items-center gap-1 text-success-ink text-xs font-medium">
      <span className="w-1.5 h-1.5 bg-success rounded-full" />
      {/* Without a timestamp the cell was a bare ✓ — the tick was the whole
          answer, and a screen reader read "check mark" with no subject. */}
      {ts ? new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : 'เรียบร้อย'}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-warn-ink text-xs">
      <span className="w-1.5 h-1.5 bg-warn rounded-full animate-pulse" />
      {STATUS.PENDING}
    </span>
  );
}
