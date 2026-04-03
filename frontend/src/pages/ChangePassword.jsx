import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/Toast';
import api from '../api/axios';

const ROLE_HOME = {
  driver: '/driver',
  school: '/school',
  affiliation: '/affiliation',
  province: '/province',
  transport: '/transport',
  admin: '/province',
};

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

    if (form.new_password.length < 6) {
      setError('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
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
      });

      // Clear must_change_password in both AuthContext and localStorage
      updateUser({ must_change_password: false });

      toast.success('เปลี่ยนรหัสผ่านสำเร็จ');
      navigate(ROLE_HOME[user?.role] || '/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'ไม่สามารถเปลี่ยนรหัสผ่านได้');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-blue-50">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-blue-700">เปลี่ยนรหัสผ่าน</h1>
          <p className="text-sm text-gray-500 mt-1">กรุณาเปลี่ยนรหัสผ่านเริ่มต้นก่อนเข้าใช้งานระบบ</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">รหัสผ่านปัจจุบัน</label>
            <input type="password" value={form.current_password} required
              onChange={(e) => setForm({ ...form, current_password: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)</label>
            <input type="password" value={form.new_password} required minLength={6}
              onChange={(e) => setForm({ ...form, new_password: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">ยืนยันรหัสผ่านใหม่</label>
            <input type="password" value={form.confirm} required minLength={6}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            {form.confirm && form.new_password !== form.confirm && (
              <p className="text-xs text-red-500 mt-1">รหัสผ่านไม่ตรงกัน</p>
            )}
          </div>

          {error && (
            <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</p>
          )}

          <button type="submit" disabled={saving}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg py-3 transition">
            {saving ? 'กำลังเปลี่ยน…' : 'เปลี่ยนรหัสผ่าน'}
          </button>
        </form>
      </div>
    </div>
  );
}
