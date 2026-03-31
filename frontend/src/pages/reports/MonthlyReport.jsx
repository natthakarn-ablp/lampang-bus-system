import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';
import KpiCard from '../../components/KpiCard';
import ExportButtons from '../../components/ExportButtons';
import RankingTable from '../../components/RankingTable';
import { kpiColor, safePct, levelBadge, topN, bottomN, sortByKpi } from '../../utils/kpi';

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

  function resetMonth() {
    setMonth(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).substring(0, 7));
  }

  const bestSchool = data?.schools?.length ? sortByKpi(data.schools)[0] : null;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">

      {/* ── SECTION 1 — Header ─────────────────────────────── */}
      <div className="flex flex-col gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800">รายงานรายเดือน</h1>
          <p className="text-sm text-gray-500 mt-0.5">สรุปผลการดำเนินงานรถรับส่งนักเรียนรายเดือน</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button onClick={resetMonth}
            className="text-sm text-gray-500 hover:text-blue-600 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
            เดือนปัจจุบัน
          </button>
          {data && (
            <div className="sm:ml-auto">
              <ExportButtons queryParams={`date=${month}-01`} filenamePrefix={`report-${month}`} />
            </div>
          )}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>}
      {loading ? <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      : !data ? <p className="text-gray-400 py-10 text-center">ไม่มีข้อมูล</p>
      : (
        <>
          {/* ── SECTION 2 — KPI Cards ──────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            <KpiCard label="KPI ส่งเช้า" pct={data.morning_kpi}
              detail={`${data.total_morning_done}/${data.total_morning_expected} คน`} />
            <KpiCard label="KPI รับเย็น" pct={data.evening_kpi}
              detail={`${data.total_evening_done}/${data.total_evening_expected} คน`} />
            <DashboardCard label="วันครบ 100% ส่งเช้า"
              value={data.days_with_data > 0 ? `${data.days_morning_100}` : '-'}
              sub={data.days_with_data > 0 ? `${data.days_morning_100} วัน จาก ${data.days_with_data} วัน` : 'ไม่มีข้อมูล'}
              color={data.days_morning_100 === data.days_with_data && data.days_with_data > 0 ? 'green' : 'yellow'} />
            <DashboardCard label="วันครบ 100% รับเย็น"
              value={data.days_with_data > 0 ? `${data.days_evening_100}` : '-'}
              sub={data.days_with_data > 0 ? `${data.days_evening_100} วัน จาก ${data.days_with_data} วัน` : 'ไม่มีข้อมูล'}
              color={data.days_evening_100 === data.days_with_data && data.days_with_data > 0 ? 'green' : 'yellow'} />
            <DashboardCard label="เหตุฉุกเฉินรวม" value={data.emergency_count}
              sub={data.emergency_count > 0 ? `${data.emergency_count} ครั้ง ในเดือนนี้` : 'ไม่มีเหตุฉุกเฉิน'}
              color={data.emergency_count > 0 ? 'red' : 'gray'} />
          </div>

          {/* ── SECTION 3 — Executive Summary Box ──────────── */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-blue-800 mb-3">สรุปผู้บริหาร</h2>
            <ul className="text-sm text-blue-700 space-y-1.5 leading-relaxed">
              <li>• เดือนนี้ KPI ส่งเช้าเฉลี่ย <strong className={kpiColor(data.morning_kpi)}>{safePct(data.morning_kpi)}</strong> ({data.total_morning_done}/{data.total_morning_expected} คน-วัน)</li>
              <li>• KPI รับเย็นเฉลี่ย <strong className={kpiColor(data.evening_kpi)}>{safePct(data.evening_kpi)}</strong> ({data.total_evening_done}/{data.total_evening_expected} คน-วัน)</li>
              <li>• มี {data.days_morning_100} วันที่ส่งเช้าครบ 100% และ {data.days_evening_100} วันที่รับเย็นครบ 100% จากทั้งหมด {data.days_with_data} วัน</li>
              {data.emergency_count > 0 && <li>• พบเหตุฉุกเฉิน {data.emergency_count} ครั้ง</li>}
              {bestSchool && <li>• โรงเรียนที่ทำผลงานดีที่สุดคือ <strong>{bestSchool.school_name}</strong> (เช้า {safePct(bestSchool.morning_kpi)} · เย็น {safePct(bestSchool.evening_kpi)})</li>}
              <li>• นักเรียนทั้งหมด {data.total_students} คน · ข้อมูล {data.days_with_data} วัน</li>
            </ul>
          </div>

          {/* ── SECTION 4 — Daily Trend Table ──────────────── */}
          {data.daily_trend?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">แนวโน้มรายวัน</h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm min-w-[650px]">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-left">
                      <th className="px-4 py-3 font-medium">วันที่</th>
                      <th className="px-4 py-3 font-medium text-center">ส่งเช้า %</th>
                      <th className="px-4 py-3 font-medium text-center">รับเย็น %</th>
                      <th className="px-4 py-3 font-medium text-center">ส่งเช้า (คน)</th>
                      <th className="px-4 py-3 font-medium text-center">รับเย็น (คน)</th>
                      <th className="px-4 py-3 font-medium text-center">ฉุกเฉิน</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.daily_trend.map((d) => (
                      <tr key={d.date} className={`hover:bg-gray-50 ${d.morning_pct >= 100 && d.evening_pct >= 100 ? 'bg-green-50/50' : ''}`}>
                        <td className="px-4 py-2.5 text-gray-800">
                          {new Date(d.date).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </td>
                        <td className={`px-4 py-2.5 text-center font-medium ${kpiColor(d.morning_pct)}`}>{safePct(d.morning_pct)}</td>
                        <td className={`px-4 py-2.5 text-center font-medium ${kpiColor(d.evening_pct)}`}>{safePct(d.evening_pct)}</td>
                        <td className="px-4 py-2.5 text-center text-gray-600">{d.morning_done}/{d.morning_expected}</td>
                        <td className="px-4 py-2.5 text-center text-gray-600">{d.evening_done}/{d.evening_expected}</td>
                        <td className="px-4 py-2.5 text-center text-gray-500">-</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── SECTION 5 — School Rankings ─────────────────── */}
          {data.schools?.length > 1 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">จัดอันดับโรงเรียน</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RankingTable title="โรงเรียนผลงานดีที่สุด" items={topN(data.schools, 'morning_kpi')} nameKey="school_name" />
                <RankingTable title="โรงเรียนที่ควรเฝ้าระวัง" items={bottomN(data.schools, 'morning_kpi')} nameKey="school_name" />
              </div>
            </section>
          )}

          {/* ── SECTION 6 — Vehicle Rankings ────────────────── */}
          {data.vehicles?.length > 1 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">จัดอันดับรถรับส่ง</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RankingTable title="รถผลงานดีที่สุด" items={topN(data.vehicles, 'morning_kpi')} nameKey="plate_no" showSchool />
                <RankingTable title="รถที่ควรเฝ้าระวัง" items={bottomN(data.vehicles, 'morning_kpi')} nameKey="plate_no" showSchool />
              </div>
            </section>
          )}

          {/* ── SECTION 7 — Full School Summary ────────────── */}
          {data.schools?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">สรุปตามโรงเรียน</h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-left">
                      <th className="px-4 py-3 font-medium">โรงเรียน</th>
                      <th className="px-4 py-3 font-medium text-center">ส่งเช้า %</th>
                      <th className="px-4 py-3 font-medium text-center">รับเย็น %</th>
                      <th className="px-4 py-3 font-medium text-center">วันครบ 100%</th>
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
                            <p className="text-xs text-gray-400">{s.student_count} คน</p>
                          </td>
                          <td className={`px-4 py-3 text-center font-medium ${kpiColor(s.morning_kpi)}`}>
                            {safePct(s.morning_kpi)}
                            <p className="text-xs text-gray-400 font-normal">{s.total_morning_done}/{s.morning_expected * (s.days_with_data || 1)}</p>
                          </td>
                          <td className={`px-4 py-3 text-center font-medium ${kpiColor(s.evening_kpi)}`}>
                            {safePct(s.evening_kpi)}
                            <p className="text-xs text-gray-400 font-normal">{s.total_evening_done}/{s.evening_expected * (s.days_with_data || 1)}</p>
                          </td>
                          <td className="px-4 py-3 text-center text-gray-600">
                            <p>เช้า {s.days_morning_100}/{s.days_with_data}</p>
                            <p className="text-xs text-gray-400">เย็น {s.days_evening_100}/{s.days_with_data}</p>
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

          {/* ── SECTION 8 — Full Vehicle Summary ───────────── */}
          {data.vehicles?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">สรุปตามรถ</h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm min-w-[750px]">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-left">
                      <th className="px-4 py-3 font-medium">ทะเบียนรถ</th>
                      <th className="px-4 py-3 font-medium">โรงเรียน</th>
                      <th className="px-4 py-3 font-medium text-center">ส่งเช้า %</th>
                      <th className="px-4 py-3 font-medium text-center">รับเย็น %</th>
                      <th className="px-4 py-3 font-medium text-center">วันครบ 100%</th>
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
                          <td className="px-4 py-3 text-gray-600 text-xs">{v.school_names || '-'}</td>
                          <td className={`px-4 py-3 text-center font-medium ${kpiColor(v.morning_kpi)}`}>
                            {safePct(v.morning_kpi)}
                            <p className="text-xs text-gray-400 font-normal">{v.total_morning_done}/{v.student_count * (v.days_with_data || 1)}</p>
                          </td>
                          <td className={`px-4 py-3 text-center font-medium ${kpiColor(v.evening_kpi)}`}>
                            {safePct(v.evening_kpi)}
                            <p className="text-xs text-gray-400 font-normal">{v.total_evening_done}/{v.student_count * (v.days_with_data || 1)}</p>
                          </td>
                          <td className="px-4 py-3 text-center text-gray-500">{v.days_with_data || '-'}</td>
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

          {/* ── SECTION 9 — หมายเหตุ KPI ───────────────────── */}
          <details className="mt-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-500">
            <summary className="px-4 py-3 cursor-pointer font-semibold text-gray-600 hover:text-gray-800 select-none">
              หมายเหตุ KPI
            </summary>
            <div className="px-4 pb-4 pt-1">
              <ul className="space-y-1.5">
                <li><span className="font-medium">KPI ส่งเช้า (%):</span> จำนวนที่ส่งเช้าสำเร็จ ÷ จำนวนที่ต้องส่งเช้าทั้งหมด × 100</li>
                <li><span className="font-medium">KPI รับเย็น (%):</span> จำนวนที่รับเย็นสำเร็จ ÷ จำนวนที่ต้องรับเย็นทั้งหมด × 100</li>
                <li><span className="font-medium">วันครบ 100%:</span> จำนวนวันที่ดำเนินการครบทุกคน</li>
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
