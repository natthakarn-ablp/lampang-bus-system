import { useState, useEffect } from 'react';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';
import KpiCard from '../../components/KpiCard';
import ExportButtons from '../../components/ExportButtons';
import RankingTable from '../../components/RankingTable';
import { kpiColor, safePct, levelBadge, topN, bottomN, sortByKpi } from '../../utils/kpi';

export default function SummaryReport() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/reports/summary')
      .then((res) => setData(res.data.data))
      .catch((err) => setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  const schools100 = data?.schools?.filter(s => (s.morning_kpi ?? 0) >= 100 && (s.evening_kpi ?? 0) >= 100).length ?? 0;
  const totalSchools = data?.schools?.length ?? 0;
  const bestSchool = data?.schools?.length ? sortByKpi(data.schools)[0] : null;
  const worstVehicle = data?.vehicles?.length
    ? [...data.vehicles].sort((a, b) => ((a.morning_kpi ?? 0) + (a.evening_kpi ?? 0)) - ((b.morning_kpi ?? 0) + (b.evening_kpi ?? 0)))[0]
    : null;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">

      {/* ── SECTION 1 — Header ─────────────────────────────── */}
      <div className="flex flex-col gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800">สรุปภาพรวม</h1>
          <p className="text-sm text-gray-500 mt-0.5">ภาพรวมผลการดำเนินงานรถรับส่งนักเรียน</p>
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
          {data && (
            <div className="sm:ml-auto">
              <ExportButtons filenamePrefix="summary" />
            </div>
          )}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>}
      {loading ? <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      : !data ? <p className="text-gray-400 py-10 text-center">ไม่มีข้อมูล</p>
      : (
        <>
          {/* ── SECTION 2 — Executive KPI Cards ────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            <KpiCard label="KPI ส่งเช้าภาพรวม" pct={data.morning_kpi}
              detail={`${data.morning_done}/${data.morning_total} คน`} />
            <KpiCard label="KPI รับเย็นภาพรวม" pct={data.evening_kpi}
              detail={`${data.evening_done}/${data.evening_total} คน`} />
            <DashboardCard label="นักเรียนทั้งหมด" value={data.total_students}
              sub={`เช้า ${data.morning_total} · เย็น ${data.evening_total}`} color="blue" />
            <DashboardCard label="รถรับส่งทั้งหมด" value={data.total_vehicles} color="blue" />
            <DashboardCard label="เหตุฉุกเฉิน" value={data.emergency_count}
              sub={data.emergency_count > 0 ? `${data.emergency_count} ครั้ง` : 'ไม่มี'}
              color={data.emergency_count > 0 ? 'red' : 'gray'} />
            <DashboardCard label="โรงเรียนที่ครบ 100%"
              value={totalSchools > 0 ? `${schools100}` : '-'}
              sub={totalSchools > 0 ? `${schools100} แห่ง จาก ${totalSchools} แห่ง` : 'ไม่มีข้อมูล'}
              color={schools100 === totalSchools && totalSchools > 0 ? 'green' : 'yellow'} />
          </div>

          {/* ── SECTION 3 — Executive Insight Box ──────────── */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-blue-800 mb-3">สรุปผู้บริหาร</h2>
            <ul className="text-sm text-blue-700 space-y-1.5 leading-relaxed">
              <li>• วันนี้ KPI ส่งเช้าภาพรวม <strong className={kpiColor(data.morning_kpi)}>{safePct(data.morning_kpi)}</strong> ({data.morning_done}/{data.morning_total} คน)</li>
              <li>• KPI รับเย็นภาพรวม <strong className={kpiColor(data.evening_kpi)}>{safePct(data.evening_kpi)}</strong> ({data.evening_done}/{data.evening_total} คน)</li>
              <li>• มี {schools100} โรงเรียนที่ดำเนินงานครบ 100% จากทั้งหมด {totalSchools} แห่ง</li>
              {data.emergency_count > 0 && <li>• พบเหตุฉุกเฉิน {data.emergency_count} ครั้ง</li>}
              {bestSchool && <li>• โรงเรียนที่มีผลการดำเนินงานดีที่สุดคือ <strong>{bestSchool.school_name}</strong> (เช้า {safePct(bestSchool.morning_kpi)} · เย็น {safePct(bestSchool.evening_kpi)})</li>}
              {worstVehicle && (worstVehicle.morning_kpi ?? 0) < 85 && (
                <li>• รถที่ควรติดตามคือ <strong>{worstVehicle.plate_no}</strong> (เช้า {safePct(worstVehicle.morning_kpi)} · เย็น {safePct(worstVehicle.evening_kpi)})</li>
              )}
            </ul>
          </div>

          {/* ── SECTION 4 — School Rankings ─────────────────── */}
          {data.schools?.length > 1 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">จัดอันดับโรงเรียน</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RankingTable title="โรงเรียนผลงานดีที่สุด" items={topN(data.schools, 'morning_kpi')} nameKey="school_name" />
                <RankingTable title="โรงเรียนที่ควรเฝ้าระวัง" items={bottomN(data.schools, 'morning_kpi')} nameKey="school_name" />
              </div>
            </section>
          )}

          {/* ── SECTION 5 — Vehicle Rankings ────────────────── */}
          {data.vehicles?.length > 1 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">จัดอันดับรถรับส่ง</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RankingTable title="รถผลงานดีที่สุด" items={topN(data.vehicles, 'morning_kpi')} nameKey="plate_no" showSchool />
                <RankingTable title="รถที่ควรเฝ้าระวัง" items={bottomN(data.vehicles, 'morning_kpi')} nameKey="plate_no" showSchool />
              </div>
            </section>
          )}

          {/* ── SECTION 6 — สรุปตามสังกัด ──────────────────── */}
          {data.affiliations?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">สรุปตามสังกัด</h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-left">
                      <th className="px-4 py-3 font-medium">สังกัด</th>
                      <th className="px-4 py-3 font-medium text-center">นักเรียน</th>
                      <th className="px-4 py-3 font-medium text-center">KPI ส่งเช้า</th>
                      <th className="px-4 py-3 font-medium text-center">KPI รับเย็น</th>
                      <th className="px-4 py-3 font-medium text-center">ฉุกเฉิน</th>
                      <th className="px-4 py-3 font-medium text-center">ระดับ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortByKpi(data.affiliations).map((a) => {
                      const badge = levelBadge(a.morning_kpi, a.evening_kpi);
                      return (
                        <tr key={a.affiliation_id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-800">{a.affiliation_name}</td>
                          <td className="px-4 py-3 text-center text-gray-600">{a.student_count}</td>
                          <td className={`px-4 py-3 text-center font-medium ${kpiColor(a.morning_kpi)}`}>
                            {safePct(a.morning_kpi)}
                            <p className="text-xs text-gray-400 font-normal">{a.morning_done}/{a.student_count}</p>
                          </td>
                          <td className={`px-4 py-3 text-center font-medium ${kpiColor(a.evening_kpi)}`}>
                            {safePct(a.evening_kpi)}
                            <p className="text-xs text-gray-400 font-normal">{a.evening_done}/{a.student_count}</p>
                          </td>
                          <td className="px-4 py-3 text-center text-gray-500">-</td>
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

          {/* ── SECTION 7 — สรุปตามโรงเรียน ─────────────────── */}
          {data.schools?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">สรุปตามโรงเรียน</h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm min-w-[750px]">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-left">
                      <th className="px-4 py-3 font-medium">โรงเรียน</th>
                      <th className="px-4 py-3 font-medium text-center">นักเรียน</th>
                      <th className="px-4 py-3 font-medium text-center">KPI ส่งเช้า</th>
                      <th className="px-4 py-3 font-medium text-center">KPI รับเย็น</th>
                      <th className="px-4 py-3 font-medium text-center">ฉุกเฉิน</th>
                      <th className="px-4 py-3 font-medium text-center">ระดับ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortByKpi(data.schools).map((s) => {
                      const badge = levelBadge(s.morning_kpi, s.evening_kpi);
                      return (
                        <tr key={s.school_id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <p className="text-gray-800 font-medium">{s.school_name}</p>
                          </td>
                          <td className="px-4 py-3 text-center text-gray-600">{s.student_count}</td>
                          <td className={`px-4 py-3 text-center font-medium ${kpiColor(s.morning_kpi)}`}>
                            {safePct(s.morning_kpi)}
                            <p className="text-xs text-gray-400 font-normal">{s.morning_done}/{s.student_count}</p>
                          </td>
                          <td className={`px-4 py-3 text-center font-medium ${kpiColor(s.evening_kpi)}`}>
                            {safePct(s.evening_kpi)}
                            <p className="text-xs text-gray-400 font-normal">{s.evening_done}/{s.student_count}</p>
                          </td>
                          <td className="px-4 py-3 text-center text-gray-500">-</td>
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

          {/* ── SECTION 8 — สรุปตามรถ ───────────────────────── */}
          {data.vehicles?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">สรุปตามรถ</h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm min-w-[750px]">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-left">
                      <th className="px-4 py-3 font-medium">ทะเบียนรถ</th>
                      <th className="px-4 py-3 font-medium text-center">นักเรียน</th>
                      <th className="px-4 py-3 font-medium text-center">KPI ส่งเช้า</th>
                      <th className="px-4 py-3 font-medium text-center">KPI รับเย็น</th>
                      <th className="px-4 py-3 font-medium text-center">ฉุกเฉิน</th>
                      <th className="px-4 py-3 font-medium text-center">ระดับ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortByKpi(data.vehicles).map((v) => {
                      const badge = levelBadge(v.morning_kpi, v.evening_kpi);
                      return (
                        <tr key={v.vehicle_id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <p className="text-gray-800 font-medium">{v.plate_no}</p>
                            <p className="text-xs text-gray-400">{v.student_count} คน</p>
                          </td>
                          <td className="px-4 py-3 text-center text-gray-600">{v.student_count}</td>
                          <td className={`px-4 py-3 text-center font-medium ${kpiColor(v.morning_kpi)}`}>
                            {safePct(v.morning_kpi)}
                            <p className="text-xs text-gray-400 font-normal">{v.morning_done}/{v.student_count}</p>
                          </td>
                          <td className={`px-4 py-3 text-center font-medium ${kpiColor(v.evening_kpi)}`}>
                            {safePct(v.evening_kpi)}
                            <p className="text-xs text-gray-400 font-normal">{v.evening_done}/{v.student_count}</p>
                          </td>
                          <td className="px-4 py-3 text-center text-gray-500">-</td>
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

          {/* ── SECTION 9 — Export Footer ───────────────────── */}
          <ExportButtons filenamePrefix="summary" />

          {/* ── SECTION 10 — หมายเหตุ KPI ──────────────────── */}
          <details className="mt-6 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-500">
            <summary className="px-4 py-3 cursor-pointer font-semibold text-gray-600 hover:text-gray-800 select-none">
              หมายเหตุ KPI
            </summary>
            <div className="px-4 pb-4 pt-1">
              <ul className="space-y-1.5">
                <li><span className="font-medium">KPI ส่งเช้า (%):</span> จำนวนที่ส่งเช้าสำเร็จ ÷ จำนวนที่ต้องส่งเช้าทั้งหมด × 100</li>
                <li><span className="font-medium">KPI รับเย็น (%):</span> จำนวนที่รับเย็นสำเร็จ ÷ จำนวนที่ต้องรับเย็นทั้งหมด × 100</li>
                <li><span className="font-medium">โรงเรียนครบ 100%:</span> โรงเรียนที่ดำเนินการครบตามเป้าหมายทั้งหมดในขอบเขตที่เลือก</li>
                <li>
                  <span className="font-medium">เกณฑ์ระดับ:</span>{' '}
                  <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">ดีมาก</span> = 95–100% ·{' '}
                  <span className="bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-medium">ดี</span> = 85–94.99% ·{' '}
                  <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">เฝ้าระวัง</span> = ต่ำกว่า 85%
                </li>
              </ul>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
