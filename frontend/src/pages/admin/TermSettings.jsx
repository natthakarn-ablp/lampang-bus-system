import { useState, useEffect, useCallback } from 'react';
import { Calendar, CheckCircle2, Plus } from 'lucide-react';
import api from '../../api/axios';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import { useToast } from '../../components/Toast';

export default function TermSettings() {
  const toast = useToast();
  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ id: '', name: '', start_date: '', end_date: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/admin/terms');
      setTerms(Array.isArray(r?.data?.data) ? r.data.data : []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function setCurrent(id) {
    if (busyId) return;
    if (!window.confirm(`ตั้ง "${id}" เป็นภาคเรียนปัจจุบัน?\nการเช็กอิน/นำเข้านักเรียนใหม่จะถูกบันทึกในภาคเรียนนี้`)) return;
    setBusyId(id);
    try {
      await api.post(`/admin/terms/${encodeURIComponent(id)}/current`);
      toast.success('ตั้งเป็นภาคเรียนปัจจุบันแล้ว');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'ไม่สำเร็จ');
    } finally { setBusyId(null); }
  }

  async function addTerm(e) {
    e.preventDefault();
    if (!/^\d{4}-[123]$/.test(form.id.trim())) { toast.error('รหัสภาคเรียนต้องเป็นรูปแบบ เช่น 2569-1'); return; }
    setSaving(true);
    try {
      await api.post('/admin/terms', {
        id: form.id.trim(), name: form.name.trim() || null,
        start_date: form.start_date || null, end_date: form.end_date || null,
      });
      toast.success('เพิ่มภาคเรียนแล้ว');
      setForm({ id: '', name: '', start_date: '', end_date: '' });
      setShowAdd(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'เพิ่มไม่สำเร็จ');
    } finally { setSaving(false); }
  }

  return (
    <div className="p-3 sm:p-6 max-w-3xl mx-auto pb-10">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Calendar className="w-6 h-6 text-blue-600" />
          <h1 className="text-xl font-semibold text-gray-800">ภาคเรียนปัจจุบัน</h1>
        </div>
        {!showAdd && (
          <button onClick={() => setShowAdd(true)}
            className="text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-4 py-2 rounded-lg transition flex items-center gap-1">
            <Plus className="w-4 h-4" /> เพิ่มภาคเรียน
          </button>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-5">
        ตั้งภาคเรียนปัจจุบันเพื่อให้การเช็กอิน/นำเข้านักเรียนบันทึกในเทอมที่ถูกต้อง — เปลี่ยนได้ทันทีโดยไม่ต้องรีสตาร์ทระบบ
      </p>

      {showAdd && (
        <form onSubmit={addTerm} className="bg-white rounded-xl border border-gray-200 p-4 mb-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">รหัสภาคเรียน *</label>
              <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })}
                placeholder="เช่น 2569-1"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">ชื่อ (ถ้ามี)</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="ภาคเรียนที่ 1/2569"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">วันเริ่ม</label>
              <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">วันสิ้นสุด</label>
              <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
            <button type="button" onClick={() => { setShowAdd(false); setForm({ id: '', name: '', start_date: '', end_date: '' }); }}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm px-4 py-2 rounded-lg">ยกเลิก</button>
          </div>
        </form>
      )}

      {loading ? (
        <LoadingState />
      ) : terms.length === 0 ? (
        <EmptyState icon={Calendar} title="ยังไม่มีภาคเรียน" description='กด "เพิ่มภาคเรียน" เพื่อเริ่ม' />
      ) : (
        <div className="space-y-2">
          {terms.map((t) => (
            <div key={t.id}
              className={`bg-white rounded-xl border px-4 py-3 flex items-center justify-between gap-3 ${t.is_current ? 'border-green-300' : 'border-gray-200'}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800">
                  {t.id}{t.name ? <span className="text-gray-400 font-normal"> · {t.name}</span> : null}
                </p>
                {(t.start_date || t.end_date) && (
                  <p className="text-xs text-gray-400">
                    {t.start_date ? String(t.start_date).split('T')[0] : '—'} ถึง {t.end_date ? String(t.end_date).split('T')[0] : '—'}
                  </p>
                )}
              </div>
              {t.is_current ? (
                <span className="shrink-0 text-sm font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> ปัจจุบัน
                </span>
              ) : (
                <button onClick={() => setCurrent(t.id)} disabled={busyId === t.id}
                  className="shrink-0 text-sm font-medium text-blue-600 hover:text-blue-800 border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-lg disabled:opacity-50">
                  ตั้งเป็นปัจจุบัน
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
