import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, GraduationCap, Bus, ClipboardList, AlertTriangle,
  Sunrise, Sunset, ChevronDown,
  // Phase 10.7E-1 — icons for the action row
  Search, FileText,
  // Phase 10.8C — override button icon
  CheckCircle2,
} from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import PlateSearchInput from '../../components/PlateSearchInput';
import { DonutChart, HBarChart } from '../../components/MiniCharts';
import PageHeader from '../../components/PageHeader';
import { SkeletonKpiGrid } from '../../components/Skeleton';
import SchoolOverrideModal from '../../components/SchoolOverrideModal';
import {
  AppCard, AlertBanner, KPIGrid, KPIStat,
  StatusBadge, DashboardSection, SectionTitle,
} from '../../components/ui';
import {
  PAGE_TITLES, CARD_LABELS, CHART_TITLES, SECTION_TITLES,
  STATUS, UI_MESSAGES, MORNING_SEGMENTS, EVENING_SEGMENTS,
} from '../../constants/uiLabels';
// Phase 10.7E-1 — teacher (grade-scoped) accounts are read-only; the
// SchoolLayout already renders a scope chip ("ขอบเขตข้อมูล: ป.X · บัญชี
// ครูประจำสายชั้น — ดูข้อมูลได้อย่างเดียว") above every school page, so
// no chip is added here. We only use isGradeTeacher() to hide the
// write-only action button ("จัดการรถ") from teacher accounts.
import { useAuth } from '../../hooks/useAuth';
import { isGradeTeacher } from '../../utils/authScope';
import { PageTransition } from '../../lib/motion';

