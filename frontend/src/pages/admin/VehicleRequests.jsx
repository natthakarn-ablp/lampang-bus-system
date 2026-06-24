import { useEffect, useMemo, useState } from 'react';
import { Clock, CheckCircle2, XCircle, MinusCircle, AlertOctagon } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import { AppCard, StatusBadge, SectionTitle, AlertBanner } from '../../components/ui';

// Phase 10.13B-7 — admin approval queue for vehicle restore / shared-fleet-use
// requests. Approving a RESTORE un-deletes the vehicle (canonical-guarded);
// other types are informational. Nothing changes without an action here.

const STATUS = {
  PENDING:   { label: 'รออนุมัติ', variant: 'warn',    icon: Clock },
  APPLIED:   { label: 'สำเร็จแล้ว', variant: 'success', icon: CheckCircle2 },
  REJECTED:  { label: 'ไม่อนุมัติ', variant: 'danger',  icon: XCircle },
  CANCELLED: { label: 'ยกเลิกแล้ว', variant: 'neutral', icon: MinusCircle },
  FAILED:    { label: 'ไม่สำเร็จ',  variant: 'danger',  icon: AlertOctagon },
};
const TYPE = { RESTORE_SOFT_DELETED_VEHICLE: 'ขอกู้คืนรถ', USE_EXISTING_SHARED_VEHICLE: 'ขอใช้รถที่มีอยู่', ADD_MISSING_VEHICLE: 'ขอเพิ่มรถ', REVIEW_VEHICLE_CONFLICT: 'ขอตรวจสอบ' };
const fmt = (d) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export default function VehicleRequests() {
  const toast = useToast();
  const [filter, setFilter] = useState('PENDING');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [action, setAction] = useState(null);
  const [note, setNote] = useState('');

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);
  async function load() {
    setBusy(true);
    try { const res = await api.get('/admin/vehicle-requests', { params: filter === 'ALL' ? {} : { status: filter } }); setRows(res.data.data || []); }
    catch { toast.error('โหลดคำขอไม่สำเร็จ'); } finally { setBusy(false); }
  }
  async function openDetail(id) {
    try { const res = await api.get(`/admin/vehicle-requests/${id}`); setDetail(res.data.data); setNote(''); setAction(null); }
    catch { toast.error('โหลดรายละเอียดไม่สำเร็จ'); }
  }
  async function submit() {
    if (!note.trim()) { toast.error('กรุณาระบุหมายเหตุ'); return; }
    setBusy(true);
    try { const res = await api.post(`/admin/vehicle-requests/${detail.id}/${action}`, { admin_note: note }); toast.success(res.data.message || 'สำเร็จแล้ว'); setDetail(null); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'ดำเนินการไม่สำเร็จ'); } finally { setBusy(false); }
  }
  const pendingCount = useMemo(() => rows.filter((r) => r.status === 'PENDING').length, [rows]);

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto motion-safe:animate-fade-in-up motion-reduce:animate-none">
      <SectionTitle
        className="mb-4"
        title="คำขอเกี่ยวกับรถ"
        action={(
          <div className="flex gap-1.5">
            {['PENDING', 'APPLIED', 'REJECTED', 'ALL'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`min-h-[44px] text-xs px-3 py-1.5 rounded-full border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 ${filter === f ? 'bg-brand-800 text-white border-brand-800' : 'bg-surface-raised text-ink-muted border-surface-border hover:bg-surface'}`}
              >
                {f === 'PENDING' ? 'รออนุมัติ' : f === 'APPLIED' ? 'สำเร็จแล้ว' : f === 'REJECTED' ? 'ไม่อนุมัติ' : 'ทั้งหมด'}
              </button>
            ))}
          </div>
        )}
      />
      {filter === 'PENDING' && pendingCount > 0 && (
        <div className="mb-4">
          <StatusBadge variant="warn" icon={Clock}>{pendingCount} รออนุมัติ</StatusBadge>
        </div>
      )}

      <AppCard padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-ink-muted text-xs">
              <tr>
                <th className="text-left font-medium px-3 py-2">วันที่</th>
                <th className="text-left font-medium px-3 py-2">ประเภท</th>
                <th className="text-left font-medium px-3 py-2">โรงเรียน</th>
                <th className="text-left font-medium px-3 py-2">ทะเบียน</th>
                <th className="text-left font-medium px-3 py-2">จากนำเข้า</th>
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
                    <td className="px-3 py-2 text-ink">{TYPE[r.request_type] || r.request_type}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.school_name || r.school_id}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.input_plate || '—'}</td>
                    <td className="px-3 py-2 text-ink-muted text-xs">{r.import_batch_id ? `#${r.import_batch_id}` : '—'}</td>
                    <td className="px-3 py-2"><StatusBadge variant={s.variant} icon={s.icon}>{s.label}</StatusBadge></td>
                    <td className="px-3 py-2"><button onClick={() => openDetail(r.id)} className="text-sm text-brand-700 hover:text-brand-800 font-medium">เปิดดู</button></td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-ink-muted text-sm">{busy ? 'กำลังโหลด…' : 'ไม่มีคำขอ'}</td></tr>}
            </tbody>
          </table>
        </div>
      </AppCard>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 motion-safe:animate-fade-in motion-reduce:animate-none" onClick={() => setDetail(null)}>
          <div className="bg-surface-raised rounded-2xl shadow-elevate w-full max-w-md p-5 sm:p-6 motion-safe:animate-scale-in motion-reduce:animate-none" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-ink mb-3">{TYPE[detail.request_type] || detail.request_type} #{detail.id}</h2>
            <div className="text-sm text-ink-muted space-y-1.5 mb-3">
              <Row k="โรงเรียน" v={detail.school_name || detail.school_id} />
              <Row k="ทะเบียน" v={detail.input_plate || '—'} />
              <Row k="รถในระบบ" v={detail.current_vehicle ? `${detail.current_vehicle.plate_no} (${detail.current_vehicle.is_deleted ? 'ถูกปิดใช้งาน' : 'ใช้งานอยู่'})` : '—'} />
              <Row k="เหตุผล" v={detail.reason || '—'} />
              {detail.import_batch_id && <Row k="จากนำเข้า" v={`ชุด #${detail.import_batch_id}${detail.import_row_id ? ` แถว ${detail.import_row_id}` : ''}`} />}
            </div>
            {detail.request_type === 'RESTORE_SOFT_DELETED_VEHICLE' && detail.active_canonical_conflict && (
              <AlertBanner variant="danger" className="mb-3">มีรถทะเบียนเดียวกันที่ใช้งานอยู่แล้ว — ไม่สามารถกู้คืนได้</AlertBanner>
            )}
            {detail.can_approve && action && (
              <div className="mb-3">
                <label className="block text-xs text-ink-muted mb-1">หมายเหตุผู้ดูแล <span className="text-danger">*</span></label>
                <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full border border-surface-border rounded-lg px-3 py-2 text-sm transition focus:border-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30" />
              </div>
            )}
            {detail.admin_note && !detail.can_approve && <div className="text-xs text-ink-muted mb-3">หมายเหตุ: {detail.admin_note}</div>}
            <div className="flex gap-2 justify-end">
              {detail.can_approve ? (action ? (
                <>
                  <button onClick={submit} disabled={busy || !note.trim()} className={`min-h-[44px] text-sm text-white font-medium px-4 py-2 rounded-lg transition disabled:opacity-40 ${action === 'approve' ? 'bg-success hover:bg-success/90' : 'bg-danger hover:bg-danger/90'}`}>
                    {action === 'approve' ? (detail.request_type === 'RESTORE_SOFT_DELETED_VEHICLE' ? 'ยืนยันกู้คืนรถ' : 'ยืนยันอนุมัติ') : 'ยืนยันไม่อนุมัติ'}
                  </button>
                  <button onClick={() => setAction(null)} className="min-h-[44px] px-4 text-ink-muted hover:text-ink text-sm">กลับ</button>
                </>
              ) : (
                <>
                  <button onClick={() => setAction('approve')} disabled={detail.request_type === 'RESTORE_SOFT_DELETED_VEHICLE' && detail.active_canonical_conflict} className="min-h-[44px] text-sm bg-success hover:bg-success/90 disabled:opacity-40 text-white font-medium px-4 py-2 rounded-lg transition">{detail.request_type === 'RESTORE_SOFT_DELETED_VEHICLE' ? 'อนุมัติและกู้คืนรถ' : 'อนุมัติคำขอ'}</button>
                  <button onClick={() => setAction('reject')} className="min-h-[44px] text-sm bg-danger hover:bg-danger/90 text-white font-medium px-4 py-2 rounded-lg transition">ไม่อนุมัติ</button>
                </>
              )) : <button onClick={() => setDetail(null)} className="min-h-[44px] text-sm bg-surface hover:bg-surface-border text-ink px-4 py-2 rounded-lg transition">ปิด</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function Row({ k, v }) { return <div className="flex justify-between gap-3"><span className="text-ink-muted">{k}</span><span className="text-right text-ink">{v}</span></div>; }
