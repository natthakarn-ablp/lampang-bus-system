import { useState } from 'react';
import { useToast } from './Toast';
import { useAuth } from '../hooks/useAuth';
import { getGradeScope } from '../utils/authScope';

const FORMATS = [
  { key: 'csv',   label: 'CSV',   ext: 'csv',  style: 'bg-success-soft hover:bg-success-soft/80 text-success border-success/20' },
  { key: 'excel', label: 'Excel', ext: 'xlsx', style: 'bg-brand-50 hover:bg-brand-50/80 text-brand-700 border-brand-200' },
  { key: 'pdf',   label: 'PDF',   ext: 'pdf',  style: 'bg-danger-soft hover:bg-danger-soft/80 text-danger border-danger/20' },
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

    // Use custom PDF handler if provided
    if (fmt.key === 'pdf' && onPdf) {
      onPdf();
      return;
    }

    setDownloading(fmt.key);
    try {
      const token = localStorage.getItem('access_token');
      const sep = queryParams ? '?' : '';
      const url = `${basePath}/${fmt.key}${sep}${queryParams}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${downloadName}.${fmt.ext}`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`ดาวน์โหลด ${fmt.label} สำเร็จ`);
    } catch {
      toast.error(`ดาวน์โหลด ${fmt.label} ล้มเหลว`);
    } finally {
      setDownloading(null);
    }
  }

  return (
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
  );
}
