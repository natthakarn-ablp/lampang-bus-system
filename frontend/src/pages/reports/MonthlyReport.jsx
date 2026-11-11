import { useState, useEffect, useCallback } from 'react';
import { FileBarChart, Sunrise, Sunset, CalendarCheck, Siren } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../hooks/useAuth';
import { FormField, DataTable } from '../../components/ui';
import { StatTile, StatGrid, TravelLeaveSummary } from '../../components/dashboard';
import ExportButtons from '../../components/ExportButtons';
import RankingTable from '../../components/RankingTable';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import StatusBadge from '../../components/ui/StatusBadge';
import { kpiColor, safePct, levelBadge, topN, bottomN, sortByKpi } from '../../utils/kpi';
import { ReportHero, ReportSection, ExportPanel, reportScopeName } from '../../components/reports/ReportParts';
import { formatThaiCalendarDate } from '../../utils/thaiTime';

const MONTH_BE_ID = 'monthly-report-month-be';

// A KPI tile is calm unless the number is notably good or below the 85% line.
const pctTone = v => (v == null || !isFinite(v) ? 'calm' : v >= 95 ? 'success' : v >= 85 ? 'calm' : 'warn');
const pctText = v => (v == null || !isFinite(v) ? '—' : `${Number(v).toFixed(1)}%`);
// Days already past are never red: a gap is something to look at, not an alarm.
// Plain-sentence figures: amber when under the 85% line, never red.
const sumCls = v => (v == null || !isFinite(v) || v >= 85 ? 'text-ink' : 'text-warn-ink');
const barCls = v => (v >= 95 ? 'bg-success' : 'bg-warn');

/** One round of one day: label, bar, percentage and count. */
function DayBar({ label, pct, count }) {
  const v = pct == null || !isFinite(pct) ? null : Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="w-9 shrink-0 text-sm text-ink-muted">{label}</span>
      <div className="flex-1 h-3 rounded-full bg-surface overflow-hidden" role="img"
        aria-label={`${label} ${v == null ? 'ไม่มีข้อมูล' : `${Math.round(v)}%`}`}>
        {v != null && <div className={`h-full rounded-full ${barCls(v)}`} style={{ width: `${v}%` }} />}
      </div>
      <span className="w-28 shrink-0 text-right text-sm tabular-nums text-ink">
        <span className="font-semibold">{v == null ? '—' : `${Math.round(v)}%`}</span>
        <span className="text-ink-muted"> {count}</span>
      </span>
    </div>
  );
}

/** Per-day trend as bars: easy to scan down the month, stacks on a phone. */
function DailyTrendList({ rows }) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <ul className="divide-y divide-surface-border rounded-2xl border border-surface-border bg-surface-raised overflow-hidden">
      {sorted.map(d => (
        <li key={d.date} className="px-4 py-2.5 grid grid-cols-1 sm:grid-cols-[8rem_1fr_1fr] gap-x-4 gap-y-1 sm:items-center">
          <span className="font-semibold text-ink">
            {new Date(d.date).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
          <DayBar label="เช้า" pct={d.morning_pct} count={`${d.morning_done}/${d.morning_expected}`} />
          <DayBar label="เย็น" pct={d.evening_pct} count={`${d.evening_done}/${d.evening_expected}`} />
        </li>
      ))}
    </ul>
  );
}

