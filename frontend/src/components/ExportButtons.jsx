import { useState } from 'react';
import { useToast } from './Toast';

const FORMATS = [
  { key: 'csv',   label: 'CSV',   ext: 'csv',  style: 'bg-green-50 hover:bg-green-100 text-green-700 border-green-200' },
  { key: 'excel', label: 'Excel', ext: 'xlsx', style: 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200' },
  { key: 'pdf',   label: 'PDF',   ext: 'pdf',  style: 'bg-red-50 hover:bg-red-100 text-red-700 border-red-200' },
];

export default function ExportButtons({ queryParams = '', filenamePrefix = 'report' }) {
  const [downloading, setDownloading] = useState(null);
  const toast = useToast();

  async function handleExport(fmt) {
    setDownloading(fmt.key);
    try {
      const token = localStorage.getItem('access_token');
      const sep = queryParams ? '?' : '';
      const url = `/api/reports/export/${fmt.key}${sep}${queryParams}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${filenamePrefix}.${fmt.ext}`;
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
    <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-gray-200">
      <span className="text-sm text-gray-500">ดาวน์โหลด:</span>
      {FORMATS.map((fmt) => (
        <button
          key={fmt.key}
          onClick={() => handleExport(fmt)}
          disabled={downloading !== null}
          className={`px-4 py-2 text-sm border rounded-lg transition disabled:opacity-50 ${fmt.style}`}
        >
          {downloading === fmt.key ? 'กำลังดาวน์โหลด…' : fmt.label}
        </button>
      ))}
    </div>
  );
}
