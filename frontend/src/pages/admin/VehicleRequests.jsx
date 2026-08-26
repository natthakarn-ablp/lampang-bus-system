import { useEffect, useMemo, useState } from 'react';
import { Clock, CheckCircle2, XCircle, MinusCircle, AlertOctagon } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import PageHeader from '../../components/PageHeader';
import {
  StatusBadge, AlertBanner, DataTable, TableAction, FilterBar, FormField, Modal,
} from '../../components/ui';

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
const FILTER_OPTIONS = [
  ['PENDING', 'รออนุมัติ'],
  ['APPLIED', 'สำเร็จแล้ว'],
  ['REJECTED', 'ไม่อนุมัติ'],
  ['ALL', 'ทั้งหมด'],
];
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
    <div className="p-4 sm:p-6 max-w-6xl mx-auto motion-safe:animate-fade-in-up motion-reduce:animate-none">
      <PageHeader
        title="คำขอเกี่ยวกับรถ"
        subtitle="คำขอกู้คืนรถ ขอใช้รถร่วม และคำขอตรวจสอบจากโรงเรียน"
        actions={
          filter === 'PENDING' && pendingCount > 0
            ? <StatusBadge variant="warn" size="lg" icon={Clock}>{pendingCount} รออนุมัติ</StatusBadge>
            : undefined
        }
      />

      <FilterBar
        className="mb-5"
        chips={{ label: 'กรองตามสถานะคำขอ', value: filter, onChange: setFilter, options: FILTER_OPTIONS }}
        count={rows.length}
        countLabel="คำขอ"
      />

      <DataTable
        caption="รายการคำขอเกี่ยวกับรถ"
        loading={busy && rows.length === 0}
        rows={rows}
        rowKey={r => r.id}
        columns={[
          { key: 'type', header: 'ประเภท', primary: true,
            cell: r => TYPE[r.request_type] || r.request_type },
          { key: 'created', header: 'วันที่', secondary: true, cell: r => fmt(r.created_at) },
          { key: 'school', header: 'โรงเรียน', cell: r => r.school_name || r.school_id },
          { key: 'plate', header: 'ทะเบียน', cell: r => r.input_plate || '—' },
          { key: 'batch', header: 'จากนำเข้า', cell: r => (r.import_batch_id ? `#${r.import_batch_id}` : '—') },
          { key: 'status', header: 'สถานะ', badge: true,
            cell: r => {
              const st = STATUS[r.status] || { label: r.status, variant: 'neutral' };
              return <StatusBadge variant={st.variant} icon={st.icon}>{st.label}</StatusBadge>;
            } },
        ]}
        actions={r => <TableAction tone="brand" onClick={() => openDetail(r.id)}>เปิดดู</TableAction>}
        empty={{
          icon: Clock,
          title: 'ไม่มีคำขอ',
          description: filter === 'PENDING' ? 'ไม่มีคำขอรออนุมัติในขณะนี้' : 'ลองเลือกสถานะอื่น',
        }}
      />

      {detail && (
        <Modal
          title={`${TYPE[detail.request_type] || detail.request_type} #${detail.id}`}
          onClose={() => setDetail(null)}
          footer={
            detail.can_approve ? (
              action ? (
                <>
                  <button onClick={() => setAction(null)}
                    className="focus-ring min-h-[44px] px-4 rounded-lg border border-surface-border bg-surface-raised text-sm font-medium text-ink hover:bg-surface active:bg-surface-border transition">
                    กลับ
                  </button>
                  <button onClick={submit} disabled={busy || !note.trim()}
                    className={`focus-ring min-h-[44px] text-sm text-white font-semibold px-4 rounded-lg transition disabled:opacity-40 disabled:pointer-events-none ${action === 'approve' ? 'bg-success hover:bg-success/90' : 'bg-danger hover:bg-danger/90'}`}>
                    {action === 'approve'
                      ? (detail.request_type === 'RESTORE_SOFT_DELETED_VEHICLE' ? 'ยืนยันกู้คืนรถ' : 'ยืนยันอนุมัติ')
                      : 'ยืนยันไม่อนุมัติ'}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setAction('reject')}
                    className="focus-ring min-h-[44px] text-sm bg-danger hover:bg-danger/90 text-white font-semibold px-4 rounded-lg transition">
                    ไม่อนุมัติ
                  </button>
                  <button onClick={() => setAction('approve')}
                    disabled={detail.request_type === 'RESTORE_SOFT_DELETED_VEHICLE' && detail.active_canonical_conflict}
                    className="focus-ring min-h-[44px] text-sm bg-success hover:bg-success/90 disabled:opacity-40 disabled:pointer-events-none text-white font-semibold px-4 rounded-lg transition">
                    {detail.request_type === 'RESTORE_SOFT_DELETED_VEHICLE' ? 'อนุมัติและกู้คืนรถ' : 'อนุมัติคำขอ'}
                  </button>
                </>
              )
            ) : (
              <button onClick={() => setDetail(null)}
                className="focus-ring min-h-[44px] text-sm bg-surface hover:bg-surface-border text-ink px-4 rounded-lg transition">
                ปิด
              </button>
            )
          }
        >
          <dl className="text-sm space-y-1.5 mb-3">
            <Row k="โรงเรียน" v={detail.school_name || detail.school_id} />
            <Row k="ทะเบียน" v={detail.input_plate || '—'} />
            <Row k="รถในระบบ" v={detail.current_vehicle ? `${detail.current_vehicle.plate_no} (${detail.current_vehicle.is_deleted ? 'ถูกปิดใช้งาน' : 'ใช้งานอยู่'})` : '—'} />
            <Row k="เหตุผล" v={detail.reason || '—'} />
            {detail.import_batch_id && (
              <Row k="จากนำเข้า" v={`ชุด #${detail.import_batch_id}${detail.import_row_id ? ` แถว ${detail.import_row_id}` : ''}`} />
            )}
          </dl>

          {detail.request_type === 'RESTORE_SOFT_DELETED_VEHICLE' && detail.active_canonical_conflict && (
            <AlertBanner variant="danger" className="mb-3">
              มีรถทะเบียนเดียวกันที่ใช้งานอยู่แล้ว — ไม่สามารถกู้คืนได้
            </AlertBanner>
          )}

          {detail.can_approve && action && (
            <FormField
              label="หมายเหตุผู้ดูแล"
              required
              value={note}
              onChange={setNote}
              placeholder={action === 'approve' ? 'เช่น ตรวจสอบเอกสารแล้ว' : 'เหตุผลที่ไม่อนุมัติ'}
              helper="หมายเหตุนี้จะถูกบันทึกไว้กับคำขอและใน audit log"
            />
          )}
          {detail.admin_note && !detail.can_approve && (
            <p className="text-caption text-ink-muted">หมายเหตุ: {detail.admin_note}</p>
          )}
        </Modal>
      )}
    </div>
  );
}
function Row({ k, v }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted shrink-0">{k}</dt>
      <dd className="text-right text-ink min-w-0">{v}</dd>
    </div>
  );
}
