import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';

export default function DailyReport() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  );

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/reports/daily?date=${date}`);
      setData(res.data.data);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  function handleExport(format) {
    const token = localStorage.getItem('access_token');
    const url = `/api/reports/export/${format}?date=${date}`;
    // Use a hidden link to trigger download with auth
    const a = document.createElement('a');
    a.href = url;
    // For auth, we use fetch + blob
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        a.href = blobUrl;
        a.download = `report-${date}.${format === 'excel' ? 'xlsx' : format}`;
        a.click();
        URL.revokeObjectURL(blobUrl);
      });
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">รายงานรายวัน</h1>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : !data ? (
        <p className="text-gray-400 py-10 text-center">ไม่มีข้อมูล</p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <DashboardCard label="นักเรียนทั้งหมด" value={data.total_students} color="blue" />
            <DashboardCard label="รถรับส่ง" value={data.total_vehicles} color="blue" />
            <DashboardCard
              label="ส่งเช้าแล้ว"
              value={data.morning_done}
              sub={data.morning_pending === 0 ? 'ครบแล้ว' : `รอ ${data.morning_pending}`}
              color={data.morning_pending === 0 ? 'green' : 'yellow'}
            />
            <DashboardCard
              label="รับเย็นแล้ว"
              value={data.evening_done}
              sub={data.evening_pending === 0 ? 'ครบแล้ว' : `รอ ${data.evening_pending}`}
              color={data.evening_pending === 0 ? 'green' : 'yellow'}
            />
          </div>

          {data.emergency_count > 0 && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm font-medium">
              เหตุฉุกเฉิน: {data.emergency_count} รายการ
            </div>
          )}

          {/* Per-school table */}
          {data.schools?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">สรุปรายโรงเรียน</h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-left">
                      <th className="px-4 py-3 font-medium">โรงเรียน</th>
                      <th className="px-4 py-3 font-medium text-center">นักเรียน</th>
                      <th className="px-4 py-3 font-medium text-center">เช้า</th>
                      <th className="px-4 py-3 font-medium text-center">เย็น</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.schools.map((s) => (
                      <tr key={s.school_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-800">{s.school_name}</td>
                        <td className="px-4 py-3 text-center text-gray-600">{s.student_count}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={s.morning_done === s.student_count ? 'text-green-600' : 'text-orange-600'}>
                            {s.morning_done}/{s.student_count}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={s.evening_done === s.student_count ? 'text-green-600' : 'text-indigo-600'}>
                            {s.evening_done}/{s.student_count}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Per-vehicle table */}
          {data.vehicles?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">สรุปรายรถ</h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-left">
                      <th className="px-4 py-3 font-medium">ทะเบียนรถ</th>
                      <th className="px-4 py-3 font-medium text-center">นักเรียน</th>
                      <th className="px-4 py-3 font-medium text-center">เช้า</th>
                      <th className="px-4 py-3 font-medium text-center">เย็น</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.vehicles.map((v) => (
                      <tr key={v.vehicle_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-800">{v.plate_no}</td>
                        <td className="px-4 py-3 text-center text-gray-600">{v.student_count}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={v.morning_done === v.student_count ? 'text-green-600' : 'text-orange-600'}>
                            {v.morning_done}/{v.student_count}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={v.evening_done === v.student_count ? 'text-green-600' : 'text-indigo-600'}>
                            {v.evening_done}/{v.student_count}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Export buttons */}
          <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
            <span className="text-sm text-gray-500">ดาวน์โหลด:</span>
            <button onClick={() => handleExport('csv')}
              className="px-4 py-2 text-sm bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded-lg transition">
              CSV
            </button>
            <button onClick={() => handleExport('excel')}
              className="px-4 py-2 text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg transition">
              Excel
            </button>
            <button onClick={() => handleExport('pdf')}
              className="px-4 py-2 text-sm bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg transition">
              PDF
            </button>
          </div>
        </>
      )}
    </div>
  );
}
