import { useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle, CheckCircle2, OctagonAlert, Info } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import AppCard from '../../components/ui/AppCard';
import StatusBadge from '../../components/ui/StatusBadge';
import SectionTitle from '../../components/ui/SectionTitle';
import AlertBanner from '../../components/ui/AlertBanner';

// Phase 10.13B-8 — driver integrity dashboard + guided lifecycle wizard.
// Read-only visibility + preflight-gated restore / reassign / deactivate.

// Maps the data-driven tone to a design-system StatusBadge variant + a short
// Thai status word (keeps text alongside colour per the No Color-Only rule).
const TONE_BADGE = {
  warn:    { variant: 'warn',    label: 'ต้องตรวจ', icon: AlertTriangle },
  success: { variant: 'success', label: 'ปกติ',     icon: CheckCircle2 },
  danger:  { variant: 'danger',  label: 'เร่งด่วน',  icon: OctagonAlert },
  neutral: { variant: 'neutral', label: 'เฝ้าดู',    icon: Info },
  info:    { variant: 'info',    label: 'ข้อมูล',    icon: Info },
};
const ACTIONS = [
  { key: 'RESTORE_DRIVER', label: 'กู้คืนบัญชีคนขับ', endpoint: (id) => `/admin/drivers/${id}/restore` },
  { key: 'REASSIGN_DRIVER_VEHICLE', label: 'ย้ายคนขับไปรถใหม่', endpoint: (id) => `/admin/drivers/${id}/reassign-vehicle` },
  { key: 'DEACTIVATE_DRIVER', label: 'ปิดใช้งานคนขับ', endpoint: (id) => `/admin/drivers/${id}/deactivate` },
];

const inputCls = 'w-full min-h-[44px] rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-sm text-ink transition focus:border-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30';

export default function DriverIntegrity() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wiz, setWiz] = useState(false);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  async function load() {
    setBusy(true);
    try { const res = await api.get('/admin/driver-integrity'); setData(res.data.data); }
    catch { toast.error('โหลดข้อมูลไม่สำเร็จ'); } finally { setBusy(false); }
  }

  const cards = data ? [
    { label: 'รถที่ยังไม่มีคนขับ', value: data.vehicles_no_active_driver, tone: data.vehicles_no_active_driver ? 'warn' : 'success' },
    { label: 'คนขับที่ยังไม่มีรถ', value: data.active_drivers_no_vehicle, tone: data.active_drivers_no_vehicle ? 'warn' : 'success' },
    { label: 'บัญชีซ้ำ/ถูกปิดใช้งาน', value: data.inactive_duplicate_candidates, tone: 'neutral' },
    { label: 'คนขับยังไม่ผูกโปรไฟล์', value: data.active_unlinked_drivers, tone: data.active_unlinked_drivers ? 'warn' : 'success' },
    { label: 'งานชี้รถที่ถูกปิดใช้งาน', value: data.active_assignment_to_soft_deleted_vehicle, tone: data.active_assignment_to_soft_deleted_vehicle ? 'danger' : 'success' },
    { label: 'รถมีคนขับซ้ำ', value: data.vehicles_multiple_active_drivers, tone: data.vehicles_multiple_active_drivers ? 'danger' : 'success' },
    { label: 'บล็อกการเปิดใช้งานซ้ำ (30 วัน)', value: data.blocked_reactivations_30d, tone: 'info' },
  ] : [];

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto motion-safe:animate-fade-in-up motion-reduce:animate-none">
      <SectionTitle
        title="สุขภาพข้อมูลคนขับ"
        description="ตรวจสอบความถูกต้องของบัญชีคนขับและการผูกรถ"
        className="mb-4"
        action={(
          <button
            onClick={() => setWiz(true)}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30"
          >
            <ShieldCheck className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
            เครื่องมือจัดการคนขับ
          </button>
        )}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {cards.map((c) => {
          const badge = TONE_BADGE[c.tone] || TONE_BADGE.neutral;
          return (
            <AppCard key={c.label} padding="sm" className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="text-2xl font-bold tabular-nums leading-none text-ink">{c.value ?? '—'}</div>
                <StatusBadge variant={badge.variant} size="sm" icon={badge.icon}>{badge.label}</StatusBadge>
              </div>
              <div className="text-xs font-medium text-ink-muted">{c.label}</div>
            </AppCard>
          );
        })}
      </div>

      {data?.vehicles_no_driver_list?.length > 0 && (
        <AppCard padding="none" className="overflow-hidden">
          <div className="px-4 py-2 bg-surface text-xs font-medium text-ink-muted border-b border-surface-border">รถที่ยังไม่มีคนขับ</div>
          <div className="divide-y divide-surface-border">
            {data.vehicles_no_driver_list.map((v) => (
              <div key={v.id} className="px-4 py-2 text-sm text-ink flex justify-between">
                <span>{v.plate_no}</span><span className="text-ink-muted text-xs tabular-nums">{v.id}</span>
              </div>
            ))}
          </div>
        </AppCard>
      )}
      {busy && !data && <div className="text-center text-ink-muted text-sm py-8">กำลังโหลด…</div>}

      {wiz && <DriverWizard onClose={() => setWiz(false)} onDone={() => { setWiz(false); load(); }} />}
    </div>
  );
}

