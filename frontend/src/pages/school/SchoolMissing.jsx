import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';

const POLL_INTERVAL = 30_000;

export default function SchoolMissing() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState('morning');

  const fetch = useCallback(async () => {
    try {
      const res = await api.get(`/school/missing?session=${session}`);
      setData(res.data.data);
    } catch {} finally { setLoading(false); }
  }, [session]);

  useEffect(() => {
    setLoading(true);
    fetch();
    const t = setInterval(fetch, POLL_INTERVAL);
    return () => clearInterval(t);
  }, [fetch]);

  const students = data?.students ?? [];
  // Group by vehicle
  const grouped = {};
  for (const s of students) {
    const key = s.plate_no || 'ไม่มีรถ';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(s);
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">นักเรียนที่ยังไม่ได้ดำเนินการ</h1>
          <p className="text-xs text-gray-400">รีเฟรชทุก 30 วินาที</p>
        </div>
        <div className="flex gap-2">
          {['morning', 'evening'].map(s => (
            <button key={s} onClick={() => setSession(s)}
              className={`px-4 py-2 text-sm rounded-lg transition ${session === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {s === 'morning' ? 'รอบเช้า' : 'รอบเย็น'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : students.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-green-600 text-lg font-medium">ดำเนินการครบแล้ว</p>
          <p className="text-gray-400 text-sm mt-1">ไม่มีนักเรียนค้างอยู่ในรอบนี้</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-red-600 font-medium">ยังไม่ได้ดำเนินการ {students.length} คน</p>
          {Object.entries(grouped).map(([plate, list]) => (
            <div key={plate} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">{plate}</span>
                <span className="text-xs text-gray-400">{list.length} คน</span>
              </div>
              <div className="divide-y divide-gray-50">
                {list.map(s => (
                  <div key={s.id} className="px-5 py-2.5 text-sm flex items-center justify-between">
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
