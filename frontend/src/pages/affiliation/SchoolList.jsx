import { useState, useEffect } from 'react';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';

export default function SchoolList() {
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/affiliation/schools')
      .then((res) => setSchools(res.data.data))
      .catch((err) => setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-4">โรงเรียนในสังกัด</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : schools.length === 0 ? (
        <p className="text-gray-400 py-10 text-center">ไม่มีโรงเรียนในสังกัด</p>
      ) : (
        <div className="grid gap-4">
          {schools.map((s) => (
            <div
              key={s.id}
              className="bg-white rounded-xl border border-gray-200 p-5"
            >
              <h3 className="font-semibold text-gray-800 mb-3">{s.name}</h3>
              <div className="grid grid-cols-2 gap-3">
                <DashboardCard label="นักเรียน" value={s.student_count} color="blue" />
                <DashboardCard label="รถรับส่ง" value={s.vehicle_count} color="blue" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
