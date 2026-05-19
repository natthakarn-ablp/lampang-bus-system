import { useState, useEffect, useRef } from 'react';
import {
  Map, Building2, GraduationCap, Bus, ClipboardList, AlertTriangle,
  Sunrise, Sunset, BellRing, Truck,
  // Phase 10.7C-2 — icons for the 5-card school-checklist hero
  Clock,
} from 'lucide-react';
import api from '../../api/axios';
import { DonutChart } from '../../components/MiniCharts';
import { useToast } from '../../components/Toast';
import PageHeader from '../../components/PageHeader';
import { SkeletonKpiGrid } from '../../components/Skeleton';
import { relativeTime } from '../../utils/datetime';
import {
  AppCard, AlertBanner,
  DashboardSection, AttentionCard,
} from '../../components/ui';
import {
  PAGE_TITLES, CHART_TITLES,
  UI_MESSAGES, MORNING_SEGMENTS, EVENING_SEGMENTS,
} from '../../constants/uiLabels';

export default function AffiliationDashboard() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [atRiskVehicles, setAtRiskVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notified, setNotified] = useState({});

  // Schools is the only detail section that exists today on Affiliation,
  // so it's the only attention-card jump target. Incidents + vehicles
  // cards render their preview but stay non-jumpable until those detail
  // sections land in a future phase.
  const schoolsRef = useRef(null);
  const scrollTo = (ref) =>
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  useEffect(() => {
    Promise.all([
      api.get('/affiliation/dashboard').catch(() => null),
      api.get('/affiliation/emergencies?per_page=5&page=1').catch(() => null),
      api.get('/affiliation/vehicles-at-risk?limit=10').catch(() => null),
    ]).then(([dashRes, incRes, atRiskRes]) => {
      if (dashRes) setData(dashRes.data.data);
      const incList = incRes?.data?.data;
      setIncidents(Array.isArray(incList) ? incList : []);
      const atRiskList = atRiskRes?.data?.data;
      setAtRiskVehicles(Array.isArray(atRiskList) ? atRiskList : []);
    }).finally(() => setLoading(false));
  }, []);

  const dateLabel = data?.date
    ? `วันที่ ${new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}`
    : null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <PageHeader
        title={PAGE_TITLES.AFFILIATION_DASHBOARD}
        subtitle={data?.affiliation?.name}
        meta={dateLabel}
        icon={Map}
        iconColor="sky"
      />

      {loading ? (
        <SkeletonKpiGrid count={5} />
      ) : !data ? (
        <p className="text-ink-muted py-10 text-center">{UI_MESSAGES.NO_DATA}</p>
      ) : (() => {
        const problemSchools = data.schools_not_complete ?? [];
        const totalBase  = (data.morning_total ?? 0) + (data.evening_total ?? 0);
        const hasEmerg   = (data.recent_emergencies ?? 0) > 0;
        const notStarted = totalBase === 0 && problemSchools.length === 0 && !hasEmerg;
        const hasAnyAttention = problemSchools.length > 0
                             || incidents.length > 0
                             || atRiskVehicles.length > 0;
        return (
        <>
          {/* Hero: state ribbon (info / success) OR Executive Attention Panel */}
          {notStarted ? (
            <AlertBanner variant="info" title="ยังไม่เริ่มดำเนินการวันนี้">รอข้อมูลรอบเช้า</AlertBanner>
          ) : !hasAnyAttention ? (
            <AlertBanner variant="success" title="ทุกโรงเรียนในสังกัดดำเนินการครบ" />
          ) : (
            <ExecutiveAttentionPanel
              schools={problemSchools}
              incidents={incidents}
              vehicles={atRiskVehicles}
              onJumpSchools={() => scrollTo(schoolsRef)}
            />
          )}

          {/* Phase 10.7C-2 — 5-card school-checklist hero. Drops the legacy
              total-students / total-schools / total-vehicles tiles in favour
              of action-driving adoption + data-quality + at-risk + alerts.
              Auxiliary totals moved to "ภาพรวมเพิ่มเติม" below. Cards 4 + 5
              are tap-through to the existing drill-down sections. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">

            {/* Card 1 — School adoption. 14-day window matches province. */}
            <AppCard padding="md">
              <div className="flex items-start gap-2 mb-2">
                <Building2 className="w-5 h-5 text-brand shrink-0" strokeWidth={2} />
                <p className="text-sm font-semibold text-ink leading-tight">โรงเรียนทั้งหมด / เข้าใช้งานแล้ว</p>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-ink-muted">โรงเรียนทั้งหมด</span>
                  <span className="text-2xl font-bold text-ink tabular-nums">{data.school_total ?? data.total_schools ?? 0}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-ink-muted">เข้าใช้งานล่าสุด 14 วัน</span>
                  <span className={`text-base font-semibold tabular-nums ${(data.school_used_recently ?? 0) > 0 ? 'text-success' : 'text-ink-muted'}`}>
                    {data.school_used_recently ?? 0}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-ink-muted">ยังไม่เข้าใช้งาน</span>
                  <span className={`text-base font-semibold tabular-nums ${(data.school_not_using_recently ?? 0) > 0 ? 'text-warn' : 'text-ink-muted'}`}>
                    {data.school_not_using_recently ?? 0}
                  </span>
                </div>
              </div>
            </AppCard>

            {/* Card 2 — Vehicle data completeness across schools. */}
            <AppCard padding="md">
              <div className="flex items-start gap-2 mb-2">
                <Bus className="w-5 h-5 text-brand shrink-0" strokeWidth={2} />
                <p className="text-sm font-semibold text-ink leading-tight">ความครบถ้วนข้อมูลรถ</p>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-ink-muted">มีข้อมูลรถแล้ว</span>
                  <span className={`text-base font-semibold tabular-nums ${(data.schools_with_vehicle_data ?? 0) > 0 ? 'text-success' : 'text-ink-muted'}`}>
                    {data.schools_with_vehicle_data ?? 0}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-ink-muted">ข้อมูลไม่ครบ</span>
                  <span className={`text-2xl font-bold tabular-nums ${(data.schools_missing_vehicle_data ?? 0) > 0 ? 'text-warn' : 'text-success'}`}>
                    {data.schools_missing_vehicle_data ?? 0}
                  </span>
                </div>
              </div>
            </AppCard>

            {/* Card 3 — Today's pickup/dropoff progress. Compact summary;
                the existing SessionDonut section below keeps the rich detail. */}
            <AppCard padding="md">
              <div className="flex items-start gap-2 mb-2">
                <Clock className="w-5 h-5 text-brand shrink-0" strokeWidth={2} />
                <p className="text-sm font-semibold text-ink leading-tight">การรับ-ส่งวันนี้</p>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-ink-muted inline-flex items-center gap-1">
                    <Sunrise className="w-3.5 h-3.5 text-warn" strokeWidth={2} /> ส่งเช้า
                  </span>
                  <span className="text-base font-semibold text-ink tabular-nums">
                    {data.morning_done ?? 0}
                    <span className="text-ink-muted text-sm"> / {data.morning_total ?? 0}</span>
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-ink-muted inline-flex items-center gap-1">
                    <Sunset className="w-3.5 h-3.5 text-info" strokeWidth={2} /> รับเย็น
                  </span>
                  <span className="text-base font-semibold text-ink tabular-nums">
                    {data.evening_done ?? 0}
                    <span className="text-ink-muted text-sm"> / {data.evening_total ?? 0}</span>
                  </span>
                </div>
              </div>
            </AppCard>

            {/* Card 4 — At-risk schools today. Tap-through to the existing
                "โรงเรียนเสี่ยง" SchoolRiskRow section below (schoolsRef). */}
            <AppCard
              as="button"
              padding="md"
              onClick={() => scrollTo(schoolsRef)}
              className="text-left transition hover:shadow-elevate focus:outline-none focus:ring-2 focus:ring-warn/40"
              aria-label="ดูรายชื่อโรงเรียนเสี่ยง"
            >
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle
                  className={`w-5 h-5 shrink-0 ${(data.at_risk_schools ?? 0) > 0 ? 'text-warn' : 'text-success'}`}
                  strokeWidth={2}
                />
                <p className="text-sm font-semibold text-ink leading-tight">โรงเรียนเสี่ยงวันนี้</p>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-ink-muted">โรงเรียนที่ต้องติดตาม</span>
                <span className={`text-2xl font-bold tabular-nums ${(data.at_risk_schools ?? 0) > 0 ? 'text-warn' : 'text-success'}`}>
                  {data.at_risk_schools ?? problemSchools.length}
                </span>
              </div>
              {problemSchools.length > 0 && (
                <p className="text-xs text-ink-muted mt-1 truncate">
                  เช่น {problemSchools.slice(0, 2).map(s => s.school_name).join(' · ')}
                </p>
              )}
            </AppCard>

            {/* Card 5 — Alert digest. Aliases emergency_7d / leave_today
                from 10.7C-1; fall back to legacy names if needed. */}
            <AppCard padding="md">
              <div className="flex items-start gap-2 mb-2">
                <BellRing
                  className={`w-5 h-5 shrink-0 ${((data.emergency_7d ?? data.recent_emergencies ?? 0) > 0) ? 'text-danger' : 'text-brand'}`}
                  strokeWidth={2}
                />
                <p className="text-sm font-semibold text-ink leading-tight">เหตุแจ้งเตือน</p>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-ink-muted">เหตุฉุกเฉิน 7 วัน</span>
                  <span className={`text-2xl font-bold tabular-nums ${(data.emergency_7d ?? data.recent_emergencies ?? 0) > 0 ? 'text-danger' : 'text-ink-muted'}`}>
                    {data.emergency_7d ?? data.recent_emergencies ?? 0}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-ink-muted">การลาวันนี้</span>
                  <span className={`text-base font-semibold tabular-nums ${(data.leave_today ?? data.leave_count ?? 0) > 0 ? 'text-warn' : 'text-ink-muted'}`}>
                    {data.leave_today ?? data.leave_count ?? 0}
                  </span>
                </div>
              </div>
            </AppCard>

          </div>

          {/* Auxiliary system size — was hero cards 2/3/4 in the pre-10.7C-2
              layout. Demoted because students/schools/vehicles totals don't
              drive a same-day decision; the 5-card hero owns that signal. */}
          <DashboardSection title="ภาพรวมเพิ่มเติม" description="ขนาดสังกัด">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <AppCard padding="sm" className="text-center">
                <p className="text-xs text-ink-muted">นักเรียน</p>
                <p className="text-2xl font-semibold text-ink tabular-nums mt-0.5">{data.total_students ?? 0}</p>
              </AppCard>
              <AppCard padding="sm" className="text-center">
                <p className="text-xs text-ink-muted">โรงเรียน</p>
                <p className="text-2xl font-semibold text-ink tabular-nums mt-0.5">{data.total_schools ?? 0}</p>
              </AppCard>
              <AppCard padding="sm" className="text-center">
                <p className="text-xs text-ink-muted">รถรับส่ง</p>
                <p className="text-2xl font-semibold text-ink tabular-nums mt-0.5">{data.total_vehicles ?? 0}</p>
              </AppCard>
              <AppCard padding="sm" className="text-center">
                <p className="text-xs text-ink-muted inline-flex items-center gap-1 justify-center w-full">
                  <ClipboardList className="w-3.5 h-3.5" strokeWidth={2} /> รายละเอียดลา
                </p>
                <p className="text-2xl font-semibold text-ink tabular-nums mt-0.5">
                  {data.morning_leave ?? 0}<span className="text-ink-muted text-sm"> / {data.evening_leave ?? 0}</span>
                </p>
              </AppCard>
            </div>
          </DashboardSection>

          {/* Session donuts */}
          <DashboardSection title="ผลการดำเนินการวันนี้">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SessionDonut
                title={CHART_TITLES.MORNING_STATUS}
                done={data.morning_done ?? 0}
                total={data.morning_total ?? 0}
                pending={data.morning_pending ?? 0}
                leave={data.morning_leave ?? 0}
                segments={MORNING_SEGMENTS(data.morning_done ?? 0, data.morning_leave ?? 0, data.morning_pending ?? 0)}
                doneLabel="ส่งแล้ว"
              />
              <SessionDonut
                title={CHART_TITLES.EVENING_STATUS}
                done={data.evening_done ?? 0}
                total={data.evening_total ?? 0}
                pending={data.evening_pending ?? 0}
                leave={data.evening_leave ?? 0}
                segments={EVENING_SEGMENTS(data.evening_done ?? 0, data.evening_leave ?? 0, data.evening_pending ?? 0)}
                doneLabel="รับแล้ว"
              />
            </div>
          </DashboardSection>

          {/* Schools with pending — wrapped div carries the scroll anchor for the attention panel */}
          {problemSchools.length > 0 && (
            <div ref={schoolsRef}>
              <DashboardSection
                title="โรงเรียนเสี่ยง"
                description={`${problemSchools.length} โรงเรียนยังมีรายการค้าง`}
              >
                <div className="space-y-3">
                  {problemSchools.map(s => (
                    <SchoolRiskRow
                      key={s.school_id}
                      school={s}
                      notifiedAt={notified[s.school_id]}
                      onNotify={async () => {
                        const msg = `แจ้งเตือนจากสังกัด: โรงเรียน${s.school_name} ยังมีข้อมูลนักเรียนค้าง (เช้า ${s.morning_pending || 0} คน, เย็น ${s.evening_pending || 0} คน) กรุณาตรวจสอบและดำเนินการในระบบ`;
                        try {
                          await navigator.clipboard.writeText(msg);
                          await api.post('/affiliation/notify-school', {
                            school_id: s.school_id, school_name: s.school_name, message: msg, method: 'copy',
                          });
                          setNotified(prev => ({ ...prev, [s.school_id]: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) }));
                          toast.success('คัดลอกข้อความแล้ว — ส่งผ่าน LINE/โทรศัพท์ได้เลย');
                        } catch { toast.error('ไม่สำเร็จ'); }
                      }}
                    />
                  ))}
                </div>
              </DashboardSection>
            </div>
          )}
        </>
        );
      })()}
    </div>
  );
}

