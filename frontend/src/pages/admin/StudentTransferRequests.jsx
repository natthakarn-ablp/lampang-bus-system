import { useEffect, useMemo, useState } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

// Phase 10.13B-6 — admin approval queue for student transfer / wrong-school
// requests. Approve applies the move (soft-close source + create destination);
// nothing moves without an explicit admin action here.

const TONE = {
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  slate: 'bg-slate-50 text-slate-600 border-slate-200',
};
const STATUS = {
  PENDING: { label: 'รออนุมัติ', tone: 'amber' },
  APPLIED: { label: 'โอนย้ายแล้ว', tone: 'emerald' },
  REJECTED: { label: 'ไม่อนุมัติ', tone: 'red' },
  CANCELLED: { label: 'ยกเลิกแล้ว', tone: 'slate' },
  FAILED: { label: 'ไม่สำเร็จ', tone: 'red' },
  STALE_NEEDS_REVIEW: { label: 'ต้องตรวจสอบใหม่', tone: 'amber' },
};
const fmt = (d) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export default function StudentTransferRequests() {
  const toast = useToast();
  const [filter, setFilter] = useState('PENDING');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [action, setAction] = useState(null);   // 'approve' | 'reject'
  const [note, setNote] = useState('');

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  async function load() {
    setBusy(true);
    try { const res = await api.get('/admin/student-transfer-requests', { params: filter === 'ALL' ? {} : { status: filter } }); setRows(res.data.data || []); }
    catch { toast.error('โหลดคำขอไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  async function openDetail(id) {
    try { const res = await api.get(`/admin/student-transfer-requests/${id}`); setDetail(res.data.data); setNote(''); setAction(null); }
    catch { toast.error('โหลดรายละเอียดไม่สำเร็จ'); }
  }
  async function submit() {
    if (!note.trim()) { toast.error('กรุณาระบุหมายเหตุ'); return; }
    setBusy(true);
    try {
      const res = await api.post(`/admin/student-transfer-requests/${detail.id}/${action}`, { admin_note: note });
      toast.success(res.data.message || 'ดำเนินการแล้ว');
      setDetail(null); setAction(null); load();
    } catch (err) { toast.error(err.response?.data?.message || 'ดำเนินการไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  const pendingCount = useMemo(() => rows.filter((r) => r.status === 'PENDING').length, [rows]);

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-800">คำขอโอนย้ายนักเรียน {filter === 'PENDING' && pendingCount > 0 && <span className="ml-2 text-sm bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{pendingCount} รออนุมัติ</span>}</h1>
        <div className="flex gap-1.5">
          {['PENDING', 'APPLIED', 'REJECTED', 'ALL'].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`text-xs px-3 py-1.5 rounded-full border transition ${filter === f ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {f === 'PENDING' ? 'รออนุมัติ' : f === 'APPLIED' ? 'โอนย้ายแล้ว' : f === 'REJECTED' ? 'ไม่อนุมัติ' : 'ทั้งหมด'}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-gray-100 rounded-lg overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left font-medium px-3 py-2">วันที่</th>
                <th className="text-left font-medium px-3 py-2">นักเรียน</th>
                <th className="text-left font-medium px-3 py-2">จากโรงเรียน</th>
                <th className="text-left font-medium px-3 py-2">ไปโรงเรียน</th>
                <th className="text-left font-medium px-3 py-2">เหตุผล</th>
                <th className="text-left font-medium px-3 py-2">สถานะ</th>
                <th className="text-left font-medium px-3 py-2"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((r) => {
                const s = STATUS[r.status] || { label: r.status, tone: 'slate' };
                return (
                  <tr key={r.id} className="hover:bg-gray-50/50">
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{fmt(r.created_at)}</td>
                    <td className="px-3 py-2 text-gray-800">{r.student_name} <span className="text-gray-400 tabular-nums">({r.student_code})</span></td>
                    <td className="px-3 py-2 text-gray-600">{r.source_school_name || r.source_school_id}</td>
                    <td className="px-3 py-2 text-gray-600">{r.destination_school_name || r.destination_school_id}</td>
                    <td className="px-3 py-2 text-gray-500 max-w-[180px] truncate">{r.reason || '—'}</td>
                    <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded-full border ${TONE[s.tone]}`}>{s.label}</span></td>
                    <td className="px-3 py-2"><button onClick={() => openDetail(r.id)} className="text-sm text-blue-600 hover:text-blue-800">เปิดดู</button></td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400 text-sm">{busy ? 'กำลังโหลด…' : 'ไม่มีคำขอ'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail / approve / reject */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">คำขอโอนย้าย #{detail.id}</h2>
            <div className="text-sm text-gray-600 space-y-1.5 mb-3">
              <Row k="นักเรียน" v={`${detail.student_name} (${detail.student_code})`} />
              <Row k="จาก" v={detail.source_school_name || detail.source_school_id} />
              <Row k="ไป" v={detail.destination_school_name || detail.destination_school_id} />
              <Row k="ประเภท" v={detail.request_type === 'WRONG_SCHOOL_CORRECTION' ? 'แก้ไขโรงเรียนผิด' : 'โอนย้ายโรงเรียน'} />
              <Row k="เหตุผล" v={detail.reason || '—'} />
              {detail.evidence_note && <Row k="หลักฐาน" v={detail.evidence_note} />}
            </div>
            {detail.destination_code_conflict && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">พบรหัสนักเรียนซ้ำในโรงเรียนปลายทาง กรุณาตรวจสอบก่อนอนุมัติ</div>
            )}
            {detail.current_student?.has_vehicle && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 mb-3">นักเรียนมีรถรับส่งอยู่ — ระบบจะยกเลิกการผูกรถเดิมเมื่อโอนย้าย</div>
            )}
            {detail.can_approve && action && (
              <div className="mb-3">
                <label className="block text-xs text-gray-500 mb-1">หมายเหตุผู้ดูแล <span className="text-red-500">*</span></label>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={action === 'approve' ? 'เช่น ตรวจสอบเอกสารแล้ว' : 'เหตุผลที่ไม่อนุมัติ'}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            )}
            {detail.admin_note && !detail.can_approve && <div className="text-xs text-gray-500 mb-3">หมายเหตุ: {detail.admin_note}</div>}
            <div className="flex gap-2 justify-end">
              {detail.can_approve ? (
                action ? (
                  <>
                    <button onClick={submit} disabled={busy || !note.trim()} className={`text-sm text-white font-medium px-4 py-2 rounded-lg transition disabled:opacity-40 ${action === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}>
                      {action === 'approve' ? 'ยืนยันอนุมัติและโอนย้าย' : 'ยืนยันไม่อนุมัติ'}
                    </button>
                    <button onClick={() => setAction(null)} className="px-4 text-gray-500 hover:text-gray-700 text-sm">กลับ</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setAction('approve')} className="text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-4 py-2 rounded-lg transition">อนุมัติและดำเนินการโอนย้าย</button>
                    <button onClick={() => setAction('reject')} className="text-sm bg-red-600 hover:bg-red-700 text-white font-medium px-4 py-2 rounded-lg transition">ไม่อนุมัติคำขอ</button>
                  </>
                )
              ) : (
                <button onClick={() => setDetail(null)} className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg transition">ปิด</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function Row({ k, v }) { return <div className="flex justify-between gap-3"><span className="text-gray-400">{k}</span><span className="text-right">{v}</span></div>; }
