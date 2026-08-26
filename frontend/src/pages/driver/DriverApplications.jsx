import { useState, useEffect, useCallback } from 'react';
import {
  Bus, FileCheck2, RefreshCw, Plus, ChevronDown,
} from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import AppCard from '../../components/ui/AppCard';
import StatusBadge from '../../components/ui/StatusBadge';
import { StatusStepRail, FormField} from '../../components/ui';
import { PageTransition } from '../../lib/motion';

const STATUS = {
  PENDING_SCHOOL_REVIEW: ['รอโรงเรียนตรวจสอบ', 'warn'],
  DRAFT: ['ฉบับร่าง', 'neutral'],
  READY_TO_PRINT: ['พร้อมพิมพ์', 'info'],
  SUBMITTED: ['ยื่นแล้ว', 'info'],
  INSPECTION_PENDING: ['กำลังตรวจ', 'warn'],
  NEEDS_FIX: ['ต้องแก้ไข', 'warn'],
  PASSED: ['ผ่าน', 'success'],
  FAILED: ['ไม่ผ่าน', 'danger'],
  REJECTED: ['โรงเรียนปฏิเสธ', 'danger'],
  CANCELLED: ['ยกเลิก', 'neutral'],
  EXPIRED: ['หมดอายุ', 'danger'],
  SUPERSEDED: ['มีฉบับใหม่', 'neutral'],
};

const CLOSED = new Set(['CANCELLED', 'FAILED', 'PASSED', 'EXPIRED', 'SUPERSEDED', 'REJECTED']);

const STEP_RAIL = [
  { key: 'PENDING_SCHOOL_REVIEW', label: 'ยื่นคำขอ' },
  { key: 'READY_TO_PRINT', label: 'โรงเรียนตรวจสอบ' },
  { key: 'SUBMITTED', label: 'ยื่นตรวจ' },
  { key: 'INSPECTION_PENDING', label: 'ตรวจสภาพ' },
  { key: 'PASSED', label: 'ผลตรวจ' },
];

function statusToStep(status) {
  const map = {
    PENDING_SCHOOL_REVIEW: 0, DRAFT: 0, READY_TO_PRINT: 1, SUBMITTED: 2,
    INSPECTION_PENDING: 3, NEEDS_FIX: 3, PASSED: 4, FAILED: 4,
    REJECTED: 1, CANCELLED: -1, EXPIRED: -1, SUPERSEDED: -1,
  };
  return map[status] ?? 0;
}