/* ── Executive Attention Panel: 3-card hero grid for at-a-glance triage ──
   Affiliation flavor — schools card is jumpable; incidents/vehicles cards
   stay non-jumpable until those detail sections land in a future phase. */
function ExecutiveAttentionPanel({ schools, incidents, vehicles, onJumpSchools }) {
  const vehicleVariant = vehicles.some(v => v.risk_score >= 100) ? 'danger'
                       : vehicles.length > 0                     ? 'warn'
                       :                                            'neutral';
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <AttentionCard
        icon={Building2}
        title="โรงเรียนเสี่ยง"
        count={schools.length}
        variant={schools.length > 0 ? 'warn' : 'neutral'}
        items={schools.slice(0, 3).map(s => ({
          key: s.school_id,
          primary: s.school_name,
          secondary: `รอ ${(s.morning_pending || 0) + (s.evening_pending || 0)}`,
        }))}
        onJump={onJumpSchools}
        emptyLabel="ไม่มีโรงเรียนค้าง"
      />
      <AttentionCard
        icon={AlertTriangle}
        title="เหตุฉุกเฉินล่าสุด"
        count={incidents.length}
        variant={incidents.length > 0 ? 'danger' : 'neutral'}
        items={incidents.slice(0, 3).map(em => ({
          key: em.id,
          primary: em.plate_no || '-',
          secondary: relativeTime(em.reported_at),
        }))}
        // No onJump — incidents detail section doesn't exist on Affiliation yet.
        emptyLabel="ไม่มีเหตุล่าสุด"
      />
      <AttentionCard
        icon={Truck}
        title="รถสำคัญ"
        count={vehicles.length}
        variant={vehicleVariant}
        items={vehicles.slice(0, 3).map(v => ({
          key: v.id,
          primary: v.plate_no,
          secondary: v.risk_reasons?.[0] || `คะแนน ${v.risk_score}`,
        }))}
        // No onJump — vehicles detail section doesn't exist on Affiliation yet.
        emptyLabel="ไม่มีรถต้องติดตาม"
      />
    </div>
  );
}

