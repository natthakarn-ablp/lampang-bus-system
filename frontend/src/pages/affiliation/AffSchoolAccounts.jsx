import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

export default function AffSchoolAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ school_id: '', username: '', password: '', display_name: '' });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await api.get('/affiliation/school-accounts');
      setAccounts(res.data.data);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchAccounts();
    api.get('/affiliation/schools').then(r => setSchools(r.data.data)).catch(() => {});
  }, [fetchAccounts]);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    if (!/^\d{6}$/.test(form.username)) {
      toast.error('ชื่อผู้ใช้ต้องเป็นรหัส OBEC 6 หลัก (ตัวเลขเท่านั้น)');
      setSaving(false);
      return;
    }
    if (!/^\d{10}$/.test(form.password)) {
      toast.error('รหัสผ่านต้องเป็นรหัสโรงเรียน 10 หลัก (ตัวเลขเท่านั้น)');
      setSaving(false);
      return;
    }
    try {
      await api.post('/affiliation/school-accounts', form);
      toast.success('สร้างบัญชีสำเร็จ');
      setShowForm(false);
      setForm({ school_id: '', username: '', password: '', display_name: '' });
      fetchAccounts();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถสร้างบัญชีได้');
    } finally { setSaving(false); }
  }

  async function handleResetPassword(id) {
    const pwd = prompt('รหัสผ่านใหม่:');
    if (!pwd) return;
    try {
      await api.post(`/affiliation/school-accounts/${id}/reset-password`, { password: pwd });
      toast.success('รีเซ็ตรหัสผ่านสำเร็จ');
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถรีเซ็ตได้');
    }
  }

  async function handleToggle(id, currentActive) {
    try {
      await api.put(`/affiliation/school-accounts/${id}`, { is_active: !currentActive });
      toast.success(currentActive ? 'ปิดใช้งานแล้ว' : 'เปิดใช้งานแล้ว');
      fetchAccounts();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถอัปเดตได้');
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">จัดการบัญชีโรงเรียน</h1>
        <button onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
          {showForm ? 'ปิด' : 'สร้างบัญชีใหม่'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">โรงเรียน</label>
            <select value={form.school_id} onChange={(e) => setForm({ ...form, school_id: e.target.value })} required
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">เลือกโรงเรียน</option>
              {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">ชื่อผู้ใช้ (รหัส OBEC 6 หลัก)</label>
              <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.replace(/\D/g, '').slice(0, 6) })} required
                pattern="\d{6}" maxLength={6} placeholder="เช่น 520341"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">รหัสผ่าน (รหัสโรงเรียน 10 หลัก)</label>
              <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value.replace(/\D/g, '').slice(0, 10) })} required
                pattern="\d{10}" maxLength={10} placeholder="เช่น 1052520341"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          <button type="submit" disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition">
            {saving ? 'กำลังสร้าง…' : 'สร้างบัญชี'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : accounts.length === 0 ? (
        <p className="text-gray-400 py-10 text-center">ยังไม่มีบัญชีโรงเรียน</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-left">
                <th className="px-4 py-3 font-medium">โรงเรียน</th>
                <th className="px-4 py-3 font-medium">ชื่อผู้ใช้</th>
                <th className="px-4 py-3 font-medium text-center">สถานะ</th>
                <th className="px-4 py-3 font-medium text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {accounts.map(a => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">{a.school_name}</td>
                  <td className="px-4 py-3 text-gray-600">{a.username}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${a.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {a.is_active ? 'ใช้งาน' : 'ปิด'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-2">
                      <button onClick={() => handleResetPassword(a.id)}
                        className="text-xs text-blue-600 hover:text-blue-700 px-2 py-1 border border-blue-200 rounded hover:bg-blue-50 transition">
                        รีเซ็ตรหัส
                      </button>
                      <button onClick={() => handleToggle(a.id, a.is_active)}
                        className={`text-xs px-2 py-1 border rounded transition ${a.is_active ? 'text-red-600 border-red-200 hover:bg-red-50' : 'text-green-600 border-green-200 hover:bg-green-50'}`}>
                        {a.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
