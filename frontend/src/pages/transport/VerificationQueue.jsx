import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  ClipboardCheck,
  FileCheck2,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import AppCard from '../../components/ui/AppCard';
import StatusBadge from '../../components/ui/StatusBadge';
import { CommandHero, StatusStepRail } from '../../components/ui';

const STATUS = {
  DRAFT: ['ฉบับร่าง', 'neutral'],
  READY_TO_PRINT: ['รอรับรถ', 'info'],
  SUBMITTED: ['ยื่นแล้ว', 'info'],
  INSPECTION_PENDING: ['กำลังตรวจ', 'warn'],
  NEEDS_FIX: ['ต้องแก้ไข', 'warn'],
  PASSED: ['ผ่าน', 'success'],
  FAILED: ['ไม่ผ่าน', 'danger'],
  CANCELLED: ['ยกเลิก', 'neutral'],
};

const RESULT_STYLE = {
  PASS: 'bg-success text-white border-success',
  FAIL: 'bg-danger text-white border-danger',
  NOT_APPLICABLE: 'bg-ink text-white border-ink',
};

function Badge({ status }) {
  const [label, variant] = STATUS[status] || [status || '-', 'neutral'];
  return <StatusBadge variant={variant}>{label}</StatusBadge>;
}

function queueCount(queue, statuses) {
  return queue.filter(item => statuses.includes(item.status)).length;
}

