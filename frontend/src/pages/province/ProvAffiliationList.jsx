import { useState, useEffect } from 'react';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';

export default function ProvAffiliationList() {
  const [affiliations, setAffiliations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/province/affiliations')
      .then((res) => setAffiliations(res.data.data))
      .catch((err) => setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-4">เขตพื้นที่ทั้งหมด</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : affiliations.length === 0 ? (
        <p className="text-gray-400 py-10 text-center">ไม่มีเขตพื้นที่</p>
      ) : (
        <div className="grid gap-4">
          {affiliations.map((a) => (
            <div key={a.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-800 mb-3">{a.name}</h3>
              <div className="grid grid-cols-3 gap-3">
                <DashboardCard label="โรงเรียน" value={a.school_count} color="blue" />
                <DashboardCard label="นักเรียน" value={a.student_count} color="blue" />
                <DashboardCard label="รถรับส่ง" value={a.vehicle_count} color="blue" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
