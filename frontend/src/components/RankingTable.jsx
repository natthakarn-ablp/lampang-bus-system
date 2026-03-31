import { kpiColor, safePct } from '../utils/kpi';

/**
 * Compact ranking card with tabular layout.
 * Used by both MonthlyReport and SummaryReport for top/bottom rankings.
 */
export default function RankingTable({ title, items, nameKey = 'school_name', showSchool = false }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-4 text-xs text-gray-400">ไม่มีข้อมูล</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400">
              <th className="px-4 py-2 text-left font-medium">#</th>
              <th className="px-2 py-2 text-left font-medium">{showSchool ? 'ทะเบียนรถ' : 'โรงเรียน'}</th>
              <th className="px-2 py-2 text-center font-medium">KPI เช้า</th>
              <th className="px-2 py-2 text-center font-medium">KPI เย็น</th>
              <th className="px-2 py-2 text-center font-medium">ฉุกเฉิน</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {items.map((item, i) => (
              <tr key={item.school_id || item.vehicle_id} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-400 text-xs">{i + 1}</td>
                <td className="px-2 py-2 text-gray-700 text-xs">
                  {item[nameKey]}
                  {showSchool && item.school_names && (
                    <span className="block text-gray-400 text-[10px]">{item.school_names}</span>
                  )}
                </td>
                <td className={`px-2 py-2 text-center text-xs font-medium ${kpiColor(item.morning_kpi ?? 0)}`}>
                  {safePct(item.morning_kpi)}
                </td>
                <td className={`px-2 py-2 text-center text-xs font-medium ${kpiColor(item.evening_kpi ?? 0)}`}>
                  {safePct(item.evening_kpi)}
                </td>
                <td className="px-2 py-2 text-center text-xs text-gray-500">-</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
