import { useState } from 'react';
import { useToast } from './Toast';
import { useAuth } from '../hooks/useAuth';
import { getGradeScope } from '../utils/authScope';
import usePolicyAction from '../hooks/usePolicyAction';
import api from '../api/axios';

const FORMATS = [
  { key: 'csv',   label: 'CSV',   ext: 'csv',  style: 'bg-success-soft hover:bg-success-soft/80 text-success-ink border-success/20' },
  { key: 'excel', label: 'Excel', ext: 'xlsx', style: 'bg-brand-50 hover:bg-brand-50/80 text-brand-700 border-brand-200' },
  { key: 'pdf',   label: 'PDF',   ext: 'pdf',  style: 'bg-danger-soft hover:bg-danger-soft/80 text-danger-ink border-danger/20' },
];

export default function ExportButtons({
  queryParams = '',
  filenamePrefix = 'report',
  onPdf,
  onBeforeExport,
  basePath = '/api/reports/export',
}) {
  const [downloading, setDownloading] = useState(null);
  const toast = useToast();
  const { user } = useAuth();
  const { runWithPolicy, policyActionDialog } = usePolicyAction();

  // A homeroom teacher's export holds only their own grade (AUD-004). The file
  // leaves the app and gets forwarded, and nothing inside a spreadsheet says it
  // is a partial roster — so the grade goes in the name. Done here rather than
  // at each call site so a report page added later cannot forget it.
  const grade = getGradeScope(user);
  const downloadName = grade ? `${filenamePrefix}-${grade}` : filenamePrefix;

  async function handleExport(fmt) {
    // Call onBeforeExport hook if provided (returns a promise)
    if (onBeforeExport) {
      try {
        await onBeforeExport(fmt.key);
      } catch {
        return; // User cancelled
      }
    }

    try {
      const params = new URLSearchParams(queryParams);
      const reportType = basePath.includes('/monthly') ? 'monthly' : 'daily';
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
      const value = reportType === 'monthly' ? (params.get('month') || today.slice(0, 7)) : (params.get('date') || today);
      const result = await runWithPolicy({
        context: 'report.export', subjectType: 'report_export', subjectId: `${reportType}:${value}:${fmt.key}`,
        claim: {
          report_type: reportType, format: fmt.key,
          date: reportType === 'daily' ? value : null,
          month: reportType === 'monthly' ? value : null,
        },
      }, async (policyToken) => {
        if (fmt.key === 'pdf' && onPdf) {
          if (policyToken) {
            await api.post('/policy-notices/consume-client-action', {
              context: 'report.export', subject_type: 'report_export',
              subject_id: `${reportType}:${value}:${fmt.key}`,
            }, { headers: { 'X-Policy-Action-Token': policyToken } });
          }
          onPdf();
          return { downloaded: true };
        }
        setDownloading(fmt.key);
        const accessToken = localStorage.getItem('access_token');
        const sep = queryParams ? '?' : '';
        const url = `${basePath}/${fmt.key}${sep}${queryParams}`;
        const headers = { Authorization: `Bearer ${accessToken}` };
        if (policyToken) headers['X-Policy-Action-Token'] = policyToken;
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${downloadName}.${fmt.ext}`;
        a.click();
        URL.revokeObjectURL(a.href);
        return { downloaded: true };
      });
      if (!result?.cancelled) toast.success(`ดาวน์โหลด ${fmt.label} สำเร็จ`);
    } catch {
      toast.error(`ดาวน์โหลด ${fmt.label} ล้มเหลว`);
    } finally {
      setDownloading(null);
    }
  }

  return (<>
    <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-surface-border">
      <span className="text-sm text-ink-muted">ดาวน์โหลด:</span>
      {FORMATS.map((fmt) => (
        <button
          key={fmt.key}
          onClick={() => handleExport(fmt)}
          disabled={downloading !== null}
          className={`focus-ring inline-flex items-center justify-center px-4 min-h-[44px] text-sm border rounded-lg transition disabled:opacity-50 disabled:pointer-events-none ${fmt.style}`}
        >
          {downloading === fmt.key ? 'กำลังดาวน์โหลด…' : fmt.label}
        </button>
      ))}
    </div>
    {policyActionDialog}
  </>);
}
