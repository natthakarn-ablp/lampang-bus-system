import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, Bus, AlertTriangle, ChevronDown,
  // Phase 10.7E-1 — icons for the action row
  Search, FileText,
  // Phase 10.8C — override button icon
  CheckCircle2,
} from 'lucide-react';
import api from '../../api/axios';
import StudentStatusTable from '../../components/StudentStatusTable';
import { useToast } from '../../components/Toast';
import PlateSearchInput from '../../components/PlateSearchInput';
import PageHeader from '../../components/PageHeader';
import { SkeletonKpiGrid } from '../../components/Skeleton';
import SchoolOverrideModal from '../../components/SchoolOverrideModal';
import {
  AppCard, StatusBadge, ConfirmDialog,
  TodayBanner, TodoCards, KpiRingCard, DayBars, RankBars, FoldSection, RoleChip,
  pctOf, pctTone,
} from '../../components/ui';
import {
  PAGE_TITLES, SECTION_TITLES, STATUS, UI_MESSAGES,
} from '../../constants/uiLabels';
// Phase 10.7E-1 — teacher (grade-scoped) accounts are read-only; the
// SchoolLayout already renders a scope chip above every school page. We only
// use isGradeTeacher() to hide write-only actions from teacher accounts.
import { useAuth } from '../../hooks/useAuth';
import useRecentDays from '../../hooks/useRecentDays';
import { isGradeTeacher } from '../../utils/authScope';
import { PageTransition } from '../../lib/motion';
import { formatGradeClass } from '../../utils/student';

const isMorningLeave = (s) => s.leave_session === 'morning' || s.leave_session === 'both';
const isEveningLeave = (s) => s.leave_session === 'evening' || s.leave_session === 'both';

