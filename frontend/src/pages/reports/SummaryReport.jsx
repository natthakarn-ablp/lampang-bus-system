import { useState, useEffect, useRef } from 'react';
import { FileBarChart } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../hooks/useAuth';
import DashboardCard from '../../components/DashboardCard';
import KpiCard from '../../components/KpiCard';
import ExportButtons from '../../components/ExportButtons';
import RankingTable from '../../components/RankingTable';
import SummaryPrintView from '../../components/SummaryPrintView';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import { AppCard, StatusBadge, DataTable } from '../../components/ui';
import { kpiColor, safePct, levelBadge, topN, bottomN, sortByKpi } from '../../utils/kpi';

export default function SummaryReport() {
  const { user } = useAuth();
  const printRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/reports/summary')
      .then((res) => setData(res.data.data))
      .catch((err) => setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  function handlePrintPdf() {
    if (!printRef.current) return;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<!DOCTYPE html><html><head>
      <meta charset="utf-8">
      <title>รายงานสรุปภาพรวม</title>
      <style>
        @font-face { font-family: 'Sarabun'; src: url('/fonts/Sarabun-Regular.ttf') format('truetype'); font-weight: 400; font-display: swap; }
        @font-face { font-family: 'Sarabun'; src: url('/fonts/Sarabun-Bold.ttf') format('truetype'); font-weight: 700; font-display: swap; }
        @page { size: A4 landscape; margin: 12mm; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Sarabun', 'TH Sarabun New', 'Tahoma', sans-serif; font-size: 16px; color: #1a1a1a; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ccc; padding: 4px 8px; }
        th { background: #f3f4f6; font-weight: bold; }
        .text-center { text-align: center; }
        .text-left { text-align: left; }
        .font-bold { font-weight: bold; }
        .mb-4 { margin-bottom: 16px; }
        .mb-2 { margin-bottom: 8px; }
        .mt-4 { margin-top: 16px; }
        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 12px; margin-bottom: 16px; }
        .header h1 { font-size: 22px; font-weight: bold; }
        .header h2 { font-size: 18px; }
        .header .meta { display: flex; justify-content: space-between; font-size: 11px; color: #666; margin-top: 8px; }
        .section-title { font-size: 16px; font-weight: bold; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 8px; }
        .kpi-table td { padding: 6px 10px; }
        .kpi-table .label { background: #f0f7ff; font-weight: 600; }
        .kpi-table .value { text-align: center; font-weight: bold; font-size: 16px; }
        .footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #999; font-size: 10px; color: #666; display: flex; justify-content: space-between; }
        .page-break { page-break-before: always; }
      </style></head><body>`);
    printWindow.document.write(printRef.current.innerHTML);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
  }

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
            className="focus-ring-inverse text-sm text-navy-100 hover:text-white px-3 min-h-[44px] border border-navy-500 rounded-lg hover:bg-navy-600 active:bg-navy-500 transition">
            รีเฟรชข้อมูล
          </button>
          {data && (
            <div className="sm:ml-auto">
              {/* CSV and Excel here hit the shared /api/reports/export endpoint,
                  which returns the per-student daily roster — not this page's
                  summary. Only PDF renders the summary itself. Naming the file
                  "summary" made the other two look like something they are not,
                  so they carry the date and the report they actually contain.
                  Passing the date explicitly also keeps the file in step with the
                  day this page is showing rather than the server's today. */}
              <ExportButtons
                queryParams={data.date ? `date=${data.date}` : ''}
                filenamePrefix={`report-${data.date || 'today'}`}
                onPdf={handlePrintPdf}
              />
            </div>
          )}
        </div>
      </div>

      {error && <ErrorState message={error} className="mb-4" />}
      {loading ? <LoadingState />
      : !data ? <EmptyState icon={FileBarChart} title="ไม่มีข้อมูล" />
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
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">จัดอันดับโรงเรียน</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RankingTable title="โรงเรียนผลงานดีที่สุด" items={topN(data.schools, 'morning_kpi')} nameKey="school_name" />
                <RankingTable title="โรงเรียนที่ควรเฝ้าระวัง" items={bottomN(data.schools, 'morning_kpi')} nameKey="school_name" />
              </div>
            </section>
          )}

          {/* ── SECTION 5 — Vehicle Rankings ────────────────── */}
          {data.vehicles?.length > 1 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">จัดอันดับรถรับส่ง</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RankingTable title="รถผลงานดีที่สุด" items={topN(data.vehicles, 'morning_kpi')} nameKey="plate_no" showSchool />
                <RankingTable title="รถที่ควรเฝ้าระวัง" items={bottomN(data.vehicles, 'morning_kpi')} nameKey="plate_no" showSchool />
              </div>
            </section>
          )}

          {/* ── SECTION 6 — สรุปตามสังกัด (hidden for affiliation — they see only their own) ── */}
          {data.affiliations?.length > 0 && user?.role !== 'affiliation' && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">สรุปตามสังกัด</h2>
              <DataTable
                caption="สรุป KPI รายสังกัด"
                rows={sortByKpi(data.affiliations)}
                rowKey={(a, i) => a.affiliation_id ?? a.id ?? a.affiliation_name ?? i}
                columns={[
                  { key: 'name', header: 'สังกัด', primary: true,
                    cell: r => <span className="text-ink font-medium">{r.affiliation_name}</span> },
                  { key: 'students', header: 'นักเรียน', numeric: true, cell: r => r.student_count },
                  { key: 'm_pct', header: 'KPI ส่งเช้า', align: 'center',
                    cell: r => (
                      <div className={`font-medium ${kpiColor(r.morning_kpi)}`}>
                        <span className="tabular-nums">{safePct(r.morning_kpi)}</span>
                        <p className="text-caption text-ink-muted font-normal tabular-nums">{r.morning_done}/{r.student_count}</p>
                      </div>
                    ) },
                  { key: 'e_pct', header: 'KPI รับเย็น', align: 'center',
                    cell: r => (
                      <div className={`font-medium ${kpiColor(r.evening_kpi)}`}>
                        <span className="tabular-nums">{safePct(r.evening_kpi)}</span>
                        <p className="text-caption text-ink-muted font-normal tabular-nums">{r.evening_done}/{r.student_count}</p>
                      </div>
                    ) },
                  { key: 'emergency', header: 'ฉุกเฉิน', align: 'center', cell: () => <span className="text-ink-muted">-</span> },
                  { key: 'level', header: 'ระดับ', align: 'center', badge: true,
                    cell: r => {
                      const b = levelBadge(r.morning_kpi, r.evening_kpi);
                      return <StatusBadge variant={b.variant || 'neutral'}>{b.label}</StatusBadge>;
                    } },
                ]}
                empty={{ title: 'ไม่มีข้อมูลสังกัด' }}
              />
            </section>
          )}

          {/* ── SECTION 7 — สรุปตามโรงเรียน ─────────────────── */}
          {data.schools?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">สรุปตามโรงเรียน</h2>
              <DataTable
                caption="สรุป KPI รายโรงเรียน"
                rows={sortByKpi(data.schools)}
                rowKey={(x, i) => x.school_id ?? x.id ?? x.school_name ?? i}
                columns={[
                  { key: 'name', header: 'โรงเรียน', primary: true,
                    cell: r => <span className="text-ink font-medium">{r.school_name}</span> },
                  { key: 'students', header: 'นักเรียน', numeric: true, cell: r => r.student_count },
                  { key: 'm_pct', header: 'KPI ส่งเช้า', align: 'center',
                    cell: r => (
                      <div className={`font-medium ${kpiColor(r.morning_kpi)}`}>
                        <span className="tabular-nums">{safePct(r.morning_kpi)}</span>
                        <p className="text-caption text-ink-muted font-normal tabular-nums">{r.morning_done}/{r.student_count}</p>
                      </div>
                    ) },
                  { key: 'e_pct', header: 'KPI รับเย็น', align: 'center',
                    cell: r => (
                      <div className={`font-medium ${kpiColor(r.evening_kpi)}`}>
                        <span className="tabular-nums">{safePct(r.evening_kpi)}</span>
                        <p className="text-caption text-ink-muted font-normal tabular-nums">{r.evening_done}/{r.student_count}</p>
                      </div>
                    ) },
                  { key: 'emergency', header: 'ฉุกเฉิน', align: 'center', cell: () => <span className="text-ink-muted">-</span> },
                  { key: 'level', header: 'ระดับ', align: 'center', badge: true,
                    cell: r => {
                      const b = levelBadge(r.morning_kpi, r.evening_kpi);
                      return <StatusBadge variant={b.variant || 'neutral'}>{b.label}</StatusBadge>;
                    } },
                ]}
                empty={{ title: 'ไม่มีข้อมูลโรงเรียน' }}
              />
            </section>
          )}

          {/* ── SECTION 8 — สรุปตามรถ ───────────────────────── */}
          {data.vehicles?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">สรุปตามรถ</h2>
              <DataTable
                caption="สรุป KPI รายรถ"
                rows={sortByKpi(data.vehicles)}
                rowKey={(x, i) => x.vehicle_id ?? x.id ?? x.plate_no ?? i}
                columns={[
                  { key: 'plate', header: 'ทะเบียนรถ', primary: true,
                    cell: r => (
                      <>
                        <p className="text-ink font-medium">{r.plate_no}</p>
                        <p className="text-caption text-ink-muted tabular-nums">{r.student_count} คน</p>
                      </>
                    ) },
                  { key: 'students', header: 'นักเรียน', numeric: true, cell: r => r.student_count },
                  { key: 'm_pct', header: 'KPI ส่งเช้า', align: 'center',
                    cell: r => (
                      <div className={`font-medium ${kpiColor(r.morning_kpi)}`}>
                        <span className="tabular-nums">{safePct(r.morning_kpi)}</span>
                        <p className="text-caption text-ink-muted font-normal tabular-nums">{r.morning_done}/{r.student_count}</p>
                      </div>
                    ) },
                  { key: 'e_pct', header: 'KPI รับเย็น', align: 'center',
                    cell: r => (
                      <div className={`font-medium ${kpiColor(r.evening_kpi)}`}>
                        <span className="tabular-nums">{safePct(r.evening_kpi)}</span>
                        <p className="text-caption text-ink-muted font-normal tabular-nums">{r.evening_done}/{r.student_count}</p>
                      </div>
                    ) },
                  { key: 'emergency', header: 'ฉุกเฉิน', align: 'center', cell: () => <span className="text-ink-muted">-</span> },
                  { key: 'level', header: 'ระดับ', align: 'center', badge: true,
                    cell: r => {
                      const b = levelBadge(r.morning_kpi, r.evening_kpi);
                      return <StatusBadge variant={b.variant || 'neutral'}>{b.label}</StatusBadge>;
                    } },
                ]}
                empty={{ title: 'ไม่มีข้อมูลรถ' }}
              />
            </section>
          )}

          {/* ── SECTION 9 — หมายเหตุ KPI ──────────────────── */}
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
                  <StatusBadge variant="success" size="sm">ดีมาก</StatusBadge> = 95–100% ·{' '}
                  <StatusBadge variant="warn"    size="sm">ดี</StatusBadge> = 85–94.99% ·{' '}
                  <StatusBadge variant="danger"  size="sm">เฝ้าระวัง</StatusBadge> = ต่ำกว่า 85%
                </li>
              </ul>
            </div>
          </details>
        </>
      )}

      {/* Hidden print view */}
      <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
        <SummaryPrintView ref={printRef} data={data} user={user} />
      </div>
    </div>
  );
}
