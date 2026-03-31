import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';

export default function MonthlyReport() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [month, setMonth] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).substring(0, 7)
  );

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/reports/monthly?month=${month}`);
      setData(res.data.data);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">รายงานรายเดือน</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <DashboardCard label="นักเรียนทั้งหมด" value={data.total_students} color="blue" />
            <DashboardCard label="เช็กอินเช้า (รวม)" value={data.total_morning_checkins} color="yellow" />
            <DashboardCard label="เช็กอินเย็น (รวม)" value={data.total_evening_checkins} color="yellow" />
            <DashboardCard
              label="เหตุฉุกเฉิน"
              value={data.emergency_count}
              color={data.emergency_count > 0 ? 'red' : 'gray'}
            />
          </div>

          {/* Daily trend */}
          {data.daily_trend?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">แนวโน้มรายวัน</h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-left">
                      <th className="px-4 py-3 font-medium">วันที่</th>
                      <th className="px-4 py-3 font-medium text-center">ส่งเช้า</th>
                      <th className="px-4 py-3 font-medium text-center">รับเย็น</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.daily_trend.map((d) => (
                      <tr key={d.date} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-800">
                          {new Date(d.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                        </td>
                        <td className="px-4 py-3 text-center text-orange-600">{d.morning_done}</td>
                        <td className="px-4 py-3 text-center text-indigo-600">{d.evening_done}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Per-school summary */}
          {data.schools?.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">สรุปรายโรงเรียน</h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-left">
                      <th className="px-4 py-3 font-medium">โรงเรียน</th>
                      <th className="px-4 py-3 font-medium text-center">นักเรียน</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.schools.map((s) => (
                      <tr key={s.school_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-800">{s.school_name}</td>
                        <td className="px-4 py-3 text-center text-gray-600">{s.student_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Export buttons */}
          <div className="flex items-center gap-3 pt-4 mt-6 border-t border-gray-200">
            <span className="text-sm text-gray-500">ดาวน์โหลด:</span>
            {['csv', 'excel', 'pdf'].map((fmt) => {
              const style = { csv: 'bg-green-50 hover:bg-green-100 text-green-700 border-green-200', excel: 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200', pdf: 'bg-red-50 hover:bg-red-100 text-red-700 border-red-200' };
              return (
                <button
                  key={fmt}
                  onClick={() => {
                    const token = localStorage.getItem('access_token');
                    const exportDate = `${month}-01`;
                    fetch(`/api/reports/export/${fmt}?date=${exportDate}`, {
                      headers: { Authorization: `Bearer ${token}` },
                    })
                      .then((r) => r.blob())
                      .then((blob) => {
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = `report-${month}.${fmt === 'excel' ? 'xlsx' : fmt}`;
                        a.click();
                        URL.revokeObjectURL(a.href);
                      });
                  }}
                  className={`px-4 py-2 text-sm border rounded-lg transition ${style[fmt]}`}
                >
                  {fmt.toUpperCase()}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