function QueueSummary({ queue }) {
  const items = [
    { label: 'รอรับรถ', value: queueCount(queue, ['READY_TO_PRINT', 'SUBMITTED']), variant: 'info' },
    { label: 'กำลังตรวจ', value: queueCount(queue, ['INSPECTION_PENDING']), variant: 'warn' },
    { label: 'ต้องแก้ไข', value: queueCount(queue, ['NEEDS_FIX']), variant: 'warn' },
    { label: 'ผ่านแล้ว', value: queueCount(queue, ['PASSED']), variant: 'success' },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-4">
      {items.map(item => (
        <div key={item.label} className="rounded-xl bg-white/10 px-3 py-2 text-blue-50">
          <p className="text-xs text-blue-200">{item.label}</p>
          <p className="mt-1 text-lg font-bold">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function QueueItem({ application, selected, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(application.id)}
      className={`w-full rounded-xl border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40 ${
        selected ? 'border-brand-600 bg-brand-50' : 'border-surface-border bg-white hover:bg-surface'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-base font-bold text-ink">{application.plate_no}</span>
          <span className="mt-1 block truncate text-xs text-ink-muted">{application.request_no}</span>
        </span>
        <Badge status={application.status} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-ink-muted">
        <span className="rounded-full bg-surface px-2.5 py-1">สูงสุด {application.peak_rider_count} คน</span>
        <span className="rounded-full bg-surface px-2.5 py-1">{application.issuing_school_name}</span>
      </div>
    </button>
  );
}

function progressSteps(detail, attemptId) {
  const hasDetail = Boolean(detail);
  const resultDone = ['PASSED', 'FAILED', 'NEEDS_FIX'].includes(detail?.status);
  return [
    {
      key: 'queue',
      label: 'เลือกคำขอ',
      description: 'คิวรวมตามทะเบียนรถ',
      status: hasDetail ? 'complete' : 'current',
    },
    {
      key: 'vehicle',
      label: 'ตรวจข้อมูลรถ',
      description: 'รถ คนขับ จำนวนเด็ก พื้นที่',
      status: hasDetail ? (attemptId ? 'complete' : 'current') : 'upcoming',
    },
    {
      key: 'checklist',
      label: 'ลง checklist',
      description: 'ตรวจทุกหัวข้อที่กำหนด',
      status: attemptId ? 'current' : resultDone ? 'complete' : 'upcoming',
    },
    {
      key: 'result',
      label: 'รับรองผล',
      description: 'บันทึกผลและวันหมดอายุ',
      status: resultDone ? (detail?.status === 'FAILED' ? 'danger' : detail?.status === 'NEEDS_FIX' ? 'warning' : 'complete') : 'upcoming',
    },
  ];
}

function VehicleDetailSummary({ detail, onStart, busy, attemptId }) {
  const canStart = !attemptId && ['READY_TO_PRINT', 'SUBMITTED', 'NEEDS_FIX', 'INSPECTION_PENDING'].includes(detail.status);
  return (
    <AppCard>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-ink-muted">{detail.request_no}</p>
          <h2 className="mt-1 text-2xl font-bold leading-tight text-ink">{detail.plate_no}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {detail.vehicle_type || '-'} · ความจุ {detail.certified_capacity || '-'} คน · ผู้โดยสารสูงสุด {detail.peak_rider_count} คน
          </p>
        </div>
        <Badge status={detail.status} />
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Users className="h-4 w-4 text-ink-muted" strokeWidth={2.2} aria-hidden="true" />
            <h3 className="text-sm font-semibold text-ink">โรงเรียนและจำนวนผู้โดยสาร</h3>
          </div>
          <div className="rounded-xl border border-surface-border">
            {(detail.schools || []).map(school => (
              <div key={school.school_id} className="flex justify-between gap-3 border-b border-surface-border px-3 py-2 text-sm last:border-0">
                <span className="min-w-0 truncate text-ink">{school.school_name}</span>
                <span className="shrink-0 text-ink-muted">เช้า {school.morning_rider_count} · เย็น {school.evening_rider_count}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-ink-muted" strokeWidth={2.2} aria-hidden="true" />
            <h3 className="text-sm font-semibold text-ink">คนขับที่ได้รับอนุญาต</h3>
          </div>
          {(detail.drivers || []).length ? (
            <div className="rounded-xl border border-surface-border">
              {detail.drivers.map(driver => (
                <div key={driver.driver_id} className="border-b border-surface-border px-3 py-2 text-sm last:border-0">
                  <p className="font-semibold text-ink">{driver.driver_name}</p>
                  <p className="text-xs text-ink-muted">{driver.assignment_role === 'BACKUP' ? 'คนขับสำรอง' : 'คนขับหลัก'}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-ink">
              <AlertTriangle className="mr-1 inline h-4 w-4 text-danger" strokeWidth={2.2} aria-hidden="true" />
              ยังไม่มีคนขับที่ได้รับอนุญาตสำหรับรถคันนี้
            </div>
          )}

          <div className="mt-4 rounded-xl bg-surface p-3">
            <h3 className="text-sm font-semibold text-ink">พื้นที่รับส่ง</h3>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              {(detail.routes || []).map(route => route.pickup_area).filter(Boolean).join(', ') || '-'}
            </p>
          </div>
        </div>
      </div>

      {canStart && (
        <button
          type="button"
          disabled={busy}
          onClick={onStart}
          className="mt-5 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          <Play className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
          เริ่มการตรวจครั้งใหม่
        </button>
      )}
    </AppCard>
  );
}

function DriverAuthorizationPanel({
  drivers,
  detail,
  busy,
  driverForm,
  setDriverForm,
  qualificationForm,
  setQualificationForm,
  onAssign,
  onQualify,
}) {
  return (
    <AppCard>
      <div className="flex items-center gap-2">
        <UserPlus className="h-5 w-5 text-brand-700" strokeWidth={2.2} aria-hidden="true" />
        <div>
          <h3 className="font-bold text-ink">จัดการคนขับหลักและคนขับสำรอง</h3>
          <p className="text-sm text-ink-muted">ข้อมูลนี้ใช้บอกว่ารถคันนี้อนุญาตให้ใครขับได้บ้าง</p>
        </div>
      </div>

      <div className="mt-4 grid gap-5 xl:grid-cols-2">
        <form onSubmit={onAssign} className="space-y-3 rounded-xl border border-surface-border p-4">
          <p className="text-sm font-semibold text-ink">เพิ่มสิทธิ์ขับรถคันนี้</p>
          <select
            value={driverForm.driver_id}
            onChange={event => setDriverForm(form => ({ ...form, driver_id: event.target.value }))}
            className="min-h-[44px] w-full rounded-lg border border-surface-border bg-white p-2 text-sm"
          >
            <option value="">เลือกคนขับ</option>
            {drivers.map(driver => (
              <option key={driver.id} value={driver.id}>{driver.name} · {driver.qualification_status || 'ยังไม่รับรอง'}</option>
            ))}
          </select>
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={driverForm.assignment_role}
              onChange={event => setDriverForm(form => ({ ...form, assignment_role: event.target.value }))}
              className="min-h-[44px] rounded-lg border border-surface-border bg-white p-2 text-sm"
            >
              <option value="PRIMARY">คนขับหลัก</option>
              <option value="BACKUP">คนขับสำรอง</option>
            </select>
            <input
              type="date"
              value={driverForm.valid_until}
              onChange={event => setDriverForm(form => ({ ...form, valid_until: event.target.value }))}
              className="min-h-[44px] rounded-lg border border-surface-border bg-white p-2 text-sm"
              title="วันสิ้นสุดสิทธิ์"
            />
          </div>
          <button
            disabled={busy || !detail}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            เพิ่มเข้ากลุ่มรถ
          </button>
        </form>

        <form onSubmit={onQualify} className="space-y-3 rounded-xl border border-surface-border p-4">
          <p className="text-sm font-semibold text-ink">รับรองใบอนุญาตคนขับ</p>
          <select
            value={qualificationForm.driver_id}
            onChange={event => setQualificationForm(form => ({ ...form, driver_id: event.target.value }))}
            className="min-h-[44px] w-full rounded-lg border border-surface-border bg-white p-2 text-sm"
          >
            <option value="">เลือกคนขับ</option>
            {drivers.map(driver => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
          </select>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={qualificationForm.license_no}
              onChange={event => setQualificationForm(form => ({ ...form, license_no: event.target.value }))}
              placeholder="เลขใบอนุญาต"
              className="min-h-[44px] rounded-lg border border-surface-border bg-white p-2 text-sm"
            />
            <input
              value={qualificationForm.license_type}
              onChange={event => setQualificationForm(form => ({ ...form, license_type: event.target.value }))}
              placeholder="ประเภท เช่น ท.2"
              className="min-h-[44px] rounded-lg border border-surface-border bg-white p-2 text-sm"
            />
            <input
              type="date"
              value={qualificationForm.license_expiry}
              onChange={event => setQualificationForm(form => ({ ...form, license_expiry: event.target.value }))}
              className="min-h-[44px] rounded-lg border border-surface-border bg-white p-2 text-sm"
              title="วันหมดอายุใบอนุญาต"
            />
            <input
              value={qualificationForm.provider_reference}
              onChange={event => setQualificationForm(form => ({ ...form, provider_reference: event.target.value }))}
              placeholder="เลขอ้างอิงขนส่ง"
              className="min-h-[44px] rounded-lg border border-surface-border bg-white p-2 text-sm"
            />
          </div>
          <button
            disabled={busy}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            บันทึกรับรองคนขับ
          </button>
        </form>
      </div>
    </AppCard>
  );
}

function InspectionChecklistPanel({
  template,
  checks,
  setCheck,
  form,
  setForm,
  busy,
  requiredComplete,
  onFinalize,
}) {
  return (
    <AppCard>
      <div className="flex items-start gap-2">
        <FileCheck2 className="mt-0.5 h-5 w-5 text-brand-700" strokeWidth={2.2} aria-hidden="true" />
        <div>
          <h3 className="font-bold text-ink">แบบตรวจ {template.template_name} รุ่น {template.version_no}</h3>
          <p className="text-sm text-ink-muted">หัวข้อที่ไม่ผ่านต้องระบุรายละเอียด เพื่อให้โรงเรียนและคนขับแก้ไขได้ตรงจุด</p>
        </div>
      </div>

      <form onSubmit={onFinalize} className="mt-4 space-y-4">
        {template.items.map(item => (
          <div key={item.item_code} className="rounded-xl border border-surface-border p-3">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <p className="font-semibold text-ink">{item.label_th}</p>
                <p className="text-xs text-ink-muted">{item.category}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {['PASS', 'FAIL', ...(item.allows_na ? ['NOT_APPLICABLE'] : [])].map(value => {
                  const selected = checks[item.item_code]?.result === value;
                  return (
                    <button
                      type="button"
                      key={value}
                      onClick={() => setCheck(item.item_code, { result: value })}
                      className={`min-h-[36px] rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                        selected ? RESULT_STYLE[value] : 'border-surface-border bg-white text-ink hover:bg-surface'
                      }`}
                    >
                      {value === 'PASS' ? 'ผ่าน' : value === 'FAIL' ? 'ไม่ผ่าน' : 'ไม่เกี่ยวข้อง'}
                    </button>
                  );
                })}
              </div>
            </div>
            {checks[item.item_code]?.result === 'FAIL' && (
              <textarea
                value={checks[item.item_code]?.notes || ''}
                onChange={event => setCheck(item.item_code, { notes: event.target.value })}
                placeholder="ระบุสิ่งที่ต้องแก้ไข"
                className="mt-3 min-h-24 w-full rounded-lg border border-surface-border p-2 text-sm"
              />
            )}
          </div>
        ))}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink">
            ผลรวม
            <select
              value={form.result}
              onChange={event => setForm(current => ({ ...current, result: event.target.value }))}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-surface-border p-2"
            >
              <option value="PASSED">ผ่าน</option>
              <option value="NEEDS_FIX">ต้องแก้ไข</option>
              <option value="FAILED">ไม่ผ่าน</option>
              <option value="PENDING">รอข้อมูลเพิ่ม</option>
            </select>
          </label>
          <label className="text-sm font-medium text-ink">
            วันหมดอายุ
            <input
              type="date"
              value={form.expiry_date}
              onChange={event => setForm(current => ({ ...current, expiry_date: event.target.value }))}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-surface-border p-2"
            />
          </label>
          <label className="text-sm font-medium text-ink">
            เลขอ้างอิงขนส่ง
            <input
              value={form.provider_reference}
              onChange={event => setForm(current => ({ ...current, provider_reference: event.target.value }))}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-surface-border p-2"
            />
          </label>
          <label className="text-sm font-medium text-ink">
            หมายเหตุ
            <input
              value={form.notes}
              onChange={event => setForm(current => ({ ...current, notes: event.target.value }))}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-surface-border p-2"
            />
          </label>
        </div>

        <button
          disabled={busy || !requiredComplete}
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          ยืนยันและลงผลรับรอง
        </button>
      </form>
    </AppCard>
  );
}

export default function VerificationQueue() {
  const toast = useToast();
  const [queue, setQueue] = useState([]);
  const [detail, setDetail] = useState(null);
  const [template, setTemplate] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [attemptId, setAttemptId] = useState(null);
  const [checks, setChecks] = useState({});
  const [form, setForm] = useState({ result: 'PASSED', expiry_date: '', notes: '', provider_reference: '' });
  const [driverForm, setDriverForm] = useState({ driver_id: '', assignment_role: 'BACKUP', valid_until: '' });
  const [qualificationForm, setQualificationForm] = useState({ driver_id: '', license_no: '', license_type: '', license_expiry: '', provider_reference: '' });
  const [filter, setFilter] = useState({ status: '', search: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filter.status) params.set('status', filter.status);
      if (filter.search) params.set('search', filter.search);
      const res = await api.get(`/verification/transport/queue?${params}`);
      setQueue(res.data?.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดคิวตรวจรถไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [filter.status, filter.search]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  const loadDrivers = useCallback(() => (
    api.get('/verification/transport/drivers')
      .then(res => setDrivers(res.data?.data || []))
      .catch(() => {})
  ), []);

  useEffect(() => {
    api.get('/verification/transport/checklist')
      .then(res => setTemplate(res.data?.data?.[0] || null))
      .catch(() => {});
    loadDrivers();
  }, [loadDrivers]);

  async function open(id) {
    setBusy(true);
    try {
      const res = await api.get(`/verification/applications/${id}`);
      const data = res.data.data;
      setDetail(data);
      const active = (data.attempts || []).find(attempt => attempt.result === 'IN_PROGRESS');
      setAttemptId(active?.id || null);
      setChecks({});
    } catch (err) {
      toast.error(err.response?.data?.message || 'เปิดคำขอไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    try {
      const res = await api.post(`/verification/transport/applications/${detail.id}/start`, {
        inspection_date: new Date().toISOString().slice(0, 10),
        provider_type: 'DLT_OFFICER',
      });
      setAttemptId(res.data.data.attempt_id);
      toast.success('เริ่มบันทึกการตรวจแล้ว');
      await open(detail.id);
    } catch (err) {
      toast.error(err.response?.data?.message || 'เริ่มตรวจไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  function setCheck(code, patch) {
    setChecks(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...patch } }));
  }

  const requiredComplete = useMemo(() => (
    (template?.items || []).every(item => checks[item.item_code]?.result)
  ), [template, checks]);

  async function finalize(event) {
    event.preventDefault();
    if (!requiredComplete) return toast.error('กรุณาระบุผลทุกหัวข้อตรวจ');
    const failedWithoutNote = (template.items || []).some(item => (
      checks[item.item_code]?.result === 'FAIL' && !checks[item.item_code]?.notes?.trim()
    ));
    if (failedWithoutNote) return toast.error('หัวข้อที่ไม่ผ่านต้องระบุรายละเอียด');
    if (form.result === 'PASSED' && !form.expiry_date) return toast.error('ผลผ่านต้องระบุวันหมดอายุ');
    setBusy(true);
    try {
      await api.post(`/verification/transport/attempts/${attemptId}/finalize`, {
        ...form,
        items: template.items.map(item => ({
          item_code: item.item_code,
          result: checks[item.item_code].result,
          notes: checks[item.item_code].notes || null,
        })),
      });
      toast.success('รับรองผลตรวจเรียบร้อย');
      setAttemptId(null);
      setChecks({});
      await loadQueue();
      await open(detail.id);
    } catch (err) {
      toast.error(err.response?.data?.message || 'บันทึกผลตรวจไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function assignDriver(event) {
    event.preventDefault();
    if (!driverForm.driver_id) return toast.error('กรุณาเลือกคนขับ');
    setBusy(true);
    try {
      await api.post(`/verification/transport/vehicles/${detail.vehicle_id}/drivers`, {
        ...driverForm,
        driver_id: Number(driverForm.driver_id),
        valid_until: driverForm.valid_until || null,
      });
      toast.success('เพิ่มคนขับในกลุ่มรถแล้ว');
      setDriverForm({ driver_id: '', assignment_role: 'BACKUP', valid_until: '' });
      await loadDrivers();
      await open(detail.id);
    } catch (err) {
      toast.error(err.response?.data?.message || 'เพิ่มคนขับไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function qualifyDriver(event) {
    event.preventDefault();
    if (!qualificationForm.driver_id || !qualificationForm.license_no || !qualificationForm.license_expiry) {
      return toast.error('กรุณากรอกข้อมูลใบอนุญาตให้ครบ');
    }
    setBusy(true);
    try {
      const { driver_id, ...payload } = qualificationForm;
      await api.post(`/verification/transport/drivers/${driver_id}/qualification`, payload);
      toast.success('รับรองคุณสมบัติคนขับแล้ว');
      setQualificationForm({ driver_id: '', license_no: '', license_type: '', license_expiry: '', provider_reference: '' });
      await loadDrivers();
      await open(detail.id);
    } catch (err) {
      toast.error(err.response?.data?.message || 'รับรองคนขับไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !detail) return <LoadingState />;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-3 sm:p-6">
      <CommandHero
        eyebrow="Transport officer workflow"
        title="คิวตรวจและรับรองรถ"
        description="คิวนี้รวมตามรถ ไม่ใช่ตามรายชื่อนักเรียน เจ้าหน้าที่เห็นข้อมูลรถ คนขับ จำนวนผู้โดยสาร และพื้นที่รับส่งเท่าที่จำเป็นต่อการตรวจ"
        icon={ShieldCheck}
        meta={[
          `${queue.length} รายการในคิว`,
          'ไม่เปิดรายชื่อนักเรียน',
          'รองรับคนขับหลักและสำรอง',
        ]}
        actions={(
          <button
            type="button"
            onClick={loadQueue}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-blue-950 transition hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
            รีเฟรชคิว
          </button>
        )}
      >
        <QueueSummary queue={queue} />
      </CommandHero>

      <StatusStepRail steps={progressSteps(detail, attemptId)} ariaLabel="ขั้นตอนการตรวจและรับรองรถโดยขนส่ง" />

      {error && <ErrorState message={error} />}

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <AppCard padding="md">
          <div className="mb-3 flex gap-2">
            <label className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-ink-muted" strokeWidth={2.2} aria-hidden="true" />
              <input
                value={filter.search}
                onChange={event => setFilter(current => ({ ...current, search: event.target.value }))}
                placeholder="ทะเบียน/เลขคำขอ/โรงเรียน"
                className="min-h-[44px] w-full rounded-lg border border-surface-border pl-9 pr-3 text-sm"
              />
            </label>
            <select
              value={filter.status}
              onChange={event => setFilter(current => ({ ...current, status: event.target.value }))}
              className="min-h-[44px] rounded-lg border border-surface-border bg-white px-2 text-sm"
            >
              <option value="">ทุกสถานะ</option>
              {Object.entries(STATUS).map(([value, [label]]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {queue.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="ไม่มีรายการในคิว" />
          ) : (
            <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
              {queue.map(application => (
                <QueueItem
                  key={application.id}
                  application={application}
                  selected={detail?.id === application.id}
                  onOpen={open}
                />
              ))}
            </div>
          )}
        </AppCard>

        {!detail ? (
          <AppCard className="flex min-h-80 items-center justify-center">
            <EmptyState
              icon={ShieldCheck}
              title="เลือกรถจากคิว"
              description="รายละเอียดจะแสดงเฉพาะรถ คนขับ จำนวนผู้โดยสาร และพื้นที่รับส่ง"
            />
          </AppCard>
        ) : (
          <div className="space-y-4">
            <VehicleDetailSummary detail={detail} onStart={start} busy={busy} attemptId={attemptId} />
            <DriverAuthorizationPanel
              drivers={drivers}
              detail={detail}
              busy={busy}
              driverForm={driverForm}
              setDriverForm={setDriverForm}
              qualificationForm={qualificationForm}
              setQualificationForm={setQualificationForm}
              onAssign={assignDriver}
              onQualify={qualifyDriver}
            />
            {attemptId && template && (
              <InspectionChecklistPanel
                template={template}
                checks={checks}
                setCheck={setCheck}
                form={form}
                setForm={setForm}
                busy={busy}
                requiredComplete={requiredComplete}
                onFinalize={finalize}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
