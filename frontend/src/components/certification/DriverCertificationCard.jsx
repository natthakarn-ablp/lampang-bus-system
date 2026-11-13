import { useCallback, useEffect, useState } from 'react';
import { FileDown, ShieldCheck } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../Toast';
import AppCard from '../ui/AppCard';
import StatusBadge from '../ui/StatusBadge';
import { FormField } from '../ui';
import { CERT_STATE, buttonPrimary, buttonSecondary, downloadCertificatePdf, thaiDate } from './certificationShared';

/**
 * Driver — the in-vehicle caretaker (ผู้ดูแลนักเรียน) the school and DLT ask
 * for, and the school certificates issued for the driver's vehicle
 * (มพบ. 2564). Mounted only when features.schoolCertification is on.
 */
export default function DriverCertificationCard() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/certification/driver/overview');
      const d = res.data?.data || null;
      setData(d);
      setForm({ name: d?.caretaker?.name || '', phone: d?.caretaker?.phone || '' });
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.put('/certification/driver/caretaker', form);
      toast.success('บันทึกผู้ดูแลนักเรียนแล้ว');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally { setBusy(false); }
  }

  if (!data || !data.vehicle_id) return null;

  return (
    <AppCard padding="lg">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-6 w-6 text-brand-700" strokeWidth={2.2} aria-hidden="true" />
        <h2 className="text-lg font-bold text-ink">หนังสือรับรองจากโรงเรียน</h2>
      </div>
      <p className="mt-1 text-base text-ink-muted">
        แนบบัตรประชาชน ใบขับขี่ รูปถ่ายรถ และเล่มทะเบียนรถ ที่หน้า "รายชื่อเด็กในรถ" แล้วให้โรงเรียนตรวจและออกหนังสือรับรอง
        นำหนังสือนี้ไปยื่นที่สำนักงานขนส่งจังหวัด
      </p>

      {(data.certificates || []).length === 0 ? (
        <p className="mt-3 text-base text-ink">ยังไม่มีหนังสือรับรอง</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.certificates.map(cert => {
            const [label, variant] = CERT_STATE[cert.state] || [cert.state, 'neutral'];
            return (
              <li key={cert.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-surface-border p-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-ink">{cert.cert_no}</p>
                  <p className="text-base text-ink-muted">{cert.school_name} · มีผลถึง {thaiDate(cert.valid_until)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge variant={variant}>{label}</StatusBadge>
                  <button type="button" className={buttonSecondary}
                    onClick={() => downloadCertificatePdf(cert.id, cert.cert_no).catch(() => toast.error('ดาวน์โหลดไม่สำเร็จ'))}>
                    <FileDown className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
                    ดาวน์โหลด
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={save} className="mt-5 grid gap-3 sm:grid-cols-2">
        <p className="text-base font-semibold text-ink sm:col-span-2">ผู้ดูแลนักเรียนประจำรถ</p>
        <FormField label="ชื่อ-นามสกุล" value={form.name} autoComplete="off"
          onChange={v => setForm(f => ({ ...f, name: v }))} />
        <FormField label="เบอร์โทร" type="tel" inputMode="tel" value={form.phone} autoComplete="off"
          onChange={v => setForm(f => ({ ...f, phone: v }))} />
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy} className={buttonPrimary}>บันทึกผู้ดูแล</button>
        </div>
      </form>
    </AppCard>
  );
}
