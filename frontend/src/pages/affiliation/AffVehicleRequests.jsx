import { useState, useEffect, useCallback } from 'react';
import {
  Bus, RefreshCw, CheckCircle2, XCircle,
} from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import PageHeader from '../../components/PageHeader';
import {
  StatusBadge, DataTable, TableAction, FilterBar, FormField, Modal,
} from '../../components/ui';
import { PageTransition } from '../../lib/motion';

const FILTERS = [
  { key: 'PENDING', label: 'รออนุมัติ' },
  { key: 'APPROVED', label: 'อนุมัติแล้ว' },
  { key: 'REJECTED', label: 'ไม่อนุมัติ' },
  { key: 'ALL', label: 'ทั้งหมด' },
];

const STATUS_BADGE = {
  PENDING: ['รออนุมัติ', 'warn'],
  APPROVED: ['อนุมัติแล้ว', 'success'],
  REJECTED: ['ไม่อนุมัติ', 'danger'],
};

const TYPE_LABELS = {
  RESTORE_SOFT_DELETED_VEHICLE: 'กู้คืนรถที่ลบ',
  USE_EXISTING_SHARED_VEHICLE: 'ใช้รถร่วม',
  ADD_MISSING_VEHICLE: 'เพิ่มรถใหม่',
  REVIEW_VEHICLE_CONFLICT: 'ตรวจสอบรถซ้ำ',
};