function DriverWizard({ onClose, onDone }) {
  const toast = useToast();
  const [action, setAction] = useState('RESTORE_DRIVER');
  const [userId, setUserId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [endTarget, setEndTarget] = useState(false);
  const [reason, setReason] = useState('');
  const [pf, setPf] = useState(null);
  const [busy, setBusy] = useState(false);

  async function runPreflight() {
    if (!userId) { toast.error('กรุณาระบุรหัสผู้ใช้คนขับ'); return; }
    setBusy(true); setPf(null);
    try {
      const payload = { user_id: Number(userId) };
      if (action === 'REASSIGN_DRIVER_VEHICLE') payload.vehicle_id = vehicleId;
      const res = await api.post('/admin/drivers/preflight', { action, payload });
      setPf(res.data.data);
    } catch (err) { toast.error(err.response?.data?.message || 'ตรวจสอบไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  async function runAction() {
    if (!reason.trim()) { toast.error('กรุณาระบุเหตุผล'); return; }
    setBusy(true);
    try {
      const ep = ACTIONS.find((a) => a.key === action).endpoint(userId);
      const body = { reason };
      if (action === 'REASSIGN_DRIVER_VEHICLE') { body.vehicle_id = vehicleId; body.end_target_existing = endTarget; }
      const res = await api.post(ep, body);
      toast.success(res.data.message || 'สำเร็จแล้ว');
      onDone();
    } catch (err) { toast.error(err.response?.data?.message || 'ดำเนินการไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  const blocked = pf && pf.allowed === false;
  const pfVariant = blocked ? 'danger' : pf?.severity === 'WARNING' ? 'warn' : 'success';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 motion-safe:animate-fade-in motion-reduce:animate-none" onClick={onClose}>
      <div
        className="bg-surface-raised rounded-2xl shadow-elevate border border-surface-border w-full max-w-md max-h-[90vh] overflow-y-auto p-5 sm:p-6 motion-safe:animate-scale-in motion-reduce:animate-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink mb-1">เครื่องมือจัดการคนขับ</h2>
        <p className="text-sm text-ink-muted mb-4">ตรวจสอบก่อนดำเนินการ · ทุกการเปลี่ยนแปลงถูกบันทึกประวัติ</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">การดำเนินการ</label>
            <select value={action} onChange={(e) => { setAction(e.target.value); setPf(null); }} className={inputCls}>
              {ACTIONS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">รหัสผู้ใช้คนขับ (user id)</label>
            <input value={userId} onChange={(e) => { setUserId(e.target.value); setPf(null); }} className={inputCls} />
          </div>
          {action === 'REASSIGN_DRIVER_VEHICLE' && (
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">รถปลายทาง (vehicle id)</label>
              <input value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); setPf(null); }} className={inputCls} />
            </div>
          )}
          <button
            onClick={runPreflight}
            disabled={busy}
            className="w-full min-h-[44px] inline-flex items-center justify-center rounded-lg border border-surface-border bg-surface text-ink text-sm font-medium py-2.5 transition hover:bg-brand-50 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30"
          >
            ตรวจสอบก่อนดำเนินการ
          </button>

          {pf && (
            <AlertBanner variant={pfVariant} title={pf.message_th}>
              {pf.canonical_user_id && <span>บัญชีหลัก: #{pf.canonical_user_id}</span>}
            </AlertBanner>
          )}
          {pf && pf.classification === 'TARGET_VEHICLE_HAS_ACTIVE_DRIVER' && (
            <label className="flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={endTarget} onChange={(e) => setEndTarget(e.target.checked)} className="accent-warn min-h-[20px] min-w-[20px]" /> ยืนยันสิ้นสุดงานคนขับเดิมของรถคันนี้</label>
          )}
          {pf && pf.allowed && (
            <>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล *" className={inputCls} />
              <button
                onClick={runAction}
                disabled={busy || !reason.trim()}
                className="w-full min-h-[44px] inline-flex items-center justify-center rounded-lg bg-brand-600 text-white text-sm font-semibold py-2.5 transition hover:bg-brand-700 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30"
              >
                ยืนยันดำเนินการ
              </button>
            </>
          )}
        </div>
        <button onClick={onClose} className="w-full min-h-[44px] text-ink-muted hover:text-ink text-sm py-2 mt-3 transition">ปิด</button>
      </div>
    </div>
  );
}
