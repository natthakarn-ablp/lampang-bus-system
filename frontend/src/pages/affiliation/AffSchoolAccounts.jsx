import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

export default function AffSchoolAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState('existing'); // 'existing' | 'new'
  const [form, setForm] = useState({ school_id: '', username: '', school_code: '', school_name: '' });
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

  function resetForm() {
    setForm({ school_id: '', username: '', school_code: '', school_name: '' });
    setMode('existing');
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!/^\d{6}$/.test(form.username)) {
      toast.error('ชื่อผู้ใช้ต้องเป็นรหัส OBEC 6 หลัก (ตัวเลขเท่านั้น)');
      return;
    }

    setSaving(true);
    try {
      if (mode === 'existing') {
        if (!form.school_id) { toast.error('กรุณาเลือกโรงเรียน'); setSaving(false); return; }
        await api.post('/affiliation/school-accounts', {
          school_id: form.school_id, username: form.username,
        });
        toast.success('สร้างบัญชีสำเร็จ — รหัสผ่านเริ่มต้นคือรหัสโรงเรียน');
      } else {
        if (!form.school_code || !/^\d{6,10}$/.test(form.school_code)) {
          toast.error('รหัสโรงเรียนต้องเป็นตัวเลข 6-10 หลัก'); setSaving(false); return;
        }
        if (!form.school_name.trim()) {
          toast.error('กรุณากรอกชื่อโรงเรียน'); setSaving(false); return;
        }
        await api.post('/affiliation/school-accounts/new-school', {
          school_code: form.school_code, school_name: form.school_name.trim(), username: form.username,
        });
        toast.success('เพิ่มโรงเรียนและสร้างบัญชีสำเร็จ — รหัสผ่านเริ่มต้นคือรหัสโรงเรียน');
        // Refresh school list too
        api.get('/affiliation/schools').then(r => setSchools(r.data.data)).catch(() => {});
      }
      setShowForm(false);
      resetForm();
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
        <button onClick={() => { setShowForm(!showForm); if (showForm) resetForm(); }}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
          {showForm ? 'ปิด' : 'สร้างบัญชีใหม่'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode('existing')}
              className={`flex-1 text-sm px-3 py-2 rounded-lg border transition ${mode === 'existing'
                ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}>
              โรงเรียนที่มีอยู่แล้ว
            </button>
            <button type="button" onClick={() => setMode('new')}
              className={`flex-1 text-sm px-3 py-2 rounded-lg border transition ${mode === 'new'
                ? 'bg-green-50 border-green-300 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}>
              เพิ่มโรงเรียนใหม่
            </button>
          </div>

          {mode === 'existing' ? (
            <div>
              <label className="block text-sm text-gray-600 mb-1">โรงเรียน</label>
              <select value={form.school_id} onChange={(e) => setForm({ ...form, school_id: e.target.value })} required
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">เลือกโรงเรียน</option>
                {schools.map(s => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
              </select>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">ชื่อโรงเรียน <span className="text-red-500">*</span></label>
                <input type="text" value={form.school_name}
                  onChange={(e) => setForm({ ...form, school_name: e.target.value })}
                  placeholder="เช่น โรงเรียนบ้านตัวอย่าง"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" required />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">รหัสโรงเรียน (6-10 หลัก) <span className="text-red-500">*</span></label>
                <input type="text" value={form.school_code}
                  onChange={(e) => setForm({ ...form, school_code: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                  placeholder="เช่น 1052520341" maxLength={10}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" required />
                <p className="text-xs text-gray-400 mt-1">รหัสนี้จะถูกใช้เป็นรหัสผ่านเริ่มต้นของบัญชีโรงเรียน</p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-600 mb-1">ชื่อผู้ใช้ (รหัส OBEC 6 หลัก)</label>
            <input type="text" value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value.replace(/\D/g, '').slice(0, 6) })}
              required pattern="\d{6}" maxLength={6} placeholder="เช่น 520341"
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
            รหัสผ่านเริ่มต้นจะใช้ "รหัสโรงเรียน" โดยอัตโนมัติ ผู้ใช้ต้องเปลี่ยนรหัสผ่านหลัง login ครั้งแรก
          </div>

          <button type="submit" disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition">
            {saving ? 'กำลังสร้าง…' : mode === 'new' ? 'เพิ่มโรงเรียนและสร้างบัญชี' : 'สร้างบัญชี'}
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
