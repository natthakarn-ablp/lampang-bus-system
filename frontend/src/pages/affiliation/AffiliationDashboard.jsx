import { useState, useEffect } from 'react';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';

export default function AffiliationDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/affiliation/dashboard')
      .then((res) => setData(res.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800">ภาพรวมเขตพื้นที่</h1>
        {data?.affiliation && (
          <p className="text-sm text-gray-500 mt-1">{data.affiliation.name}</p>
        )}
        {data?.date && (
          <p className="text-xs text-gray-400 mt-0.5">
            วันที่: {new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : !data ? (
        <p className="text-gray-400 py-10 text-center">ไม่มีข้อมูล</p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            <DashboardCard label="โรงเรียน" value={data.total_schools} color="blue" />
            <DashboardCard label="นักเรียนทั้งหมด" value={data.total_students} color="blue" />
            <DashboardCard label="รถรับส่ง" value={data.total_vehicles} color="blue" />
            <DashboardCard label="นักเรียนลาวันนี้" value={data.leave_count ?? 0}
              color={(data.leave_count ?? 0) > 0 ? 'yellow' : 'gray'} />
            <DashboardCard label="เหตุฉุกเฉิน (7 วัน)" value={data.recent_emergencies}
              color={data.recent_emergencies > 0 ? 'red' : 'gray'} />
          </div>

          {/* Realtime status */}
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">สถานะวันนี้</h2>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <DashboardCard
              label="นักเรียนรอส่งเช้า"
              value={data.morning_pending ?? 0}
              sub={data.morning_pending === 0 ? 'ส่งเช้าครบแล้ว' : `ส่งแล้ว ${data.morning_done}/${data.morning_total}`}
              color={data.morning_pending === 0 ? 'green' : 'yellow'}
            />
            <DashboardCard
              label="นักเรียนรอรับเย็น"
              value={data.evening_pending ?? 0}
              sub={data.evening_pending === 0 ? 'รับเย็นครบแล้ว' : `รับแล้ว ${data.evening_done}/${data.evening_total}`}
              color={data.evening_pending === 0 ? 'green' : 'yellow'}
            />
          </div>

          {/* Schools not complete */}
          {data.schools_not_complete?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                โรงเรียนที่ยังไม่ครบ ({data.schools_not_complete.length} แห่ง)
              </h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-left">
                      <th className="px-4 py-3 font-medium">โรงเรียน</th>
                      <th className="px-4 py-3 font-medium text-center">รอส่งเช้า</th>
                      <th className="px-4 py-3 font-medium text-center">รอรับเย็น</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.schools_not_complete.map((s) => (
                      <tr key={s.school_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-800">{s.school_name}</td>
                        <td className="px-4 py-3 text-center">
                          {s.morning_pending > 0
                            ? <span className="text-orange-600 font-medium">{s.morning_pending} คน</span>
                            : <span className="text-green-600 text-xs">ครบ</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {s.evening_pending > 0
                            ? <span className="text-indigo-600 font-medium">{s.evening_pending} คน</span>
                            : <span className="text-green-600 text-xs">ครบ</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {data.schools_not_complete?.length === 0 && (
            <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 mb-6 text-sm font-medium">
              ทุกโรงเรียนดำเนินการครบแล้ว
            </div>
          )}

        </>
      )}
    </div>
  );
}