/* ── Session donut card ── */
function SessionDonut({ title, done, total, pending, leave, segments, doneLabel }) {
  const notStarted = total === 0;
  const pct = notStarted ? 0 : Math.round((done / total) * 100);
  return (
    <AppCard padding="lg">
      <p className="text-sm font-semibold text-ink-muted mb-4 text-center">{title}</p>
      <DonutChart
        size={160} thickness={22}
        label={notStarted ? '–' : `${pct}%`}
        sublabel={notStarted ? 'รอเริ่มรอบ' : `${doneLabel} ${done}/${total} คน`}
        segments={segments}
      />
      <div className="flex justify-center gap-6 mt-3 text-sm">
        {notStarted ? (
          <span className="text-ink-muted">ยังไม่เริ่ม</span>
        ) : (
          <>
            <span className="text-success font-medium">{doneLabel} {done}</span>
            <span className="text-warn">ลา {leave}</span>
            <span className="text-danger font-medium">รอ {pending}</span>
          </>
        )}
      </div>
    </AppCard>
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

  return (
    <AppCard padding="md" className={`relative pl-5 before:content-[''] before:absolute before:left-0 before:top-3 before:bottom-3 before:w-1 before:rounded-r-full ${
      level === 'high' ? 'before:bg-danger' : level === 'medium' ? 'before:bg-warn' : 'before:bg-success'
    }`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink truncate">{s.school_name}</p>
          <div className="flex items-center gap-3 text-xs text-ink-muted mt-0.5">
            <span className="inline-flex items-center gap-1"><GraduationCap className="w-3.5 h-3.5" strokeWidth={2} /> {s.student_count ?? '-'} คน</span>
            <span className="inline-flex items-center gap-1"><Bus className="w-3.5 h-3.5" strokeWidth={2} /> {s.vehicle_count ?? '-'} คัน</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onNotify}
          className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition border ${
            notifiedAt
              ? 'bg-success-soft text-success border-success/30'
              : 'bg-brand-50 text-brand-700 border-brand-200 hover:bg-brand-100'
          }`}
        >
          <BellRing className="w-3.5 h-3.5" strokeWidth={2} />
          {notifiedAt ? `แจ้งแล้ว ${notifiedAt}` : 'แจ้งเตือน'}
        </button>
      </div>

      <SessionBar icon={Sunrise} label="ส่งเช้า" done={mDone} total={mTotal} pending={mPend} pct={mPct} />
      <div className="h-2" />
      <SessionBar icon={Sunset}  label="รับเย็น" done={eDone} total={eTotal} pending={ePend} pct={ePct} />
    </AppCard>
  );
}

function SessionBar({ icon: Icon, label, done, total, pending, pct }) {
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
        <span className="text-success font-medium">ส่งแล้ว {done}</span>
        <span className="text-danger font-medium">รอ {pending}</span>
      </div>
    </div>
  );
}
