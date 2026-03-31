import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import ApprovalBadge from '../../components/ApprovalBadge';
import { useToast } from '../../components/Toast';

export default function DriverRosterRequests() {
  const [requests, setRequests] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ student_id: '', request_type: 'remove', reason: '' });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const fetchRequests = useCallback(async () => {
    try {
      const res = await api.get('/driver/roster-requests');
      setRequests(res.data.data);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchRequests();
    api.get('/driver/roster').then(r => setStudents(r.data.data.students || [])).catch(() => {});
  }, [fetchRequests]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.student_id || !form.request_type) return;
    setSaving(true);
    try {
      await api.post('/driver/roster-request', form);
      toast.success('ส่งคำขอสำเร็จ');
      setShowForm(false);
      setForm({ student_id: '', request_type: 'remove', reason: '' });
      fetchRequests();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถส่งคำขอได้');
    } finally { setSaving(false); }
  }

  const TYPE_LABEL = { add: 'เพิ่มนักเรียน', remove: 'ถอนนักเรียน' };

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">คำขอเปลี่ยนแปลงรายชื่อ</h1>
        <button onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
          {showForm ? 'ปิด' : 'สร้างคำขอ'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">ประเภท</label>
            <select value={form.request_type} onChange={(e) => setForm({ ...form, request_type: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="remove">ถอนนักเรียนออกจากรถ</option>
              <option value="add">เพิ่มนักเรียนเข้ารถ</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">รหัสนักเรียน</label>
            {form.request_type === 'remove' ? (
              <select value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" required>
                <option value="">เลือกนักเรียน</option>
                {students.map(s => (
                  <option key={s.id} value={s.id}>{s.prefix}{s.first_name} {s.last_name}</option>
                ))}
              </select>
            ) : (
              <input type="number" value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })}
                placeholder="กรอกรหัสนักเรียน"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" required />
            )}
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">เหตุผล</label>
            <input type="text" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="เหตุผลในการขอเปลี่ยนแปลง"
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <button type="submit" disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition">
            {saving ? 'กำลังส่ง…' : 'ส่งคำขอ'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : requests.length === 0 ? (
        <p className="text-gray-400 py-10 text-center">ไม่มีคำขอ</p>
      ) : (
        <div className="space-y-3">
          {requests.map(r => (
            <div key={r.id} className="bg-white rounded-xl border border-gray-200 px-5 py-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800">{TYPE_LABEL[r.request_type]} — {r.student_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {r.grade && r.classroom ? `${r.grade}/${r.classroom}` : ''} · {r.reason || '-'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(r.created_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {r.review_note && <> · หมายเหตุ: {r.review_note}</>}
                  </p>
                </div>
                <ApprovalBadge status={r.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
