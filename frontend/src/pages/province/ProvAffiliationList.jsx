import { useState, useEffect } from 'react';
import api from '../../api/axios';
import KpiCard from '../../components/KpiCard';
import { kpiColor, safePct, levelBadge, sortByKpi } from '../../utils/kpi';

export default function ProvAffiliationList() {
  const [affiliations, setAffiliations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/province/affiliations')
      .then((res) => setAffiliations(res.data.data))
      .catch((err) => setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800">สังกัดทั้งหมด</h1>
        <p className="text-sm text-gray-500 mt-0.5">สรุป KPI รายสังกัด</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : affiliations.length === 0 ? (
        <p className="text-gray-400 py-10 text-center">ไม่มีสังกัด</p>
      ) : (
        <>
          {/* Full KPI table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto mb-6">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-4 py-3 font-medium">สังกัด</th>
                  <th className="px-4 py-3 font-medium text-center">โรงเรียน</th>
                  <th className="px-4 py-3 font-medium text-center">นักเรียน</th>
                  <th className="px-4 py-3 font-medium text-center">รถ</th>
                  <th className="px-4 py-3 font-medium text-center">KPI ส่งเช้า</th>
                  <th className="px-4 py-3 font-medium text-center">KPI รับเย็น</th>
                  <th className="px-4 py-3 font-medium text-center">ฉุกเฉิน</th>
                  <th className="px-4 py-3 font-medium text-center">ระดับ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortByKpi(affiliations).map((a) => {
                  const badge = levelBadge(a.morning_kpi, a.evening_kpi);
                  return (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-800 font-medium">{a.name}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{a.school_count}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{a.student_count}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{a.vehicle_count}</td>
                      <td className={`px-4 py-3 text-center font-medium ${kpiColor(a.morning_kpi)}`}>
                        {safePct(a.morning_kpi)}
                        <p className="text-xs text-gray-400 font-normal">{a.morning_done}/{a.morning_expected}</p>
                      </td>
                      <td className={`px-4 py-3 text-center font-medium ${kpiColor(a.evening_kpi)}`}>
                        {safePct(a.evening_kpi)}
                        <p className="text-xs text-gray-400 font-normal">{a.evening_done}/{a.evening_expected}</p>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-500">{a.emergency_count}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badge.cls}`}>{badge.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Per-affiliation KPI cards */}
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">KPI รายสังกัด</h2>
          <div className="grid gap-4">
            {sortByKpi(affiliations).map((a) => {
              const badge = levelBadge(a.morning_kpi, a.evening_kpi);
              return (
                <div key={a.id} className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                    <div>
                      <h3 className="font-semibold text-gray-800">{a.name}</h3>
                      <p className="text-xs text-gray-400">{a.school_count} โรงเรียน · {a.student_count} คน · {a.vehicle_count} คัน</p>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full self-start ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <KpiCard label="KPI ส่งเช้า" pct={a.morning_kpi}
                      detail={`${a.morning_done}/${a.morning_expected} คน`} />
                    <KpiCard label="KPI รับเย็น" pct={a.evening_kpi}
                      detail={`${a.evening_done}/${a.evening_expected} คน`} />
                    <div className="rounded-xl border p-4 bg-gray-50 border-gray-200 text-gray-700">
                      <p className="text-xs font-medium opacity-75">โรงเรียน</p>
                      <p className="text-2xl font-bold mt-1">{a.school_count}</p>
                      <p className="text-xs mt-1 opacity-60">นักเรียน {a.student_count} คน</p>
                    </div>
                    <div className={`rounded-xl border p-4 ${a.emergency_count > 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                      <p className="text-xs font-medium opacity-75">เหตุฉุกเฉิน</p>
                      <p className="text-2xl font-bold mt-1">{a.emergency_count}</p>
                      <p className="text-xs mt-1 opacity-60">{a.emergency_count > 0 ? 'ครั้ง วันนี้' : 'ไม่มี'}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
