import { useState, useEffect } from 'react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import DashboardCard from '../../components/DashboardCard';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import SchoolReportDialog from './SchoolReportDialog';

const number = new Intl.NumberFormat('th-TH');
const metrics = [
  { key: 'total_schools', testId: 'total-schools', label: 'โรงเรียน', unit: 'แห่ง' },
  { key: 'total_students', testId: 'total-students', label: 'นักเรียน', unit: 'คน' },
  { key: 'total_vehicles', testId: 'total-vehicles', label: 'รถรับส่ง', unit: 'คัน' },
];

export default function SchoolList() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  const schools = report?.schools || [];

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setReport(null);
    api.get('/affiliation/schools/report')
      .then((res) => {
        const data = res.data.data;
        if (!data || !Array.isArray(data.schools) || !data.summary) throw new Error('Invalid report');
        if (active) setReport(data);
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  async function exportExcel() {
    if (!report || exporting) return;
    setExporting(true);
    setExportError('');
    setExportMessage('');
    try {
      const response = await api.get('/affiliation/schools/report/excel', { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
      link.href = url;
      link.download = `affiliation-schools-${date}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage('ดาวน์โหลด Excel สำเร็จ');
    } catch {
      setExportError('ดาวน์โหลด Excel ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto">
      <PageHeader
        title="โรงเรียนในสังกัด"
        subtitle="โรงเรียนที่อยู่ในความดูแลของสังกัดนี้"
        actions={(
          <section aria-label="สรุปโรงเรียนในสังกัด" aria-busy={loading}
            className="w-[min(25rem,calc(100vw-3rem))] rounded-xl border border-brand-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-brand-800 mb-3">สรุปโรงเรียนในสังกัด</h2>
            <dl className="grid grid-cols-3 gap-3">
              {metrics.map((metric) => (
                <div key={metric.key}>
                  <dt className="text-xs text-ink-muted">{metric.label} ({metric.unit})</dt>
                  <dd data-testid={metric.testId} className="text-xl font-bold text-brand-700 tabular-nums mt-1">
                    {report ? number.format(report.summary[metric.key]) : '–'}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-ink-muted mt-2">รถรวมนับไม่ซ้ำ แม้รับส่งหลายโรงเรียน</p>
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={() => setReportOpen(true)} disabled={!report || loading}
                className="focus-ring min-h-11 flex-1 rounded-lg border border-brand-200 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50 disabled:cursor-not-allowed">
                ดูรายงาน
              </button>
              <button type="button" onClick={exportExcel} disabled={!report || loading || exporting}
                className="focus-ring min-h-11 flex-1 rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed">
                {exporting ? 'กำลังดาวน์โหลด…' : 'ส่งออก Excel'}
              </button>
            </div>
          </section>
        )}
      />

      {exportError && <ErrorState title="ส่งออกไม่สำเร็จ" message={exportError} className="mb-4" />}
      {exportMessage && <p role="status" className="mb-4 text-sm text-success">{exportMessage}</p>}
      {reportOpen && report && <SchoolReportDialog report={report} onClose={() => setReportOpen(false)} />}
      {error && <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} className="mb-4" />}

      {loading ? (
        <LoadingState />
      ) : error ? null : schools.length === 0 ? (
        <EmptyState title="ยังไม่มีโรงเรียนในสังกัด" />
      ) : (
        <div className="grid gap-4">
          {schools.map((school) => (
            <div key={school.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-800 mb-3">{school.name}</h3>
              <div className="grid grid-cols-2 gap-3">
                <DashboardCard label="นักเรียน" value={number.format(school.student_count)} color="blue" />
                <DashboardCard label="รถรับส่ง" value={number.format(school.vehicle_count)} color="blue" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
