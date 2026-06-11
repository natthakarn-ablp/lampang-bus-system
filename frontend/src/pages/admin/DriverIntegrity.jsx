import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

// Phase 10.13B-8 — driver integrity dashboard + guided lifecycle wizard.
// Read-only visibility + preflight-gated restore / reassign / deactivate.

const TONE = { amber: 'bg-amber-50 text-amber-700 border-amber-200', emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200', red: 'bg-red-50 text-red-700 border-red-200', slate: 'bg-slate-50 text-slate-600 border-slate-200', blue: 'bg-blue-50 text-blue-700 border-blue-200' };
const ACTIONS = [
  { key: 'RESTORE_DRIVER', label: 'กู้คืนบัญชีคนขับ', endpoint: (id) => `/admin/drivers/${id}/restore` },
  { key: 'REASSIGN_DRIVER_VEHICLE', label: 'ย้ายคนขับไปรถใหม่', endpoint: (id) => `/admin/drivers/${id}/reassign-vehicle` },
  { key: 'DEACTIVATE_DRIVER', label: 'ปิดใช้งานคนขับ', endpoint: (id) => `/admin/drivers/${id}/deactivate` },
];

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
    { label: 'รถที่ยังไม่มีคนขับ', value: data.vehicles_no_active_driver, tone: data.vehicles_no_active_driver ? 'amber' : 'emerald' },
    { label: 'คนขับที่ยังไม่มีรถ', value: data.active_drivers_no_vehicle, tone: data.active_drivers_no_vehicle ? 'amber' : 'emerald' },
    { label: 'บัญชีซ้ำ/ถูกปิดใช้งาน', value: data.inactive_duplicate_candidates, tone: 'slate' },
    { label: 'คนขับยังไม่ผูกโปรไฟล์', value: data.active_unlinked_drivers, tone: data.active_unlinked_drivers ? 'amber' : 'emerald' },
    { label: 'งานชี้รถที่ถูกปิดใช้งาน', value: data.active_assignment_to_soft_deleted_vehicle, tone: data.active_assignment_to_soft_deleted_vehicle ? 'red' : 'emerald' },
    { label: 'รถมีคนขับซ้ำ', value: data.vehicles_multiple_active_drivers, tone: data.vehicles_multiple_active_drivers ? 'red' : 'emerald' },
    { label: 'บล็อกการเปิดใช้งานซ้ำ (30 วัน)', value: data.blocked_reactivations_30d, tone: 'blue' },
  ] : [];

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-800">สุขภาพข้อมูลคนขับ</h1>
        <button onClick={() => setWiz(true)} className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg transition">เครื่องมือจัดการคนขับ</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-lg border px-3 py-3 ${TONE[c.tone]}`}>
            <div className="text-2xl font-bold tabular-nums leading-none">{c.value ?? '—'}</div>
            <div className="text-xs font-medium mt-1 opacity-80">{c.label}</div>
          </div>
        ))}
      </div>

      {data?.vehicles_no_driver_list?.length > 0 && (
        <div className="border border-gray-100 rounded-lg overflow-hidden bg-white">
          <div className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-500">รถที่ยังไม่มีคนขับ</div>
          <div className="divide-y divide-gray-50">
            {data.vehicles_no_driver_list.map((v) => (
              <div key={v.id} className="px-4 py-2 text-sm text-gray-700 flex justify-between">
                <span>{v.plate_no}</span><span className="text-gray-400 text-xs tabular-nums">{v.id}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {busy && !data && <div className="text-center text-gray-400 text-sm py-8">กำลังโหลด…</div>}

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
      toast.success(res.data.message || 'ดำเนินการแล้ว');
      onDone();
    } catch (err) { toast.error(err.response?.data?.message || 'ดำเนินการไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  const blocked = pf && pf.allowed === false;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">เครื่องมือจัดการคนขับ</h2>
        <p className="text-sm text-gray-400 mb-4">ตรวจสอบก่อนดำเนินการ · ทุกการเปลี่ยนแปลงถูกบันทึกประวัติ</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">การดำเนินการ</label>
            <select value={action} onChange={(e) => { setAction(e.target.value); setPf(null); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {ACTIONS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">รหัสผู้ใช้คนขับ (user id)</label>
            <input value={userId} onChange={(e) => { setUserId(e.target.value); setPf(null); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          {action === 'REASSIGN_DRIVER_VEHICLE' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">รถปลายทาง (vehicle id)</label>
              <input value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); setPf(null); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          )}
          <button onClick={runPreflight} disabled={busy} className="w-full bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-700 text-sm font-medium py-2.5 rounded-lg transition">ตรวจสอบก่อนดำเนินการ</button>

          {pf && (
            <div className={`rounded-lg border px-3 py-2.5 text-sm ${blocked ? TONE.red : pf.severity === 'WARNING' ? TONE.amber : TONE.emerald}`}>
              <div className="font-medium">{pf.message_th}</div>
              {pf.canonical_user_id && <div className="text-xs mt-1">บัญชีหลัก: #{pf.canonical_user_id}</div>}
            </div>
          )}
          {pf && pf.classification === 'TARGET_VEHICLE_HAS_ACTIVE_DRIVER' && (
            <label className="flex items-center gap-2 text-xs text-amber-700"><input type="checkbox" checked={endTarget} onChange={(e) => setEndTarget(e.target.checked)} className="accent-amber-600" /> ยืนยันสิ้นสุดงานคนขับเดิมของรถคันนี้</label>
          )}
          {pf && pf.allowed && (
            <>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล *" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <button onClick={runAction} disabled={busy || !reason.trim()} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg transition">ยืนยันดำเนินการ</button>
            </>
          )}
        </div>
        <button onClick={onClose} className="w-full text-gray-500 hover:text-gray-700 text-sm py-2 mt-3">ปิด</button>
      </div>
    </div>
  );
}
