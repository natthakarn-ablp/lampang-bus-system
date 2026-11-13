import { useCallback, useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../Toast';
import AppCard from '../ui/AppCard';
import StatusBadge from '../ui/StatusBadge';
import { ConfirmDialog, FormField } from '../ui';
import { APPOINTMENT_STATUS, buttonPrimary, buttonSecondary, thaiDate } from './certificationShared';
import { todayBangkok } from '../../utils/thaiTime';

/**
 * Transport — schools' requests for one inspection day at the school
 * (มพบ. 2564). Confirm a date (may differ from the proposal), then mark the
 * visit done. Mounted only when features.schoolCertification is on.
 */
export default function TransportAppointmentsPanel() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [date, setDate] = useState('');
  const [doneTarget, setDoneTarget] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/certification/transport/appointments');
      setRows((res.data?.data || []).filter(r => ['REQUESTED', 'CONFIRMED'].includes(r.status)));
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function confirm() {
    if (!confirmTarget || !date) return;
    setBusy(true);
    try {
      await api.post(`/certification/transport/appointments/${confirmTarget.id}/confirm`, { confirmed_date: date });
      toast.success('ยืนยันวันตรวจแล้ว');
      setConfirmTarget(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ยืนยันวันตรวจไม่สำเร็จ');
    } finally { setBusy(false); }
  }

  async function markDone() {
    if (!doneTarget) return;
    setBusy(true);
    try {
      await api.post(`/certification/transport/appointments/${doneTarget.id}/done`);
      toast.success('บันทึกว่าตรวจเสร็จแล้ว');
      setDoneTarget(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally { setBusy(false); }
  }

  if (!rows.length) return null;

  return (
    <AppCard>
      <div className="flex items-center gap-2">
        <CalendarDays className="h-5 w-5 text-ink-muted" strokeWidth={2.2} aria-hidden="true" />
        <h2 className="text-lg font-bold text-ink">นัดตรวจรถที่โรงเรียน</h2>
        <StatusBadge variant="warn">{rows.filter(r => r.status === 'REQUESTED').length} รอยืนยัน</StatusBadge>
      </div>
      <ul className="mt-3 divide-y divide-surface-border">
        {rows.map(ap => {
          const [label, variant] = APPOINTMENT_STATUS[ap.status] || [ap.status, 'neutral'];
          return (
            <li key={ap.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{ap.school_name} · {(ap.vehicles || []).length} คัน</p>
                <p className="text-sm text-ink-muted">
                  เสนอ {thaiDate(ap.proposed_date)}{ap.confirmed_date ? ` · วันตรวจ ${thaiDate(ap.confirmed_date)}` : ''}
                  {ap.note ? ` · ${ap.note}` : ''}
                </p>
                <p className="text-sm text-ink-muted">{(ap.vehicles || []).map(v => v.plate_no).join(', ')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge variant={variant}>{label}</StatusBadge>
                <button type="button" className={buttonPrimary}
                  onClick={() => { setDate(ap.confirmed_date || ap.proposed_date || todayBangkok()); setConfirmTarget(ap); }}>
                  {ap.status === 'CONFIRMED' ? 'เปลี่ยนวันตรวจ' : 'ยืนยันวันตรวจ'}
                </button>
                {ap.status === 'CONFIRMED' && (
                  <button type="button" className={buttonSecondary} onClick={() => setDoneTarget(ap)}>ตรวจเสร็จแล้ว</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={Boolean(confirmTarget)}
        title="ยืนยันวันตรวจรถที่โรงเรียน"
        description="โรงเรียนจะเห็นวันตรวจนี้ในหน้าส่งตรวจและรับรองรถ"
        itemName={confirmTarget?.school_name}
        confirmLabel="ยืนยันวันตรวจ"
        tone="brand"
        loading={busy}
        confirmDisabled={!date}
        onConfirm={confirm}
        onCancel={() => { if (!busy) setConfirmTarget(null); }}
      >
        <FormField label="วันตรวจ" type="date" required value={date} onChange={setDate} min={todayBangkok()} />
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(doneTarget)}
        title="ยืนยันว่าตรวจที่โรงเรียนเสร็จแล้ว"
        description="ผลตรวจรายคันยังบันทึกในคิวตรวจตามปกติ"
        itemName={doneTarget?.school_name}
        confirmLabel="ตรวจเสร็จแล้ว"
        tone="brand"
        loading={busy}
        onConfirm={markDone}
        onCancel={() => { if (!busy) setDoneTarget(null); }}
      />
    </AppCard>
  );
}
