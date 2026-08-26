import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/Toast';
import api from '../api/axios';
import { ROLE_HOME } from '../App';

export default function ChangePassword() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (form.new_password.length < 8) {
      setError('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
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
      await api.post('/auth/change-password', {
        current_password: form.current_password,
        new_password: form.new_password,
        refresh_token: localStorage.getItem('refresh_token'),
      });

      // Audit 2026-06-18 (frontend-security): the backend now invalidates all
      // tokens issued before the change (access + refresh), so the current session
      // is dead. Clear local state and force a fresh login with the new password
      // instead of navigating on with a stale token (which would 401).
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-4">
      <div className="bg-surface-raised border border-surface-border rounded-2xl shadow-elevate p-8 sm:p-10 w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-ink">เปลี่ยนรหัสผ่าน</h1>
          <p className="text-sm text-ink-muted mt-1">กรุณาเปลี่ยนรหัสผ่านเริ่มต้นก่อนเข้าใช้งานระบบ</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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
            minLength={8}
            autoComplete="new-password"
            helper="อย่างน้อย 8 ตัวอักษร"
            value={form.new_password}
            onChange={v => setForm({ ...form, new_password: v })}
          />
          <FormField
            label="ยืนยันรหัสผ่านใหม่"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={form.confirm}
            onChange={v => setForm({ ...form, confirm: v })}
            error={form.confirm && form.new_password !== form.confirm ? 'รหัสผ่านไม่ตรงกัน' : undefined}
          />

          {error && <ErrorState message={error} />}

          <button type="submit" disabled={saving}
            className="focus-ring w-full bg-brand-600 hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50 disabled:pointer-events-none text-white font-semibold rounded-lg min-h-[48px] transition">
            {saving ? 'กำลังเปลี่ยน…' : 'เปลี่ยนรหัสผ่าน'}
          </button>
        </form>
      </div>
    </div>
  );
}
