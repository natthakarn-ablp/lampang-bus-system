import { useEffect, useMemo, useState } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import { AppCard, StatusBadge, AlertBanner } from '../../components/ui';

// Phase 10.13B-6 — admin approval queue for student transfer / wrong-school
// requests. Approve applies the move (soft-close source + create destination);
// nothing moves without an explicit admin action here.

const STATUS = {
  PENDING: { label: 'รออนุมัติ', variant: 'warn' },
  APPLIED: { label: 'โอนย้ายแล้ว', variant: 'success' },
  REJECTED: { label: 'ไม่อนุมัติ', variant: 'danger' },
  CANCELLED: { label: 'ยกเลิกแล้ว', variant: 'neutral' },
  FAILED: { label: 'ไม่สำเร็จ', variant: 'danger' },
  STALE_NEEDS_REVIEW: { label: 'ต้องตรวจสอบใหม่', variant: 'warn' },
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
      toast.success(res.data.message || 'สำเร็จแล้ว');
      setDetail(null); setAction(null); load();
    } catch (err) { toast.error(err.response?.data?.message || 'ดำเนินการไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  const pendingCount = useMemo(() => rows.filter((r) => r.status === 'PENDING').length, [rows]);

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto motion-safe:animate-fade-in-up">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-semibold text-ink flex items-center gap-2">
          คำขอโอนย้ายนักเรียน
          {filter === 'PENDING' && pendingCount > 0 && (
            <StatusBadge variant="warn">{pendingCount} รออนุมัติ</StatusBadge>
          )}
        </h1>
        <div className="flex gap-1.5">
          {['PENDING', 'APPLIED', 'REJECTED', 'ALL'].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`min-h-[44px] text-xs px-3 py-1.5 rounded-full border transition ${filter === f ? 'bg-brand-800 text-white border-brand-800' : 'bg-surface-raised text-ink-muted border-surface-border hover:bg-surface'}`}>
              {f === 'PENDING' ? 'รออนุมัติ' : f === 'APPLIED' ? 'โอนย้ายแล้ว' : f === 'REJECTED' ? 'ไม่อนุมัติ' : 'ทั้งหมด'}
            </button>
          ))}
        </div>
      </div>

      <AppCard padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-ink-muted text-xs">
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
            <tbody className="divide-y divide-surface-border">
              {rows.map((r) => {
                const s = STATUS[r.status] || { label: r.status, variant: 'neutral' };
                return (
                  <tr key={r.id} className="hover:bg-surface">
                    <td className="px-3 py-2 text-ink-muted whitespace-nowrap">{fmt(r.created_at)}</td>
                    <td className="px-3 py-2 text-ink">{r.student_name} <span className="text-ink-muted tabular-nums">({r.student_code})</span></td>
                    <td className="px-3 py-2 text-ink-muted">{r.source_school_name || r.source_school_id}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.destination_school_name || r.destination_school_id}</td>
                    <td className="px-3 py-2 text-ink-muted max-w-[180px] truncate">{r.reason || '—'}</td>
                    <td className="px-3 py-2"><StatusBadge variant={s.variant}>{s.label}</StatusBadge></td>
                    <td className="px-3 py-2"><button onClick={() => openDetail(r.id)} className="text-sm font-medium text-brand-600 hover:text-brand-700">เปิดดู</button></td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-ink-muted text-sm">{busy ? 'กำลังโหลด…' : 'ไม่มีคำขอ'}</td></tr>}
            </tbody>
          </table>
        </div>
      </AppCard>

      {/* Detail / approve / reject */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 motion-safe:animate-fade-in" onClick={() => setDetail(null)}>
          <div className="bg-surface-raised border border-surface-border rounded-2xl shadow-elevate w-full max-w-md p-5 sm:p-6 motion-safe:animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-ink mb-3">คำขอโอนย้าย #{detail.id}</h2>
            <div className="text-sm text-ink-muted space-y-1.5 mb-3">
              <Row k="นักเรียน" v={`${detail.student_name} (${detail.student_code})`} />
              <Row k="จาก" v={detail.source_school_name || detail.source_school_id} />
              <Row k="ไป" v={detail.destination_school_name || detail.destination_school_id} />
              <Row k="ประเภท" v={detail.request_type === 'WRONG_SCHOOL_CORRECTION' ? 'แก้ไขโรงเรียนผิด' : 'โอนย้ายโรงเรียน'} />
              <Row k="เหตุผล" v={detail.reason || '—'} />
              {detail.evidence_note && <Row k="หลักฐาน" v={detail.evidence_note} />}
            </div>
            {detail.destination_code_conflict && (
              <AlertBanner variant="danger" className="mb-3">พบรหัสนักเรียนซ้ำในโรงเรียนปลายทาง กรุณาตรวจสอบก่อนอนุมัติ</AlertBanner>
            )}
            {detail.current_student?.has_vehicle && (
              <AlertBanner variant="warn" className="mb-3">นักเรียนมีรถรับส่งอยู่ — ระบบจะยกเลิกการผูกรถเดิมเมื่อโอนย้าย</AlertBanner>
            )}
            {detail.can_approve && action && (
              <div className="mb-3">
                <label className="block text-xs text-ink-muted mb-1">หมายเหตุผู้ดูแล <span className="text-danger">*</span></label>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={action === 'approve' ? 'เช่น ตรวจสอบเอกสารแล้ว' : 'เหตุผลที่ไม่อนุมัติ'}
                  className="w-full border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20" />
              </div>
            )}
            {detail.admin_note && !detail.can_approve && <div className="text-xs text-ink-muted mb-3">หมายเหตุ: {detail.admin_note}</div>}
            <div className="flex gap-2 justify-end">
              {detail.can_approve ? (
                action ? (
                  <>
                    <button onClick={submit} disabled={busy || !note.trim()} className={`min-h-[44px] text-sm text-white font-medium px-4 py-2 rounded-lg transition disabled:opacity-40 ${action === 'approve' ? 'bg-success hover:bg-success/90' : 'bg-danger hover:bg-danger/90'}`}>
                      {action === 'approve' ? 'ยืนยันอนุมัติและโอนย้าย' : 'ยืนยันไม่อนุมัติ'}
                    </button>
                    <button onClick={() => setAction(null)} className="min-h-[44px] px-4 text-ink-muted hover:text-ink text-sm">กลับ</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setAction('approve')} className="min-h-[44px] text-sm bg-success hover:bg-success/90 text-white font-medium px-4 py-2 rounded-lg transition">อนุมัติและดำเนินการโอนย้าย</button>
                    <button onClick={() => setAction('reject')} className="min-h-[44px] text-sm bg-danger hover:bg-danger/90 text-white font-medium px-4 py-2 rounded-lg transition">ไม่อนุมัติคำขอ</button>
                  </>
                )
              ) : (
                <button onClick={() => setDetail(null)} className="min-h-[44px] text-sm bg-surface hover:bg-surface-border text-ink px-4 py-2 rounded-lg transition">ปิด</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function Row({ k, v }) { return <div className="flex justify-between gap-3"><span className="text-ink-muted">{k}</span><span className="text-right text-ink">{v}</span></div>; }
