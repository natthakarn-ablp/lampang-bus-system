import { useState, useEffect, useCallback } from 'react';
import { Users, RefreshCw, CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import PageHeader from '../../components/PageHeader';
import {
  AlertBanner, StatusBadge, DataTable, TableAction, FilterBar, FormField, Modal,
} from '../../components/ui';
import { PageTransition } from '../../lib/motion';
import { isFailedOutcome } from '../../utils/requestOutcome';

// QA affiliation-03 — a pupil transferring in from a school in ANOTHER
// affiliation is accepted or refused by the receiving school (this page), not
// by the source affiliation. Transfers within one affiliation are still decided
// by that affiliation; they are listed here for status only.

const FILTERS = [
  { key: 'DECIDE', label: 'รอโรงเรียนพิจารณา' },
  { key: 'INCOMING', label: 'โอนเข้า' },
  { key: 'OUTGOING', label: 'โอนออก' },
  { key: 'ALL', label: 'ทั้งหมด' },
];

const STATUS_BADGE = {
  PENDING: ['รออนุมัติ', 'warn'],
  APPLIED: ['โอนย้ายแล้ว', 'success'],
  REJECTED: ['ไม่อนุมัติ', 'danger'],
  CANCELLED: ['ยกเลิก', 'neutral'],
  FAILED: ['ไม่สำเร็จ', 'danger'],
  STALE_NEEDS_REVIEW: ['ต้องตรวจสอบใหม่', 'warn'],
};

function whoDecides(r) {
  if (r.status !== 'PENDING') return '—';
  if (r.can_decide) return 'โรงเรียนของคุณ';
  return r.cross_affiliation ? 'โรงเรียนปลายทาง' : 'สังกัด / ผู้ดูแลระบบ';
}

export default function SchoolTransferRequests() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('DECIDE');
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState('');
  const [action, setAction] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/school/students/transfer-requests');
      setRows(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openDetail(id) {
    try {
      const res = await api.get(`/school/students/transfer-requests/${id}`);
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
      const res = await api.post(`/school/students/transfer-requests/${detail.id}/${action}`, { note });
      const outStatus = res.data?.data?.status;
      if (isFailedOutcome(action, outStatus)) toast.error(res.data.message || 'ดำเนินการไม่สำเร็จ');
      else toast.success(res.data.message || 'สำเร็จ');
      setDetail(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ดำเนินการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  const visible = rows.filter((r) => {
    if (filter === 'DECIDE') return r.can_decide;
    if (filter === 'INCOMING') return r.direction === 'INCOMING';
    if (filter === 'OUTGOING') return r.direction === 'OUTGOING';
    return true;
  });
  const decideCount = rows.filter((r) => r.can_decide).length;

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <PageHeader
          title="คำขอโอนย้ายนักเรียน"
          subtitle="รับหรือไม่รับนักเรียนที่โอนเข้ามาจากโรงเรียนต่างสังกัด และติดตามสถานะคำขอโอนออก"
          actions={
            <div className="flex items-center gap-2">
              {decideCount > 0 && (
                <StatusBadge variant="warn" size="lg">{decideCount} รอโรงเรียนพิจารณา</StatusBadge>
              )}
              <button onClick={load}
                className="focus-ring inline-flex items-center gap-1.5 bg-surface-raised hover:bg-surface active:bg-surface-border text-ink text-sm font-medium px-3 min-h-[44px] rounded-lg border border-surface-border transition">
                <RefreshCw className="w-4 h-4" aria-hidden="true" /> รีเฟรช
              </button>
            </div>
          }
        />

        <AlertBanner variant="info">
          โอนย้ายภายในสังกัดเดียวกัน สังกัดเป็นผู้อนุมัติ · โอนย้ายข้ามสังกัด โรงเรียนปลายทางเป็นผู้อนุมัติ
          เมื่ออนุมัติ ระบบจะสร้างนักเรียนในโรงเรียนของคุณ และผู้ปกครองที่ผูก LINE ไว้จะเห็นข้อมูลของบุตรหลานที่โรงเรียนใหม่
        </AlertBanner>

        <FilterBar
          chips={{
            label: 'กรองคำขอ',
            value: filter,
            onChange: setFilter,
            options: FILTERS.map((f) => [f.key, f.label]),
          }}
          count={visible.length}
          countLabel="คำขอ"
        />

        <DataTable
          caption="รายการคำขอโอนย้ายนักเรียนของโรงเรียน"
          rows={visible}
          rowKey={(r) => r.id}
          columns={[
            { key: 'student', header: 'นักเรียน', primary: true,
              cell: (r) => <span className="font-medium text-ink">{r.student_name}</span> },
            { key: 'code', header: 'รหัสนักเรียน', secondary: true,
              cell: (r) => <span className="tabular-nums">{r.student_code}</span> },
            { key: 'direction', header: 'ทิศทาง',
              cell: (r) => (r.direction === 'INCOMING' ? 'โอนเข้า' : 'โอนออก') + (r.cross_affiliation ? ' (ข้ามสังกัด)' : '') },
            { key: 'route', header: 'จาก → ไป',
              cell: (r) => (
                <span className="inline-flex items-center gap-1">
                  <span className="text-ink">{r.source_school_name}</span>
                  <ArrowRight className="w-3 h-3 text-ink-muted shrink-0" aria-label="ไป" />
                  <span className="text-ink">{r.destination_school_name}</span>
                </span>
              ) },
            { key: 'decider', header: 'ผู้พิจารณา', cell: whoDecides },
            { key: 'status', header: 'สถานะ', badge: true,
              cell: (r) => {
                const [label, variant] = STATUS_BADGE[r.status] || [r.status, 'neutral'];
                return <StatusBadge variant={variant}>{label}</StatusBadge>;
              } },
          ]}
          actions={(r) => (r.direction === 'INCOMING'
            ? <TableAction tone="brand" onClick={() => openDetail(r.id)}>{r.can_decide ? 'พิจารณา' : 'รายละเอียด'}</TableAction>
            : null)}
          empty={{
            icon: Users,
            title: 'ไม่มีคำขอ',
            description: filter === 'DECIDE' ? 'ไม่มีคำขอโอนเข้าที่รอโรงเรียนของคุณพิจารณา' : 'ยังไม่มีคำขอโอนย้ายในหมวดนี้',
          }}
        />

        {detail && (
          <Modal
            size="lg"
            title="คำขอโอนนักเรียนเข้าโรงเรียน"
            onClose={() => { if (!busy) setDetail(null); }}
            footer={
              detail.can_decide ? (
                <>
                  <button onClick={() => setAction('reject')} disabled={busy}
                    className="focus-ring inline-flex items-center justify-center gap-1.5 border border-danger/30 bg-danger-soft hover:bg-danger/10 disabled:opacity-50 text-danger-ink text-sm font-semibold px-4 min-h-[44px] rounded-lg transition">
                    <XCircle className="w-4 h-4" aria-hidden="true" /> ไม่อนุมัติ
                  </button>
                  <button onClick={() => setAction('approve')} disabled={busy}
                    className="focus-ring inline-flex items-center justify-center gap-1.5 bg-success-ink hover:opacity-90 disabled:opacity-50 text-white text-sm font-semibold px-4 min-h-[44px] rounded-lg transition">
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> อนุมัติรับเข้า
                  </button>
                  {action && (
                    <button onClick={doAction} disabled={busy}
                      className="focus-ring inline-flex items-center justify-center bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-sm font-semibold px-4 min-h-[44px] rounded-lg transition">
                      {busy ? 'กำลังดำเนินการ…' : `ยืนยัน${action === 'approve' ? 'อนุมัติรับเข้า' : 'ไม่อนุมัติ'}`}
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
                <dt className="text-caption text-ink-muted">นักเรียน</dt>
                <dd className="font-medium text-ink">{detail.student_name}</dd>
                <dd className="text-caption text-ink-muted tabular-nums">{detail.student_code}</dd>
              </div>
              <div>
                <dt className="text-caption text-ink-muted">ชั้น / ห้อง</dt>
                <dd className="font-medium text-ink">{detail.grade || '—'}{detail.classroom ? ` / ${detail.classroom}` : ''}</dd>
              </div>
              <div>
                <dt className="text-caption text-ink-muted">จากโรงเรียน</dt>
                <dd className="font-medium text-ink">{detail.source_school_name}</dd>
              </div>
              <div>
                <dt className="text-caption text-ink-muted">ไปโรงเรียน</dt>
                <dd className="font-medium text-ink">{detail.destination_school_name}</dd>
              </div>
              <div>
                <dt className="text-caption text-ink-muted">ผู้ปกครองที่ผูก LINE (อนุมัติแล้ว)</dt>
                <dd className="font-medium text-ink tabular-nums">{detail.guardian_links} คน</dd>
              </div>
              <div>
                <dt className="text-caption text-ink-muted">สถานะ</dt>
                <dd>
                  {(() => { const [label, variant] = STATUS_BADGE[detail.status] || [detail.status, 'neutral']; return <StatusBadge variant={variant}>{label}</StatusBadge>; })()}
                </dd>
              </div>
              {detail.reason && (
                <div className="sm:col-span-2">
                  <dt className="text-caption text-ink-muted">เหตุผล</dt>
                  <dd className="text-ink">{detail.reason}</dd>
                </div>
              )}
              {detail.evidence_note && (
                <div className="sm:col-span-2">
                  <dt className="text-caption text-ink-muted">หลักฐานเพิ่มเติม</dt>
                  <dd className="text-ink">{detail.evidence_note}</dd>
                </div>
              )}
              {detail.admin_note && (
                <div className="sm:col-span-2">
                  <dt className="text-caption text-ink-muted">หมายเหตุผู้พิจารณา</dt>
                  <dd className="text-ink">{detail.admin_note}</dd>
                </div>
              )}
            </dl>

            {detail.status === 'PENDING' && !detail.cross_affiliation && (
              <AlertBanner variant="info" className="mt-4">
                คำขอนี้เป็นการโอนย้ายภายในสังกัดเดียวกัน สังกัดเป็นผู้พิจารณา โรงเรียนดูสถานะได้อย่างเดียว
              </AlertBanner>
            )}
            {detail.can_decide && detail.destination_code_conflict && (
              <AlertBanner variant="danger" className="mt-4">
                โรงเรียนของคุณมีนักเรียนรหัสนี้อยู่แล้ว ระบบจะโอนย้ายไม่ได้ กรุณาตรวจสอบก่อน
              </AlertBanner>
            )}
            {detail.can_decide && detail.source_student_missing && (
              <AlertBanner variant="warn" className="mt-4">
                ข้อมูลนักเรียนที่โรงเรียนต้นทางเปลี่ยนไปแล้ว ระบบจะให้ตรวจสอบใหม่แทนการโอนย้าย
              </AlertBanner>
            )}

            {detail.can_decide && (
              <FormField
                className="mt-4"
                label="หมายเหตุ"
                helper="ไม่บังคับ — จะถูกบันทึกไว้กับคำขอและโรงเรียนต้นทางเห็นได้"
              >
                {(ctl) => (
                  <textarea
                    {...ctl}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    maxLength={500}
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
