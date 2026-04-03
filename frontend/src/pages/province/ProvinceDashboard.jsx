import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';
import KpiCard from '../../components/KpiCard';
import RankingTable from '../../components/RankingTable';
import { DonutChart, HBarChart, TrendChart } from '../../components/MiniCharts';
import { kpiColor, safePct, levelBadge, topN, bottomN, sortByKpi } from '../../utils/kpi';
import { PAGE_TITLES, CARD_LABELS, CHART_TITLES, SECTION_TITLES, STATUS, UI_MESSAGES, MORNING_SEGMENTS, EVENING_SEGMENTS } from '../../constants/uiLabels';

export default function ProvinceDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/province/dashboard').then(r => r.data.data),
      api.get('/province/trend?days=7').then(r => r.data.data).catch(() => []),
    ])
      .then(([dash, trendData]) => { setData(dash); setTrend(trendData || []); })
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
          <h1 className="text-xl font-bold text-gray-800">{PAGE_TITLES.PROVINCE_DASHBOARD}</h1>
          <p className="text-sm text-gray-500 mt-0.5">สรุปผลดำเนินงานรถรับส่งนักเรียน</p>
        </div>
        {data && (
          <p className="text-xs text-gray-400">
            ข้อมูล ณ {new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">{UI_MESSAGES.LOADING}</p>
      ) : !data ? (
        <p className="text-gray-400 py-10 text-center">{UI_MESSAGES.NO_DATA}</p>
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
            <DashboardCard label={CARD_LABELS.AFFILIATIONS} value={data.total_affiliations} color="blue" />
            <DashboardCard label={CARD_LABELS.SCHOOLS} value={data.total_schools}
              sub={`นักเรียน ${data.total_students} คน`} color="blue" />
            <DashboardCard label={CARD_LABELS.STUDENT_LEAVE} value={data.leave_count ?? 0}
              color={(data.leave_count ?? 0) > 0 ? 'yellow' : 'gray'} />
            <DashboardCard label={CARD_LABELS.EMERGENCY_7D} value={data.recent_emergencies}
              color={data.recent_emergencies > 0 ? 'red' : 'gray'} />
          </div>

          {/* ── Charts Row ── */}
          {data.affiliations?.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs font-semibold text-gray-500 mb-3 text-center">{CHART_TITLES.MORNING_STATUS}</p>
                <DonutChart size={110} thickness={16}
                  label={safePct(data.morning_kpi)} sublabel={STATUS.DONE}
                  segments={MORNING_SEGMENTS(data.morning_done, data.morning_leave ?? 0, data.morning_pending)}
                />
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs font-semibold text-gray-500 mb-3 text-center">{CHART_TITLES.EVENING_STATUS}</p>
                <DonutChart size={110} thickness={16}
                  label={safePct(data.evening_kpi)} sublabel={STATUS.DONE}
                  segments={EVENING_SEGMENTS(data.evening_done, data.evening_leave ?? 0, data.evening_pending)}
                />
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <HBarChart
                  label="KPI เช้าตามสังกัด"
                  items={data.affiliations.map(a => ({
                    label: a.name?.replace(/สำนักงาน(เขตพื้นที่)?/g, '').trim().substring(0, 15) || a.id,
                    value: Math.round(a.morning_kpi || 0),
                    color: (a.morning_kpi || 0) >= 95 ? '#22c55e' : (a.morning_kpi || 0) >= 85 ? '#f59e0b' : '#ef4444',
                  }))}
                  valueLabel="%"
                  maxValue={100}
                />
              </div>
            </div>
          )}

          {/* ── Exception Panel + Weekly Trend ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Exception Panel */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <p className="text-sm font-bold text-gray-800">{SECTION_TITLES.EXCEPTION_PANEL}</p>
              </div>
              {(() => {
                const exceptions = [];
                // Low KPI affiliations
                (data.affiliations || []).forEach(a => {
                  if ((a.morning_kpi ?? 0) < 85) exceptions.push({ type: 'kpi', label: a.name?.replace(/สำนักงาน(เขตพื้นที่)?/g,'').trim(), detail: `KPI เช้า ${safePct(a.morning_kpi)}`, severity: 'high' });
                });
                // High pending
                if (data.morning_pending > 50) exceptions.push({ type: 'pending', label: `รอส่งเช้า ${data.morning_pending} คน`, detail: `จาก ${data.morning_total} คน`, severity: 'medium' });
                if (data.evening_pending > 50) exceptions.push({ type: 'pending', label: `รอรับเย็น ${data.evening_pending} คน`, detail: `จาก ${data.evening_total} คน`, severity: 'medium' });
                // Emergencies
                if (data.recent_emergencies > 0) exceptions.push({ type: 'emergency', label: `เหตุฉุกเฉิน ${data.recent_emergencies} ครั้ง`, detail: '7 วันล่าสุด', severity: data.recent_emergencies > 3 ? 'high' : 'medium' });

                if (exceptions.length === 0) return (
                  <div className="flex items-center gap-2 py-4 text-green-600">
                    <span className="text-lg">✅</span>
                    <span className="text-sm font-medium">{UI_MESSAGES.NO_EXCEPTION}</span>
                  </div>
                );

                return (
                  <div className="space-y-2">
                    {exceptions.slice(0, 5).map((ex, i) => (
                      <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${
                        ex.severity === 'high' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                      }`}>
                        <span className="mt-0.5">{ex.type === 'emergency' ? '🚨' : ex.type === 'kpi' ? '📉' : '⏳'}</span>
                        <div>
                          <p className="font-medium">{ex.label}</p>
                          <p className="opacity-70">{ex.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Weekly Trend */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <TrendChart
                title={SECTION_TITLES.TREND_KPI}
                labels={trend.map(t => {
                  const d = new Date(t.date);
                  return `${d.getDate()}/${d.getMonth()+1}`;
                })}
                series={[
                  { label: 'เช้า %', data: trend.map(t => t.morning_pct), color: '#f97316' },
                  { label: 'เย็น %', data: trend.map(t => t.evening_pct), color: '#6366f1' },
                ]}
                height={160}
              />
            </div>
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
              <li>• มี {data.total_affiliations} สังกัด · {data.total_schools} โรงเรียน · {data.total_students} คน · {data.total_vehicles} คัน</li>
              {bestAff && <li>• สังกัดผลงานดีที่สุดคือ <strong>{bestAff.name}</strong> (เช้า {safePct(bestAff.morning_kpi)} · เย็น {safePct(bestAff.evening_kpi)})</li>}
              {worstAff && (worstAff.morning_kpi ?? 0) < 85 && <li>• สังกัดที่ควรเฝ้าระวังคือ <strong>{worstAff.name}</strong> (เช้า {safePct(worstAff.morning_kpi)} · เย็น {safePct(worstAff.evening_kpi)})</li>}
              {data.recent_emergencies > 0 && <li>• พบเหตุฉุกเฉิน {data.recent_emergencies} ครั้งในรอบ 7 วัน</li>}
            </ul>
          </div>

          {/* ── 4. KPI สังกัด Table ─────────────────────── */}
          {affs.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">KPI รายสังกัด</h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-left">
                      <th className="px-4 py-3 font-medium">สังกัด</th>
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

          {/* ── 5. Top / Bottom สังกัด ──────────────────── */}
          {affs.length > 1 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">จัดอันดับสังกัด</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AffRankingCard title="สังกัดผลงานดีที่สุด" items={topN(affs, 'morning_kpi', 3)} />
                <AffRankingCard title="สังกัดที่ควรเฝ้าระวัง" items={bottomN(affs, 'morning_kpi', 3)} />
              </div>
            </section>
          )}

          {/* ── 6. Drill-down by Affiliation ────────────────── */}
          {affs.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">รายละเอียดรายสังกัด</h2>
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
                        <DashboardCard label={CARD_LABELS.EMERGENCY} value={a.emergency_count}
                          sub={a.emergency_count > 0 ? `${a.emergency_count} ครั้ง` : 'ไม่มี'}
                          color={a.emergency_count > 0 ? 'red' : 'gray'} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

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
        <p className="px-4 py-4 text-xs text-gray-400">{UI_MESSAGES.NO_DATA}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400">
              <th className="px-4 py-2 text-left font-medium">#</th>
              <th className="px-2 py-2 text-left font-medium">สังกัด</th>
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
