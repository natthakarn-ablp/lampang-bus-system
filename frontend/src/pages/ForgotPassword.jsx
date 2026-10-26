import { useEffect, useState } from 'react';
import { ArrowLeft, KeyRound, Send } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { AlertBanner, FormField } from '../components/ui';

const LOGO = '/brand/school-safe-logo.webp';

export default function ForgotPassword() {
  const [enabled, setEnabled] = useState(null);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/auth/recovery/config')
      .then((res) => setEnabled(Boolean(res.data.data?.admin_password_recovery)))
      .catch(() => setEnabled(false));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/auth/recovery/request', { username: username.trim() });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.message || 'ไม่สามารถส่งคำขอได้ กรุณาลองใหม่ภายหลัง');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface px-4 py-8 sm:py-12">
      <main className="mx-auto w-full max-w-md rounded-lg border border-surface-border bg-surface-raised p-6 shadow-elevate sm:p-8">
        <img src={LOGO} alt="School Safe Connect" className="mx-auto h-16 w-16 rounded-full border border-brand-100 bg-white object-cover" />
        <div className="mt-5 text-center">
          <h1 className="text-2xl font-black text-brand-900">ลืมรหัสผ่าน</h1>
          <p className="mt-2 text-sm leading-6 text-ink-muted">ระยะแรกเปิดสำหรับบัญชีผู้ดูแลระบบที่ผูก LINE แล้ว</p>
        </div>

        {enabled === false && (
          <AlertBanner variant="warn" className="mt-6" title="ยังไม่เปิดใช้บริการนี้">
            กรุณาติดต่อผู้ดูแลระบบระดับจังหวัดเพื่อรีเซ็ตรหัสผ่านตามขั้นตอนเดิม
          </AlertBanner>
        )}

        {enabled && !done && (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <FormField
              label="ชื่อผู้ใช้ผู้ดูแลระบบ"
              value={username}
              onChange={setUsername}
              autoComplete="username"
              required
              maxLength={100}
              placeholder="กรอกชื่อผู้ใช้"
            />
            {error && <AlertBanner variant="danger">{error}</AlertBanner>}
            <button type="submit" disabled={busy} className="focus-ring inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 font-bold text-white hover:bg-brand-700 disabled:opacity-50">
              <Send className="h-4 w-4" aria-hidden="true" />
              {busy ? 'กำลังส่งคำขอ…' : 'ส่งลิงก์ไปยัง LINE'}
            </button>
          </form>
        )}

        {done && (
          <AlertBanner variant="success" className="mt-6" title="รับคำขอแล้ว">
            หากบัญชีนี้เปิดใช้การกู้คืน ระบบจะส่งลิงก์ไปยัง LINE ที่ผูกไว้ ลิงก์มีอายุ 15 นาที
          </AlertBanner>
        )}

        <Link to="/login" className="focus-ring mt-6 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg font-bold text-brand-700 hover:bg-brand-50">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> กลับหน้าเข้าสู่ระบบ
        </Link>
      </main>
    </div>
  );
}
