import { useCallback, useEffect, useState } from 'react';
import api from '../../api/axios';
import { useToast } from '../Toast';
import LoadingState from '../LoadingState';
import ErrorState from '../ErrorState';
import AlertBanner from '../ui/AlertBanner';
import ConfirmDialog from '../ui/ConfirmDialog';
import StatusBadge from '../ui/StatusBadge';

// Phase QR-1 — driver consent management. THREE SEPARATE consent records
// (public / parent / sensitive), each granted/withdrawn independently. Each
// checkbox is NOT pre-checked. Withdrawing a required consent warns that the
// public display becomes "ระงับการแสดงผล".
const DRIVER_CONSENTS = [
  { type: 'qr_driver_public', label: 'แสดงสถานะระดับสาธารณะ', required: true },
  { type: 'qr_driver_parent', label: 'แสดงชื่อ/ช่องทางติดต่อแก่ผู้ปกครอง', required: true },
  { type: 'qr_driver_sensitive', label: 'ข้อมูลอ่อนไหวต่อเจ้าหน้าที่ (PDPA ม.26)', required: false },
];

export default function DriverConsentForm() {
  const toast = useToast();
  const [statuses, setStatuses] = useState({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  // A failed load only raised a toast, so every row settled on
  // "ยังไม่ยินยอม" — a driver would read that as consent having been
  // withdrawn and grant it again.
  const [error, setError] = useState(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/consent/me');
      const map = {};
      (Array.isArray(res.data?.data) ? res.data.data : []).forEach((c) => { map[c.type] = c.status; });
      setStatuses(map);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดสถานะความยินยอมไม่สำเร็จ');
      setStatuses({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function grant(type) {
    setBusy(true);
    try { await api.post('/consent', { consent_type: type }); toast.success('บันทึกความยินยอมแล้ว'); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'ไม่สำเร็จ'); } finally { setBusy(false); }
  }
  // A required consent is the one whose withdrawal suspends the driver's
  // public display, so it asks first — and now says so in a dialog that can
  // be read and dismissed with the keyboard.
  function requestWithdraw(c) {
    if (c.required) { setConfirmWithdraw(c); return; }
    withdraw(c.type);
  }

  async function withdraw(type) {
    setBusy(true);
    try {
      await api.post('/consent/withdraw', { consent_type: type });
      toast.success('ถอนความยินยอมแล้ว');
      setConfirmWithdraw(null);
      load();
    }
    catch (err) { toast.error(err.response?.data?.message || 'ไม่สำเร็จ'); } finally { setBusy(false); }
  }

  return (
    <div className="max-w-md">
      <h2 className="text-base font-semibold text-ink mb-1">การจัดการความยินยอม (QR)</h2>
      <p className="text-caption text-ink-muted mb-3">เลือกยินยอมแยกแต่ละรายการ ถอนได้ตลอดเวลา</p>
      <AlertBanner variant="info" title="สิทธิ์ของคุณ" className="mb-4">
        คุณให้หรือถอนความยินยอมแต่ละรายการได้อิสระ และเปลี่ยนใจได้ทุกเมื่อ
      </AlertBanner>
      {loading ? (
        <LoadingState compact message="กำลังโหลดสถานะความยินยอม…" />
      ) : error ? (
        <ErrorState title="โหลดสถานะความยินยอมไม่สำเร็จ" message={error} onRetry={load} />
      ) : (
        <ul className="space-y-2">
          {DRIVER_CONSENTS.map((c) => {
            const granted = statuses[c.type] === 'granted';
            return (
              <li
                key={c.type}
                className="flex flex-wrap items-center justify-between gap-2 border border-surface-border rounded-lg px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm text-ink">
                    {c.label}
                    {c.required && (
                      <>
                        <span className="text-danger-ink ml-1" aria-hidden="true">*</span>
                        <span className="sr-only"> (จำเป็น)</span>
                      </>
                    )}
                  </div>
                  <div className="mt-1">
                    <StatusBadge variant={granted ? 'success' : 'neutral'} size="sm">
                      {granted ? 'ยินยอมแล้ว' : 'ยังไม่ยินยอม'}
                    </StatusBadge>
                  </div>
                </div>
                {granted ? (
                  <button
                    type="button"
                    onClick={() => requestWithdraw(c)}
                    disabled={busy}
                    className="focus-ring shrink-0 text-sm font-medium text-danger-ink border border-danger/30 hover:bg-danger-soft rounded-lg px-3 min-h-[44px] transition disabled:opacity-50 disabled:pointer-events-none"
                  >
                    ถอนความยินยอม
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => grant(c.type)}
                    disabled={busy}
                    className="focus-ring shrink-0 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 active:bg-brand-800 rounded-lg px-3 min-h-[44px] transition disabled:opacity-50 disabled:pointer-events-none"
                  >
                    ยินยอม
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(confirmWithdraw)}
        title="ถอนความยินยอมที่จำเป็น?"
        itemName={confirmWithdraw?.label}
        description={'การถอนความยินยอมนี้จะทำให้ระบบ “ระงับการแสดงผล” ข้อมูลของคุณ — ผู้ปกครองและเจ้าหน้าที่จะไม่เห็นสถานะรถของคุณจนกว่าจะให้ความยินยอมอีกครั้ง'}
        confirmLabel="ถอนความยินยอม"
        cancelLabel="ยังคงยินยอม"
        loading={busy}
        onConfirm={() => withdraw(confirmWithdraw.type)}
        onCancel={() => setConfirmWithdraw(null)}
      />
    </div>
  );
}
