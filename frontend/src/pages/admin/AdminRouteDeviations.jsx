import { useEffect, useState } from 'react';
import { AlertTriangle, Route, Clock, PauseCircle } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import AppCard from '../../components/ui/AppCard';
import StatusBadge from '../../components/ui/StatusBadge';
import SectionTitle from '../../components/ui/SectionTitle';
import AlertBanner from '../../components/ui/AlertBanner';
import LoadingState from '../../components/LoadingState';

// Phase 11A — Route deviation log (admin / province).

const TYPE_ICON = {
  OFF_ROUTE: Route,
  LATE: Clock,
  STALLED: PauseCircle,
};
const TYPE_LABEL = {
  OFF_ROUTE: 'เบี่ยงเส้นทาง',
  LATE: 'ล่าช้า',
  STALLED: 'หยุดนิ่งนาน',
};
const SEVERITY_VARIANT = {
  INFO: 'info',
  WARN: 'warn',
  CRITICAL: 'danger',
};

export default function AdminRouteDeviations() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState({ unresolvedOnly: false, severity: '' });

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);
  async function load() {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (filter.unresolvedOnly) params.set('unresolved', 'true');
      if (filter.severity) params.set('severity', filter.severity);
      params.set('limit', '100');
      const res = await api.get(`/route-deviations?${params}`);
      setRows(res.data.data || []);
    } catch { toast.error('โหลดข้อมูลไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  const unresolved = rows.filter((r) => !r.resolved_at).length;

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto motion-safe:animate-fade-in-up motion-reduce:animate-none">
      <SectionTitle
        title="การเบี่ยงเส้นทาง / ความล่าช้า"
        description="ตรวจจับรถที่เบี่ยงเส้นทาง, ล่าช้า, หรือหยุดนิ่งนานผิดปกติ"
        className="mb-4"
      />

      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setFilter({ ...filter, unresolvedOnly: !filter.unresolvedOnly })}
          className={`rounded-lg px-3 py-2 text-sm border ${filter.unresolvedOnly ? 'bg-brand-600 text-white border-brand-600' : 'bg-surface-raised border-surface-border'}`}>
          เฉพาะที่ยังไม่ resolved ({unresolved})
        </button>
        {['WARN', 'CRITICAL', 'INFO'].map((sev) => (
          <button key={sev} onClick={() => setFilter({ ...filter, severity: filter.severity === sev ? '' : sev })}
            className={`rounded-lg px-3 py-2 text-sm border ${filter.severity === sev ? 'bg-brand-600 text-white border-brand-600' : 'bg-surface-raised border-surface-border'}`}>
            {sev}
          </button>
        ))}
      </div>

      {busy && rows.length === 0 ? (
        <LoadingState label="กำลังโหลดการเบี่ยงเส้นทาง..." />
      ) : null}

      {rows.length === 0 && !busy && (
        <AlertBanner tone="success">ไม่มีการเบี่ยงเส้นทาง / ความล่าช้าในช่วงที่เลือก</AlertBanner>
      )}

      <div className="grid grid-cols-1 gap-2">
        {rows.map((r) => {
          const Icon = TYPE_ICON[r.deviation_type] || AlertTriangle;
          return (
            <AppCard key={r.id} padding="sm" className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Icon className="w-5 h-5 text-brand-600 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">
                    {TYPE_LABEL[r.deviation_type]} — รถ {r.vehicle_id}
                    {r.deviation_type === 'OFF_ROUTE' && r.offset_meters != null && ` · เบี่ยง ${r.offset_meters}m`}
                    {r.deviation_type === 'LATE' && r.delay_minutes != null && ` · ล่าช้า ${r.delay_minutes} นาที`}
                    {r.deviation_type === 'STALLED' && r.delay_minutes != null && ` · นิ่ง ${r.delay_minutes} นาที`}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {new Date(r.occurred_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                    {r.resolved_at && ` → resolved ${new Date(r.resolved_at).toLocaleTimeString('th-TH', { timeStyle: 'short' })}`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge variant={SEVERITY_VARIANT[r.severity] || 'neutral'} size="sm">
                  {r.severity}
                </StatusBadge>
                {!r.resolved_at && <StatusBadge variant="warn" size="sm">ยังไม่ resolved</StatusBadge>}
              </div>
            </AppCard>
          );
        })}
      </div>
    </div>
  );
}
