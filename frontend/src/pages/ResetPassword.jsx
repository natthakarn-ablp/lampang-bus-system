import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { AlertBanner, FormField } from '../components/ui';

export default function ResetPassword() {
  const [token] = useState(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return hash.get('token') || '';
  });
  const [form, setForm] = useState({ recovery_code: '', new_password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (token) window.history.replaceState({}, document.title, '/reset-password');
  }, [token]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (form.new_password.length < 8) return setError('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
    if (form.new_password !== form.confirm) return setError('รหัสผ่านใหม่ไม่ตรงกัน');
    setBusy(true);
    try {
      await api.post('/auth/recovery/complete', {
        token,
        recovery_code: form.recovery_code,
        new_password: form.new_password,
      });
      setDone(true);
      setForm({ recovery_code: '', new_password: '', confirm: '' });
    } catch (err) {
      setError(err.response?.data?.message || 'ไม่สามารถเปลี่ยนรหัสผ่านได้');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface px-4 py-8 sm:py-12">
      <main className="mx-auto w-full max-w-md rounded-lg border border-surface-border bg-surface-raised p-6 shadow-elevate sm:p-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          {done ? <CheckCircle2 className="h-7 w-7" aria-hidden="true" /> : <KeyRound className="h-7 w-7" aria-hidden="true" />}
        </div>
        <h1 className="mt-5 text-center text-2xl font-black text-brand-900">
          {done ? 'ตั้งรหัสผ่านใหม่สำเร็จ' : 'ตั้งรหัสผ่านใหม่'}
        </h1>

        {!token && !done && (
          <AlertBanner variant="danger" className="mt-6" title="ไม่พบลิงก์ยืนยัน">
            กรุณาขอลิงก์ใหม่จากหน้าเข้าสู่ระบบและเปิดลิงก์ที่ได้รับใน LINE
          </AlertBanner>
        )}

        {token && !done && (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <FormField
              label="รหัสกู้คืน"
              value={form.recovery_code}
              onChange={(value) => setForm({ ...form, recovery_code: value.toUpperCase() })}
              autoComplete="one-time-code"
              required
              maxLength={14}
              placeholder="XXXX-XXXX-XXXX"
              helper="ใช้หนึ่งรหัสจากชุดที่บันทึกไว้ตอนผูก LINE"
            />
            <FormField
              label="รหัสผ่านใหม่"
              type="password"
              value={form.new_password}
              onChange={(value) => setForm({ ...form, new_password: value })}
              autoComplete="new-password"
              required
              minLength={8}
              helper="อย่างน้อย 8 ตัวอักษร และไม่ซ้ำกับรหัสเดิม"
            />
            <FormField
              label="ยืนยันรหัสผ่านใหม่"
              type="password"
              value={form.confirm}
              onChange={(value) => setForm({ ...form, confirm: value })}
              autoComplete="new-password"
              required
              minLength={8}
              error={form.confirm && form.confirm !== form.new_password ? 'รหัสผ่านไม่ตรงกัน' : undefined}
            />
            {error && <AlertBanner variant="danger">{error}</AlertBanner>}
            <button type="submit" disabled={busy} className="focus-ring min-h-[48px] w-full rounded-lg bg-brand-600 px-4 font-bold text-white hover:bg-brand-700 disabled:opacity-50">
              {busy ? 'กำลังเปลี่ยนรหัสผ่าน…' : 'ยืนยันรหัสผ่านใหม่'}
            </button>
          </form>
        )}

        {done && (
          <AlertBanner variant="success" className="mt-6">
            เซสชันเดิมถูกยกเลิกแล้ว กรุณาเข้าสู่ระบบอีกครั้งด้วยรหัสผ่านใหม่
          </AlertBanner>
        )}

        <Link to="/login" className="focus-ring mt-6 inline-flex min-h-[44px] w-full items-center justify-center rounded-lg font-bold text-brand-700 hover:bg-brand-50">
          กลับหน้าเข้าสู่ระบบ
        </Link>
      </main>
    </div>
  );
}
