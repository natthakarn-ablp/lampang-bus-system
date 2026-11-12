import { useState, useEffect, useCallback } from 'react';
import { Route } from 'lucide-react';
import api from '../api/axios';
import { useToast } from './Toast';
import { AppCard, Modal } from './ui';
import { driverErrorMessage } from '../utils/driverErrors';

/**
 * Several trips per round (FEATURE_MULTI_TRIP, owner decision 2026-11-12).
 * Shown on the driver dashboard while pupils are still waiting:
 *   - children on board  → "ส่งเด็กกลุ่มนี้ลงครบแล้ว (จบเที่ยวที่ N)" (checkout-all)
 *   - bus empty, pupils left → "เริ่มเที่ยวที่ N+1" with a reason
 * The server enforces the same rules (bus empty, someone boarded already).
 */
export default function TripPanel({ session, pendingCount, refreshKey, onChanged }) {
  const toast = useToast();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonText, setReasonText] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/driver/trips', { params: { session } });
      setState(res.data?.data || null);
    } catch {
      setState(null); // flag off or not linked: the panel simply stays hidden
    }
  }, [session]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (!state || pendingCount === 0) return null;
  const tripNo = state.current_trip;

  async function endTrip() {
    setBusy(true);
    try {
      const res = await api.post('/driver/checkout-all', { session });
      const { succeeded = [], failed = [] } = res.data?.data || {};
      toast.success(`จบเที่ยวที่ ${tripNo} — ส่งลง ${succeeded.length} คน` + (failed.length ? ` · ไม่สำเร็จ ${failed.length} คน` : ''));
      await onChanged?.();
      await load();
    } catch (err) {
      toast.error(driverErrorMessage(err, 'บันทึกไม่สำเร็จ'));
    } finally { setBusy(false); }
  }

  async function startNext() {
    if (!reason) { toast.error('กรุณาเลือกเหตุผล'); return; }
    if (reason === 'OTHER' && !reasonText.trim()) { toast.error('กรุณาพิมพ์เหตุผล'); return; }
    setBusy(true);
    try {
      const res = await api.post('/driver/trips', { session, reason_code: reason, reason_text: reasonText });
      toast.success(res.data?.message || 'เริ่มเที่ยวถัดไปแล้ว');
      setOpen(false); setReason(''); setReasonText('');
      await onChanged?.();
      await load();
    } catch (err) {
      toast.error(driverErrorMessage(err, 'เริ่มเที่ยวถัดไปไม่สำเร็จ'));
      await load();
    } finally { setBusy(false); }
  }

  return (
    <AppCard className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <Route className="w-5 h-5 text-brand-700" aria-hidden="true" />
        <p className="text-lg font-semibold text-ink">เที่ยวที่ {tripNo}</p>
        {state.trips.length > 0 && (
          <span className="text-sm text-ink-muted">· {state.trips[state.trips.length - 1].reason_label}</span>
        )}
      </div>
      {state.on_board > 0 ? (
        <>
          <p className="text-base text-ink-muted mb-3">
            บนรถ {state.on_board} คน · ยังรอรับอีก {pendingCount} คน ถ้ารถเต็มหรือต้องส่งกลุ่มนี้ก่อน ให้ส่งลงให้ครบแล้วกดปุ่มนี้
          </p>
          <button type="button" onClick={endTrip} disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 bg-brand-700 hover:bg-brand-700/90 disabled:opacity-50 text-white text-lg font-semibold px-5 min-h-[56px] rounded-2xl transition">
            {busy ? 'กำลังบันทึก…' : `ส่งเด็กกลุ่มนี้ลงครบแล้ว (จบเที่ยวที่ ${tripNo})`}
          </button>
        </>
      ) : state.can_start_next ? (
        <>
          <p className="text-base text-ink-muted mb-3">ส่งกลุ่มก่อนลงครบแล้ว ยังรอรับอีก {pendingCount} คน</p>
          <button type="button" onClick={() => setOpen(true)} disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 bg-success-ink hover:bg-success-ink/90 disabled:opacity-50 text-white text-lg font-semibold px-5 min-h-[56px] rounded-2xl transition">
            เริ่มเที่ยวที่ {tripNo + 1}
          </button>
        </>
      ) : null}

      {open && (
        <Modal title={`เริ่มเที่ยวที่ ${tripNo + 1} — ทำไมต้องวิ่งหลายเที่ยว?`} onClose={() => setOpen(false)}>
          <fieldset className="space-y-2">
            <legend className="sr-only">เหตุผล</legend>
            {state.reasons.map((r) => (
              <label key={r.code}
                className={`flex items-center gap-3 min-h-[48px] px-3 rounded-lg border cursor-pointer ${reason === r.code ? 'border-brand-600 bg-brand-50' : 'border-surface-border'}`}>
                <input type="radio" name="trip-reason" value={r.code} checked={reason === r.code}
                  onChange={() => setReason(r.code)} className="w-5 h-5" />
                <span className="text-base text-ink">{r.label}</span>
              </label>
            ))}
          </fieldset>
          {reason === 'OTHER' && (
            <label className="block mt-3">
              <span className="text-sm font-medium text-ink">พิมพ์เหตุผล</span>
              <input type="text" value={reasonText} maxLength={200} onChange={(e) => setReasonText(e.target.value)}
                className="focus-ring mt-1 w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[48px] text-base text-ink" />
            </label>
          )}
          <button type="button" onClick={startNext} disabled={busy}
            className="mt-4 inline-flex w-full items-center justify-center bg-success-ink hover:bg-success-ink/90 disabled:opacity-50 text-white text-lg font-semibold min-h-[52px] rounded-xl transition">
            {busy ? 'กำลังบันทึก…' : `เริ่มเที่ยวที่ ${tripNo + 1}`}
          </button>
          <button type="button" onClick={() => setOpen(false)}
            className="mt-2 w-full text-ink-muted hover:text-ink text-base min-h-[48px] rounded-lg">
            ยกเลิก
          </button>
        </Modal>
      )}
    </AppCard>
  );
}
