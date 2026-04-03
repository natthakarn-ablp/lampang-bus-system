import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';

export default function ProvSchoolList() {
  const [schools, setSchools] = useState([]);
  const [affiliations, setAffiliations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState({ page: 1, per_page: 50, total: 0 });
  const [affFilter, setAffFilter] = useState('');

  useEffect(() => {
    api.get('/province/affiliations')
      .then((res) => setAffiliations(res.data.data))
      .catch(() => {});
  }, []);

  const fetchSchools = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('per_page', '50');
      if (affFilter) params.set('affiliation_id', affFilter);

      const res = await api.get(`/province/schools?${params}`);
      setSchools(res.data.data);
      setMeta(res.data.meta);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [affFilter]);

  useEffect(() => {
    fetchSchools(1);
  }, [fetchSchools]);

  const totalPages = Math.ceil(meta.total / meta.per_page) || 1;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-4">โรงเรียนทั้งหมด</h1>

      <div className="flex flex-wrap gap-3 mb-5">
        <select
          value={affFilter}
          onChange={(e) => setAffFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="">ทุกสังกัด</option>
          {affiliations.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : schools.length === 0 ? (
        <p className="text-gray-400 py-10 text-center">ไม่พบโรงเรียน</p>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-4 py-3 font-medium">โรงเรียน</th>
                  <th className="px-4 py-3 font-medium">สังกัด</th>
                  <th className="px-4 py-3 font-medium text-center">นักเรียน</th>
                  <th className="px-4 py-3 font-medium text-center">รถ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {schools.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-800">{s.name}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{s.affiliation_name || '-'}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{s.student_count}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{s.vehicle_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
              <span>แสดง {schools.length} จาก {meta.total} รายการ</span>
              <div className="flex gap-2">
                <button onClick={() => fetchSchools(meta.page - 1)} disabled={meta.page <= 1}
                  className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-30">ก่อนหน้า</button>
                <span className="px-3 py-1">หน้า {meta.page}/{totalPages}</span>
                <button onClick={() => fetchSchools(meta.page + 1)} disabled={meta.page >= totalPages}
                  className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-30">ถัดไป</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
