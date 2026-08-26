import { Link2, ShieldAlert } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios'; // Raw axios intentional — public LIFF page, no JWT auth
import { resolveLineUserId, getLiffIdToken, isInLiffClient } from '../../utils/liff';
import PageHeader from '../../components/PageHeader';
import { AlertBanner, FormField } from '../../components/ui';

// Phase 10.3E-UX1 — parent account linking via LIFF form.
//
// Flow:
//   form → POST /api/parent/line/bind-preview → preview screen
//        → user confirms → POST /api/parent/line/bind-confirm → success
//
// Security: every request includes the LIFF idToken. Backend NEVER trusts
// the lineUserId we send in body — it derives the canonical userId from
// the verified token. The chat-driven bind flow stays as a fallback.

const STEP = {
  FORM:    'form',
  PREVIEW: 'preview',
  SUCCESS: 'success',
};

function maskPhoneClient(s) {
  if (!s) return '-';
  const d = String(s).replace(/\D/g, '');
  if (d.length < 5) return d;
  return d.slice(0, 3) + '****' + d.slice(-3);
}

export default function ParentLink() {
  const [step, setStep] = useState(STEP.FORM);
  const [phone, setPhone] = useState('');
  const [studentId, setStudentId] = useState('');
  const [phoneErr, setPhoneErr] = useState('');
  const [studentErr, setStudentErr] = useState('');
  const [serverErr, setServerErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [idToken, setIdToken] = useState('');
  const [liffReady, setLiffReady] = useState(false);
  const [inLineClient, setInLineClient] = useState(true);

  const [previewStudent, setPreviewStudent] = useState(null);
  const [maskedPhone, setMaskedPhone] = useState('');

  // Bootstrap LIFF (resolveLineUserId triggers the login redirect if needed).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await resolveLineUserId();
        const token = await getLiffIdToken();
        if (cancelled) return;
        setIdToken(token);
        setInLineClient(isInLiffClient());
        setLiffReady(true);
        if (!token) {
          setServerErr('ไม่พบ LIFF token — กรุณาเปิดหน้านี้ผ่านลิงก์ใน LINE OA');
        }
      } catch (err) {
        if (cancelled) return;
        setLiffReady(true);
        setServerErr('ไม่สามารถเริ่ม LIFF ได้: ' + (err?.message || 'unknown'));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── Inline validation ────────────────────────────────────────────────────
  function validatePhone(p) {
    const s = (p || '').replace(/\D/g, '');
    if (!s) return 'กรุณากรอกเบอร์โทรศัพท์';
    if (s.length !== 10) return 'กรุณากรอกเบอร์โทรศัพท์ 10 หลัก';
    return '';
  }
  function validateStudent(sid) {
    const t = (sid || '').trim();
    if (!t) return 'กรุณากรอกรหัสนักเรียน';
    if (!/^\d+$/.test(t)) return 'รหัสนักเรียนต้องเป็นตัวเลข';
    return '';
  }

  const cleanedPhone = phone.replace(/\D/g, '').slice(0, 10);

  // ─── Submit handlers ──────────────────────────────────────────────────────
  const onPreview = useCallback(async (e) => {
    e?.preventDefault();
    setServerErr('');
    const pErr = validatePhone(cleanedPhone);
    const sErr = validateStudent(studentId);
    setPhoneErr(pErr);
    setStudentErr(sErr);
    if (pErr || sErr) return;
    if (!idToken) {
      setServerErr('ไม่พบ LIFF token — กรุณาเปิดหน้านี้ผ่านลิงก์ใน LINE OA');
      return;
    }
    setBusy(true);
    try {
      const res = await axios.post('/api/parent/line/bind-preview', {
        idToken, phone: cleanedPhone, studentId,
      });
      setPreviewStudent(res.data?.data?.student || null);
      setMaskedPhone(res.data?.data?.masked_phone || maskPhoneClient(cleanedPhone));
      setStep(STEP.PREVIEW);
    } catch (err) {
      const msg = err.response?.data?.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่';
      setServerErr(msg);
    } finally {
      setBusy(false);
    }
  }, [cleanedPhone, studentId, idToken]);

  const onConfirm = useCallback(async () => {
    setServerErr('');
    if (!idToken) {
      setServerErr('ไม่พบ LIFF token — กรุณาเปิดหน้านี้ผ่านลิงก์ใน LINE OA');
      return;
    }
    setBusy(true);
    try {
      await axios.post('/api/parent/line/bind-confirm', {
        idToken, phone: cleanedPhone, studentId,
      });
      setStep(STEP.SUCCESS);
    } catch (err) {
      const msg = err.response?.data?.message || 'ไม่สามารถผูกบัญชีได้ กรุณาลองใหม่';
      setServerErr(msg);
    } finally {
      setBusy(false);
    }
  }, [cleanedPhone, studentId, idToken]);

  // ─── UI ───────────────────────────────────────────────────────────────────
  if (!liffReady) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-6">
        <div className="text-gray-500 text-sm">กำลังเริ่มต้น LIFF…</div>
      </div>
    );
  }

  if (step === STEP.SUCCESS) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6">
        <div className="text-6xl mb-5">✅</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">ผูกบัญชีสำเร็จ</h2>
        <p className="text-gray-500 text-sm text-center max-w-xs mb-8">
          ระบบได้เชื่อมต่อบัญชี LINE ของคุณกับข้อมูลบุตรหลานเรียบร้อยแล้ว
        </p>
        <p className="text-ink-muted text-caption text-center max-w-xs">
          ปิดหน้านี้แล้วกลับไปที่ LINE OA<br />
          พิมพ์ &quot;สถานะ&quot; เพื่อดูสถานะรับ-ส่งวันนี้
        </p>
      </div>
    );
  }

  if (step === STEP.PREVIEW) {
    const s = previewStudent || {};
    const fullName = [s.prefix, s.first_name, s.last_name].filter(Boolean).join('');
    const gradeRoom = [s.grade, s.classroom].filter(Boolean).join(' / ');
    return (
      <div className="min-h-screen bg-surface p-4 sm:p-6">
        <div className="max-w-lg mx-auto">
          <PageHeader title="ตรวจสอบข้อมูล" subtitle="กรุณายืนยันก่อนผูกบัญชี" />
          <div className="bg-surface-raised rounded-2xl border border-surface-border shadow-sm p-5 space-y-4">
            <div className="bg-brand-50 border border-brand-100 rounded-xl p-4">
              <div className="text-caption text-brand-700 font-semibold mb-1">นักเรียน</div>
              <div className="text-lg font-bold text-ink">{fullName || '-'}</div>
              {gradeRoom && <div className="text-sm text-ink-muted mt-1">ระดับชั้น: {gradeRoom}</div>}
              {s.school_name && <div className="text-sm text-ink-muted">โรงเรียน: {s.school_name}</div>}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-muted">เบอร์โทรศัพท์ที่ใช้ค้นหา</span>
              <span className="font-bold text-ink">{maskedPhone}</span>
            </div>
            {serverErr && (
              <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">
                {serverErr}
              </p>
            )}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition"
              >
                {busy ? 'กำลังบันทึก…' : 'ยืนยันผูกบัญชี'}
              </button>
              <button
                type="button"
                onClick={() => { setStep(STEP.FORM); setServerErr(''); }}
                disabled={busy}
                className="flex-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 font-semibold py-3 rounded-lg transition"
              >
                ย้อนกลับ
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // STEP.FORM
  return (
    <div className="min-h-screen bg-surface p-4 sm:p-6">
      <div className="max-w-lg mx-auto">
        <PageHeader
          icon={Link2}
          title="ผูกบัญชีผู้ปกครอง"
          subtitle="เชื่อมต่อบัญชี LINE กับข้อมูลบุตรหลาน"
        />

        {!inLineClient && (
          <AlertBanner variant="warn" icon={ShieldAlert} title="เปิดจากนอก LINE" className="mb-4">
            ดูเหมือนคุณกำลังเปิดในเบราว์เซอร์ภายนอก
            แนะนำให้เปิดผ่านลิงก์ใน LINE OA เพื่อความปลอดภัย
          </AlertBanner>
        )}

        <form onSubmit={onPreview} className="bg-surface-raised rounded-2xl border border-surface-border shadow-sm p-5 space-y-4">
          {/* Neither label was tied to its input, so tapping the label did
              nothing and a screen reader announced both fields unnamed. */}
          <FormField
            label="เบอร์โทรศัพท์"
            required
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={10}
            value={phone}
            onChange={(v) => { setPhone(v); setPhoneErr(''); }}
            placeholder="0901234567"
            helper="เบอร์ที่ลงทะเบียนไว้กับโรงเรียน (10 หลัก)"
            error={phoneErr || undefined}
          />

          <FormField
            label="รหัสนักเรียน"
            required
            inputMode="numeric"
            autoComplete="off"
            value={studentId}
            onChange={(v) => { setStudentId(v); setStudentErr(''); }}
            placeholder="18985"
            helper="รหัสนักเรียนของบุตรหลาน (ตัวเลข)"
            error={studentErr || undefined}
          />

          {serverErr && <AlertBanner variant="danger" title="ค้นหาไม่สำเร็จ">{serverErr}</AlertBanner>}

          <button
            type="submit"
            disabled={busy}
            className="focus-ring w-full bg-brand-600 hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50 disabled:pointer-events-none text-white font-semibold min-h-[48px] rounded-lg transition"
          >
            {busy ? 'กำลังค้นหา…' : 'ค้นหาข้อมูลบุตรหลาน'}
          </button>
        </form>

        <div className="mt-4 text-center text-caption text-ink-muted">
          ระบบรถรับส่งนักเรียนจังหวัดลำปาง
        </div>
      </div>
    </div>
  );
}
