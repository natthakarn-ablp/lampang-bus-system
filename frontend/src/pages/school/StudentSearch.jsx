import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';

export default function StudentSearch() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState({ page: 1, per_page: 20, total: 0 });

  // Filters
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchStudents = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('per_page', '20');
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (grade) params.set('grade', grade);

      const res = await api.get(`/school/students?${params}`);
      setStudents(res.data.data);
      setMeta(res.data.meta);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, grade]);

  useEffect(() => {
    fetchStudents(1);
  }, [fetchStudents]);

  const totalPages = Math.ceil(meta.total / meta.per_page) || 1;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-4">ค้นหานักเรียน</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อ นามสกุล หรือรหัส…"
          className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <select
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="">ทุกระดับชั้น</option>
          {['อ.1','อ.2','อ.3','ป.1','ป.2','ป.3','ป.4','ป.5','ป.6','ม.1','ม.2','ม.3','ม.4','ม.5','ม.6'].map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : students.length === 0 ? (
        <p className="text-gray-400 py-10 text-center">ไม่พบนักเรียน</p>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-4 py-3 font-medium">รหัส</th>
                  <th className="px-4 py-3 font-medium">ชื่อ-นามสกุล</th>
                  <th className="px-4 py-3 font-medium">ชั้น</th>
                  <th className="px-4 py-3 font-medium">ห้อง</th>
                  <th className="px-4 py-3 font-medium">ทะเบียนรถ</th>
                  <th className="px-4 py-3 font-medium">เช้า</th>
                  <th className="px-4 py-3 font-medium">เย็น</th>
                  <th className="px-4 py-3 font-medium">ผู้ปกครอง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {students.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{s.id}</td>
                    <td className="px-4 py-3 text-gray-800">
                      {s.prefix}{s.first_name} {s.last_name}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{s.grade || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{s.classroom || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{s.plate_no || '-'}</td>
                    <td className="px-4 py-3">
                      {s.morning_enabled
                        ? <span className="text-green-600 text-xs font-medium">ใช้</span>
                        : <span className="text-gray-400 text-xs">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      {s.evening_enabled
                        ? <span className="text-green-600 text-xs font-medium">ใช้</span>
                        : <span className="text-gray-400 text-xs">-</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {s.parent_name
                        ? <span>{s.parent_name} <span className="text-gray-400">{s.parent_phone}</span></span>
                        : <span className="text-gray-400">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
            <span>แสดง {students.length} จาก {meta.total} รายการ</span>
            <div className="flex gap-2">
              <button
                onClick={() => fetchStudents(meta.page - 1)}
                disabled={meta.page <= 1}
                className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-30"
              >
                ก่อนหน้า
              </button>
              <span className="px-3 py-1">หน้า {meta.page}/{totalPages}</span>
              <button
                onClick={() => fetchStudents(meta.page + 1)}
                disabled={meta.page >= totalPages}
                className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-30"
              >
                ถัดไป
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
