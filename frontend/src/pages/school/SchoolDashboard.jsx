import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';

export default function SchoolDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/school/dashboard')
      .then((res) => setData(res.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800">ภาพรวมโรงเรียน</h1>
        {data?.school && (
          <p className="text-sm text-gray-500 mt-1">
            {data.school.name}
            {data.school.affiliation_name && (
              <span className="text-gray-400"> · {data.school.affiliation_name}</span>
            )}
          </p>
        )}
        {data?.date && (
          <p className="text-xs text-gray-400 mt-0.5">
            วันที่: {new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            <DashboardCard
              label="นักเรียนทั้งหมด"
              value={data?.total_students ?? 0}
              color="blue"
            />
            <DashboardCard
              label="รถรับส่ง"
              value={data?.total_vehicles ?? 0}
              color="blue"
            />
            <DashboardCard
              label="เหตุฉุกเฉิน (7 วัน)"
              value={data?.recent_emergencies ?? 0}
              color={data?.recent_emergencies > 0 ? 'red' : 'gray'}
            />
          </div>

          {/* Morning/Evening status */}
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            สถานะวันนี้
          </h2>
          <div className="grid grid-cols-2 gap-4 mb-8">
            <DashboardCard
              label="ส่งเช้าแล้ว"
              value={data?.morning_done ?? 0}
              sub={
                (data?.morning_pending ?? 0) === 0
                  ? 'ส่งเช้าครบแล้ว'
                  : `รอ ${data?.morning_pending ?? 0} คน (จาก ${data?.morning_total ?? 0})`
              }
              color={(data?.morning_pending ?? 1) === 0 ? 'green' : 'yellow'}
            />
            <DashboardCard
              label="รับเย็นแล้ว"
              value={data?.evening_done ?? 0}
              sub={
                (data?.evening_pending ?? 0) === 0
                  ? 'รับเย็นครบแล้ว'
                  : `รอ ${data?.evening_pending ?? 0} คน (จาก ${data?.evening_total ?? 0})`
              }
              color={(data?.evening_pending ?? 1) === 0 ? 'green' : 'yellow'}
            />
          </div>

          {/* Quick links */}
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            เมนูลัด
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'ค้นหานักเรียน', to: '/school/students', icon: '🔍' },
              { label: 'รถรับส่ง', to: '/school/vehicles', icon: '🚐' },
              { label: 'สถานะวันนี้', to: '/school/status', icon: '📋' },
              { label: 'เหตุฉุกเฉิน', to: '/school/emergencies', icon: '🚨' },
            ].map(({ label, to, icon }) => (
              <button
                key={to}
                onClick={() => navigate(to)}
                className="flex items-center gap-2 bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50 rounded-xl px-4 py-3 text-sm text-gray-700 transition"
              >
                <span>{icon}</span> {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
