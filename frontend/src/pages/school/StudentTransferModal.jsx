import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

// Phase 10.13B-6 — school-side "ขอโอนย้ายนักเรียน" request. Creating a request
// changes NO data; the move only happens after admin approval.

const TONE = { amber: 'bg-amber-50 text-amber-700 border-amber-200', emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200', red: 'bg-red-50 text-red-700 border-red-200', slate: 'bg-slate-50 text-slate-600 border-slate-200' };
const STATUS = { PENDING: { label: 'รออนุมัติ', tone: 'amber' }, APPLIED: { label: 'โอนย้ายแล้ว', tone: 'emerald' }, REJECTED: { label: 'ไม่อนุมัติ', tone: 'red' }, CANCELLED: { label: 'ยกเลิกแล้ว', tone: 'slate' }, FAILED: { label: 'ไม่สำเร็จ', tone: 'red' }, STALE_NEEDS_REVIEW: { label: 'ต้องตรวจสอบใหม่', tone: 'amber' } };

export default function StudentTransferModal({ student, onClose, onChanged }) {
  const toast = useToast();
  const [dest, setDest] = useState('');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requests, setRequests] = useState([]);

  useEffect(() => { loadRequests(); /* eslint-disable-next-line */ }, []);
  if (!student) return null;

  async function loadRequests() {
    try { const res = await api.get('/school/students/transfer-requests'); setRequests((res.data.data || []).filter((r) => String(r.student_id) === String(student.id))); }
    catch { /* non-blocking */ }
  }
  async function submit() {
    setError('');
    if (!dest.trim()) { setError('กรุณาระบุรหัสโรงเรียนปลายทาง'); return; }
    if (!reason.trim()) { setError('กรุณาระบุเหตุผล'); return; }
    setBusy(true);
    try {
      await api.post(`/school/students/${student.id}/transfer-request`, { destination_school_id: dest.trim(), reason, evidence_note: evidence });
      toast.success('ส่งคำขอโอนย้ายแล้ว · รอผู้ดูแลระบบตรวจสอบ');
      setDest(''); setReason(''); setEvidence(''); loadRequests(); onChanged?.();
    } catch (err) { setError(err.response?.data?.message || 'ส่งคำขอไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  async function cancel(id) {
    setBusy(true);
    try { await api.post(`/school/students/transfer-requests/${id}/cancel`); toast.success('ยกเลิกคำขอแล้ว'); loadRequests(); }
    catch (err) { toast.error(err.response?.data?.message || 'ยกเลิกไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-surface-raised border border-surface-border rounded-xl shadow-elevate w-full max-w-md max-h-[90vh] overflow-y-auto p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">ขอโอนย้ายนักเรียน</h2>
        <p className="text-sm text-gray-400 mb-3">{student.prefix}{student.first_name} {student.last_name} · รหัส {student.student_code ?? student.id}</p>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 mb-4">
          ระบบจะไม่ย้ายข้อมูลนักเรียนอัตโนมัติ · คำขอนี้ต้องรอผู้ดูแลระบบตรวจสอบก่อน
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">รหัสโรงเรียนปลายทาง <span className="text-red-500">*</span></label>
            <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="เช่น 52020082"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">เหตุผล <span className="text-red-500">*</span></label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ย้ายตามผู้ปกครอง"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">หมายเหตุ/หลักฐาน (ถ้ามี)</label>
            <input value={evidence} onChange={(e) => setEvidence(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-sm text-red-700">{error}</div>}
          <button onClick={submit} disabled={busy} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg transition">
            {busy ? 'กำลังส่ง…' : 'ส่งคำขอโอนย้าย'}
          </button>
        </div>

        {requests.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-medium text-gray-500 mb-2">คำขอของนักเรียนคนนี้</p>
            <div className="space-y-2">
              {requests.map((r) => {
                const s = STATUS[r.status] || { label: r.status, tone: 'slate' };
                return (
                  <div key={r.id} className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2 text-xs">
                    <div>
                      <span className={`px-2 py-0.5 rounded-full border ${TONE[s.tone]}`}>{s.label}</span>
                      <span className="text-gray-500 ml-2">→ {r.destination_school_name || r.destination_school_id}</span>
                      {r.status === 'REJECTED' && r.admin_note && <div className="text-gray-400 mt-1">หมายเหตุ: {r.admin_note}</div>}
                    </div>
                    {r.status === 'PENDING' && <button onClick={() => cancel(r.id)} disabled={busy} className="text-red-500 hover:text-red-700">ยกเลิก</button>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <button onClick={onClose} className="w-full text-gray-500 hover:text-gray-700 text-sm py-2 mt-3">ปิด</button>
      </div>
    </div>
  );
}
