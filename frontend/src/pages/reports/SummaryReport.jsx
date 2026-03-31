import { useState, useEffect } from 'react';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';

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

  function handleExport(format) {
    const token = localStorage.getItem('access_token');
    const url = `/api/reports/export/${format}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `summary.${format === 'excel' ? 'xlsx' : format}`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-4">สรุปภาพรวม</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : !data ? (
        <p className="text-gray-400 py-10 text-center">ไม่มีข้อมูล</p>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-4">
            วันที่: {new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            <DashboardCard label="นักเรียนทั้งหมด" value={data.total_students} color="blue" />
            <DashboardCard label="รถรับส่ง" value={data.total_vehicles} color="blue" />
            <DashboardCard
              label="เหตุฉุกเฉินวันนี้"
              value={data.emergency_count}
              color={data.emergency_count > 0 ? 'red' : 'gray'}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <DashboardCard
              label="ส่งเช้าแล้ว"
              value={data.morning_done}
              sub={data.morning_pending === 0 ? 'ครบแล้ว' : `รอ ${data.morning_pending} (จาก ${data.morning_total})`}
              color={data.morning_pending === 0 ? 'green' : 'yellow'}
            />
            <DashboardCard
              label="รับเย็นแล้ว"
              value={data.evening_done}
              sub={data.evening_pending === 0 ? 'ครบแล้ว' : `รอ ${data.evening_pending} (จาก ${data.evening_total})`}
              color={data.evening_pending === 0 ? 'green' : 'yellow'}
            />
          </div>

          {/* Export */}
          <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
            <span className="text-sm text-gray-500">ดาวน์โหลดรายงานวันนี้:</span>
            <button onClick={() => handleExport('csv')}
              className="px-4 py-2 text-sm bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded-lg transition">CSV</button>
            <button onClick={() => handleExport('excel')}
              className="px-4 py-2 text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg transition">Excel</button>
            <button onClick={() => handleExport('pdf')}
              className="px-4 py-2 text-sm bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg transition">PDF</button>
          </div>
        </>
      )}
    </div>
  );
}