export default function DriverApplications() {
  const toast = useToast();
  const [applications, setApplications] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [timeline, setTimeline] = useState({});

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [appsRes, vehiclesRes] = await Promise.all([
        api.get('/driver/applications'),
        api.get('/driver/authorized-vehicles'),
      ]);
      setApplications(appsRes.data.data || []);
      setVehicles(vehiclesRes.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selectedVehicle) { toast.error('กรุณาเลือกรถ'); return; }
    setSubmitting(true);
    try {
      await api.post('/driver/applications', { vehicle_id: Number(selectedVehicle) });
      toast.success('ยื่นคำขอขึ้นทะเบียนรถสำเร็จ');
      setShowForm(false);
      setSelectedVehicle('');
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ยื่นคำขอไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleExpand(appId) {
    if (expandedId === appId) { setExpandedId(null); return; }
    setExpandedId(appId);
    if (!timeline[appId]) {
      try {
        const res = await api.get(`/verification/applications/${appId}/timeline`);
        setTimeline(prev => ({ ...prev, [appId]: res.data.data || [] }));
      } catch { /* ignore */ }
    }
  }

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={fetchData} />;

  const activeApps = applications.filter(a => !CLOSED.has(a.status));
  const closedApps = applications.filter(a => CLOSED.has(a.status));

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <PageHeader
          title="ขึ้นทะเบียนรถ"
          subtitle="ยื่นคำขอและติดตามสถานะการขึ้นทะเบียนรถรับส่งนักเรียน"
          icon={FileCheck2}
          actions={
          <div className="flex gap-2">
            <button onClick={fetchData} className="inline-flex items-center gap-1.5 bg-surface-raised hover:bg-surface text-ink text-sm font-medium px-3 py-2 rounded-lg border border-surface-border transition min-h-[44px]">
              <RefreshCw className="w-4 h-4" /> รีเฟรช
            </button>
            {vehicles.length > 0 && (
              <button onClick={() => setShowForm(v => !v)} className="inline-flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-surface-raised text-sm font-medium px-3.5 py-2 rounded-lg transition min-h-[44px]">
                <Plus className="w-4 h-4" /> ยื่นคำขอ
              </button>
            )}
          </div>
          }
        />

        {showForm && (
          <AppCard padding="lg" className="border-brand-200">
            <h2 className="text-base font-semibold text-ink mb-3">ยื่นคำขอขึ้นทะเบียนรถ</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <FormField label="เลือกรถ" helper="ระบบจะสร้างคำขอและส่งให้โรงเรียนตรวจสอบอัตโนมัติ">
                {ctl => (
                  <select {...ctl} value={selectedVehicle} onChange={e => setSelectedVehicle(e.target.value)}
                    className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink transition">
                    <option value="">— เลือกรถ —</option>
                    {vehicles.map(v => (
                      <option key={v.vehicle_id} value={v.vehicle_id}>{v.plate_no} {v.vehicle_type || ''}</option>
                    ))}
                  </select>
                )}
              </FormField>
              <div className="flex gap-2">
                <button type="submit" disabled={submitting}
                  className="inline-flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-surface-raised text-sm font-medium px-4 py-2 rounded-lg transition min-h-[44px]">
                  {submitting ? 'กำลังส่ง...' : 'ยื่นคำขอ'}
                </button>
                <button type="button" onClick={() => setShowForm(false)}
                  className="inline-flex items-center gap-1.5 bg-surface-raised hover:bg-surface text-ink text-sm font-medium px-4 py-2 rounded-lg border border-surface-border transition min-h-[44px]">
                  ยกเลิก
                </button>
              </div>
            </form>
          </AppCard>
        )}

        {activeApps.length === 0 && closedApps.length === 0 ? (
          <EmptyState icon={FileCheck2} title="ยังไม่มีคำขอขึ้นทะเบียน"
            description={vehicles.length > 0 ? 'กด "ยื่นคำขอ" เพื่อเริ่มขึ้นทะเบียนรถ' : 'คุณยังไม่มีรถที่ได้รับอนุญาต กรุณาติดต่อโรงเรียนหรือสังกัด'} />
        ) : (
          <>
            {activeApps.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-ink-muted">คำขอที่ดำเนินการอยู่ ({activeApps.length})</h2>
                {activeApps.map(app => (
                  <ApplicationCard key={app.id} app={app} isExpanded={expandedId === app.id}
                    onToggle={() => toggleExpand(app.id)} timeline={timeline[app.id]} />
                ))}
              </div>
            )}
            {closedApps.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-ink-muted pt-4">ประวัติ ({closedApps.length})</h2>
                {closedApps.map(app => (
                  <ApplicationCard key={app.id} app={app} isExpanded={expandedId === app.id}
                    onToggle={() => toggleExpand(app.id)} timeline={timeline[app.id]} compact />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </PageTransition>
  );
}

function ApplicationCard({ app, isExpanded, onToggle, timeline, compact }) {
  const [label, variant] = STATUS[app.status] || [app.status || '-', 'neutral'];
  const stepIndex = statusToStep(app.status);

  return (
    <AppCard padding="none" className="overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-surface transition">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0 bg-brand-soft text-brand-700">
            <Bus className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <h3 className="font-semibold text-ink text-base truncate">{app.plate_no || app.vehicle?.plate_no}</h3>
            <p className="text-sm text-ink-muted truncate">{app.request_no} · {app.issuing_school_name || ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge variant={variant} size="sm">{label}</StatusBadge>
          <ChevronDown className={`w-4 h-4 text-ink-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-surface-border p-4 space-y-4">
          {!compact && stepIndex >= 0 && (
            <StatusStepRail steps={STEP_RAIL} currentIndex={stepIndex} />
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-xs text-ink-muted">นักเรียนเช้า</p>
              <p className="font-semibold text-ink">{app.morning_rider_count ?? 0} คน</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">นักเรียนเย็น</p>
              <p className="font-semibold text-ink">{app.evening_rider_count ?? 0} คน</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">รวม (peak)</p>
              <p className="font-semibold text-ink">{app.peak_rider_count ?? 0} คน</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">โรงเรียนที่ใช้ร่วม</p>
              <p className="font-semibold text-ink">{app.total_schools ?? 1} โรงเรียน</p>
            </div>
          </div>

          {app.schools && app.schools.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-ink-muted mb-1.5">โรงเรียนที่รับส่ง</p>
              <div className="flex flex-wrap gap-1.5">
                {app.schools.map(s => (
                  <span key={s.school_id} className="text-xs bg-surface border border-surface-border px-2 py-1 rounded">
                    {s.school_name} ({s.morning_rider_count}/{s.evening_rider_count})
                  </span>
                ))}
              </div>
            </div>
          )}

          {timeline && timeline.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-ink-muted mb-2">ไทม์ไลน์</p>
              <div className="space-y-2">
                {timeline.map((t, i) => (
                  <div key={t.id || i} className="flex items-start gap-2 text-xs">
                    <span className="text-ink-muted tabular-nums shrink-0">
                      {new Date(t.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })}
                    </span>
                    <div>
                      <span className="font-medium text-ink">{t.actor_name}</span>
                      <span className="text-ink-muted"> — {t.action}</span>
                      {t.new_value?.status && (
                        <span className="ml-1 text-ink">→ {STATUS[t.new_value.status]?.[0] || t.new_value.status}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </AppCard>
  );
}
