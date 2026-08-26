import { useCallback, useEffect, useState } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import LoadingState from '../../components/LoadingState';
import { AlertBanner, ConfirmDialog, FormField, Modal, StatusBadge } from '../../components/ui';

// Phase 10.13B-6 — school-side "ขอโอนย้ายนักเรียน" request. Creating a request
// changes NO data; the move only happens after admin approval.

const STATUS = {
  PENDING:            { label: 'รออนุมัติ',        variant: 'warn' },
  APPLIED:            { label: 'โอนย้ายแล้ว',      variant: 'success' },
  REJECTED:           { label: 'ไม่อนุมัติ',        variant: 'danger' },
  CANCELLED:          { label: 'ยกเลิกแล้ว',       variant: 'neutral' },
  FAILED:             { label: 'ไม่สำเร็จ',         variant: 'danger' },
  STALE_NEEDS_REVIEW: { label: 'ต้องตรวจสอบใหม่', variant: 'warn' },
};

export default function StudentTransferModal({ student, onClose, onChanged }) {
  const toast = useToast();
  const [dest, setDest] = useState('');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requests, setRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  // The existing-requests fetch failed silently, so "no requests yet" and
  // "we could not load your requests" looked identical — and the school would
  // file a duplicate request for a pupil who already had one pending.
  const [requestsError, setRequestsError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(null);

  const studentId = student?.id;

  const loadRequests = useCallback(async () => {
    if (!studentId) return;
    setRequestsLoading(true);
    setRequestsError('');
    try {
      const res = await api.get('/school/students/transfer-requests');
      const list = Array.isArray(res.data?.data) ? res.data.data : [];
      setRequests(list.filter((r) => String(r.student_id) === String(studentId)));
    } catch (err) {
      setRequestsError(err.response?.data?.message || 'โหลดคำขอเดิมไม่สำเร็จ');
      setRequests([]);
    } finally {
      setRequestsLoading(false);
    }
  }, [studentId]);

  // The effect used to dereference student.id unguarded, so mounting this
  // without a student threw rather than rendering nothing.
  useEffect(() => { loadRequests(); }, [loadRequests]);

  if (!student) return null;

  const destError = error && !dest.trim() ? 'กรุณาระบุรหัสโรงเรียนปลายทาง' : undefined;
  const reasonError = error && !reason.trim() ? 'กรุณาระบุเหตุผล' : undefined;

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!dest.trim()) { setError('กรุณาระบุรหัสโรงเรียนปลายทาง'); return; }
    if (!reason.trim()) { setError('กรุณาระบุเหตุผล'); return; }
    if (busy) return; // a duplicate request has to be cancelled by hand
    setBusy(true);
    try {
      await api.post(`/school/students/${student.id}/transfer-request`, {
        destination_school_id: dest.trim(), reason, evidence_note: evidence,
      });
      toast.success('ส่งคำขอโอนย้ายแล้ว · รอผู้ดูแลระบบตรวจสอบ');
      setDest(''); setReason(''); setEvidence(''); loadRequests(); onChanged?.();
    } catch (err) { setError(err.response?.data?.message || 'ส่งคำขอไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  async function cancel(req) {
    setBusy(true);
    try {
      await api.post(`/school/students/transfer-requests/${req.id}/cancel`);
      toast.success('ยกเลิกคำขอแล้ว');
      setConfirmCancel(null);
      loadRequests();
    } catch (err) { toast.error(err.response?.data?.message || 'ยกเลิกไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Modal
        title="ขอโอนย้ายนักเรียน"
        onClose={() => { if (!busy) onClose(); }}
        footer={
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="focus-ring px-4 min-h-[44px] text-sm font-medium rounded-lg border border-surface-border text-ink hover:bg-surface transition disabled:opacity-50"
            >
              ปิด
            </button>
            <button
              type="submit"
              form="student-transfer-form"
              disabled={busy}
              className="focus-ring px-4 min-h-[44px] text-sm font-semibold rounded-lg bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white transition disabled:opacity-40 disabled:pointer-events-none"
            >
              {busy ? 'กำลังส่ง…' : 'ส่งคำขอโอนย้าย'}
            </button>
          </>
        }
      >
        <p className="text-sm text-ink-muted mb-3">
          {student.prefix}{student.first_name} {student.last_name} · รหัส {student.student_code ?? student.id}
        </p>

        <AlertBanner variant="warn" title="คำขอนี้ยังไม่ย้ายข้อมูล" className="mb-4">
          ระบบจะไม่ย้ายข้อมูลนักเรียนอัตโนมัติ · คำขอนี้ต้องรอผู้ดูแลระบบตรวจสอบก่อน
        </AlertBanner>

        <form id="student-transfer-form" onSubmit={submit} className="space-y-3">
          <FormField
            label="รหัสโรงเรียนปลายทาง"
            required
            value={dest}
            onChange={setDest}
            placeholder="เช่น 52020082"
            error={destError}
          />
          <FormField
            label="เหตุผล"
            required
            value={reason}
            onChange={setReason}
            placeholder="เช่น ย้ายตามผู้ปกครอง"
            error={reasonError}
          />
          <FormField
            label="หมายเหตุ/หลักฐาน"
            helper="ไม่บังคับ"
            value={evidence}
            onChange={setEvidence}
          />
          {error && !destError && !reasonError && (
            <AlertBanner variant="danger" title="ส่งคำขอไม่สำเร็จ">{error}</AlertBanner>
          )}
        </form>

        <div className="mt-5">
          <h3 className="text-caption font-medium text-ink-muted mb-2">คำขอของนักเรียนคนนี้</h3>
          {requestsLoading ? (
            <LoadingState compact message="กำลังโหลดคำขอเดิม…" />
          ) : requestsError ? (
            <AlertBanner variant="danger" title="โหลดคำขอเดิมไม่สำเร็จ">{requestsError}</AlertBanner>
          ) : requests.length === 0 ? (
            <p className="text-sm text-ink-muted">ยังไม่มีคำขอโอนย้ายของนักเรียนคนนี้</p>
          ) : (
            <ul className="space-y-2">
              {requests.map((r) => {
                const s = STATUS[r.status] || { label: r.status, variant: 'neutral' };
                return (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 border border-surface-border rounded-lg px-3 py-2"
                  >
                    <div className="min-w-0 text-sm">
                      <StatusBadge variant={s.variant} size="sm">{s.label}</StatusBadge>
                      <span className="text-ink-muted ml-2">
                        <span aria-hidden="true">→</span> {r.destination_school_name || r.destination_school_id}
                      </span>
                      {r.status === 'REJECTED' && r.admin_note && (
                        <div className="text-caption text-ink-muted mt-1">หมายเหตุ: {r.admin_note}</div>
                      )}
                    </div>
                    {r.status === 'PENDING' && (
                      <button
                        type="button"
                        onClick={() => setConfirmCancel(r)}
                        disabled={busy}
                        className="focus-ring shrink-0 text-sm font-medium text-danger-ink px-2 min-h-[44px] rounded-lg hover:bg-danger-soft transition disabled:opacity-50 disabled:pointer-events-none"
                      >
                        ยกเลิกคำขอ
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmCancel)}
        title="ยกเลิกคำขอโอนย้ายนี้?"
        itemName={confirmCancel
          ? `${student.prefix || ''}${student.first_name} ${student.last_name} → ${confirmCancel.destination_school_name || confirmCancel.destination_school_id}`
          : undefined}
        description="คำขอจะถูกยกเลิกและต้องยื่นใหม่หากยังต้องการโอนย้าย ข้อมูลนักเรียนไม่เปลี่ยนแปลง"
        confirmLabel="ยกเลิกคำขอ"
        cancelLabel="เก็บคำขอไว้"
        loading={busy}
        onConfirm={() => cancel(confirmCancel)}
        onCancel={() => setConfirmCancel(null)}
      />
    </>
  );
}
