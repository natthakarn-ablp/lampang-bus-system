import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileDown, XCircle } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../Toast';
import StatusBadge from '../ui/StatusBadge';
import { AlertBanner } from '../ui';
import { CERT_STATE, WINDOW_STATE, buttonPrimary, buttonSecondary, downloadCertificatePdf, thaiDate } from './certificationShared';

const ISSUABLE = new Set(['READY_TO_PRINT', 'SUBMITTED', 'INSPECTION_PENDING', 'NEEDS_FIX']);

/**
 * School review of one application against the มพบ. 2564 document list
 * (ID card, licence, vehicle photo, registration book, พ.ร.บ. when required,
 * pupil list from the system, caretaker). Approving the application issues
 * the certificate; for an application already past review the school can
 * issue it here. Outside the intake window it still issues, with a warning.
 */
export default function CertificateChecklistCard({ applicationId, status, reloadKey = 0, onChanged }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/certification/school/applications/${applicationId}/checklist`);
      setData(res.data?.data || null);
    } catch {
      setData(null);
    }
  }, [applicationId]);

  useEffect(() => { load(); }, [load, reloadKey, status]);

  async function issue() {
    setBusy(true);
    try {
      const res = await api.post(`/certification/school/applications/${applicationId}/certificate`);
      const warnings = res.data?.data?.warnings || [];
      toast.success(warnings.includes('OUTSIDE_WINDOW')
        ? 'ออกหนังสือรับรองแล้ว (นอกช่วงรับเอกสาร)'
        : 'ออกหนังสือรับรองแล้ว');
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ออกหนังสือรับรองไม่สำเร็จ');
    } finally { setBusy(false); }
  }

  if (!data) return null;
  const cert = data.certificate;
  const certValid = cert && cert.state === 'VALID';
  // Shared vehicle: another rider school sees all of this read-only.
  const isIssuer = data.viewer_is_issuer !== false;
  const issuerName = data.application?.issuing_school_name || 'โรงเรียนผู้ออก';
  const pupilItem = data.items.find(i => i.code === 'PUPIL_LIST');
  const otherCerts = data.other_school_certificates || [];
  const [certLabel, certVariant] = CERT_STATE[cert?.state || 'NONE'] || ['-', 'neutral'];

  return (
    <div className="rounded-xl border border-surface-border bg-surface p-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ink">เอกสารประกอบการรับรองรถ (มพบ. 2564)</h3>
        <StatusBadge variant={certVariant}>หนังสือรับรอง: {certLabel}</StatusBadge>
      </div>
      {data.outside_window && (
        <AlertBanner variant="warn" className="mt-3">
          {WINDOW_STATE[data.window_state]} — ยังออกหนังสือรับรองได้ แต่ควรตรวจว่าเป็นกรณียกเว้น
        </AlertBanner>
      )}
      <ul className="mt-3 grid gap-1 sm:grid-cols-2">
        {data.items.map(item => (
          <li key={item.code} className="flex min-h-[36px] items-center gap-2 text-sm">
            {item.present
              ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success-ink" strokeWidth={2.2} aria-hidden="true" />
              : <XCircle className="h-4 w-4 shrink-0 text-danger-ink" strokeWidth={2.2} aria-hidden="true" />}
            <span className="text-ink">
              {item.label}
              {item.code === 'PUPIL_LIST' ? ` (${issuerName} ${item.count || 0} คน)` : ''}
              {item.code === 'CARETAKER' && item.present ? ` — ${item.name}` : ''}
            </span>
            <span className="sr-only">{item.present ? 'มีแล้ว' : 'ยังไม่มี'}</span>
          </li>
        ))}
      </ul>
      {pupilItem?.schools?.length > 1 && (
        <p className="mt-2 text-sm text-ink-muted">
          รถคันนี้รับส่งนักเรียน {pupilItem.schools.length} โรงเรียน รวม {pupilItem.total_count} คน:{' '}
          {pupilItem.schools.map(s => `${s.school_name} ${s.pupil_count}`).join(', ')}
        </p>
      )}
      {data.missing.length > 0 && isIssuer && (
        <p className="mt-2 text-sm text-ink-muted">ยังขาด {data.missing.length} รายการ — คนขับแนบเอกสารได้ที่เมนูรายชื่อเด็กในรถ/เอกสาร</p>
      )}
      {cert && (
        <p className="mt-3 text-sm text-ink">
          {isIssuer ? '' : `รถคันนี้มีหนังสือรับรองจาก${issuerName} `}
          เลขที่ {cert.cert_no} · มีผลถึง {thaiDate(cert.valid_until)}
          {cert.state !== 'VALID' ? ` (${certLabel})` : ''}
        </p>
      )}
      {!isIssuer && !cert && (
        <p className="mt-3 text-sm text-ink-muted">{issuerName} ยังไม่ได้ออกหนังสือรับรองสำหรับคำขอนี้</p>
      )}
      {otherCerts.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-ink-muted">
          {otherCerts.map(c => (
            <li key={c.id}>
              หนังสือรับรองจาก{c.school_name} เลขที่ {c.cert_no} · ถึง {thaiDate(c.valid_until)} ·{' '}
              {(CERT_STATE[c.state] || [c.state])[0]}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {cert && (
          <button type="button" className={buttonSecondary}
            onClick={() => downloadCertificatePdf(cert.id, cert.cert_no).catch(() => toast.error('ดาวน์โหลดไม่สำเร็จ'))}>
            <FileDown className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
            พิมพ์หนังสือรับรอง (PDF)
          </button>
        )}
        {isIssuer && !certValid && ISSUABLE.has(status) && (
          <button type="button" disabled={busy} className={buttonPrimary} onClick={issue}>ออกหนังสือรับรอง</button>
        )}
      </div>
    </div>
  );
}
