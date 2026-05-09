import { useState, useEffect } from 'react';
import {
  Bus, GraduationCap, Building2, Clock, AlertTriangle,
  Sunrise, Sunset, FileText,
} from 'lucide-react';
import api from '../../api/axios';
import { safePct, kpiColor } from '../../utils/kpi';
import { PAGE_TITLES, UI_MESSAGES } from '../../constants/uiLabels';
import {
  AppCard, AlertBanner, KPIGrid, KPIStat,
  RiskCard, DashboardSection, StatusBadge,
} from '../../components/ui';

export default function ProvinceDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/province/dashboard')
      .then(r => setData(r.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-ink-muted py-10 text-center text-lg">{UI_MESSAGES.LOADING}</p>;
  if (!data) return <p className="text-ink-muted py-10 text-center text-lg">{UI_MESSAGES.NO_DATA}</p>;

  const affs = data.affiliations ?? [];
  const problemSchools = data.schools_not_complete ?? [];
  const hasEmergency = data.recent_emergencies > 0;
  const totalPending = (data.morning_pending || 0) + (data.evening_pending || 0);
  const allClear = problemSchools.length === 0 && !hasEmergency && totalPending === 0;

  const dateLabel = data.date
    ? new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  // Build alert lines (consolidated into one banner)
  const alertLines = [];
  if (problemSchools.length > 0) alertLines.push(`${problemSchools.length} โรงเรียนยังมีรายการค้าง`);
  if (data.morning_pending > 20) alertLines.push(`รอส่งเช้า ${data.morning_pending} คน`);
  if (data.evening_pending > 20) alertLines.push(`รอรับเย็น ${data.evening_pending} คน`);
  if (hasEmergency) alertLines.push(`เหตุฉุกเฉิน ${data.recent_emergencies} ครั้ง (7 วัน)`);
  if ((data.leave_count ?? 0) > 10) alertLines.push(`ลาวันนี้ ${data.leave_count} คน`);

  const bannerVariant = problemSchools.length > 0 || hasEmergency ? 'danger'
                      : alertLines.length > 0 ? 'warn'
                      : 'success';

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold text-ink leading-tight">{PAGE_TITLES.PROVINCE_DASHBOARD}</h1>
        {dateLabel && <p className="text-sm text-ink-muted mt-1">ข้อมูล ณ {dateLabel}</p>}
      </header>

      {/* Status banner */}
      {allClear ? (
        <AlertBanner variant="success" title="ระบบปกติ — ทุกโรงเรียนดำเนินการครบ" />
      ) : (
        <AlertBanner variant={bannerVariant} title="สิ่งที่ต้องติดตามทันที">
          <ul className="space-y-1 mt-1">
            {alertLines.map((line, i) => (
              <li key={i} className="text-ink">{line}</li>
            ))}
          </ul>
        </AlertBanner>
      )}

      {/* KPI Grid */}
      <KPIGrid cols={4}>
        <KPIStat
          label="รถรับส่ง"
          value={data.total_vehicles}
          icon={Bus}
          variant="brand"
          hint={data.total_students > 0
            ? `เฉลี่ย ${Math.round(data.total_students / data.total_vehicles)} คน/คัน`
            : null}
        />
        <KPIStat
          label="นักเรียน"
          value={data.total_students}
          icon={GraduationCap}
          variant="brand"
          hint={`${data.total_schools} ร.ร. · ${data.total_vehicles} คัน`}
        />
        <KPIStat
          label="โรงเรียน"
          value={data.total_schools}
          icon={Building2}
          variant={problemSchools.length > 0 ? 'warn' : 'brand'}
          hint={`${data.total_affiliations} สังกัด · ค้าง ${problemSchools.length}`}
        />
        <KPIStat
          label={totalPending > 0 ? 'รอดำเนินการ' : 'ครบแล้ว'}
          value={totalPending > 0 ? totalPending : '✓'}
          icon={totalPending > 0 ? Clock : null}
          variant={totalPending > 50 ? 'danger' : totalPending > 0 ? 'warn' : 'success'}
          hint={totalPending > 0
            ? `เช้า ${data.morning_pending} · เย็น ${data.evening_pending}`
            : 'ทุกรายการ'}
        />
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

      {/* Risk schools */}
      {problemSchools.length > 0 && (
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
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const pendingPct = total > 0 ? Math.round((pending / total) * 100) : 0;
  const isComplete = pending === 0 && total > 0;
  const kpiTone = isComplete ? 'text-success' : pct >= 80 ? 'text-warn' : 'text-danger';

  return (
    <AppCard padding="md" className={isComplete ? 'border-success/40 bg-success-soft/40' : ''}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-ink-muted" strokeWidth={2} />}
          <span className="text-sm font-semibold text-ink">{label}</span>
        </div>
        <span className={`text-xl font-bold tabular-nums ${kpiTone}`}>{safePct(kpi)}</span>
      </div>
      <div className="flex w-full h-2.5 rounded-full overflow-hidden bg-surface mb-2">
        {done > 0 && <div className="bg-success h-full transition-all" style={{ width: `${pct}%` }} />}
        {pending > 0 && <div className="bg-danger/80 h-full" style={{ width: `${pendingPct}%` }} />}
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-success font-medium tabular-nums">{done}/{total}</span>
        <div className="flex gap-3">
          {pending > 0 && <span className="text-danger font-medium">รอ {pending}</span>}
          {leave > 0 && <span className="text-warn">ลา {leave}</span>}
        </div>
      </div>
    </AppCard>
  );
}