function WeeklyTrend({ trend }) {
  const weeks = [];
  const sorted = [...trend].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < sorted.length; i += 7) {
    const chunk = sorted.slice(i, i + 7);
    const avg = k => Math.round(chunk.reduce((s, d) => s + (d[k] || 0), 0) / chunk.length);
    weeks.push({ label: `สัปดาห์ ${weeks.length + 1}`, days: chunk.length, mAvg: avg('morning_pct'), eAvg: avg('evening_pct') });
  }
  if (weeks.length < 2) return null;
  return (
    <ReportSection title="แนวโน้มรายสัปดาห์" hint="ค่าเฉลี่ยของแต่ละสัปดาห์ ยิ่งแถบเต็มยิ่งดี">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {weeks.map(w => (
          <div key={w.label} className="bg-surface-raised rounded-2xl border border-surface-border p-4">
            <p className="text-sm font-semibold text-ink mb-2">{w.label} <span className="font-normal text-ink-muted">({w.days} วัน)</span></p>
            <div className="space-y-2">
              {[['เช้า', w.mAvg], ['เย็น', w.eAvg]].map(([name, v]) => (
                <div key={name}>
                  <div className="flex justify-between text-sm mb-0.5">
                    <span className="text-ink-muted">{name}</span>
                    <span className={`font-bold tabular-nums ${v >= 95 ? 'text-success-ink' : 'text-warn-ink'}`}>{v}%</span>
                  </div>
                  <div className="w-full bg-surface rounded-full h-2.5">
                    <div className={`h-2.5 rounded-full ${barCls(v)}`} style={{ width: `${v}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ReportSection>
  );
}

export default function MonthlyReport() {
  const { user } = useAuth();
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
    <div className="p-3 sm:p-6 max-w-6xl mx-auto">
      <ReportHero eyebrow="รายงานรายเดือน" title={reportScopeName(user, data)}
        subtitle={month ? new Date(month + '-01').toLocaleDateString('th-TH', { year: 'numeric', month: 'long' }) : ''}>
        <div>
          <div className="flex items-end gap-2">
            <FormField label="เดือนของรายงาน" labelClassName="text-navy-200">
              {ctl => (
                <input {...ctl} type="month" value={month} onChange={(e) => setMonth(e.target.value)}
                  aria-describedby={[ctl['aria-describedby'], MONTH_BE_ID].filter(Boolean).join(' ')}
                  className="focus-ring-inverse w-full border border-navy-500 bg-navy-600 text-white rounded-lg px-3 min-h-[44px] text-base sm:text-sm" />
              )}
            </FormField>
            <button onClick={resetMonth}
              className="focus-ring-inverse text-sm text-navy-100 hover:text-white px-3 min-h-[44px] border border-navy-500 rounded-lg hover:bg-navy-600 active:bg-navy-500 transition">
              ปัจจุบัน
            </button>
          </div>
          {/* The native picker shows the device's Gregorian format; echo the month in พ.ศ. */}
          <p id={MONTH_BE_ID} className="mt-1 text-caption text-navy-100">{formatThaiCalendarDate(month)}</p>
        </div>
      </ReportHero>

      {error && <ErrorState message={error} className="mb-4" />}
      {loading ? <LoadingState />
      : !data ? <EmptyState icon={FileBarChart} title="ไม่มีข้อมูล" description="ลองเปลี่ยนเดือนอื่น" />
      : (
        <>
          {/* 1. The answer in plain sentences */}
          <section className="rounded-2xl border border-surface-border bg-surface-raised p-4 sm:p-5 mb-5" aria-label="สรุปประจำเดือน">
            <h2 className="text-lg font-bold text-ink">สรุปประจำเดือน</h2>
            <ul className="mt-2 text-base text-ink space-y-1.5 leading-relaxed">
              <li>ส่งเช้าสำเร็จเฉลี่ย <strong className={sumCls(data.morning_kpi)}>{safePct(data.morning_kpi)}</strong> ({data.total_morning_done}/{data.total_morning_expected} คน-วัน)</li>
              <li>รับเย็นสำเร็จเฉลี่ย <strong className={sumCls(data.evening_kpi)}>{safePct(data.evening_kpi)}</strong> ({data.total_evening_done}/{data.total_evening_expected} คน-วัน)</li>
              <li>ครบ 100% ส่งเช้า {data.days_morning_100} วัน และรับเย็น {data.days_evening_100} วัน จากทั้งหมด {data.days_with_data} วัน</li>
              {data.emergency_count > 0 && <li className="text-danger-ink font-semibold">พบเหตุฉุกเฉิน {data.emergency_count} ครั้ง</li>}
              {bestSchool && data.schools.length > 1 && (
                <li>โรงเรียนที่ผลดีที่สุด: <strong>{bestSchool.school_name}</strong> (เช้า {safePct(bestSchool.morning_kpi)} · เย็น {safePct(bestSchool.evening_kpi)})</li>
              )}
              <li className="text-ink-muted">นักเรียนทั้งหมด {data.total_students} คน · มีข้อมูล {data.days_with_data} วัน</li>
            </ul>
          </section>

          {/* 2. Key numbers */}
          <StatGrid cols={4} label="ตัวเลขสำคัญของเดือน" className="mb-5">
            <StatTile icon={Sunrise} label="ส่งเช้าสำเร็จ" value={pctText(data.morning_kpi)} tone={pctTone(data.morning_kpi)}
              sub={`${data.total_morning_done}/${data.total_morning_expected} คน-วัน`} />
            <StatTile icon={Sunset} label="รับเย็นสำเร็จ" value={pctText(data.evening_kpi)} tone={pctTone(data.evening_kpi)}
              sub={`${data.total_evening_done}/${data.total_evening_expected} คน-วัน`} />
            <StatTile icon={CalendarCheck} label="วันที่ครบ 100%"
              value={data.days_with_data > 0 ? `${data.days_morning_100} / ${data.days_evening_100}` : '—'}
              sub={data.days_with_data > 0 ? `เช้า / เย็น จาก ${data.days_with_data} วัน` : 'ไม่มีข้อมูล'} />
            <StatTile icon={Siren} label="เหตุฉุกเฉิน" value={data.emergency_count} unit="ครั้ง"
              tone={data.emergency_count > 0 ? 'danger' : 'calm'} sub={data.emergency_count > 0 ? 'ในเดือนนี้' : 'ไม่มีเหตุฉุกเฉิน'} />
          </StatGrid>

          {/* Self-travel / leave: in context, hidden when all 0. */}
          <TravelLeaveSummary data={data} monthly className="mb-6" />

          {/* 3. Trend */}
          {data.daily_trend?.length > 0 && <WeeklyTrend trend={data.daily_trend} />}
          {data.daily_trend?.length > 0 && (
            <ReportSection title="แนวโน้มรายวัน" hint="แถบสีเขียว = ครบเกือบทั้งหมด (95% ขึ้นไป) · สีเหลือง = ยังมีนักเรียนที่ไม่ได้ยืนยัน">
              <DailyTrendList rows={data.daily_trend} />
            </ReportSection>
          )}

          {/* 4. Rankings */}
          {data.schools?.length > 1 && (
            <ReportSection title="จัดอันดับโรงเรียน">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RankingTable title="โรงเรียนผลงานดีที่สุด" items={topN(data.schools, 'morning_kpi')} nameKey="school_name" />
                <RankingTable title="โรงเรียนที่ควรเฝ้าระวัง" items={bottomN(data.schools, 'morning_kpi')} nameKey="school_name" />
              </div>
            </ReportSection>
          )}
          {data.vehicles?.length > 1 && (
            <ReportSection title="จัดอันดับรถรับส่ง">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RankingTable title="รถผลงานดีที่สุด" items={topN(data.vehicles, 'morning_kpi')} nameKey="plate_no" showSchool />
                <RankingTable title="รถที่ควรเฝ้าระวัง" items={bottomN(data.vehicles, 'morning_kpi')} nameKey="plate_no" showSchool />
              </div>
            </ReportSection>
          )}

          {/* 5. Full tables */}
          {data.schools?.length > 0 && (
            <ReportSection title="สรุปตามโรงเรียน">
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
            </ReportSection>
          )}

          {data.vehicles?.length > 0 && (
            <ReportSection title="สรุปตามรถ">
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
            </ReportSection>
          )}

          {/* KPI notes */}
          <details className="mt-2 bg-surface border border-surface-border rounded-2xl text-sm text-ink-muted">
            <summary className="px-4 py-3 min-h-[44px] cursor-pointer font-semibold text-ink select-none">
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

          <ExportPanel note="ไฟล์รายงานของเดือนที่เลือก · CSV และ Excel เปิดในตารางคำนวณ, PDF สำหรับพิมพ์">
            <ExportButtons
              basePath="/api/reports/export/monthly"
              queryParams={`month=${month}`}
              filenamePrefix={`monthly-report-${month}`}
            />
          </ExportPanel>
        </>
      )}
    </div>
  );
}
