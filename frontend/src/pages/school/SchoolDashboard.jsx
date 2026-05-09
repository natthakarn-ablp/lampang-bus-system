import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, GraduationCap, Bus, ClipboardList, AlertTriangle,
  Sunrise, Sunset, ChevronDown,
} from 'lucide-react';
import api from '../../api/axios';
import PlateSearchInput from '../../components/PlateSearchInput';
import { DonutChart, HBarChart } from '../../components/MiniCharts';
import PageHeader from '../../components/PageHeader';
import { SkeletonKpiGrid } from '../../components/Skeleton';
import {
  AppCard, AlertBanner, KPIGrid, KPIStat,
  StatusBadge, DashboardSection, SectionTitle,
} from '../../components/ui';
import {
  PAGE_TITLES, CARD_LABELS, CHART_TITLES, SECTION_TITLES,
  STATUS, UI_MESSAGES, MORNING_SEGMENTS, EVENING_SEGMENTS,
} from '../../constants/uiLabels';

export default function SchoolDashboard() {
  const [data, setData] = useState(null);
  const [statusData, setStatusData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedVehicle, setExpandedVehicle] = useState(null);
  const [plateSearch, setPlateSearch] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/school/dashboard').then(r => r.data.data),
      api.get('/school/status-today').then(r => r.data.data),
    ])
      .then(([dash, status]) => { setData(dash); setStatusData(status); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
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

      {loading ? (
        <div className="space-y-4">
          <SkeletonKpiGrid count={4} />
          <SkeletonKpiGrid count={2} />
        </div>
      ) : (
        <>
          {/* Status banner */}
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

          {/* Data completeness */}
          {data?.completeness && <CompletenessCard c={data.completeness} />}

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

          {/* Session progress */}
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

          {/* Charts row */}
          {vehicles.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <AppCard padding="md">
                <p className="text-xs font-semibold text-ink-muted mb-3 text-center">{CHART_TITLES.MORNING_STATUS}</p>
                <DonutChart
                  size={110} thickness={16}
                  label={`${data?.morning_total > 0 ? Math.round(((data?.morning_done ?? 0) / data.morning_total) * 100) : 0}%`}
                  sublabel={STATUS.DONE}
                  segments={MORNING_SEGMENTS(data?.morning_done ?? 0, data?.morning_leave ?? 0, data?.morning_pending ?? 0)}
                />
              </AppCard>
              <AppCard padding="md">
                <p className="text-xs font-semibold text-ink-muted mb-3 text-center">{CHART_TITLES.EVENING_STATUS}</p>
                <DonutChart
                  size={110} thickness={16}
                  label={`${data?.evening_total > 0 ? Math.round(((data?.evening_done ?? 0) / data.evening_total) * 100) : 0}%`}
                  sublabel={STATUS.DONE}
                  segments={EVENING_SEGMENTS(data?.evening_done ?? 0, data?.evening_leave ?? 0, data?.evening_pending ?? 0)}
                />
              </AppCard>
              <AppCard padding="md">
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
          )}

          {/* Vehicle status section */}
          <DashboardSection
            title={SECTION_TITLES.VEHICLE_STATUS}
            description={`${filtered.length} คัน${plateSearch ? ' (กรอง)' : ''}`}
            action={<PlateSearchInput value={plateSearch} onChange={setPlateSearch} />}
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
        <span className={`text-sm font-bold tabular-nums ${overallTone}`}>{Math.round(overallPct)}%</span>
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
  const allDone = pending === 0 && total > 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const barCls = allDone ? 'bg-success' : pct >= 80 ? 'bg-warn' : 'bg-danger';
  const pctTone = allDone ? 'text-success' : pct >= 80 ? 'text-warn' : 'text-danger';

  return (
    <AppCard padding="md" className={allDone ? 'border-success/40' : ''}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-ink-muted" strokeWidth={2} />}
          <span className="text-sm font-semibold text-ink">{label}</span>
        </div>
        <span className={`text-xs font-bold tabular-nums ${pctTone}`}>{pct}%</span>
      </div>
      <div className="w-full bg-surface rounded-full h-2 mb-2">
        <div className={`h-2 rounded-full transition-all ${barCls}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className={allDone ? 'text-success font-medium' : 'text-ink-muted'}>
          {allDone ? `${label}ครบแล้ว ✓` : `${done}/${total - leave} คน`}
        </span>
        <div className="flex gap-2">
          {pending > 0 && <span className="text-danger font-medium">{STATUS.PENDING} {pending}</span>}
          {leave > 0 && <span className="text-warn">{STATUS.LEAVE} {leave}</span>}
        </div>
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
  const railColor = allMorningDone && allEveningDone ? 'bg-success'
                  : mPending + ePending > 0 ? 'bg-warn'
                  : 'bg-surface-border';

  return (
    <AppCard padding="none" className="overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-surface transition"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-1.5 h-9 rounded-full shrink-0 ${railColor}`} />
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
      {pending > 0 && <span className="text-danger font-bold ml-0.5">({pending})</span>}
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