export default function SchoolDashboard() {
  // Phase 10.7E-1 — read user from auth context to decide whether to
  // show the write-only "จัดการรถ" action button. Teacher accounts are
  // read-only and would 403 if they reached the vehicle management page.
  const { user } = useAuth();
  const isTeacher = isGradeTeacher(user);
  const toast = useToast();

  const [data, setData] = useState(null);
  const [statusData, setStatusData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedVehicle, setExpandedVehicle] = useState(null);
  const [plateSearch, setPlateSearch] = useState('');
  // Phase 10.8C — override modal open state. Refetches both feeds on save
  // so the session hero + alert chips + per-vehicle table all reflect the
  // new daily_status row immediately.
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [leaves, setLeaves] = useState([]);
  const [leaveLoading, setLeaveLoading] = useState({});

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

  async function handleCancelLeave(leaveId) {
    if (!leaveId) return;
    if (!confirm('ยืนยันยกเลิกการลานี้?')) return;
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

  const vehicles = statusData?.vehicles || [];
  const filtered = vehicles.filter(v => !plateSearch || v.plate_no.toLowerCase().includes(plateSearch.toLowerCase()));
  const totalLeave = (data?.morning_leave ?? 0) + (data?.evening_leave ?? 0);
  const totalBase  = (data?.morning_total  ?? 0) + (data?.evening_total  ?? 0);
  const hasEmerg   = (data?.recent_emergencies ?? 0) > 0;

  // Build issue lines for alert banner
  const issues = [];
  if ((data?.morning_pending ?? 0) > 0) issues.push(`รอส่งเช้า ${data.morning_pending} คน`);
  if ((data?.evening_pending ?? 0) > 0) issues.push(`รอรับเย็น ${data.evening_pending} คน`);
  if (hasEmerg) issues.push(`เหตุฉุกเฉิน ${data.recent_emergencies} ครั้ง (7 วัน)`);

  const notStarted = totalBase === 0 && !hasEmerg;

  return (
    <PageTransition>
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4 sm:space-y-5">
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

      {/* Phase 10.7E-1 — action row. Renders even while the data loads
          (the buttons are static). "จัดการรถ" is hidden for grade-teacher
          accounts because those accounts are read-only per the system
          intent — backend would 403 anyway.
          Phase 10.7E-4 mobile polish — each Link uses `flex-1 sm:flex-none
          justify-center` so the buttons fill the row evenly on mobile (no
          awkward right-edge whitespace) and revert to content-width on
          tablet/desktop where horizontal space is plentiful. */}
      <div className="flex flex-wrap items-stretch gap-2">
        <Link
          to="/school/students"
          className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 bg-brand-700 hover:bg-brand-800 active:bg-brand-900 text-surface-raised text-sm font-medium px-3.5 py-2 rounded-lg transition min-h-[44px]"
        >
          <Search className="w-4 h-4" strokeWidth={2} />
          ค้นหานักเรียน
        </Link>
        {!isTeacher && (
          <Link
            to="/school/vehicles"
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 bg-surface-raised hover:bg-surface active:bg-surface-border text-ink text-sm font-medium px-3.5 py-2 rounded-lg transition border border-surface-border min-h-[44px]"
          >
            <Bus className="w-4 h-4" strokeWidth={2} />
            จัดการรถ
          </Link>
        )}
        <Link
          to="/reports/daily"
          className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 bg-surface-raised hover:bg-surface active:bg-surface-border text-ink text-sm font-medium px-3.5 py-2 rounded-lg transition border border-surface-border min-h-[44px]"
        >
          <FileText className="w-4 h-4" strokeWidth={2} />
          รายงานวันนี้
        </Link>
        {/* Phase 10.8C — "ยืนยันแทนคนขับ" override action. Hidden for
            grade-teacher accounts (read-only) — backend enforces 403
            via requireFullSchoolScope anyway, but hiding the button
            avoids a dead-end UX. */}
        {!isTeacher && (
          <button
            type="button"
            onClick={() => setOverrideOpen(true)}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 bg-surface-raised hover:bg-surface active:bg-surface-border text-ink text-sm font-medium px-3.5 py-2 rounded-lg transition border border-surface-border min-h-[44px]"
          >
            <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
            ยืนยันแทนคนขับ
          </button>
        )}
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
          {/* Status banner — entrance fade explains today's state arriving
              after the loading skeleton (motion-safe, ≤300ms, reduced-motion
              users see it instantly). */}
          <div className="motion-safe:animate-fade-in-up">
            {notStarted ? (
              <AlertBanner variant="info" title="ยังไม่เริ่มดำเนินการวันนี้">รอข้อมูลรอบเช้า</AlertBanner>
            ) : issues.length > 0 ? (
              <AlertBanner variant="warn" title="สิ่งที่ต้องติดตามวันนี้">
                <ul className="space-y-0.5 mt-1">
                  {issues.map((msg, i) => <li key={i}>{msg}</li>)}
                </ul>
              </AlertBanner>
            ) : (
              <AlertBanner variant="success" title="ดำเนินการครบแล้ว ไม่มีรายการค้าง" />
            )}
          </div>

          {/* Phase 10.7E-3 — data completeness moved below the fold.
              Overall % shown in the collapsible subtitle so the at-a-glance
              read survives even when closed. The full bar breakdown opens
              on click. CompletenessCard component is reused as-is. */}
          {data?.completeness && (() => {
            const c = data.completeness;
            const items = [
              { done: c.students_with_vehicle, total: c.students_total },
              { done: c.students_with_parent,  total: c.students_total },
              { done: c.vehicles_inspected,    total: c.vehicles_total },
              { done: c.vehicles_insured,      total: c.vehicles_total },
            ];
            const pct = Math.round(
              items.reduce((s, i) => s + (i.total > 0 ? i.done / i.total : 1), 0) / items.length * 100
            );
            return (
              <CollapsibleSection
                title="ความครบถ้วนข้อมูล"
                subtitle={`${pct}% ครบถ้วน`}
                defaultOpen={false}
              >
                <CompletenessCard c={c} />
              </CollapsibleSection>
            );
          })()}

          {/* Headline KPIs */}
          <KPIGrid cols={4} gap="sm">
            <KPIStat
              label={CARD_LABELS.TOTAL_STUDENTS}
              value={data?.total_students ?? 0}
              icon={GraduationCap}
              variant="brand"
            />
            <KPIStat
              label={CARD_LABELS.VEHICLES}
              value={data?.total_vehicles ?? 0}
              icon={Bus}
              variant="brand"
            />
            <KPIStat
              label={CARD_LABELS.STUDENT_LEAVE}
              value={totalLeave > 0 ? `${data?.morning_leave ?? 0}/${data?.evening_leave ?? 0}` : '0'}
              icon={ClipboardList}
              variant={totalLeave > 0 ? 'warn' : 'neutral'}
              hint={totalLeave > 0 ? 'เช้า/เย็น' : 'ไม่มีคนลา'}
            />
            <KPIStat
              label={CARD_LABELS.EMERGENCY}
              value={data?.recent_emergencies ?? 0}
              icon={AlertTriangle}
              variant={data?.recent_emergencies > 0 ? 'danger' : 'neutral'}
              hint="7 วันล่าสุด"
            />
          </KPIGrid>

          {/* Phase 10.7E-2 — alert strip. 4 at-a-glance operational chips
              derived from existing dashboard fields. Sits right above the
              session-card hero so admins see the actionable totals before
              they scan the per-session detail. Mobile: flex-wrap. */}
          {(() => {
            const totalDone     = (data?.morning_done    ?? 0) + (data?.evening_done    ?? 0);
            const totalPending  = (data?.morning_pending ?? 0) + (data?.evening_pending ?? 0);
            const totalLeaveNow = (data?.morning_leave   ?? 0) + (data?.evening_leave   ?? 0);
            const emerg7d       = data?.recent_emergencies ?? 0;
            const Chip = ({ tone, label, value }) => {
              const cls = {
                neutral: 'bg-surface-raised text-ink-muted border-surface-border',
                info:    'bg-info-soft   text-info   border-info/30',
                warn:    'bg-warn-soft   text-warn   border-warn/30',
                danger:  'bg-danger-soft text-danger border-danger/30',
                success: 'bg-success-soft text-success border-success/30',
              }[tone] || 'bg-surface-raised text-ink-muted border-surface-border';
              return (
                <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border tabular-nums ${cls}`}>
                  <span>{label}</span>
                  <span className="font-semibold">{value}</span>
                </span>
              );
            };
            return (
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={totalLeaveNow > 0 ? 'warn'    : 'neutral'} label="นักเรียนลา"      value={totalLeaveNow} />
                <Chip tone={totalPending  > 0 ? 'danger'  : 'success'} label="ยังไม่ยืนยัน"     value={totalPending} />
                <Chip tone={totalDone     > 0 ? 'success' : 'neutral'} label="สำเร็จแล้ว"   value={totalDone} />
                <Chip tone={emerg7d       > 0 ? 'danger'  : 'neutral'} label="เหตุฉุกเฉิน 7 วัน" value={emerg7d} />
              </div>
            );
          })()}

          {/* Session progress (hero — Phase 10.7E-2 makes SessionCard more
              prominent without changing data semantics; see component below). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SessionCard
              icon={Sunrise}
              label="ส่งเช้า"
              done={data?.morning_done ?? 0}
              total={data?.morning_total ?? 0}
              pending={data?.morning_pending ?? 0}
              leave={data?.morning_leave ?? 0}
            />
            <SessionCard
              icon={Sunset}
              label="รับเย็น"
              done={data?.evening_done ?? 0}
              total={data?.evening_total ?? 0}
              pending={data?.evening_pending ?? 0}
              leave={data?.evening_leave ?? 0}
            />
          </div>

          {/* Leave list with cancel — school can cancel leaves recorded in error */}
          {leaves.length > 0 && !isTeacher && (
            <CollapsibleSection
              title="นักเรียนลา"
              subtitle={`${leaves.length} รายการ`}
              defaultOpen={false}
            >
              <div className="space-y-2">
                {leaves.map(lv => (
                  <div key={lv.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-surface border border-surface-border">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{lv.student_name}</p>
                      <p className="text-xs text-ink-muted">
                        {lv.grade && lv.classroom ? `${lv.grade}/${lv.classroom}` : lv.grade || ''} · {lv.plate_no}
                        {lv.session && ` · ${lv.session === 'morning' ? 'เช้า' : lv.session === 'evening' ? 'เย็น' : 'ทั้งวัน'}`}
                        {lv.reason && ` · ${lv.reason}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCancelLeave(lv.id)}
                      disabled={!!leaveLoading[lv.id]}
                      className="shrink-0 text-xs font-medium text-danger-ink hover:text-danger-ink/80 disabled:opacity-50 px-2.5 py-1 rounded border border-danger/30 hover:bg-danger-soft transition min-h-[36px]"
                    >
                      {leaveLoading[lv.id] ? 'กำลัง...' : 'ยกเลิก'}
                    </button>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Phase 10.7E-3 — analytics charts moved below the fold.
              Three charts (morning donut, evening donut, pending bar chart)
              kept intact; only collapsed by default. The hero session cards
              above already show the same morning/evening pct numbers, so
              hiding the donuts by default removes redundancy without
              losing the data — open the section to compare layouts. */}
          {vehicles.length > 0 && (
            <CollapsibleSection
              title="วิเคราะห์ภาพรวม"
              subtitle="กราฟส่งเช้า / รับเย็น / รถที่มีรายการค้าง"
              defaultOpen={false}
            >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <AppCard padding="lg">
                <p className="text-xs font-semibold text-ink-muted mb-3 text-center">{CHART_TITLES.MORNING_STATUS}</p>
                <DonutChart
                  size={110} thickness={16}
                  label={`${data?.morning_total > 0 ? Math.round(((data?.morning_done ?? 0) / data.morning_total) * 100) : 0}%`}
                  sublabel={STATUS.DONE}
                  segments={MORNING_SEGMENTS(data?.morning_done ?? 0, data?.morning_leave ?? 0, data?.morning_pending ?? 0)}
                />
              </AppCard>
              <AppCard padding="lg">
                <p className="text-xs font-semibold text-ink-muted mb-3 text-center">{CHART_TITLES.EVENING_STATUS}</p>
                <DonutChart
                  size={110} thickness={16}
                  label={`${data?.evening_total > 0 ? Math.round(((data?.evening_done ?? 0) / data.evening_total) * 100) : 0}%`}
                  sublabel={STATUS.DONE}
                  segments={EVENING_SEGMENTS(data?.evening_done ?? 0, data?.evening_leave ?? 0, data?.evening_pending ?? 0)}
                />
              </AppCard>
              <AppCard padding="lg">
                <HBarChart
                  label="รถที่มีรายการค้างมากที่สุด"
                  items={(() => {
                    const isMLeave = (s) => s.leave_session === 'morning' || s.leave_session === 'both';
                    return vehicles
                      .map(v => {
                        const mE = v.students.filter(s => s.morning_enabled && !isMLeave(s));
                        const mP = mE.length - mE.filter(s => s.morning_done).length;
                        return { label: v.plate_no, value: mP, color: mP > 5 ? '#EF4444' : mP > 0 ? '#F59E0B' : '#10B981' };
                      })
                      .sort((a, b) => b.value - a.value)
                      .slice(0, 6);
                  })()}
                  valueLabel=" คน"
                />
              </AppCard>
            </div>
            </CollapsibleSection>
          )}

          {/* Vehicle status section */}
          <DashboardSection
            title={SECTION_TITLES.VEHICLE_STATUS}
            description={`${filtered.length} คัน${plateSearch ? ' (กรอง)' : ''}`}
            action={<PlateSearchInput value={plateSearch} onChange={setPlateSearch} suggestions={vehicles} />}
          >
            {filtered.length === 0 ? (
              <AppCard padding="lg" className="py-12 text-center">
                <p className="text-ink-muted">{UI_MESSAGES.VEHICLE_NOT_FOUND}</p>
              </AppCard>
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
          </DashboardSection>
        </>
      )}
    </div>
    </PageTransition>
  );
}

/* ── Domain-specific sub-components ── */

function CompletenessCard({ c }) {
  const items = [
    { label: 'นักเรียนมีรถ',     done: c.students_with_vehicle, total: c.students_total, link: '/school/students', linkLabel: 'ดูรายชื่อ' },
    { label: 'ผู้ปกครองครบ',     done: c.students_with_parent,  total: c.students_total, link: '/school/students', linkLabel: 'ดูรายชื่อ' },
    { label: 'รถผ่านตรวจสภาพ',   done: c.vehicles_inspected,    total: c.vehicles_total, link: '/school/vehicles', linkLabel: 'ดูรถ' },
    { label: 'ประกันภัยครบ',     done: c.vehicles_insured,      total: c.vehicles_total, link: '/school/vehicles', linkLabel: 'ดูรถ' },
  ];
  const overallPct = items.reduce((s, i) => s + (i.total > 0 ? i.done / i.total : 1), 0) / items.length * 100;
  const overallTone = overallPct >= 90 ? 'text-success' : overallPct >= 60 ? 'text-warn' : 'text-danger';

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
          const tone = pct >= 90 ? 'text-success' : pct >= 60 ? 'text-warn' : 'text-danger';
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

function SessionCard({ icon: Icon, label, done, total, pending, leave }) {
  const notStarted = total === 0;
  const allDone    = !notStarted && pending === 0;
  const pct        = notStarted ? 0 : Math.round((done / total) * 100);

  // Semantic state mapping — neutral when nothing has happened yet,
  // never danger for "0% before the day started."
  const barCls  = notStarted ? 'bg-surface-border'
                : allDone    ? 'bg-success'
                : pct >= 80  ? 'bg-warn'
                : 'bg-danger';
  const pctTone = notStarted ? 'text-ink-muted'
                : allDone    ? 'text-success'
                : pct >= 80  ? 'text-warn'
                : 'text-danger';

  // Phase 10.7E-2 — promote to hero layout: a single large done/total
  // headline + percentage on its own row, then a wider progress bar and
  // explicit pending/leave chips below. Data semantics unchanged: same
  // props, same caller (already passing morning_/evening_ fields).
  return (
    <AppCard padding="lg" className={allDone ? 'border-success/40' : ''}>
      {/* Header row: icon + label · pct (top-right) */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 text-ink-muted" strokeWidth={2} />}
          <span className="text-base font-semibold text-ink">{label}</span>
        </div>
        <span className={`text-base font-semibold tabular-nums ${pctTone}`}>
          {notStarted ? 'ยังไม่เริ่ม' : `${pct}%`}
        </span>
      </div>

      {/* Hero number — bigger done/total readout */}
      <div className="mb-3">
        {notStarted ? (
          <p className="text-2xl font-bold text-ink-muted tabular-nums">–</p>
        ) : allDone ? (
          <p className="text-2xl font-bold text-success">{label}ครบแล้ว ✓</p>
        ) : (
          <p className="text-3xl font-bold text-ink tabular-nums leading-none">
            {done}
            <span className="text-base font-semibold text-ink-muted"> / {total - leave} คน</span>
          </p>
        )}
      </div>

      {/* Progress bar — slightly taller for hero feel */}
      <div className="w-full bg-surface rounded-full h-2.5 mb-2.5">
        {!notStarted && (
          <div className={`h-2.5 rounded-full transition-all ${barCls}`} style={{ width: `${pct}%` }} />
        )}
      </div>

      {/* Detail chips: pending + leave, only when relevant */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {notStarted ? (
          <span className="text-ink-muted">รอเริ่มรอบ</span>
        ) : (
          <>
            {pending > 0 && (
              <span className="inline-flex items-center gap-1 bg-danger-soft text-danger-ink px-2 py-0.5 rounded-full border border-danger/30 font-medium tabular-nums">
                {STATUS.PENDING} {pending}
              </span>
            )}
            {leave > 0 && (
              <span className="inline-flex items-center gap-1 bg-warn-soft text-warn-ink px-2 py-0.5 rounded-full border border-warn/30 font-medium tabular-nums">
                {STATUS.LEAVE} {leave}
              </span>
            )}
            {pending === 0 && leave === 0 && (
              <span className="text-success font-medium">ทุกรายการ ✓</span>
            )}
          </>
        )}
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
    ? { Icon: CheckCircle2, cls: 'bg-success-soft text-success', label: 'ครบแล้ว' }
    : mPending + ePending > 0
    ? { Icon: AlertTriangle, cls: 'bg-warn-soft text-warn', label: 'มีรายการค้าง' }
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
        <div className="border-t border-surface-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface text-ink-muted text-xs">
                <th className="px-4 py-2 text-left font-medium">ชื่อนักเรียน</th>
                <th className="px-4 py-2 text-left font-medium">ชั้น/ห้อง</th>
                <th className="px-4 py-2 text-center font-medium">ส่งเช้า</th>
                <th className="px-4 py-2 text-center font-medium">รับเย็น</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {vehicle.students.map(s => (
                <tr key={s.id} className={`${s.leave_session ? 'bg-warn-soft/40' : ''} hover:bg-surface`}>
                  <td className="px-4 py-2 text-ink text-sm">{s.name}</td>
                  <td className="px-4 py-2 text-ink-muted text-xs">
                    {s.grade && s.classroom ? `${s.grade}/${s.classroom}` : s.grade || '-'}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <StudentStatus enabled={s.morning_enabled} done={s.morning_done} ts={s.morning_ts} leave={isMorningLeave(s)} />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <StudentStatus enabled={s.evening_enabled} done={s.evening_done} ts={s.evening_ts} leave={isEveningLeave(s)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
      {pending > 0 && <span className="text-danger font-semibold ml-0.5">({pending})</span>}
    </StatusBadge>
  );
}

function StudentStatus({ enabled, done, ts, leave }) {
  if (!enabled) return <span className="text-ink-muted text-xs">-</span>;
  if (leave) return <StatusBadge variant="warn" size="sm">{STATUS.LEAVE}</StatusBadge>;
  if (done) return (
    <span className="inline-flex items-center gap-1 text-success text-xs font-medium">
      <span className="w-1.5 h-1.5 bg-success rounded-full" />
      {ts ? new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '✓'}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-warn text-xs">
      <span className="w-1.5 h-1.5 bg-warn rounded-full animate-pulse" />
      {STATUS.PENDING}
    </span>
  );
}

/* ── Phase 10.7E-3 ── Collapsible section ────────────────────────────────
   Local helper used to move secondary analytics below the fold without
   removing them. Pure React state, no library. The header is a full-width
   button (min-h ≥ 44px for mobile tap), shows a subtitle so closed state
   still carries one piece of glanceable info, and uses the existing
   AppCard styling so it matches the rest of the dashboard. */
function CollapsibleSection({ title, subtitle, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <AppCard padding="none">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-brand-400 rounded-2xl"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink truncate">{title}</p>
          {subtitle && <p className="text-xs text-ink-muted mt-0.5 truncate">{subtitle}</p>}
        </div>
        <span className="text-xs text-ink-muted shrink-0 inline-flex items-center gap-1 ml-2">
          {open ? 'ซ่อนรายละเอียด' : 'แสดงรายละเอียด'}
          <ChevronDown
            className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
            strokeWidth={2}
          />
        </span>
      </button>
      {open && (
        <div className="border-t border-surface-border p-3 sm:p-4">
          {children}
        </div>
      )}
    </AppCard>
  );
}
