import { useState, useEffect, useCallback } from 'react';
import { FileBarChart } from 'lucide-react';
import api from '../../api/axios';
import { FormField, DataTable } from '../../components/ui';
import DashboardCard from '../../components/DashboardCard';
import KpiCard from '../../components/KpiCard';
import ExportButtons from '../../components/ExportButtons';
import RankingTable from '../../components/RankingTable';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import AppCard from '../../components/ui/AppCard';
import StatusBadge from '../../components/ui/StatusBadge';
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

      {/* ── HEADER ── */}
      <div className="bg-navy-700 text-white rounded-xl px-5 py-4 mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-caption text-navy-200 uppercase tracking-wider">รายงานรายเดือน</p>
            <h1 className="text-lg font-bold">ระบบรถรับส่งนักเรียนจังหวัดลำปาง</h1>
            <p className="text-sm text-navy-200 mt-0.5">
              {month ? new Date(month + '-01').toLocaleDateString('th-TH', { year: 'numeric', month: 'long' }) : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <FormField label="เดือนของรายงาน" labelClassName="text-navy-200">
              {ctl => (
                <input {...ctl} type="month" value={month} onChange={(e) => setMonth(e.target.value)}
                  className="focus-ring-inverse w-full border border-navy-500 bg-navy-600 text-white rounded-lg px-3 min-h-[44px] text-base sm:text-sm" />
              )}
            </FormField>
            <button onClick={resetMonth}
              className="focus-ring-inverse self-end text-sm text-navy-100 hover:text-white px-3 min-h-[44px] border border-navy-500 rounded-lg hover:bg-navy-600 active:bg-navy-500 transition">
              ปัจจุบัน
            </button>
          </div>
        </div>
      </div>

      {error && <ErrorState message={error} className="mb-4" />}
      {loading ? <LoadingState />
      : !data ? <EmptyState icon={FileBarChart} title="ไม่มีข้อมูล" description="ลองเปลี่ยนเดือนอื่น" />
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
          {/* ── Weekly Trend ── */}
          {data.daily_trend?.length > 0 && (() => {
            const weeks = [];
            const sorted = [...data.daily_trend].sort((a, b) => a.date.localeCompare(b.date));
            for (let i = 0; i < sorted.length; i += 7) {
              const chunk = sorted.slice(i, i + 7);
              const mAvg = chunk.length > 0 ? Math.round(chunk.reduce((s, d) => s + (d.morning_pct || 0), 0) / chunk.length) : 0;
              const eAvg = chunk.length > 0 ? Math.round(chunk.reduce((s, d) => s + (d.evening_pct || 0), 0) / chunk.length) : 0;
              weeks.push({ label: `สัปดาห์ ${weeks.length + 1}`, days: chunk.length, mAvg, eAvg });
            }
            return weeks.length > 1 ? (
              <section className="mb-6">
                <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">แนวโน้มรายสัปดาห์</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {weeks.map((w, i) => (
                    <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                      <p className="text-xs font-semibold text-ink-muted mb-2">{w.label}</p>
                      <div className="space-y-2">
                        <div>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-ink-muted">เช้า</span>
                            <span className={`font-bold ${w.mAvg >= 95 ? 'text-success-ink' : w.mAvg >= 80 ? 'text-warn-ink' : 'text-danger-ink'}`}>{w.mAvg}%</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-2.5">
                            <div className={`h-2.5 rounded-full ${w.mAvg >= 95 ? 'bg-green-500' : w.mAvg >= 80 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${w.mAvg}%` }} />
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-ink-muted">เย็น</span>
                            <span className={`font-bold ${w.eAvg >= 95 ? 'text-success-ink' : w.eAvg >= 80 ? 'text-warn-ink' : 'text-danger-ink'}`}>{w.eAvg}%</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-2.5">
                            <div className={`h-2.5 rounded-full ${w.eAvg >= 95 ? 'bg-green-500' : w.eAvg >= 80 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${w.eAvg}%` }} />
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-ink-muted mt-1">{w.days} วัน</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null;
          })()}

          {data.daily_trend?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">แนวโน้มรายวัน</h2>
              <DataTable
                caption="แนวโน้มรายวันตลอดเดือน"
                rows={data.daily_trend}
                rowKey={d => d.date}
                rowClassName={d => (d.morning_pct >= 100 && d.evening_pct >= 100 ? 'bg-success-soft/40' : '')}
                columns={[
                  { key: 'date', header: 'วันที่', primary: true,
                    cell: d => new Date(d.date).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' }) },
                  { key: 'm_pct', header: 'ส่งเช้า %', align: 'center',
                    cell: d => <span className={`font-medium tabular-nums ${kpiColor(d.morning_pct)}`}>{safePct(d.morning_pct)}</span> },
                  { key: 'e_pct', header: 'รับเย็น %', align: 'center',
                    cell: d => <span className={`font-medium tabular-nums ${kpiColor(d.evening_pct)}`}>{safePct(d.evening_pct)}</span> },
                  { key: 'm_cnt', header: 'ส่งเช้า (คน)', numeric: true, cell: d => `${d.morning_done}/${d.morning_expected}` },
                  { key: 'e_cnt', header: 'รับเย็น (คน)', numeric: true, cell: d => `${d.evening_done}/${d.evening_expected}` },
                  { key: 'emergency', header: 'ฉุกเฉิน', align: 'center', cell: () => <span className="text-ink-muted">-</span> },
                ]}
                empty={{ title: 'ไม่มีข้อมูลในเดือนที่เลือก' }}
              />
            </section>
          )}

          {/* ── SECTION 5 — School Rankings ─────────────────── */}
          {data.schools?.length > 1 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">จัดอันดับโรงเรียน</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RankingTable title="โรงเรียนผลงานดีที่สุด" items={topN(data.schools, 'morning_kpi')} nameKey="school_name" />
                <RankingTable title="โรงเรียนที่ควรเฝ้าระวัง" items={bottomN(data.schools, 'morning_kpi')} nameKey="school_name" />
              </div>
            </section>
          )}

          {/* ── SECTION 6 — Vehicle Rankings ────────────────── */}
          {data.vehicles?.length > 1 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">จัดอันดับรถรับส่ง</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RankingTable title="รถผลงานดีที่สุด" items={topN(data.vehicles, 'morning_kpi')} nameKey="plate_no" showSchool />
                <RankingTable title="รถที่ควรเฝ้าระวัง" items={bottomN(data.vehicles, 'morning_kpi')} nameKey="plate_no" showSchool />
              </div>
            </section>
          )}

          {/* ── SECTION 7 — Full School Summary ────────────── */}
          {data.schools?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">สรุปตามโรงเรียน</h2>
              <DataTable
                caption="สรุปผลรายโรงเรียนตลอดเดือน"
                rows={sortByKpi(data.schools)}
                rowKey={s2 => s2.school_id}
                columns={[
                  { key: 'school', header: 'โรงเรียน', primary: true,
                    cell: s2 => (
                      <>
                        <p className="text-ink font-medium">{s2.school_name}</p>
                        <p className="text-caption text-ink-muted tabular-nums">{s2.student_count} คน</p>
                      </>
                    ) },
                  { key: 'm_pct', header: 'ส่งเช้า %', align: 'center',
                    cell: s2 => (
                      <div className={`font-medium ${kpiColor(s2.morning_kpi)}`}>
                        <span className="tabular-nums">{safePct(s2.morning_kpi)}</span>
                        <p className="text-caption text-ink-muted font-normal tabular-nums">{s2.total_morning_done}/{s2.morning_expected * (s2.days_with_data || 1)}</p>
                      </div>
                    ) },
                  { key: 'e_pct', header: 'รับเย็น %', align: 'center',
                    cell: s2 => (
                      <div className={`font-medium ${kpiColor(s2.evening_kpi)}`}>
                        <span className="tabular-nums">{safePct(s2.evening_kpi)}</span>
                        <p className="text-caption text-ink-muted font-normal tabular-nums">{s2.total_evening_done}/{s2.evening_expected * (s2.days_with_data || 1)}</p>
                      </div>
                    ) },
                  { key: 'full_days', header: 'วันครบ 100%', align: 'center',
                    cell: s2 => (
                      <div className="tabular-nums">
                        <p className="text-ink">เช้า {s2.days_morning_100}/{s2.days_with_data}</p>
                        <p className="text-caption text-ink-muted">เย็น {s2.days_evening_100}/{s2.days_with_data}</p>
                      </div>
                    ) },
                  { key: 'emergency', header: 'ฉุกเฉิน', align: 'center', cell: () => <span className="text-ink-muted">-</span> },
                  { key: 'level', header: 'ระดับ', align: 'center', badge: true,
                    cell: s2 => {
                      const b = levelBadge(s2.morning_kpi, s2.evening_kpi);
                      return <StatusBadge variant={b.variant || 'neutral'}>{b.label}</StatusBadge>;
                    } },
                ]}
                empty={{ title: 'ไม่มีข้อมูลโรงเรียนในเดือนที่เลือก' }}
              />
            </section>
          )}

          {/* ── SECTION 8 — Full Vehicle Summary ───────────── */}
          {data.vehicles?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">สรุปตามรถ</h2>
              <DataTable
                caption="สรุปผลรายรถตลอดเดือน"
                rows={sortByKpi(data.vehicles)}
                rowKey={v => v.vehicle_id}
                columns={[
                  { key: 'plate', header: 'ทะเบียนรถ', primary: true,
                    cell: v => (
                      <>
                        <p className="text-ink font-medium">{v.plate_no}</p>
                        <p className="text-caption text-ink-muted tabular-nums">{v.student_count} คน</p>
                      </>
                    ) },
                  { key: 'school', header: 'โรงเรียน', secondary: true, cell: v => v.school_names || '-' },
                  { key: 'm_pct', header: 'ส่งเช้า %', align: 'center',
                    cell: v => <span className={`font-medium tabular-nums ${kpiColor(v.morning_kpi)}`}>{safePct(v.morning_kpi)}</span> },
                  { key: 'e_pct', header: 'รับเย็น %', align: 'center',
                    cell: v => <span className={`font-medium tabular-nums ${kpiColor(v.evening_kpi)}`}>{safePct(v.evening_kpi)}</span> },
                  { key: 'full_days', header: 'วันครบ 100%', align: 'center',
                    cell: v => (
                      <div className="tabular-nums">
                        <p className="text-ink">เช้า {v.days_morning_100}/{v.days_with_data}</p>
                        <p className="text-caption text-ink-muted">เย็น {v.days_evening_100}/{v.days_with_data}</p>
                      </div>
                    ) },
                  { key: 'emergency', header: 'ฉุกเฉิน', align: 'center', cell: () => <span className="text-ink-muted">-</span> },
                  { key: 'level', header: 'ระดับ', align: 'center', badge: true,
                    cell: v => {
                      const b = levelBadge(v.morning_kpi, v.evening_kpi);
                      return <StatusBadge variant={b.variant || 'neutral'}>{b.label}</StatusBadge>;
                    } },
                ]}
                empty={{ title: 'ไม่มีข้อมูลรถในเดือนที่เลือก' }}
              />
            </section>
          )}

          {/* ── SECTION 9 — หมายเหตุ KPI ───────────────────── */}
          <details className="mt-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-ink-muted">
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
                  <StatusBadge variant="success" size="sm">ดีมาก</StatusBadge> = 95–100% ·{' '}
                  <StatusBadge variant="warn"    size="sm">ดี</StatusBadge> = 85–94.99% ·{' '}
                  <StatusBadge variant="danger"  size="sm">เฝ้าระวัง</StatusBadge> = ต่ำกว่า 85%
                </li>
              </ul>
            </div>
          </details>

          {/* ── FOOTER ── */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-gray-200 mt-6">
            <ExportButtons
              basePath="/api/reports/export/monthly"
              queryParams={`month=${month}`}
              filenamePrefix={`monthly-report-${month}`}
            />
            <p className="text-xs text-ink-muted">
              สร้างจากระบบรถรับส่งนักเรียนจังหวัดลำปาง · {new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
