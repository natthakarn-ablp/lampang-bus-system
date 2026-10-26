import { useCallback, useState } from 'react';
import api from '../api/axios';
import Modal from '../components/ui/Modal';

/**
 * Server-backed confirmation for consequential actions. Review mode displays
 * the real dialog but continues under existing RBAC without evidence. Once a
 * policy is legally approved, the server issues a one-use actor/subject-bound
 * token only after the exact approved text has been shown.
 */
export default function usePolicyAction() {
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const runWithPolicy = useCallback(async (request, execute) => {
    let response;
    try {
      response = await api.get(`/policy-notices/action/${encodeURIComponent(request.context)}`);
    } catch (err) {
      // 503 = the policy-notice tables (migration 052/053) are not installed.
      // The notice feature is not core work, so the action itself must not be
      // blocked by it: continue without a token and let the server's own
      // consumePolicyAction decide, exactly as when no policy is enabled.
      if (err.response?.status === 503) return execute(null);
      throw err;
    }
    if (!response.data?.data?.enabled) return execute(null);
    return new Promise((resolve, reject) => {
      setError('');
      setPending({
        request, execute, resolve, reject,
        action: response.data.data.action,
        reviewMode: response.data.data.reviewMode === true,
      });
    });
  }, []);

  function cancel() {
    if (busy || !pending) return;
    pending.resolve({ cancelled: true });
    setPending(null);
    setError('');
  }

  async function confirm() {
    if (!pending || busy) return;
    setBusy(true);
    setError('');
    try {
      if (pending.reviewMode) {
        const result = await pending.execute(null);
        pending.resolve(result);
        setPending(null);
        return;
      }
      const prepared = await api.post('/policy-notices/prepare-action', {
        context: pending.request.context,
        subject_type: pending.request.subjectType,
        subject_id: String(pending.request.subjectId),
        claim: pending.request.claim,
      });
      const result = await pending.execute(prepared.data.data.token);
      pending.resolve(result);
      setPending(null);
    } catch (err) {
      setError(err.response?.data?.message || 'ยังยืนยันรายการไม่ได้ กรุณาตรวจข้อมูลแล้วลองใหม่');
    } finally {
      setBusy(false);
    }
  }

  const action = pending?.action;
  const policyActionDialog = (
    <Modal
      open={!!pending}
      title={action?.title || 'ตรวจสอบก่อนดำเนินการ'}
      onClose={cancel}
      size="md"
      footer={<>
        <button type="button" onClick={cancel} disabled={busy}
          className="focus-ring min-h-[44px] rounded-lg border border-surface-border px-4 text-sm font-medium text-ink hover:bg-surface disabled:opacity-50">
          กลับไปตรวจข้อมูล
        </button>
        <button type="button" onClick={confirm} disabled={busy}
          className="focus-ring min-h-[44px] rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? 'กำลังยืนยัน…' : pending?.reviewMode ? 'ตรวจแล้ว ดำเนินรายการจริง'
            : action?.kind === 'warning' ? 'เข้าใจและส่งออก' : 'รับรองและดำเนินการ'}
        </button>
      </>}
    >
      <div className="space-y-4 text-sm leading-7 text-ink-muted">
        {pending?.reviewMode && <p role="status" className="rounded-xl border border-warn-border bg-warn-soft p-3 text-xs leading-6 text-warn-ink">
          ใช้งานจริงเพื่อประชุมวันที่ 21 ตุลาคม 2569: รายการที่ทำต่อจะบันทึกจริงตามสิทธิ์เดิมของระบบ ส่วนการกดหน้าต่างนี้ยังไม่บันทึกเป็นหลักฐานรับทราบทางกฎหมาย
        </p>}
        <p className="text-ink">{action?.summary}</p>
        {action?.body && <p className="whitespace-pre-line">{action.body}</p>}
        <dl className="rounded-xl bg-surface p-4 text-xs leading-6">
          <dt className="font-semibold text-ink">ฐานการใช้ข้อมูล</dt>
          <dd>{action?.lawfulBasis || 'รอทีมกฎหมายและหน่วยงานกำหนด'}</dd>
          <dt className="mt-2 font-semibold text-ink">ระยะเวลาเก็บหลักฐาน</dt>
          <dd>{action?.retentionRule || 'รอทีมกฎหมายและหน่วยงานกำหนด'}</dd>
        </dl>
        {action?.fullNoticeUrl && <a href={action.fullNoticeUrl} target="_blank" rel="noopener noreferrer"
          className="focus-ring inline-block font-medium text-brand-700 underline underline-offset-2">อ่านประกาศฉบับเต็ม</a>}
        <p className="rounded-xl border border-info-border bg-info-soft p-3 text-xs leading-6 text-info-ink">
          การยืนยันนี้เป็นหลักฐานของรายการที่กำลังทำ ไม่ใช่การให้ความยินยอมแทนนักเรียนหรือผู้ปกครอง และไม่เพิ่มสิทธิ์เข้าถึงข้อมูล
        </p>
        {error && <p role="alert" className="rounded-xl bg-danger-soft p-3 text-danger-ink">{error}</p>}
      </div>
    </Modal>
  );

  return { runWithPolicy, policyActionDialog };
}
