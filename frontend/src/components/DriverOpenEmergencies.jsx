import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2 } from 'lucide-react';
import api from '../api/axios';
import EmergencyCloseDialog from './EmergencyCloseDialog';

/**
 * DriverOpenEmergencies — the driver's own emergencies that are still open
 * (reported by them or for their current vehicle), each with a "แก้ไขแล้ว"
 * button (owner decision 2026-11-13). Renders nothing when there are none or
 * the list cannot be read: reporting a new emergency must never be blocked or
 * cluttered by this list.
 */
export default function DriverOpenEmergencies() {
  const [openEmergencies, setOpenEmergencies] = useState([]);
  const [resolving, setResolving] = useState(null);
  const load = useCallback(() => {
    api.get('/driver/emergencies/open')
      .then((res) => setOpenEmergencies(Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => setOpenEmergencies([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <>
    {openEmergencies.length > 0 && (
      <section aria-labelledby="open-emergencies-title" className="mb-5 rounded-2xl border border-warn bg-warn-soft p-4">
        <h2 id="open-emergencies-title" className="font-semibold text-warn-ink mb-2">เหตุที่แจ้งไว้และยังไม่ปิด</h2>
        <ul className="space-y-3">
          {openEmergencies.map((em) => (
            <li key={em.id} className="rounded-xl bg-surface-raised border border-surface-border p-3">
              <p className="text-sm text-ink">{em.detail}</p>
              <p className="text-xs text-ink-muted mt-1">
                {em.plate_no ? `${em.plate_no} · ` : ''}
                {em.reported_at ? new Date(em.reported_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
              </p>
              <button type="button" onClick={() => setResolving(em)}
                className="focus-ring mt-2 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg bg-success-ink text-white text-sm font-semibold hover:opacity-90">
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                แก้ไขแล้ว
              </button>
            </li>
          ))}
        </ul>
      </section>
    )}

    {resolving && (
      <EmergencyCloseDialog
        emergency={resolving}
        closeUrl={`/driver/emergencies/${resolving.id}/resolve`}
        results={['RESOLVED']}
        title="แจ้งว่าแก้ไขเหตุแล้ว"
        submitLabel="แก้ไขแล้ว"
        onClose={() => setResolving(null)}
        onClosed={() => { setResolving(null); load(); }}
      />
    )}
    </>
  );
}
