import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

const SESSION_LABEL = { morning: 'เช้า', evening: 'เย็น', both: 'ทั้งวัน' };

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
    if (!form.student_id || !form.session) {
      toast.error('กรุณาเลือกนักเรียนและรอบ');
      return;
    }
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

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-800">รายการลา</h1>
          <p className="text-xs text-gray-400 mt-0.5">แจ้งลานักเรียนในรถของคุณ (วันนี้)</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
          {showForm ? 'ปิด' : 'แจ้งลา'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">แจ้งลานักเรียน</h2>

          <div>
            <label className="block text-sm text-gray-600 mb-1.5">นักเรียน</label>
            <select value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" required>
              <option value="">— เลือกนักเรียน —</option>
              {students.map(s => (
                <option key={s.id} value={s.id}>
                  {s.prefix}{s.first_name} {s.last_name} ({s.grade && s.classroom ? `${s.grade}/${s.classroom}` : s.grade || '-'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1.5">รอบที่ลา</label>
            <div className="flex gap-2">
              {[
                { val: 'morning', label: 'ลาเช้า' },
                { val: 'evening', label: 'ลาเย็น' },
                { val: 'both', label: 'ลาทั้งวัน' },
              ].map(opt => (
                <button key={opt.val} type="button"
                  onClick={() => setForm({ ...form, session: opt.val })}
                  className={`flex-1 text-sm px-3 py-2 rounded-lg border transition ${form.session === opt.val
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1.5">เหตุผล <span className="text-gray-400">(ไม่บังคับ)</span></label>
            <input type="text" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="เช่น ป่วย, ธุระ, ไปหาหมอ ฯลฯ"
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          <button type="submit" disabled={saving || !form.student_id}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2.5 rounded-lg transition w-full sm:w-auto">
            {saving ? 'กำลังบันทึก…' : 'บันทึกการลา'}
          </button>
        </form>
      )}

      {/* Leave list */}
      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : leaves.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400 text-base">ไม่มีรายการลาวันนี้</p>
          <p className="text-xs text-gray-300 mt-1">กดปุ่ม "แจ้งลา" เพื่อบันทึกการลานักเรียน</p>
        </div>
      ) : (
        <div>
          <p className="text-sm text-gray-500 mb-2">วันนี้มีนักเรียนลา {leaves.length} คน</p>
          <div className="space-y-2">
            {leaves.map(l => (
              <div key={l.id} className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">{l.student_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {l.grade && l.classroom ? `${l.grade}/${l.classroom}` : l.grade || '-'}
                    {' · '}
                    <span className={l.session === 'both' ? 'text-amber-600 font-medium' : ''}>
                      ลา{SESSION_LABEL[l.session]}
                    </span>
                    {l.reason && ` · ${l.reason}`}
                  </p>
                </div>
                <button onClick={() => handleCancel(l.id)}
                  className="text-xs text-red-600 hover:text-red-700 px-3 py-1.5 border border-red-200 rounded-lg hover:bg-red-50 transition shrink-0">
                  ยกเลิก
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
