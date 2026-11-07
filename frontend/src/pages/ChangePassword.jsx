import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/Toast';
import api from '../api/axios';
import ErrorState from '../components/ErrorState';
import { FormField } from '../components/ui';
import { ROLE_HOME } from '../App';
import { PASSWORD_MIN_LENGTH, PASSWORD_HELPER, PASSWORD_TOO_SHORT } from '../utils/passwordPolicy';

export default function ChangePassword() {
  const { user, loading, updateUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    // gt2-03: the form is noValidate, so these app messages replace the
    // browser's own English/blocking popups.
    if (!form.current_password) {
      setError('กรุณากรอกรหัสผ่านปัจจุบัน');
      return;
    }
    if (!form.new_password) {
      setError('กรุณากรอกรหัสผ่านใหม่');
      return;
    }
    if (form.new_password.length < PASSWORD_MIN_LENGTH) {
      setError(PASSWORD_TOO_SHORT);
      return;
    }
    if (form.new_password !== form.confirm) {
      setError('รหัสผ่านใหม่ไม่ตรงกัน');
      return;
    }
    if (form.new_password === form.current_password) {
      setError('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
      return;
    }

    setSaving(true);
    try {
      const res = await api.post('/auth/change-password', {
        current_password: form.current_password,
        new_password: form.new_password,
        refresh_token: localStorage.getItem('refresh_token'),
      });

      // The backend invalidates every token issued before the change, so the
      // old session is dead. load-03: it now returns a fresh pair signed after
      // the change — store it and continue to the role home without a second
      // login. An older backend returns no tokens: fall back to a fresh login.
      const data = res.data?.data;
      if (data?.access_token && data?.refresh_token) {
        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('refresh_token', data.refresh_token);
        const nextUser = { ...(user || {}), ...(data.user || {}), must_change_password: false };
        updateUser(nextUser);
        toast.success('เปลี่ยนรหัสผ่านสำเร็จ');
        navigate(ROLE_HOME[nextUser.role] || '/', { replace: true });
        return;
      }

      localStorage.clear();
      sessionStorage.clear();
      toast.success('เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบใหม่');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'ไม่สามารถเปลี่ยนรหัสผ่านได้');
    } finally {
      setSaving(false);
    }
  }

  // vis-16: Back after logout lands here with no session. There is nothing to
  // change without one, so go to the login page instead of a bare form.
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  // sch-09: a forced first-login change keeps the prompt and has no way out;
  // a voluntary visit (account menu) gets neutral copy and a cancel button.
  const forced = !!user.must_change_password;
  const home = ROLE_HOME[user.role] || '/';
  function cancel() {
    if (window.history.length > 1) navigate(-1);
    else navigate(home, { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-4">
      <div className="bg-surface-raised border border-surface-border rounded-2xl shadow-elevate p-8 sm:p-10 w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-ink">เปลี่ยนรหัสผ่าน</h1>
          <p className="text-sm text-ink-muted mt-1">
            {forced ? 'กรุณาเปลี่ยนรหัสผ่านเริ่มต้นก่อนเข้าใช้งานระบบ' : 'ตั้งรหัสผ่านใหม่สำหรับบัญชีของคุณ'}
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <FormField
            label="รหัสผ่านปัจจุบัน"
            type="password"
            required
            autoComplete="current-password"
            value={form.current_password}
            onChange={v => setForm({ ...form, current_password: v })}
          />
          <FormField
            label="รหัสผ่านใหม่"
            type="password"
            required
            autoComplete="new-password"
            helper={PASSWORD_HELPER}
            value={form.new_password}
            onChange={v => setForm({ ...form, new_password: v })}
          />
          <FormField
            label="ยืนยันรหัสผ่านใหม่"
            type="password"
            required
            autoComplete="new-password"
            value={form.confirm}
            onChange={v => setForm({ ...form, confirm: v })}
            error={form.confirm && form.new_password !== form.confirm ? 'รหัสผ่านไม่ตรงกัน' : undefined}
          />

          {error && <ErrorState title="เปลี่ยนรหัสผ่านไม่สำเร็จ" message={error} />}

          <button type="submit" disabled={saving}
            className="focus-ring w-full bg-brand-600 hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50 disabled:pointer-events-none text-white font-semibold rounded-lg min-h-[48px] transition">
            {saving ? 'กำลังเปลี่ยน…' : 'เปลี่ยนรหัสผ่าน'}
          </button>
          {!forced && (
            <button type="button" onClick={cancel} disabled={saving}
              className="focus-ring w-full rounded-lg min-h-[48px] border border-surface-border bg-surface-raised hover:bg-surface text-ink font-medium transition disabled:opacity-50">
              ยกเลิก
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
