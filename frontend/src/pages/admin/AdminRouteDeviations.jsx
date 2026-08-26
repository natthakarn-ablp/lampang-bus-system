import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Route, Clock, PauseCircle } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import AppCard from '../../components/ui/AppCard';
import StatusBadge from '../../components/ui/StatusBadge';
import FilterBar from '../../components/ui/FilterBar';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';

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
// The badge and the filter both showed the raw enum. A duty officer reading
// "WARN" has to know the enum; the Thai word is the same information.
const SEVERITY_LABEL = {
  INFO: 'ข้อมูล',
  WARN: 'เตือน',
  CRITICAL: 'วิกฤต',
};

export default function AdminRouteDeviations() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  // A failed load raised a toast and left the previous rows on screen — or an
  // empty list reading as "no deviations", which on this page means "all clear".
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState({ unresolvedOnly: false, severity: '' });

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter.unresolvedOnly) params.set('unresolved', 'true');
      if (filter.severity) params.set('severity', filter.severity);
      params.set('limit', '100');
      const res = await api.get(`/route-deviations?${params}`);
      setRows(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลการเบี่ยงเส้นทางไม่สำเร็จ');
      setRows([]);
    } finally { setBusy(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const unresolved = rows.filter((r) => !r.resolved_at).length;
  const hasFilter = filter.unresolvedOnly || Boolean(filter.severity);

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto motion-safe:animate-fade-in-up motion-reduce:animate-none">
      <PageHeader
        icon={AlertTriangle}
        title="การเบี่ยงเส้นทาง / ความล่าช้า"
        subtitle="ตรวจจับรถที่เบี่ยงเส้นทาง ล่าช้า หรือหยุดนิ่งนานผิดปกติ"
      />

      <FilterBar
        className="mb-4"
        chips={{
          label: 'กรองตามระดับความรุนแรง',
          value: filter.severity,
          onChange: (v) => setFilter(f => ({ ...f, severity: v })),
          options: [
            ['', 'ทุกระดับ'],
            ['CRITICAL', SEVERITY_LABEL.CRITICAL],
            ['WARN', SEVERITY_LABEL.WARN],
            ['INFO', SEVERITY_LABEL.INFO],
          ],
        }}
        count={rows.length}
        countLabel="เหตุการณ์"
        onClear={hasFilter ? () => setFilter({ unresolvedOnly: false, severity: '' }) : undefined}
        actions={(
          <button
            type="button"
            aria-pressed={filter.unresolvedOnly}
            onClick={() => setFilter(f => ({ ...f, unresolvedOnly: !f.unresolvedOnly }))}
            className={`focus-ring rounded-lg px-3 min-h-[44px] text-sm font-medium border transition ${
              filter.unresolvedOnly
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-surface-raised text-ink border-surface-border hover:bg-surface'
            }`}
          >
            เฉพาะที่ยังไม่แก้ไข ({unresolved})
          </button>
        )}
      />

      {busy && rows.length === 0 ? (
        <LoadingState message="กำลังโหลดการเบี่ยงเส้นทาง…" />
      ) : error ? (
        <ErrorState title="โหลดข้อมูลไม่สำเร็จ" message={error} onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Route}
          title="ไม่มีการเบี่ยงเส้นทาง / ความล่าช้าในช่วงที่เลือก"
          description={hasFilter ? 'ลองล้างตัวกรองเพื่อดูทั้งหมด' : undefined}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {rows.map((r) => {
            const Icon = TYPE_ICON[r.deviation_type] || AlertTriangle;
            return (
              <li key={r.id}>
                <AppCard padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon className="w-5 h-5 text-brand-600 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink">
                        {TYPE_LABEL[r.deviation_type] || 'เหตุการณ์ผิดปกติ'} — รถ {r.vehicle_id}
                        {r.deviation_type === 'OFF_ROUTE' && r.offset_meters != null && ` · เบี่ยง ${r.offset_meters} เมตร`}
                        {r.deviation_type === 'LATE' && r.delay_minutes != null && ` · ล่าช้า ${r.delay_minutes} นาที`}
                        {r.deviation_type === 'STALLED' && r.delay_minutes != null && ` · นิ่ง ${r.delay_minutes} นาที`}
                      </div>
                      <div className="text-xs text-ink-muted">
                        {new Date(r.occurred_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                        {r.resolved_at && ` → แก้ไขแล้วเมื่อ ${new Date(r.resolved_at).toLocaleTimeString('th-TH', { timeStyle: 'short' })}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge variant={SEVERITY_VARIANT[r.severity] || 'neutral'} size="sm">
                      {SEVERITY_LABEL[r.severity] || r.severity}
                    </StatusBadge>
                    {!r.resolved_at && <StatusBadge variant="warn" size="sm">ยังไม่แก้ไข</StatusBadge>}
                  </div>
                </AppCard>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
