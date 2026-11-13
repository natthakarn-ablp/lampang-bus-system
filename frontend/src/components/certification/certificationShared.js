/**
 * Shared helpers for the school transport certification UI (มพบ. 2564
 * "ล้อที่ 3", FEATURE_SCHOOL_CERTIFICATION). Nothing here renders while the
 * flag is off — every caller checks `features.schoolCertification` first.
 */
import api from '../../api/axios';

export const CERT_STATE = {
  VALID: ['มีผล', 'success'],
  EXPIRED: ['หมดอายุ', 'danger'],
  REVOKED: ['เพิกถอนแล้ว', 'danger'],
  NONE: ['ยังไม่มี', 'neutral'],
};

export const WINDOW_STATE = {
  NOT_SET: 'ยังไม่กำหนดช่วงรับเอกสาร',
  BEFORE: 'ยังไม่ถึงช่วงรับเอกสาร',
  OPEN: 'อยู่ในช่วงรับเอกสาร',
  CLOSED: 'เลยช่วงรับเอกสารแล้ว',
};

export const APPOINTMENT_STATUS = {
  REQUESTED: ['รอขนส่งยืนยัน', 'warn'],
  CONFIRMED: ['ยืนยันวันตรวจแล้ว', 'info'],
  DONE: ['ตรวจเสร็จแล้ว', 'success'],
  CANCELLED: ['ยกเลิกแล้ว', 'neutral'],
};

/** Thai long date for a 'YYYY-MM-DD' (Bangkok calendar). */
export function thaiDate(iso) {
  if (!iso) return '-';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00+07:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' });
}

/** Download the certificate PDF (audited server-side before bytes leave). */
export async function downloadCertificatePdf(id, certNo) {
  const res = await api.get(`/certification/certificates/${id}/pdf`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = `หนังสือรับรอง-${String(certNo || id).replace(/[^\w-]+/g, '_')}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

export const inputClass = 'focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink';
export const buttonPrimary = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50';
export const buttonSecondary = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-surface-border bg-surface-raised px-4 py-2 text-sm font-semibold text-ink transition hover:bg-surface disabled:opacity-50';
export const buttonDanger = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-2 text-sm font-semibold text-danger-ink transition hover:bg-danger/10 disabled:opacity-50';
