import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

const RESULT_OPTIONS = [
  { value: 'PASSED',   label: 'ผ่าน' },
  { value: 'FAILED',   label: 'ไม่ผ่าน' },
  { value: 'NEEDS_FIX',label: 'ต้องแก้ไข' },
  { value: 'PENDING',  label: 'รอตรวจ' },
];

const RESULT_BADGE = {
  PASSED:    'bg-green-100 text-green-700',
  FAILED:    'bg-red-100 text-red-700',
  NEEDS_FIX: 'bg-yellow-100 text-yellow-700',
  PENDING:   'bg-gray-100 text-gray-600',
};

export default function InspectionForm() {
  const toast = useToast();
  const [vehicles, setVehicles] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [meta, setMeta] = useState({ page: 1, per_page: 20, total: 0 });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resultFilter, setResultFilter] = useState('');

  const [form, setForm] = useState({
    vehicle_id: '', inspection_date: new Date().toISOString().slice(0, 10),
    expiry_date: '', result: 'PASSED', notes: '',
  });

  useEffect(() => {
    api.get('/transport/vehicles?per_page=200').then(r => setVehicles(r.data.data)).catch(() => {});
  }, []);

  const fetchInspections = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('per_page', '20');
      if (resultFilter) params.set('result', resultFilter);
      const res = await api.get(`/transport/inspections?${params}`);
      setInspections(res.data.data);
      setMeta(res.data.meta);
    } catch {} finally { setLoading(false); }
  }, [resultFilter]);

  useEffect(() => { fetchInspections(1); }, [fetchInspections]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.vehicle_id) { toast.error('กรุณาเลือกรถ'); return; }
    setSaving(true);
    try {
      await api.post('/transport/inspections', form);
      toast.success('บันทึกผลตรวจสำเร็จ');
      setShowForm(false);
      setForm({ vehicle_id: '', inspection_date: new Date().toISOString().slice(0, 10), expiry_date: '', result: 'PASSED', notes: '' });
      fetchInspections(1);
    } catch (err) {
      toast.error(err.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally { setSaving(false); }
  }

  const totalPages = Math.ceil(meta.total / meta.per_page) || 1;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-800">บันทึกตรวจสภาพรถ</h1>
          <p className="text-xs text-gray-400 mt-0.5">บันทึกและดูประวัติการตรวจสภาพ</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
          {showForm ? 'ปิด' : 'บันทึกผลตรวจ'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">รถ <span className="text-red-500">*</span></label>
              <select value={form.vehicle_id} onChange={e => setForm({ ...form, vehicle_id: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" required>
                <option value="">— เลือกรถ —</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_no}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">ผลตรวจ <span className="text-red-500">*</span></label>
              <select value={form.result} onChange={e => setForm({ ...form, result: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                {RESULT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">วันที่ตรวจ</label>
              <input type="date" value={form.inspection_date}
                onChange={e => setForm({ ...form, inspection_date: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">วันหมดอายุผลตรวจ</label>
              <input type="date" value={form.expiry_date}
                onChange={e => setForm({ ...form, expiry_date: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">หมายเหตุ</label>
            <input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="รายละเอียดเพิ่มเติม"
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <button type="submit" disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition">
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </form>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <select value={resultFilter} onChange={e => setResultFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
          <option value="">ทุกผลตรวจ</option>
          {RESULT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : inspections.length === 0 ? (
        <p className="text-gray-400 py-10 text-center">ไม่มีบันทึกการตรวจ</p>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-4 py-3 font-medium">ทะเบียนรถ</th>
                  <th className="px-4 py-3 font-medium text-center">ผลตรวจ</th>
                  <th className="px-4 py-3 font-medium">วันที่ตรวจ</th>
                  <th className="px-4 py-3 font-medium">หมดอายุ</th>
                  <th className="px-4 py-3 font-medium">ผู้ตรวจ</th>
                  <th className="px-4 py-3 font-medium">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {inspections.map(ins => (
                  <tr key={ins.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{ins.plate_no}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${RESULT_BADGE[ins.result] || 'bg-gray-100 text-gray-500'}`}>
                        {RESULT_OPTIONS.find(o => o.value === ins.result)?.label || ins.result}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{ins.inspection_date}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{ins.expiry_date || '-'}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{ins.inspector_name || '-'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{ins.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
              <span>แสดง {inspections.length} จาก {meta.total} รายการ</span>
              <div className="flex gap-2">
                <button onClick={() => fetchInspections(meta.page - 1)} disabled={meta.page <= 1}
                  className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-30">ก่อนหน้า</button>
                <span className="px-3 py-1">หน้า {meta.page}/{totalPages}</span>
                <button onClick={() => fetchInspections(meta.page + 1)} disabled={meta.page >= totalPages}
                  className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-30">ถัดไป</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
