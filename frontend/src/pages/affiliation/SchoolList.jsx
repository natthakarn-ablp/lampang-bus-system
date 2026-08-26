import { useState, useEffect } from 'react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import DashboardCard from '../../components/DashboardCard';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';

export default function SchoolList() {
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/affiliation/schools')
      .then((res) => setSchools(Array.isArray(res.data.data) ? res.data.data : []))
      .catch((err) => setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto">
      <PageHeader title="โรงเรียนในสังกัด" subtitle="โรงเรียนที่อยู่ในความดูแลของสังกัดนี้" />

      {error && <ErrorState message={error} className="mb-4" />}

      {loading ? (
        <LoadingState />
      ) : schools.length === 0 ? (
        <EmptyState title="ยังไม่มีโรงเรียนในสังกัด" />
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
