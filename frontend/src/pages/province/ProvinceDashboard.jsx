import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';
import KpiCard from '../../components/KpiCard';
import ExportButtons from '../../components/ExportButtons';
import RankingTable from '../../components/RankingTable';
import { kpiColor, safePct, levelBadge, topN, bottomN, sortByKpi } from '../../utils/kpi';

export default function ProvinceDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/province/dashboard')
      .then((res) => setData(res.data.data))
      .catch((err) => setError(err.response?.data?.message || 'ไม่สามารถโหลดข้อมูลได้'))
      .finally(() => setLoading(false));
  }, []);

  const affs = data?.affiliations ?? [];
  const bestAff = affs.length ? sortByKpi(affs)[0] : null;
  const worstAff = affs.length > 1 ? [...affs].sort((a, b) => ((a.morning_kpi ?? 0) + (a.evening_kpi ?? 0)) - ((b.morning_kpi ?? 0) + (b.evening_kpi ?? 0)))[0] : null;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">

      {/* ── 1. Header + Filters + Export ────────────────────── */}
      <div className="flex flex-col gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800">ภาพรวมจังหวัดลำปาง</h1>
          <p className="text-sm text-gray-500 mt-0.5">สรุปผลการดำเนินงานรถรับส่งนักเรียนภาพรวมจังหวัด</p>
        </div>
        {data && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span className="text-xs text-gray-400">
              ข้อมูล ณ {new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
            <div className="sm:ml-auto">
              <ExportButtons filenamePrefix="province-summary" />
            </div>
          </div>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : !data ? (
        <p className="text-gray-400 py-10 text-center">ไม่มีข้อมูล</p>
      ) : (
        <>
          {/* ── 2. Province-wide KPI Cards ──────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-4">
            <KpiCard label="KPI ส่งเช้า" pct={data.morning_kpi}
              detail={`${data.morning_done}/${data.morning_total} คน`} />
            <KpiCard label="KPI รับเย็น" pct={data.evening_kpi}
              detail={`${data.evening_done}/${data.evening_total} คน`} />
            <DashboardCard label="นักเรียนรอส่งเช้า" value={data.morning_pending}
              sub={data.morning_pending === 0 ? 'ครบแล้ว' : `จาก ${data.morning_total} คน`}
              color={data.morning_pending === 0 ? 'green' : 'yellow'} />
            <DashboardCard label="นักเรียนรอรับเย็น" value={data.evening_pending}
              sub={data.evening_pending === 0 ? 'ครบแล้ว' : `จาก ${data.evening_total} คน`}
              color={data.evening_pending === 0 ? 'green' : 'yellow'} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <DashboardCard label="เขตพื้นที่" value={data.total_affiliations} color="blue" />
            <DashboardCard label="โรงเรียน" value={data.total_schools}
              sub={`นักเรียน ${data.total_students} คน`} color="blue" />
            <DashboardCard label="นักเรียนลาวันนี้" value={data.leave_count ?? 0}
              color={(data.leave_count ?? 0) > 0 ? 'yellow' : 'gray'} />
            <DashboardCard label="เหตุฉุกเฉิน (7 วัน)" value={data.recent_emergencies}
              color={data.recent_emergencies > 0 ? 'red' : 'gray'} />
          </div>

          {/* School dropdown for quick navigation */}
          {data.schools?.length > 0 && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-600 mb-1">ค้นหาโรงเรียน</label>
              <select
                onChange={(e) => { if (e.target.value) navigate(`/province/students?school_id=${e.target.value}`); }}
                className="w-full sm:w-80 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">เลือกโรงเรียน…</option>
                {data.schools.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.affiliation_name || '-'})</option>
                ))}
              </select>
            </div>
          )}

          {/* ── 3. Executive Insight Box ────────────────────── */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-blue-800 mb-3">สรุปผู้บริหาร</h2>
            <ul className="text-sm text-blue-700 space-y-1.5 leading-relaxed">
              <li>• KPI ส่งเช้าภาพรวมจังหวัด <strong className={kpiColor(data.morning_kpi)}>{safePct(data.morning_kpi)}</strong> ({data.morning_done}/{data.morning_total} คน)</li>
              <li>• KPI รับเย็นภาพรวมจังหวัด <strong className={kpiColor(data.evening_kpi)}>{safePct(data.evening_kpi)}</strong> ({data.evening_done}/{data.evening_total} คน)</li>
              <li>• มี {data.total_affiliations} เขตพื้นที่ · {data.total_schools} โรงเรียน · {data.total_students} คน · {data.total_vehicles} คัน</li>
              {bestAff && <li>• เขตพื้นที่ผลงานดีที่สุดคือ <strong>{bestAff.name}</strong> (เช้า {safePct(bestAff.morning_kpi)} · เย็น {safePct(bestAff.evening_kpi)})</li>}
              {worstAff && (worstAff.morning_kpi ?? 0) < 85 && <li>• เขตพื้นที่ที่ควรเฝ้าระวังคือ <strong>{worstAff.name}</strong> (เช้า {safePct(worstAff.morning_kpi)} · เย็น {safePct(worstAff.evening_kpi)})</li>}
              {data.recent_emergencies > 0 && <li>• พบเหตุฉุกเฉิน {data.recent_emergencies} ครั้งในรอบ 7 วัน</li>}
            </ul>
          </div>

          {/* ── 4. KPI เขตพื้นที่ Table ─────────────────────── */}
          {affs.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">KPI รายเขตพื้นที่</h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-left">
                      <th className="px-4 py-3 font-medium">เขตพื้นที่</th>
                      <th className="px-4 py-3 font-medium text-center">โรงเรียน</th>
                      <th className="px-4 py-3 font-medium text-center">รถ</th>
                      <th className="px-4 py-3 font-medium text-center">KPI ส่งเช้า</th>
                      <th className="px-4 py-3 font-medium text-center">KPI รับเย็น</th>
                      <th className="px-4 py-3 font-medium text-center">ร.ร. ครบ 100%</th>
                      <th className="px-4 py-3 font-medium text-center">รถครบ 100%</th>
                      <th className="px-4 py-3 font-medium text-center">ฉุกเฉิน</th>
                      <th className="px-4 py-3 font-medium text-center">ระดับ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortByKpi(affs).map((a) => {
                      const badge = levelBadge(a.morning_kpi, a.evening_kpi);
                      return (
                        <tr key={a.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <p className="text-gray-800 font-medium">{a.name}</p>
                            <p className="text-xs text-gray-400">{a.student_count} คน</p>
                          </td>
                          <td className="px-4 py-3 text-center text-gray-600">{a.school_count}</td>
                          <td className="px-4 py-3 text-center text-gray-600">{a.vehicle_count}</td>
                          <td className={`px-4 py-3 text-center font-medium ${kpiColor(a.morning_kpi)}`}>
                            {safePct(a.morning_kpi)}
                            <p className="text-xs text-gray-400 font-normal">{a.morning_done}/{a.morning_expected}</p>
                          </td>
                          <td className={`px-4 py-3 text-center font-medium ${kpiColor(a.evening_kpi)}`}>
                            {safePct(a.evening_kpi)}
                            <p className="text-xs text-gray-400 font-normal">{a.evening_done}/{a.evening_expected}</p>
                          </td>
                          <td className="px-4 py-3 text-center text-gray-600">
                            {a.schools_at_100}/{a.school_count}
                          </td>
                          <td className="px-4 py-3 text-center text-gray-600">
                            {a.vehicles_at_100}/{a.vehicle_count}
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
            </section>
          )}

          {/* ── 5. Top / Bottom เขตพื้นที่ ──────────────────── */}
          {affs.length > 1 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">จัดอันดับเขตพื้นที่</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AffRankingCard title="เขตพื้นที่ผลงานดีที่สุด" items={topN(affs, 'morning_kpi', 3)} />
                <AffRankingCard title="เขตพื้นที่ที่ควรเฝ้าระวัง" items={bottomN(affs, 'morning_kpi', 3)} />
              </div>
            </section>
          )}

          {/* ── 6. Drill-down by Affiliation ────────────────── */}
          {affs.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">รายละเอียดรายเขตพื้นที่</h2>
              <div className="grid gap-4">
                {sortByKpi(affs).map((a) => {
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
                        <DashboardCard label="ร.ร./รถ ครบ 100%"
                          value={`${a.schools_at_100}/${a.vehicles_at_100}`}
                          sub={`ร.ร. ${a.schools_at_100}/${a.school_count} · รถ ${a.vehicles_at_100}/${a.vehicle_count}`}
                          color={a.schools_at_100 === a.school_count ? 'green' : 'yellow'} />
                        <DashboardCard label="เหตุฉุกเฉิน" value={a.emergency_count}
                          sub={a.emergency_count > 0 ? `${a.emergency_count} ครั้ง` : 'ไม่มี'}
                          color={a.emergency_count > 0 ? 'red' : 'gray'} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── 7. Existing School + Vehicle links ─────────── */}
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">เมนูลัด</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'เขตพื้นที่',     to: '/province/affiliations', icon: '🏛️' },
              { label: 'โรงเรียน',       to: '/province/schools',      icon: '🏫' },
              { label: 'รถรับส่ง',       to: '/province/vehicles',     icon: '🚐' },
              { label: 'สถานะวันนี้',    to: '/province/status',       icon: '📋' },
              { label: 'เหตุฉุกเฉิน',   to: '/province/emergencies',  icon: '🚨' },
              { label: 'ค้นหานักเรียน',  to: '/province/students',     icon: '🔍' },
              { label: 'รายงานรายวัน',   to: '/reports/daily',         icon: '📊' },
              { label: 'รายงานรายเดือน', to: '/reports/monthly',       icon: '📈' },
            ].map(({ label, to, icon }) => (
              <button key={to} onClick={() => navigate(to)}
                className="flex items-center gap-2 bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50 rounded-xl px-4 py-3 text-sm text-gray-700 transition">
                <span>{icon}</span> {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AffRankingCard({ title, items }) {
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
              <th className="px-2 py-2 text-left font-medium">เขตพื้นที่</th>
              <th className="px-2 py-2 text-center font-medium">KPI เช้า</th>
              <th className="px-2 py-2 text-center font-medium">KPI เย็น</th>
              <th className="px-2 py-2 text-center font-medium">ครบ100%</th>
              <th className="px-2 py-2 text-center font-medium">ฉุกเฉิน</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {items.map((a, i) => (
              <tr key={a.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-400 text-xs">{i + 1}</td>
                <td className="px-2 py-2 text-gray-700 text-xs">{a.name}</td>
                <td className={`px-2 py-2 text-center text-xs font-medium ${kpiColor(a.morning_kpi ?? 0)}`}>
                  {safePct(a.morning_kpi)}
                </td>
                <td className={`px-2 py-2 text-center text-xs font-medium ${kpiColor(a.evening_kpi ?? 0)}`}>
                  {safePct(a.evening_kpi)}
                </td>
                <td className="px-2 py-2 text-center text-xs text-gray-500">
                  {a.schools_at_100}/{a.school_count}
                </td>
                <td className="px-2 py-2 text-center text-xs text-gray-500">{a.emergency_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