/** Riders expected and done on one bus for one round (leave excluded). */
function vehicleRound(vehicle, session) {
  const students = vehicle.students || [];
  const expected = session === 'evening'
    ? students.filter(s => s.evening_enabled && !isEveningLeave(s))
    : students.filter(s => s.morning_enabled && !isMorningLeave(s));
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
  // A fold opened from the banner / a todo button is re-mounted open (its key
  // changes) and scrolled into view.
  const [forced, setForced] = useState({ vehicles: 0, leaves: 0 });
  const vehiclesRef = useRef(null);
  const leavesRef = useRef(null);

  const recentDays = useRecentDays('reports', 7);

  function refetchDashboard() {
    return Promise.all([
      api.get('/school/dashboard').then(r => r.data.data),
      api.get('/school/status-today').then(r => r.data.data),
      api.get('/school/leaves').then(r => r.data.data).catch(() => []),
    ])
      .then(([dash, status, lv]) => { setData(dash); setStatusData(status); setLeaves(lv || []); })
      .catch(() => {});
  }

  useEffect(() => {
    refetchDashboard().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Grade teachers cannot approve requests, so the count would be a dead end.
    if (isTeacher) return;
    api.get('/school/roster-requests', { params: { status: 'pending' } })
      .then(r => setRosterPending(Number(r.data?.meta?.total ?? (r.data?.data || []).length) || 0))
      .catch(() => setRosterPending(null));
  }, [isTeacher]);

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

  const vehicles = statusData?.vehicles || [];
  const filtered = vehicles.filter(v => !plateSearch || v.plate_no.toLowerCase().includes(plateSearch.toLowerCase()));

  // ── Today's numbers ───────────────────────────────────────────────────────
  const mTotal = data?.morning_total ?? 0;
  const eTotal = data?.evening_total ?? 0;
  const mLeave = data?.morning_leave ?? 0;
  const eLeave = data?.evening_leave ?? 0;
  const mDone = data?.morning_done ?? 0;
  const eDone = data?.evening_done ?? 0;
  const mPending = data?.morning_pending ?? 0;
  const ePending = data?.evening_pending ?? 0;
  // Pending already excludes pupils on leave, so the percentages do too.
  const mExpected = Math.max(0, mTotal - mLeave);
  const eExpected = Math.max(0, eTotal - eLeave);
  const mPct = pctOf(mDone, mExpected);
  const ePct = pctOf(eDone, eExpected);
  const emerg7d = data?.recent_emergencies ?? 0;
  const nothingToday = mTotal + eTotal === 0;
  const eveningStarted = eDone > 0;

  // ── Banner: one sentence, one tone ───────────────────────────────────────
  const showVehicles = { label: 'ดูรถที่ยังค้าง', onClick: () => openFold('vehicles', vehiclesRef) };
  let banner;
  if (nothingToday) {
    banner = { variant: 'neutral', title: 'ยังไม่มีข้อมูลการรับส่งวันนี้', sub: 'รอข้อมูลรอบเช้าจากคนขับ', topic: 'none' };
  } else if (mPending > 0) {
    banner = {
      variant: 'warn', title: `รอบเช้ายังค้าง ${mPending.toLocaleString('th-TH')} คน`,
      sub: `ส่งแล้ว ${mDone.toLocaleString('th-TH')} จาก ${mExpected.toLocaleString('th-TH')} คน`,
      cta: showVehicles, topic: 'morning',
    };
  } else if (!eveningStarted) {
    banner = {
      variant: 'success', title: 'รอบเช้าครบแล้ว',
      sub: `ส่งครบ ${mDone.toLocaleString('th-TH')} คน · รอบเย็นยังไม่เริ่ม`, topic: 'none',
    };
  } else if (ePending > 0) {
    banner = {
      variant: 'warn', title: `รอบเย็นยังค้าง ${ePending.toLocaleString('th-TH')} คน`,
      sub: `รอบเช้าครบ ${mDone.toLocaleString('th-TH')} คน · รับเย็นแล้ว ${eDone.toLocaleString('th-TH')} จาก ${eExpected.toLocaleString('th-TH')} คน`,
      cta: showVehicles, topic: 'evening',
    };
  } else {
    banner = { variant: 'success', title: 'วันนี้รับส่งครบแล้ว', sub: `ส่งเช้า ${mDone.toLocaleString('th-TH')} คน · รับเย็น ${eDone.toLocaleString('th-TH')} คน`, topic: 'none' };
  }

  // ── Todos: things to act on that the banner does not already say ─────────
  const c = data?.completeness;
  const noVehicle = c && Number.isFinite(c.students_total) && Number.isFinite(c.students_with_vehicle)
    ? Math.max(0, c.students_total - c.students_with_vehicle) : 0;
  const noParent = c && Number.isFinite(c.students_total) && Number.isFinite(c.students_with_parent)
    ? Math.max(0, c.students_total - c.students_with_parent) : 0;
  const todos = [
    { key: 'emergency', variant: 'danger', count: emerg7d, title: 'เหตุฉุกเฉินใน 7 วัน', sub: 'ตรวจสอบรายละเอียดและผลการแก้ไข', cta: { label: 'ดูเหตุฉุกเฉิน', to: '/school/emergencies' } },
    !isTeacher && rosterPending != null && { key: 'roster', variant: 'warn', count: rosterPending, title: 'คำขอรายชื่อจากคนขับ', sub: 'รอโรงเรียนอนุมัติ', cta: { label: 'ตรวจคำขอ', to: '/school/approvals' } },
    { key: 'no-vehicle', variant: 'warn', count: noVehicle, title: 'นักเรียนยังไม่ผูกรถ', sub: 'ยังไม่มีรถรับส่งในระบบ', cta: { label: 'ดูรายชื่อ', to: '/school/students?has_vehicle=no' } },
    { key: 'no-parent', variant: 'info', count: noParent, title: 'ข้อมูลผู้ปกครองไม่ครบ', sub: 'เติมเบอร์ผู้ปกครองเพื่อให้แจ้งเตือนได้', cta: { label: 'ดูรายชื่อ', to: '/school/students' } },
    !isTeacher && { key: 'leaves', variant: 'info', count: leaves.length, title: 'รายการลาของวันนี้', sub: 'ยกเลิกได้หากบันทึกผิด', cta: { label: 'ดูรายการลา', onClick: () => openFold('leaves', leavesRef) } },
  ].filter(Boolean);

  // ── Per-bus ranking for the round in progress ────────────────────────────
  const rankSession = eveningStarted ? 'evening' : 'morning';
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

  const btnSecondary = 'flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 bg-surface-raised hover:bg-surface active:bg-surface-border text-ink text-sm font-medium px-3.5 py-2 rounded-lg transition border border-surface-border min-h-[44px]';

  return (
    <PageTransition>
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="space-y-2">
        <RoleChip role="school" />
        <PageHeader
          title={PAGE_TITLES.SCHOOL_DASHBOARD}
          subtitle={data?.school
            ? `${data.school.name}${data.school.affiliation_name ? ' · ' + data.school.affiliation_name : ''}`
            : null}
          meta={data?.date
            ? `วันที่ ${new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}`
            : null}
          icon={Building2}
          iconColor="green"
        />

        {/* Quick actions. "จัดการรถ" and "ยืนยันแทนคนขับ" are hidden for
            grade-teacher accounts, which are read-only (the backend 403s). */}
        <div className="flex flex-wrap items-stretch gap-2">
          <Link
            to="/school/students"
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 bg-brand-700 hover:bg-brand-800 active:bg-brand-900 text-surface-raised text-sm font-medium px-3.5 py-2 rounded-lg transition min-h-[44px]"
          >
            <Search className="w-4 h-4" strokeWidth={2} />
            ค้นหานักเรียน
          </Link>
          {!isTeacher && (
            <Link to="/school/vehicles" className={btnSecondary}>
              <Bus className="w-4 h-4" strokeWidth={2} />
              จัดการรถ
            </Link>
          )}
          <Link to="/reports/daily" className={btnSecondary}>
            <FileText className="w-4 h-4" strokeWidth={2} />
            รายงานวันนี้
          </Link>
          {!isTeacher && (
            <button type="button" onClick={() => setOverrideOpen(true)} className={btnSecondary}>
              <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
              ยืนยันแทนคนขับ
            </button>
          )}
        </div>
      </div>

      {overrideOpen && (
        <SchoolOverrideModal
          vehicles={statusData?.vehicles || []}
          onClose={() => setOverrideOpen(false)}
          onSaved={() => refetchDashboard()}
        />
      )}

      {loading ? (
        <div className="space-y-4">
          <SkeletonKpiGrid count={4} />
          <SkeletonKpiGrid count={2} />
        </div>
      ) : (
        <>
          <div className="motion-safe:animate-fade-in-up">
            <TodayBanner variant={banner.variant} title={banner.title} sub={banner.sub} cta={banner.cta} />
          </div>

          <TodoCards items={todos} />

          {/* Headline numbers */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" aria-label="ตัวเลขหลักวันนี้">
            {/* Before a round has any check-in, show "not started" instead of an empty ring. */}
            {mExpected === 0 || mDone === 0 ? (
              <KpiRingCard label="ส่งเช้า" value="ยังไม่เริ่ม" sub="ยังไม่เริ่มรอบ" variant="neutral" />
            ) : (
              <KpiRingCard label="ส่งเช้า" pct={mPct} sub={`${mDone.toLocaleString('th-TH')} / ${mExpected.toLocaleString('th-TH')} คน`} variant={pctTone(mPct)} />
            )}
            {eExpected === 0 || !eveningStarted ? (
              <KpiRingCard label="รับเย็น" value="ยังไม่เริ่ม" sub="ยังไม่เริ่มรอบ" variant="neutral" />
            ) : (
              <KpiRingCard label="รับเย็น" pct={ePct} sub={`${eDone.toLocaleString('th-TH')} / ${eExpected.toLocaleString('th-TH')} คน`} variant={pctTone(ePct)} />
            )}
            <KpiRingCard
              label="นักเรียนที่ลา"
              value={mLeave + eLeave}
              sub={`วันนี้ · เช้า ${mLeave} · เย็น ${eLeave}`}
              variant="info"
            />
            <KpiRingCard
              label="เหตุฉุกเฉิน 7 วัน"
              value={emerg7d}
              sub="7 วันล่าสุด"
              variant={emerg7d > 0 ? 'danger' : 'success'}
              chip={emerg7d > 0 ? undefined : 'ไม่มีเหตุ'}
            />
          </section>

          {/* Two charts: the last school days, and the buses to chase now */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DayBars
              title="การรับส่ง 7 วันล่าสุด (%)"
              days={recentDays || []}
              note="แสดงเฉพาะวันที่มีการเช็กชื่อ"
            />
            <RankBars
              title={`รายรถวันนี้ (${rankSession === 'evening' ? 'รอบเย็น' : 'รอบเช้า'})`}
              sub="เรียงจากค้างมากไปน้อย"
              rows={rankRows}
              link={{ label: 'ดูรถทั้งหมด', to: '/school/vehicles' }}
              empty="ยังไม่มีรถที่มีนักเรียนในรอบนี้"
            />
          </section>

          {/* Details — folded */}
          <section className="space-y-3">
            <div ref={vehiclesRef} className="scroll-mt-4">
              <FoldSection
                key={`vehicles-${forced.vehicles}`}
                defaultOpen={forced.vehicles > 0}
                title={SECTION_TITLES.VEHICLE_STATUS}
                subtitle={`${vehicles.length} คัน · กดเพื่อดูรายชื่อนักเรียนในแต่ละคัน`}
              >
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
  const mEnabled = vehicle.students.filter(s => s.morning_enabled && !isMorningLeave(s));
  const mDone = mEnabled.filter(s => s.morning_done).length;
  const mPending = mEnabled.length - mDone;
  const eEnabled = vehicle.students.filter(s => s.evening_enabled && !isEveningLeave(s));
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
                ? <StudentStatus enabled={s.morning_enabled} done={s.morning_done} ts={s.morning_ts} leave={isMorningLeave(s)} />
                : <StudentStatus enabled={s.evening_enabled} done={s.evening_done} ts={s.evening_ts} leave={isEveningLeave(s)} />
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

function StudentStatus({ enabled, done, ts, leave }) {
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