export default function AffVehicleRequests() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('PENDING');
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState('');
  const [action, setAction] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/affiliation/vehicle-requests', {
        params: filter === 'ALL' ? {} : { status: filter },
      });
      setRows(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function openDetail(id) {
    try {
      const res = await api.get(`/affiliation/vehicle-requests/${id}`);
      setDetail(res.data.data);
      setNote('');
      setAction(null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'เปิดรายละเอียดไม่สำเร็จ');
    }
  }

  async function doAction() {
    if (!detail || !action) return;
    setBusy(true);
    try {
      const res = await api.post(`/affiliation/vehicle-requests/${detail.id}/${action}`, { admin_note: note });
      toast.success(res.data.message || 'สำเร็จ');
      setDetail(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ดำเนินการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  const pendingCount = rows.filter(r => r.status === 'PENDING').length;

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <PageHeader
          title="คำขอเกี่ยวกับรถ"
          subtitle="อนุมัติคำขอเกี่ยวกับรถรับส่งจากโรงเรียนในสังกัด"
          actions={
            <div className="flex items-center gap-2">
              {filter === 'PENDING' && pendingCount > 0 && (
                <StatusBadge variant="warn" size="lg">{pendingCount} รออนุมัติ</StatusBadge>
              )}
              <button onClick={load}
                className="focus-ring inline-flex items-center gap-1.5 bg-surface-raised hover:bg-surface active:bg-surface-border text-ink text-sm font-medium px-3 min-h-[44px] rounded-lg border border-surface-border transition">
                <RefreshCw className="w-4 h-4" aria-hidden="true" /> รีเฟรช
              </button>
            </div>
          }
        />

        <FilterBar
          chips={{
            label: 'กรองตามสถานะคำขอ',
            value: filter,
            onChange: setFilter,
            options: FILTERS.map(f => [f.key, f.label]),
          }}
          count={rows.length}
          countLabel="คำขอ"
        />

        <DataTable
          caption="รายการคำขอเกี่ยวกับรถในสังกัด"
          rows={rows}
          rowKey={r => r.id}
          columns={[
            { key: 'type', header: 'ประเภท', primary: true,
              cell: r => <span className="font-medium text-ink">{TYPE_LABELS[r.request_type] || r.request_type}</span> },
            { key: 'school', header: 'โรงเรียน', secondary: true, cell: r => r.school_name },
            { key: 'created', header: 'วันที่',
              cell: r => new Date(r.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' }) },
            { key: 'plate', header: 'ทะเบียน', cell: r => r.input_plate || '-' },
            { key: 'status', header: 'สถานะ', badge: true,
              cell: r => {
                const [label, variant] = STATUS_BADGE[r.status] || [r.status, 'neutral'];
                return <StatusBadge variant={variant}>{label}</StatusBadge>;
              } },
          ]}
          actions={r => <TableAction tone="brand" onClick={() => openDetail(r.id)}>รายละเอียด</TableAction>}
          empty={{
            icon: Bus,
            title: 'ไม่มีคำขอ',
            description: 'ยังไม่มีคำขอเกี่ยวกับรถในสังกัดของคุณ',
          }}
        />

        {detail && (
          <Modal
            size="lg"
            title="รายละเอียดคำขอเกี่ยวกับรถ"
            onClose={() => setDetail(null)}
            footer={
              detail.status === 'PENDING' ? (
                <>
                  <button onClick={() => setAction('reject')} disabled={busy}
                    className="focus-ring inline-flex items-center justify-center gap-1.5 border border-danger/30 bg-danger-soft hover:bg-danger/10 disabled:opacity-50 text-danger-ink text-sm font-semibold px-4 min-h-[44px] rounded-lg transition">
                    <XCircle className="w-4 h-4" aria-hidden="true" /> ไม่อนุมัติ
                  </button>
                  <button onClick={() => setAction('approve')} disabled={busy}
                    className="focus-ring inline-flex items-center justify-center gap-1.5 bg-success hover:opacity-90 disabled:opacity-50 text-white text-sm font-semibold px-4 min-h-[44px] rounded-lg transition">
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> อนุมัติ
                  </button>
                  {action && (
                    <button onClick={doAction} disabled={busy}
                      className="focus-ring inline-flex items-center justify-center bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-sm font-semibold px-4 min-h-[44px] rounded-lg transition">
                      {busy ? 'กำลังดำเนินการ…' : `ยืนยัน${action === 'approve' ? 'อนุมัติ' : 'ไม่อนุมัติ'}`}
                    </button>
                  )}
                </>
              ) : (
                <button onClick={() => setDetail(null)}
                  className="focus-ring min-h-[44px] text-sm bg-surface hover:bg-surface-border text-ink px-4 rounded-lg transition">
                  ปิด
                </button>
              )
            }
          >
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-caption text-ink-muted">ประเภทคำขอ</dt>
                <dd className="font-medium text-ink">{TYPE_LABELS[detail.request_type] || detail.request_type}</dd>
              </div>
              <div>
                <dt className="text-caption text-ink-muted">โรงเรียน</dt>
                <dd className="font-medium text-ink">{detail.school_name}</dd>
              </div>
              <div>
                <dt className="text-caption text-ink-muted">ทะเบียนรถ</dt>
                <dd className="font-medium text-ink">{detail.input_plate || '-'}</dd>
              </div>
              {detail.current_vehicle && (
                <div>
                  <dt className="text-caption text-ink-muted">รถปัจจุบัน</dt>
                  <dd className="font-medium text-ink">
                    {detail.current_vehicle.plate_no} {detail.current_vehicle.is_deleted ? '(ถูกลบ)' : ''}
                  </dd>
                </div>
              )}
              {detail.reason && (
                <div className="sm:col-span-2">
                  <dt className="text-caption text-ink-muted">เหตุผล</dt>
                  <dd className="text-ink">{detail.reason}</dd>
                </div>
              )}
              {detail.admin_note && (
                <div className="sm:col-span-2">
                  <dt className="text-caption text-ink-muted">หมายเหตุผู้อนุมัติ</dt>
                  <dd className="text-ink">{detail.admin_note}</dd>
                </div>
              )}
            </dl>

            {detail.status === 'PENDING' && (
              <FormField
                className="mt-4"
                label="หมายเหตุ"
                helper="ไม่บังคับ — จะถูกบันทึกไว้กับคำขอ"
              >
                {ctl => (
                  <textarea
                    {...ctl}
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={3}
                    className="focus-ring w-full min-h-[72px] rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-base sm:text-sm text-ink transition"
                  />
                )}
              </FormField>
            )}
          </Modal>
        )}
      </div>
    </PageTransition>
  );
}
