import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, FileDown, FileText, ShieldCheck } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../Toast';
import AppCard from '../ui/AppCard';
import StatusBadge from '../ui/StatusBadge';
import { AlertBanner, ConfirmDialog, FormField } from '../ui';
import {
  APPOINTMENT_STATUS, CERT_STATE, WINDOW_STATE, buttonDanger, buttonPrimary, buttonSecondary,
  downloadCertificatePdf, inputClass, thaiDate,
} from './certificationShared';

/**
 * School main account — "ล้อที่ 3 ระบบการรับรองรถโรงเรียน" (มพบ. 2564):
 * intake window + criteria for the current term, the certificates the school
 * has issued (download / revoke with a reason), and inspection-day requests
 * covering several ready vehicles. Mounted only when
 * features.schoolCertification is on and the account is not a grade teacher.
 */
export default function SchoolCertificationPanel({ applications = [], onChanged }) {
  const toast = useToast();
  const [summary, setSummary] = useState(null);
  const [form, setForm] = useState({ opens_on: '', closes_on: '', criteria_note: '', require_compulsory_insurance: false });
  const [certificates, setCertificates] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [apForm, setApForm] = useState({ proposed_date: '', note: '', ids: [] });
  const [cancelTarget, setCancelTarget] = useState(null);

  const load = useCallback(async () => {
    try {
      const [w, c, a] = await Promise.all([
        api.get('/certification/school/window'),
        api.get('/certification/school/certificates'),
        api.get('/certification/school/appointments'),
      ]);
      const data = w.data?.data || null;
      setSummary(data);
      const win = data?.window || {};
      setForm({
        opens_on: win.opens_on || '',
        closes_on: win.closes_on || '',
        criteria_note: win.criteria_note || '',
        require_compulsory_insurance: Boolean(win.require_compulsory_insurance),
      });
      setCertificates(c.data?.data || []);
      setAppointments(a.data?.data || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'โหลดข้อมูลการรับรองรถไม่สำเร็จ');
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function saveWindow(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.put('/certification/school/window', { ...form, opens_on: form.opens_on || null, closes_on: form.closes_on || null });
      toast.success('บันทึกช่วงเวลารับเอกสารแล้ว');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally { setBusy(false); }
  }

  async function revoke() {
    if (!revokeTarget || revokeReason.trim().length < 5) return;
    setBusy(true);
    try {
      await api.post(`/certification/school/certificates/${revokeTarget.id}/revoke`, { reason: revokeReason.trim() });
      toast.success('เพิกถอนหนังสือรับรองแล้ว');
      setRevokeTarget(null);
      setRevokeReason('');
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'เพิกถอนไม่สำเร็จ');
    } finally { setBusy(false); }
  }

  async function requestAppointment(event) {
    event.preventDefault();
    if (!apForm.proposed_date || !apForm.ids.length) return;
    setBusy(true);
    try {
      await api.post('/certification/school/appointments', {
        proposed_date: apForm.proposed_date, note: apForm.note || null, application_ids: apForm.ids,
      });
      toast.success('ส่งคำขอนัดตรวจรถที่โรงเรียนแล้ว');
      setApForm({ proposed_date: '', note: '', ids: [] });
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ส่งคำขอนัดไม่สำเร็จ');
    } finally { setBusy(false); }
  }

  async function cancelAppointment() {
    if (!cancelTarget) return;
    setBusy(true);
    try {
      await api.post(`/certification/school/appointments/${cancelTarget.id}/cancel`);
      toast.success('ยกเลิกการนัดแล้ว');
      setCancelTarget(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ยกเลิกการนัดไม่สำเร็จ');
    } finally { setBusy(false); }
  }

  async function download(cert) {
    try { await downloadCertificatePdf(cert.id, cert.cert_no); }
    catch { toast.error('ดาวน์โหลดหนังสือรับรองไม่สำเร็จ'); }
  }

  const ready = applications.filter(a => ['READY_TO_PRINT', 'SUBMITTED', 'NEEDS_FIX'].includes(a.status));
  const toggleId = id => setApForm(f => ({
    ...f, ids: f.ids.includes(id) ? f.ids.filter(x => x !== id) : [...f.ids, id],
  }));

  return (
    <div className="space-y-4 print:hidden">
      <AppCard>
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-brand-600" strokeWidth={2.2} aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-ink">ช่วงรับเอกสารและเกณฑ์การรับรองรถ</h2>
            <p className="mt-1 text-sm text-ink-muted">
              ภาคเรียน {summary?.term_id || '-'} · หนังสือรับรองมีผลถึง {thaiDate(summary?.term_end_date)} ·{' '}
              {WINDOW_STATE[summary?.window_state] || ''}
            </p>
          </div>
        </div>
        <form onSubmit={saveWindow} className="mt-4 grid gap-3 sm:grid-cols-2">
          <FormField label="วันเปิดรับเอกสาร" type="date" value={form.opens_on}
            onChange={v => setForm(f => ({ ...f, opens_on: v }))} />
          <FormField label="วันปิดรับเอกสาร" type="date" value={form.closes_on}
            onChange={v => setForm(f => ({ ...f, closes_on: v }))} />
          <FormField label="เกณฑ์/หมายเหตุสำหรับคนขับ" className="sm:col-span-2" value={form.criteria_note}
            onChange={v => setForm(f => ({ ...f, criteria_note: v }))}>
            {props => (
              <textarea {...props} rows={3} value={form.criteria_note}
                onChange={e => setForm(f => ({ ...f, criteria_note: e.target.value }))}
                className={`${inputClass} py-2`} />
            )}
          </FormField>
          <label className="flex min-h-[44px] items-center gap-2 text-base text-ink sm:col-span-2 sm:text-sm">
            <input type="checkbox" className="h-5 w-5" checked={form.require_compulsory_insurance}
              onChange={e => setForm(f => ({ ...f, require_compulsory_insurance: e.target.checked }))} />
            ต้องแนบหลักฐาน พ.ร.บ. ด้วย
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className={buttonPrimary}>บันทึกช่วงรับเอกสาร</button>
          </div>
        </form>
      </AppCard>

      <AppCard>
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-ink-muted" strokeWidth={2.2} aria-hidden="true" />
          <h2 className="text-lg font-bold text-ink">หนังสือรับรองการรับส่งนักเรียนที่ออกแล้ว</h2>
        </div>
        {certificates.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">ยังไม่มีหนังสือรับรอง — ออกได้เมื่อกด "ตรวจสอบถูกต้อง" หรือ "ยืนยันข้อมูลพร้อมพิมพ์" ในคำขอ</p>
        ) : (
          <ul className="mt-3 divide-y divide-surface-border">
            {certificates.map(cert => {
              const [label, variant] = CERT_STATE[cert.state] || [cert.state, 'neutral'];
              return (
                <li key={cert.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{cert.cert_no} · {cert.plate_no}</p>
                    <p className="text-sm text-ink-muted">
                      มีผลถึง {thaiDate(cert.valid_until)}{cert.expiring ? ' (ใกล้หมดอายุ)' : ''}
                      {cert.revoke_reason ? ` · เหตุผลเพิกถอน: ${cert.revoke_reason}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge variant={variant}>{label}</StatusBadge>
                    <button type="button" className={buttonSecondary} onClick={() => download(cert)}>
                      <FileDown className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
                      PDF
                    </button>
                    {cert.state === 'VALID' && (
                      <button type="button" className={buttonDanger} onClick={() => { setRevokeReason(''); setRevokeTarget(cert); }}>
                        เพิกถอน
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AppCard>

      <AppCard>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-ink-muted" strokeWidth={2.2} aria-hidden="true" />
          <h2 className="text-lg font-bold text-ink">นัดขนส่งตรวจรถที่โรงเรียน</h2>
        </div>
        <p className="mt-1 text-sm text-ink-muted">เลือกรถที่พร้อมตรวจหลายคัน แล้วเสนอวันให้สำนักงานขนส่งมาตรวจที่โรงเรียนวันเดียว</p>
        {ready.length === 0 ? (
          <AlertBanner variant="info" className="mt-3">ยังไม่มีคำขอที่พร้อมตรวจ</AlertBanner>
        ) : (
          <form onSubmit={requestAppointment} className="mt-3 space-y-3">
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium text-ink">รถที่จะให้ตรวจ</legend>
              {ready.map(app => (
                <label key={app.id} className="flex min-h-[44px] items-center gap-2 text-base text-ink sm:text-sm">
                  <input type="checkbox" className="h-5 w-5" checked={apForm.ids.includes(app.id)} onChange={() => toggleId(app.id)} />
                  {app.plate_no} · {app.request_no}
                  {app.certificate?.state !== 'VALID' && <span className="text-danger-ink">(ยังไม่มีหนังสือรับรอง)</span>}
                </label>
              ))}
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="วันที่เสนอ" type="date" required value={apForm.proposed_date}
                onChange={v => setApForm(f => ({ ...f, proposed_date: v }))} />
              <FormField label="หมายเหตุ (ถ้ามี)" value={apForm.note}
                onChange={v => setApForm(f => ({ ...f, note: v }))} />
            </div>
            <button type="submit" disabled={busy || !apForm.ids.length || !apForm.proposed_date} className={buttonPrimary}>
              ส่งคำขอนัด ({apForm.ids.length} คัน)
            </button>
          </form>
        )}
        {appointments.length > 0 && (
          <ul className="mt-4 divide-y divide-surface-border">
            {appointments.map(ap => {
              const [label, variant] = APPOINTMENT_STATUS[ap.status] || [ap.status, 'neutral'];
              return (
                <li key={ap.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      เสนอ {thaiDate(ap.proposed_date)}{ap.confirmed_date ? ` · วันตรวจ ${thaiDate(ap.confirmed_date)}` : ''}
                    </p>
                    <p className="text-sm text-ink-muted">{(ap.vehicles || []).map(v => v.plate_no).join(', ')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge variant={variant}>{label}</StatusBadge>
                    {['REQUESTED', 'CONFIRMED'].includes(ap.status) && (
                      <button type="button" className={buttonSecondary} onClick={() => setCancelTarget(ap)}>ยกเลิกนัด</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AppCard>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title="ยืนยันเพิกถอนหนังสือรับรอง"
        description="รถคันนี้จะเข้ารับการตรวจสภาพไม่ได้จนกว่าโรงเรียนจะออกหนังสือรับรองใหม่"
        itemName={revokeTarget ? `${revokeTarget.cert_no} · ${revokeTarget.plate_no}` : ''}
        confirmLabel="เพิกถอน"
        loading={busy}
        confirmDisabled={revokeReason.trim().length < 5}
        onConfirm={revoke}
        onCancel={() => { if (!busy) { setRevokeTarget(null); setRevokeReason(''); } }}
      >
        <FormField label="เหตุผล (อย่างน้อย 5 ตัวอักษร)" required value={revokeReason} onChange={setRevokeReason} />
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="ยืนยันยกเลิกการนัดตรวจ"
        description="ขนส่งจะเห็นว่าการนัดนี้ถูกยกเลิก"
        itemName={cancelTarget ? thaiDate(cancelTarget.confirmed_date || cancelTarget.proposed_date) : ''}
        confirmLabel="ยกเลิกนัด"
        loading={busy}
        onConfirm={cancelAppointment}
        onCancel={() => { if (!busy) setCancelTarget(null); }}
      />
    </div>
  );
}
