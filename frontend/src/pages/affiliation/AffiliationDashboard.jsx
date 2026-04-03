import { useState, useEffect } from 'react';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';
import { DonutChart, HBarChart } from '../../components/MiniCharts';
import { PAGE_TITLES, CARD_LABELS, CHART_TITLES, SECTION_TITLES, STATUS, UI_MESSAGES, MORNING_SEGMENTS, EVENING_SEGMENTS } from '../../constants/uiLabels';

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
        <h1 className="text-xl font-bold text-gray-800">{PAGE_TITLES.AFFILIATION_DASHBOARD}</h1>
        {data?.affiliation && (
          <p className="text-sm text-gray-500 mt-1">{data.affiliation.name}</p>
        )}
        {data?.date && (
          <p className="text-xs text-gray-400 mt-0.5">
            วันที่ {new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-gray-400 py-10 text-center">{UI_MESSAGES.LOADING}</p>
      ) : !data ? (
        <p className="text-gray-400 py-10 text-center">{UI_MESSAGES.NO_DATA}</p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
            <DashboardCard label={CARD_LABELS.SCHOOLS} value={data.total_schools} color="blue" />
            <DashboardCard label={CARD_LABELS.TOTAL_STUDENTS} value={data.total_students} color="blue" />
            <DashboardCard label={CARD_LABELS.VEHICLES} value={data.total_vehicles} color="blue" />
            <DashboardCard label={CARD_LABELS.STUDENT_LEAVE} value={data.leave_count ?? 0}
              color={(data.leave_count ?? 0) > 0 ? 'yellow' : 'gray'} />
            <DashboardCard label={CARD_LABELS.EMERGENCY_7D} value={data.recent_emergencies}
              color={data.recent_emergencies > 0 ? 'red' : 'gray'} />
          </div>

          {/* Status + Charts */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {/* Morning donut */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-semibold text-gray-500 mb-3 text-center">{CHART_TITLES.MORNING_STATUS}</p>
              <DonutChart size={110} thickness={16}
                label={data.morning_total > 0 ? `${Math.round((data.morning_done / data.morning_total) * 100)}%` : '0%'}
                sublabel={STATUS.DONE}
                segments={MORNING_SEGMENTS(data.morning_done ?? 0, data.morning_leave ?? 0, data.morning_pending ?? 0)}
              />
            </div>
            {/* Evening donut */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-semibold text-gray-500 mb-3 text-center">{CHART_TITLES.EVENING_STATUS}</p>
              <DonutChart size={110} thickness={16}
                label={data.evening_total > 0 ? `${Math.round((data.evening_done / data.evening_total) * 100)}%` : '0%'}
                sublabel={STATUS.DONE}
                segments={EVENING_SEGMENTS(data.evening_done ?? 0, data.evening_leave ?? 0, data.evening_pending ?? 0)}
              />
            </div>
            {/* Schools pending bar */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <HBarChart
                label={SECTION_TITLES.SCHOOLS_PENDING}
                items={(data.schools_not_complete || []).map(s => ({
                  label: s.school_name?.substring(0, 15) || '-',
                  value: (s.morning_pending || 0) + (s.evening_pending || 0),
                  color: (s.morning_pending || 0) + (s.evening_pending || 0) > 10 ? '#ef4444' : '#f97316',
                })).sort((a, b) => b.value - a.value).slice(0, 6)}
                valueLabel=" คน"
              />
            </div>
          </div>

          {/* Schools not complete table */}
          {data.schools_not_complete?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                {SECTION_TITLES.SCHOOLS_PENDING} ({data.schools_not_complete.length} แห่ง)
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
                            : <span className="text-green-600 text-xs">{STATUS.COMPLETE}</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {s.evening_pending > 0
                            ? <span className="text-indigo-600 font-medium">{s.evening_pending} คน</span>
                            : <span className="text-green-600 text-xs">{STATUS.COMPLETE}</span>}
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
              {UI_MESSAGES.ALL_SCHOOLS_DONE}
            </div>
          )}
        </>
      )}
    </div>
  );
}
