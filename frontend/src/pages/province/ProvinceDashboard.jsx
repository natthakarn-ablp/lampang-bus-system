import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bus, GraduationCap, Building2, Clock, AlertTriangle,
  Sunrise, Sunset, FileText, RotateCw, Truck,
} from 'lucide-react';

const POLL_INTERVAL = 30_000; // 30s background refresh
const TICK_INTERVAL = 1_000;  // 1s freshness ticker (re-render only)
import api from '../../api/axios';
import { safePct, kpiColor } from '../../utils/kpi';
import { PAGE_TITLES, UI_MESSAGES } from '../../constants/uiLabels';
import {
  AppCard, AlertBanner, KPIGrid, KPIStat,
  RiskCard, DashboardSection, StatusBadge,
} from '../../components/ui';

export default function ProvinceDashboard() {
  const [data, setData] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [atRiskVehicles, setAtRiskVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Refs for the attention-panel scroll-to-section drill-down (mirrors the
  // TransportDashboard scrollIntoView pattern). DashboardSection itself
  // doesn't forward refs, so we attach via a wrapping div on each section.
  const schoolsRef   = useRef(null);
  const incidentsRef = useRef(null);
  const vehiclesRef  = useRef(null);
  const scrollTo = (ref) =>
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [dashRes, incRes, atRiskRes] = await Promise.all([
        api.get('/province/dashboard').catch(() => null),
        api.get('/province/emergencies?per_page=5&page=1').catch(() => null),
        api.get('/province/vehicles-at-risk?limit=10').catch(() => null),
      ]);
      if (dashRes) setData(dashRes.data.data);
      const incList = incRes?.data?.data;
      setIncidents(Array.isArray(incList) ? incList : []);
      const atRiskList = atRiskRes?.data?.data;
      setAtRiskVehicles(Array.isArray(atRiskList) ? atRiskList : []);
      setLastSyncedAt(Date.now());
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

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

  if (loading) return <p className="text-ink-muted py-10 text-center text-lg">{UI_MESSAGES.LOADING}</p>;
  if (!data) return <p className="text-ink-muted py-10 text-center text-lg">{UI_MESSAGES.NO_DATA}</p>;

  const affs = data.affiliations ?? [];
  const problemSchools = data.schools_not_complete ?? [];
  const hasEmergency = data.recent_emergencies > 0;
  const totalPending = (data.morning_pending || 0) + (data.evening_pending || 0);
  const totalBase    = (data.morning_total   || 0) + (data.evening_total   || 0);
  const notStarted   = totalBase === 0 && problemSchools.length === 0 && !hasEmergency;

  // Hero state: the AttentionPanel takes over from the bulleted-text banner
  // whenever any of the three entity-level signals has content. Pending and
  // leave counts (which used to drive bulleted-text alerts) are already
  // surfaced in the SessionProgress cards below — no need to duplicate them
  // in the hero.
  const hasAnyAttention = problemSchools.length > 0
                       || incidents.length > 0
                       || atRiskVehicles.length > 0;

  const dateLabel = data.date
    ? new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold text-ink leading-tight">{PAGE_TITLES.PROVINCE_DASHBOARD}</h1>
          {dateLabel && <p className="text-sm text-ink-muted mt-1">ข้อมูล ณ {dateLabel}</p>}
        </div>
        <FreshnessPill
          lastSyncedAt={lastSyncedAt}
          now={now}
          refreshing={refreshing}
          onRefresh={fetchAll}
        />
      </header>

      {/* Hero: state ribbon (info / success) OR Executive Attention Panel */}
      {notStarted ? (
        <AlertBanner variant="info" title="ยังไม่เริ่มดำเนินการวันนี้">รอข้อมูลรอบเช้า</AlertBanner>
      ) : !hasAnyAttention ? (
        <AlertBanner variant="success" title="ระบบปกติ — ทุกโรงเรียนดำเนินการครบ" />
      ) : (
        <ExecutiveAttentionPanel
          schools={problemSchools}
          incidents={incidents}
          vehicles={atRiskVehicles}
          onJump={(section) => scrollTo(
            section === 'schools'   ? schoolsRef
            : section === 'incidents' ? incidentsRef
            :                           vehiclesRef
          )}
        />
      )}

      {/* KPI Grid */}
      <KPIGrid cols={4}>
        <KPIStat
          label="รถรับส่ง"
          value={data.total_vehicles ?? 0}
          icon={Bus}
          variant="brand"
          hint={(data.total_students ?? 0) > 0 && (data.total_vehicles ?? 0) > 0
            ? `เฉลี่ย ${Math.round(data.total_students / data.total_vehicles)} คน/คัน`
            : null}
        />
        <KPIStat
          label="นักเรียน"
          value={data.total_students ?? 0}
          icon={GraduationCap}
          variant="brand"
          hint={`${data.total_schools ?? 0} ร.ร. · ${data.total_vehicles ?? 0} คัน`}
        />
        <KPIStat
          label="โรงเรียน"
          value={data.total_schools ?? 0}
          icon={Building2}
          variant={problemSchools.length > 0 ? 'warn' : 'brand'}
          hint={`${data.total_affiliations ?? 0} สังกัด · ค้าง ${problemSchools.length}`}
        />
        {(() => {
          const base = (data.morning_total ?? 0) + (data.evening_total ?? 0);
          const notStarted = base === 0;
          const variant = notStarted ? 'neutral'
                        : totalPending > 50 ? 'danger'
                        : totalPending > 0  ? 'warn'
                        : 'success';
          return (
            <KPIStat
              label={notStarted ? 'ยังไม่เริ่ม' : totalPending > 0 ? 'รอดำเนินการ' : 'ครบแล้ว'}
              value={notStarted ? '–' : totalPending > 0 ? totalPending : '✓'}
              icon={!notStarted && totalPending > 0 ? Clock : null}
              variant={variant}
              hint={notStarted
                ? 'รอเริ่มรอบเช้า'
                : totalPending > 0
                  ? `เช้า ${data.morning_pending} · เย็น ${data.evening_pending}`
                  : 'ทุกรายการ'}
            />
          );
        })()}
      </KPIGrid>

      {/* Session progress */}
      <DashboardSection title="ผลการดำเนินการวันนี้">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SessionProgress
            label="รอบเช้า"
            icon={Sunrise}
            done={data.morning_done}
            total={data.morning_total}
            pending={data.morning_pending}
            leave={data.morning_leave ?? 0}
            kpi={data.morning_kpi}
          />
          <SessionProgress
            label="รอบเย็น"
            icon={Sunset}
            done={data.evening_done}
            total={data.evening_total}
            pending={data.evening_pending}
            leave={data.evening_leave ?? 0}
            kpi={data.evening_kpi}
          />
        </div>
      </DashboardSection>

      {/* Risk schools — wrapped div carries the scroll anchor for the attention panel */}
      {problemSchools.length > 0 && (
        <div ref={schoolsRef}>
          <DashboardSection
            title="โรงเรียนเสี่ยง"
            description={`${problemSchools.length} โรงเรียนมีรายการค้างวันนี้`}
          >
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
          </DashboardSection>
        </div>
      )}

      {/* Affiliations */}
      {affs.length > 0 && (
        <DashboardSection title="สรุปรายสังกัด">
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
        </DashboardSection>
      )}

      {/* Incident feed — last 5 emergencies (only render when there are any) */}
      {incidents.length > 0 && (
        <div ref={incidentsRef}>
          <DashboardSection title="เหตุฉุกเฉินล่าสุด" description={`${incidents.length} รายการล่าสุด`}>
            <div className="space-y-2">
              {incidents.map(em => <IncidentEntry key={em.id} em={em} />)}
            </div>
          </DashboardSection>
        </div>
      )}

      {/* Priority vehicles — top 10 by risk score (hidden when API returns empty) */}
      {atRiskVehicles.length > 0 && (
        <div ref={vehiclesRef}>
          <DashboardSection
            title="รถสำคัญต้องติดตาม"
            description={`${atRiskVehicles.length} คัน เรียงตามความเร่งด่วน`}
          >
            <div className="space-y-2">
              {atRiskVehicles.map(v => <VehicleAtRiskRow key={v.id} vehicle={v} />)}
            </div>
          </DashboardSection>
        </div>
      )}

      {/* Executive summary */}
      <AlertBanner variant="info" title="สรุปผู้บริหาร" icon={FileText}>
        <ul className="space-y-1 mt-1 list-disc pl-4">
          <li>รถรับส่ง <strong>{data.total_vehicles} คัน</strong> ให้บริการ <strong>{data.total_students} คน</strong> ใน <strong>{data.total_schools} โรงเรียน</strong></li>
          <li>KPI ส่งเช้า <strong className={kpiColor(data.morning_kpi)}>{safePct(data.morning_kpi)}</strong> · รับเย็น <strong className={kpiColor(data.evening_kpi)}>{safePct(data.evening_kpi)}</strong></li>
          {problemSchools.length > 0
            ? <li><strong className="text-danger">{problemSchools.length} โรงเรียน</strong>ยังมีรายการค้าง</li>
            : <li><strong className="text-success">ทุกโรงเรียนดำเนินการครบ</strong></li>}
          {hasEmergency && <li>เหตุฉุกเฉิน <strong className="text-danger">{data.recent_emergencies} ครั้ง</strong></li>}
        </ul>
      </AlertBanner>
    </div>
  );
}

/* ── Domain-specific sub-components ── */

function SessionProgress({ label, icon: Icon, done, total, pending, leave, kpi }) {
  const notStarted = total === 0;
  const pct = notStarted ? 0 : Math.round((done / total) * 100);
  const pendingPct = notStarted ? 0 : Math.round((pending / total) * 100);
  const isComplete = !notStarted && pending === 0;

  // Neutral when nothing has happened yet — never danger for "0% before day started."
  const kpiTone = notStarted ? 'text-ink-muted'
                : isComplete ? 'text-success'
                : pct >= 80  ? 'text-warn'
                : 'text-danger';

  return (
    <AppCard padding="md" className={isComplete ? 'border-success/40 bg-success-soft/40' : ''}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-ink-muted" strokeWidth={2} />}
          <span className="text-sm font-semibold text-ink">{label}</span>
        </div>
        <span className={`text-xl font-semibold tabular-nums ${kpiTone}`}>
          {notStarted ? 'ยังไม่เริ่ม' : safePct(kpi)}
        </span>
      </div>
      <div className="flex w-full h-2.5 rounded-full overflow-hidden bg-surface mb-2">
        {done > 0 && <div className="bg-success h-full transition-all" style={{ width: `${pct}%` }} />}
        {pending > 0 && <div className="bg-danger/80 h-full" style={{ width: `${pendingPct}%` }} />}
      </div>
      <div className="flex justify-between text-xs">
        <span className={notStarted ? 'text-ink-muted tabular-nums' : 'text-success font-medium tabular-nums'}>
          {notStarted ? 'รอเริ่มรอบ' : `${done}/${total}`}
        </span>
        <div className="flex gap-3">
          {pending > 0 && <span className="text-danger font-medium">รอ {pending}</span>}
          {leave > 0   && <span className="text-warn">ลา {leave}</span>}
        </div>
      </div>
    </AppCard>
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
      <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" strokeWidth={2.2} />
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

/* ── Executive Attention Panel: 3-card hero grid for at-a-glance triage ── */
/* Compact "X minutes ago" formatter used inside AttentionCard rows. The
   detailed IncidentEntry below uses absolute datetimes — this helper is
   intentionally terser to fit a card secondary line. */
function relativeTime(iso) {
  if (!iso) return '-';
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60)    return `${sec} วินาทีก่อน`;
  if (sec < 3600)  return `${Math.floor(sec / 60)} นาทีก่อน`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ชั่วโมงก่อน`;
  return `${Math.floor(sec / 86400)} วันก่อน`;
}

function ExecutiveAttentionPanel({ schools, incidents, vehicles, onJump }) {
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
        onJump={() => onJump('schools')}
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
        onJump={() => onJump('incidents')}
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
        onJump={() => onJump('vehicles')}
        emptyLabel="ไม่มีรถต้องติดตาม"
      />
    </div>
  );
}

function AttentionCard({ icon: Icon, title, count, variant, items, onJump, emptyLabel }) {
  const interactive = count > 0;
  // Render as a real <button> when interactive so click + Enter + Space all
  // fire onJump natively and screen readers announce "button". Fall back to
  // a plain <div> for the empty state — there's nothing to navigate to.
  const Wrapper = interactive ? 'button' : 'div';
  const wrapperProps = interactive
    ? { type: 'button', onClick: onJump,
        className: 'block w-full text-left transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-xl' }
    : { className: 'block w-full text-left' };

  return (
    <Wrapper {...wrapperProps}>
      <AppCard padding="md" className="h-full">
        <div className="flex items-center gap-2 mb-2">
          {Icon && <Icon className="w-4 h-4 text-ink-muted" strokeWidth={2} />}
          <span className="text-sm font-semibold text-ink truncate">{title}</span>
          <span className="ml-auto">
            <StatusBadge variant={variant} size="sm">{count}</StatusBadge>
          </span>
        </div>
        {interactive ? (
          <>
            <ul className="space-y-1.5">
              {items.map(it => (
                <li key={it.key} className="min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{it.primary}</p>
                  <p className="text-xs text-ink-muted truncate">{it.secondary}</p>
                </li>
              ))}
            </ul>
            <p className="text-xs text-brand font-medium mt-3">ดูทั้งหมด →</p>
          </>
        ) : (
          <p className="text-xs text-ink-muted">{emptyLabel}</p>
        )}
      </AppCard>
    </Wrapper>
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
        className="ml-1 p-1 rounded-full hover:bg-surface-border transition disabled:opacity-50"
        aria-label="รีเฟรชข้อมูล"
      >
        <RotateCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} strokeWidth={2.2} />
      </button>
    </div>
  );
}
