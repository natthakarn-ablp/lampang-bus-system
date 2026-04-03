import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';

const POLL_INTERVAL = 30_000;

export default function SchoolMissing() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState('morning');
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get(`/school/missing?session=${session}`);
      setData(res.data.data);
      setLastUpdated(new Date());
    } catch {} finally { setLoading(false); }
  }, [session]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const t = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(t);
  }, [fetchData]);

  const students = data?.students ?? [];
  // Group by vehicle
  const grouped = {};
  for (const s of students) {
    const key = s.plate_no || 'ไม่มีรถ';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(s);
  }
  const vehicleCount = Object.keys(grouped).length;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-800">นักเรียนที่ยังไม่ได้ดำเนินการ</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            รีเฟรชอัตโนมัติทุก 30 วินาที
            {lastUpdated && <> · อัปเดตล่าสุด {lastUpdated.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</>}
          </p>
        </div>
        <div className="flex gap-2">
          {['morning', 'evening'].map(s => (
            <button key={s} onClick={() => setSession(s)}
              className={`px-4 py-2 text-sm rounded-lg transition font-medium ${session === s
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {s === 'morning' ? 'รอบเช้า' : 'รอบเย็น'}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : students.length === 0 ? (
        <div className="text-center py-20">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-50 mb-4">
            <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-green-600 text-lg font-semibold">ดำเนินการครบแล้ว</p>
          <p className="text-gray-400 text-sm mt-1">
            ไม่มีนักเรียนค้างใน{session === 'morning' ? 'รอบเช้า' : 'รอบเย็น'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
            <span className="text-red-600 font-semibold text-sm">ยังไม่ดำเนินการ</span>
            <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{students.length} คน</span>
            <span className="text-red-400 text-xs">จาก {vehicleCount} คัน</span>
          </div>

          {/* Vehicle groups */}
          {Object.entries(grouped).map(([plate, list]) => (
            <div key={plate} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">{plate}</span>
                <span className="bg-red-100 text-red-600 text-xs font-medium px-2 py-0.5 rounded-full">{list.length} คน</span>
              </div>
              <div className="divide-y divide-gray-50">
                {list.map(s => (
                  <div key={s.id} className="px-5 py-3 text-sm flex items-center justify-between">
                    <span className="text-gray-800">{s.student_name}</span>
                    <span className="text-xs text-gray-400">
                      {s.grade && s.classroom ? `${s.grade}/${s.classroom}` : s.grade || '-'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
