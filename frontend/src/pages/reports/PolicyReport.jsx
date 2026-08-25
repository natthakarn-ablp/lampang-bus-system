import { useState, useEffect } from 'react';
import { Landmark } from 'lucide-react';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';
import KpiCard from '../../components/KpiCard';
import AppCard from '../../components/ui/AppCard';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';

/**
 * รายงานเชิงนโยบาย (Policy report) — province/admin only.
 * Consumes the existing GET /api/reports/policy (report.service.getPolicyReport):
 * province-wide totals, today's check-in completion, 30-day emergencies, and a
 * per-affiliation breakdown. Presentation-facing for executives / ผู้บริหาร.
 */
export default function PolicyReport() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/reports/policy')
      .then((res) => setData(res.data.data))
      .catch((err) => setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  const t = data?.province_totals || {};
  const today = data?.today || {};

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800">รายงานเชิงนโยบาย</h1>
          <p className="text-sm text-gray-500 mt-0.5">ภาพรวมระดับจังหวัดสำหรับผู้บริหาร</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {data?.date && (
            <span className="text-xs text-gray-400">
              ข้อมูล ณ {new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
          )}
          <button onClick={() => window.location.reload()}
            className="text-sm text-gray-500 hover:text-blue-600 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
            รีเฟรชข้อมูล
          </button>
        </div>
      </div>

      {error && <ErrorState message={error} className="mb-4" />}
      {loading ? <LoadingState />
      : !data ? <EmptyState icon={Landmark} title="ไม่มีข้อมูล" />
      : (
        <>
          {/* Province totals */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            <DashboardCard label="สังกัด" value={t.affiliations ?? 0} color="blue" />
            <DashboardCard label="โรงเรียน" value={t.schools ?? 0} color="blue" />
            <DashboardCard label="นักเรียน" value={t.students ?? 0} color="blue" />
            <DashboardCard label="รถรับส่ง" value={t.vehicles ?? 0} color="blue" />
            <DashboardCard label="คนขับ" value={t.drivers ?? 0} color="blue" />
          </div>

          {/* Today's completion + emergencies */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <KpiCard label="ส่งเช้าวันนี้" pct={today.morning_pct}
              detail={`${today.morning_done}/${today.tracked} คน`} />
            <KpiCard label="รับเย็นวันนี้" pct={today.evening_pct}
              detail={`${today.evening_done}/${today.tracked} คน`} />
            <DashboardCard label="เหตุฉุกเฉิน (30 วัน)" value={data.emergencies_30d ?? 0}
              sub={data.emergencies_30d > 0 ? `${data.emergencies_30d} ครั้ง` : 'ไม่มี'}
              color={data.emergencies_30d > 0 ? 'red' : 'gray'} />
          </div>

          {/* Executive insight box */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-blue-800 mb-3">สรุปผู้บริหาร</h2>
            <ul className="text-sm text-blue-700 space-y-1.5 leading-relaxed">
              <li>• ครอบคลุม {t.affiliations ?? 0} สังกัด · {t.schools ?? 0} โรงเรียน · นักเรียน {(t.students ?? 0).toLocaleString('th-TH')} คน · รถ {t.vehicles ?? 0} คัน</li>
              <li>• วันนี้ติดตามการเดินทาง {today.tracked ?? 0} คน — ส่งเช้า <strong>{today.morning_pct ?? 0}%</strong> · รับเย็น <strong>{today.evening_pct ?? 0}%</strong></li>
              {data.emergencies_30d > 0
                ? <li>• มีเหตุฉุกเฉิน {data.emergencies_30d} ครั้งใน 30 วันที่ผ่านมา — ควรติดตาม</li>
                : <li>• ไม่มีเหตุฉุกเฉินใน 30 วันที่ผ่านมา</li>}
            </ul>
          </div>

          {/* Per-affiliation breakdown */}
          {data.affiliations?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">สรุปตามสังกัด</h2>
              <AppCard padding="none" className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead className="bg-surface text-ink-muted text-xs font-semibold uppercase tracking-wide">
                      <tr className="text-left">
                        <th className="px-4 py-3">สังกัด</th>
                        <th className="px-4 py-3 text-center">โรงเรียน</th>
                        <th className="px-4 py-3 text-center">นักเรียน</th>
                        <th className="px-4 py-3 text-center">รถรับส่ง</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-border">
                      {data.affiliations.map((a, i) => (
                        <tr key={a.affiliation_id ?? a.affiliation_name ?? i} className="hover:bg-surface transition">
                          <td className="px-4 py-3 text-gray-800">{a.affiliation_name}</td>
                          <td className="px-4 py-3 text-center text-gray-600">{a.schools}</td>
                          <td className="px-4 py-3 text-center text-gray-600">{(a.students ?? 0).toLocaleString('th-TH')}</td>
                          <td className="px-4 py-3 text-center text-gray-600">{a.vehicles}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </AppCard>
            </section>
          )}
        </>
      )}
    </div>
  );
}
