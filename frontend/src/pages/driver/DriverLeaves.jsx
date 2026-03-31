import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

export default function DriverLeaves() {
  const [leaves, setLeaves] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ student_id: '', session: 'morning', reason: '' });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const fetchLeaves = useCallback(async () => {
    try {
      const res = await api.get('/driver/leaves');
      setLeaves(res.data.data);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchLeaves();
    api.get('/driver/roster').then(r => setStudents(r.data.data.students || [])).catch(() => {});
  }, [fetchLeaves]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.student_id || !form.session) return;
    setSaving(true);
    try {
      await api.post('/driver/leave', form);
      toast.success('บันทึกการลาสำเร็จ');
      setShowForm(false);
      setForm({ student_id: '', session: 'morning', reason: '' });
      fetchLeaves();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถบันทึกได้');
    } finally { setSaving(false); }
  }

  async function handleCancel(id) {
    try {
      await api.delete(`/driver/leave/${id}`);
      toast.success('ยกเลิกการลาแล้ว');
      fetchLeaves();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถยกเลิกได้');
    }
  }

  const SESSION_LABEL = { morning: 'เช้า', evening: 'เย็น', both: 'ทั้งวัน' };

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">รายการลา</h1>
        <button onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
          {showForm ? 'ปิด' : 'แจ้งลา'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">นักเรียน</label>
            <select value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" required>
              <option value="">เลือกนักเรียน</option>
              {students.map(s => (
                <option key={s.id} value={s.id}>{s.prefix}{s.first_name} {s.last_name} ({s.grade}/{s.classroom})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">รอบ</label>
            <select value={form.session} onChange={(e) => setForm({ ...form, session: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="morning">ลาเช้า</option>
              <option value="evening">ลาเย็น</option>
              <option value="both">ลาทั้งวัน</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">เหตุผล</label>
            <input type="text" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="ป่วย, ธุระ ฯลฯ"
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <button type="submit" disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition">
            {saving ? 'กำลังบันทึก…' : 'บันทึกการลา'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : leaves.length === 0 ? (
        <p className="text-gray-400 py-10 text-center">ไม่มีรายการลาวันนี้</p>
      ) : (
        <div className="space-y-3">
          {leaves.map(l => (
            <div key={l.id} className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800">{l.student_name}</p>
                <p className="text-xs text-gray-500">
                  {l.grade && l.classroom ? `${l.grade}/${l.classroom}` : l.grade || '-'} · ลา{SESSION_LABEL[l.session]} · {l.reason || '-'}
                </p>
              </div>
              <button onClick={() => handleCancel(l.id)}
                className="text-xs text-red-600 hover:text-red-700 px-3 py-1 border border-red-200 rounded-lg hover:bg-red-50 transition">
                ยกเลิก
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
