import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import PageHeader from '../../components/PageHeader';
import {
  StatusBadge, AlertBanner, DataTable, TableAction, FilterBar, FormField, Modal,
} from '../../components/ui';

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

const FILTER_OPTIONS = [
  ['PENDING', 'รออนุมัติ'],
  ['APPLIED', 'โอนย้ายแล้ว'],
  ['REJECTED', 'ไม่อนุมัติ'],
  ['ALL', 'ทั้งหมด'],
];

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
    try {
      const res = await api.get('/admin/student-transfer-requests', { params: filter === 'ALL' ? {} : { status: filter } });
      setRows(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch { toast.error('โหลดคำขอไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  async function openDetail(id) {
    try {
      const res = await api.get(`/admin/student-transfer-requests/${id}`);
      setDetail(res.data.data); setNote(''); setAction(null);
    } catch { toast.error('โหลดรายละเอียดไม่สำเร็จ'); }
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
    <div className="p-4 sm:p-6 max-w-6xl mx-auto motion-safe:animate-fade-in-up">
      <PageHeader
        title="คำขอโอนย้ายนักเรียน"
        subtitle="ตรวจสอบและอนุมัติการย้ายนักเรียนระหว่างโรงเรียน"
        actions={
          filter === 'PENDING' && pendingCount > 0
            ? <StatusBadge variant="warn" size="lg">{pendingCount} รออนุมัติ</StatusBadge>
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
        caption="รายการคำขอโอนย้ายนักเรียน"
        loading={busy && rows.length === 0}
        rows={rows}
        rowKey={r => r.id}
        columns={[
          { key: 'student', header: 'นักเรียน', primary: true,
            cell: r => <>{r.student_name} <span className="text-ink-muted tabular-nums">({r.student_code})</span></> },
          { key: 'created', header: 'วันที่', secondary: true, cell: r => fmt(r.created_at) },
          { key: 'from', header: 'จากโรงเรียน', cell: r => r.source_school_name || r.source_school_id },
          { key: 'to', header: 'ไปโรงเรียน', cell: r => r.destination_school_name || r.destination_school_id },
          { key: 'reason', header: 'เหตุผล',
            cell: r => <span className="block max-w-[180px] truncate">{r.reason || '—'}</span> },
          { key: 'status', header: 'สถานะ', badge: true,
            cell: r => {
              const s = STATUS[r.status] || { label: r.status, variant: 'neutral' };
              return <StatusBadge variant={s.variant}>{s.label}</StatusBadge>;
            } },
        ]}
        actions={r => (
          <TableAction tone="brand" onClick={() => openDetail(r.id)}>เปิดดู</TableAction>
        )}
        empty={{
          icon: Users,
          title: 'ไม่มีคำขอ',
          description: filter === 'PENDING' ? 'ไม่มีคำขอรออนุมัติในขณะนี้' : 'ลองเลือกสถานะอื่น',
        }}
      />

      {detail && (
        <Modal
          title={`คำขอโอนย้าย #${detail.id}`}
          onClose={() => setDetail(null)}
          footer={
            detail.can_approve ? (
              action ? (
                <>
                  <button
                    onClick={() => setAction(null)}
                    className="focus-ring min-h-[44px] px-4 rounded-lg border border-surface-border bg-surface-raised text-sm font-medium text-ink hover:bg-surface active:bg-surface-border transition"
                  >
                    กลับ
                  </button>
                  <button
                    onClick={submit}
                    disabled={busy || !note.trim()}
                    className={`focus-ring min-h-[44px] text-sm text-white font-semibold px-4 rounded-lg transition disabled:opacity-40 disabled:pointer-events-none ${
                      action === 'approve' ? 'bg-success hover:bg-success/90' : 'bg-danger hover:bg-danger/90'
                    }`}
                  >
                    {action === 'approve' ? 'ยืนยันอนุมัติและโอนย้าย' : 'ยืนยันไม่อนุมัติ'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setAction('reject')}
                    className="focus-ring min-h-[44px] text-sm bg-danger hover:bg-danger/90 text-white font-semibold px-4 rounded-lg transition"
                  >
                    ไม่อนุมัติคำขอ
                  </button>
                  <button
                    onClick={() => setAction('approve')}
                    className="focus-ring min-h-[44px] text-sm bg-success hover:bg-success/90 text-white font-semibold px-4 rounded-lg transition"
                  >
                    อนุมัติและดำเนินการโอนย้าย
                  </button>
                </>
              )
            ) : (
              <button
                onClick={() => setDetail(null)}
                className="focus-ring min-h-[44px] text-sm bg-surface hover:bg-surface-border text-ink px-4 rounded-lg transition"
              >
                ปิด
              </button>
            )
          }
        >
          <dl className="text-sm space-y-1.5 mb-3">
            <Row k="นักเรียน" v={`${detail.student_name} (${detail.student_code})`} />
            <Row k="จาก" v={detail.source_school_name || detail.source_school_id} />
            <Row k="ไป" v={detail.destination_school_name || detail.destination_school_id} />
            <Row k="ประเภท" v={detail.request_type === 'WRONG_SCHOOL_CORRECTION' ? 'แก้ไขโรงเรียนผิด' : 'โอนย้ายโรงเรียน'} />
            <Row k="เหตุผล" v={detail.reason || '—'} />
            {detail.evidence_note && <Row k="หลักฐาน" v={detail.evidence_note} />}
          </dl>

          {detail.destination_code_conflict && (
            <AlertBanner variant="danger" className="mb-3">
              พบรหัสนักเรียนซ้ำในโรงเรียนปลายทาง กรุณาตรวจสอบก่อนอนุมัติ
            </AlertBanner>
          )}
          {detail.current_student?.has_vehicle && (
            <AlertBanner variant="warn" className="mb-3">
              นักเรียนมีรถรับส่งอยู่ — ระบบจะยกเลิกการผูกรถเดิมเมื่อโอนย้าย
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
