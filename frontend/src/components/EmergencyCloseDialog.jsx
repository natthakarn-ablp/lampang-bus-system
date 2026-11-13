import { useState, useRef } from 'react';
import api from '../api/axios';
import { FormField, Modal } from './ui';
import { useToast } from './Toast';

/**
 * EmergencyCloseDialog — close (ปิดเหตุ) one emergency with a required note.
 * The backend appends the note to the emergency's history and audits who,
 * which role and when; it answers 404 for an emergency outside the caller's
 * scope and 409 when it is already closed.
 *
 * Props: emergency, closeUrl (e.g. `/school/emergencies/12/close`),
 *        results (choices offered; first is the default), onClose, onClosed.
 */
export const RESULT_LABELS = {
  RESOLVED: 'แก้ไขแล้ว',
  FALSE_ALARM: 'แจ้งผิด/ไม่ใช่เหตุฉุกเฉิน',
  CLOSED: 'ปิดเรื่อง',
  ACKNOWLEDGED: 'รับทราบแล้ว',
};

export function isClosedResult(result) {
  return ['RESOLVED', 'FALSE_ALARM', 'CLOSED'].includes(String(result || '').toUpperCase());
}

export default function EmergencyCloseDialog({
  emergency, closeUrl, results = ['RESOLVED', 'FALSE_ALARM'], title = 'ปิดเหตุฉุกเฉิน',
  submitLabel = 'ปิดเหตุ', onClose, onClosed,
}) {
  const toast = useToast();
  const [result, setResult] = useState(results[0]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);

  async function submit(e) {
    e.preventDefault();
    if (lock.current) return;
    if (!note.trim()) { setError('กรุณาระบุบันทึกการแก้ไขเหตุ'); return; }
    lock.current = true; setSaving(true); setError('');
    try {
      await api.post(closeUrl, { result, note: note.trim() });
      toast.success('ปิดเหตุฉุกเฉินแล้ว');
      onClosed?.();
    } catch (err) {
      setError(err.response?.data?.message || 'ปิดเหตุไม่สำเร็จ');
    } finally {
      lock.current = false; setSaving(false);
    }
  }

  return (
    <Modal
      title={title}
      dismissible={!saving}
      onClose={() => { if (!lock.current) onClose?.(); }}
      footer={
        <>
          <button type="button" disabled={saving} onClick={onClose}
            className="focus-ring text-sm font-medium px-4 min-h-[44px] rounded-lg border border-surface-border bg-surface-raised text-ink hover:bg-surface transition">
            ยกเลิก
          </button>
          <button type="submit" form="emergency-close-form" disabled={saving || !note.trim()}
            className="focus-ring text-sm font-semibold px-4 min-h-[44px] rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 disabled:pointer-events-none transition">
            {saving ? 'กำลังบันทึก…' : submitLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-ink-muted mb-3">
        {emergency?.plate_no || 'ไม่ระบุรถ'} · {emergency?.detail}
      </p>
      <form id="emergency-close-form" onSubmit={submit} className="space-y-3">
        {results.length > 1 && (
          <FormField label="ผลการดำเนินการ" required>
            {ctl => (
              <select {...ctl} value={result} onChange={e => setResult(e.target.value)}
                className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink">
                {results.map(r => <option key={r} value={r}>{RESULT_LABELS[r] || r}</option>)}
              </select>
            )}
          </FormField>
        )}
        <FormField label="บันทึกการแก้ไขเหตุ" required error={error || undefined}>
          {ctl => (
            <textarea {...ctl} value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={500}
              placeholder="เช่น ติดต่อคนขับแล้ว รถซ่อมเสร็จ นักเรียนปลอดภัยทุกคน"
              className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 py-2.5 text-base text-ink placeholder:text-ink-muted" />
          )}
        </FormField>
        <p className="text-caption text-ink-muted">ระบบเก็บประวัติว่าใคร บทบาทใด ปิดเหตุเมื่อใด พร้อมบันทึกนี้</p>
      </form>
    </Modal>
  );
}
