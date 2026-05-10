import { useState, useEffect, useRef } from 'react';
import {
  Map, Building2, GraduationCap, Bus, ClipboardList, AlertTriangle,
  Sunrise, Sunset, BellRing, Truck,
} from 'lucide-react';
import api from '../../api/axios';
import { DonutChart } from '../../components/MiniCharts';
import { useToast } from '../../components/Toast';
import PageHeader from '../../components/PageHeader';
import { SkeletonKpiGrid } from '../../components/Skeleton';
import { relativeTime } from '../../utils/datetime';
import {
  AppCard, AlertBanner, KPIGrid, KPIStat,
  RiskCard, DashboardSection, AttentionCard,
} from '../../components/ui';
import {
  PAGE_TITLES, CARD_LABELS, CHART_TITLES,
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

          {/* Headline KPIs */}
          <KPIGrid cols={5} gap="sm">
            <KPIStat
              label={CARD_LABELS.SCHOOLS}
              value={data.total_schools ?? 0}
              icon={Building2}
              variant="brand"
            />
            <KPIStat
              label={CARD_LABELS.TOTAL_STUDENTS}
              value={data.total_students ?? 0}
              icon={GraduationCap}
              variant="brand"
            />
            <KPIStat
              label={CARD_LABELS.VEHICLES}
              value={data.total_vehicles ?? 0}
              icon={Bus}
              variant="brand"
            />
            <KPIStat
              label={CARD_LABELS.STUDENT_LEAVE}
              value={data.leave_count ?? 0}
              icon={ClipboardList}
              variant={(data.leave_count ?? 0) > 0 ? 'warn' : 'neutral'}
            />
            <KPIStat
              label={CARD_LABELS.EMERGENCY_7D}
              value={data.recent_emergencies ?? 0}
              icon={AlertTriangle}
              variant={(data.recent_emergencies ?? 0) > 0 ? 'danger' : 'neutral'}
            />
          </KPIGrid>

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
