import { useState, useEffect } from 'react';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';

const RESULT_LABEL = { PASSED: 'ผ่าน', FAILED: 'ไม่ผ่าน', NEEDS_FIX: 'ต้องแก้ไข', PENDING: 'รอตรวจ' };
const RESULT_COLOR = { PASSED: 'green', FAILED: 'red', NEEDS_FIX: 'yellow', PENDING: 'gray' };

export default function TransportDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/transport/dashboard')
      .then(r => setData(r.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>;
  if (!data) return <p className="text-gray-400 py-10 text-center">ไม่มีข้อมูล</p>;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800">ภาพรวมตรวจสภาพรถ</h1>
        <p className="text-sm text-gray-500 mt-0.5">สรุปสถานะรถรับส่งนักเรียนทั้งจังหวัด</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <DashboardCard label="รถทั้งหมด" value={data.total_vehicles} color="blue" />
        <DashboardCard label="ตรวจแล้ว" value={data.inspected_count}
          sub={`ยังไม่ตรวจ ${data.not_inspected}`} color={data.not_inspected > 0 ? 'yellow' : 'green'} />
        <DashboardCard label="ประกันใกล้หมด" value={data.expiring_insurance}
          sub="ภายใน 30 วัน" color={data.expiring_insurance > 0 ? 'yellow' : 'green'} />
        <DashboardCard label="ประกันหมดแล้ว" value={data.expired_insurance}
          color={data.expired_insurance > 0 ? 'red' : 'green'} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <DashboardCard label={RESULT_LABEL.PASSED} value={data.passed} color={RESULT_COLOR.PASSED} />
        <DashboardCard label={RESULT_LABEL.FAILED} value={data.failed} color={RESULT_COLOR.FAILED} />
        <DashboardCard label={RESULT_LABEL.NEEDS_FIX} value={data.needs_fix} color={RESULT_COLOR.NEEDS_FIX} />
        <DashboardCard label={RESULT_LABEL.PENDING} value={data.pending} color={RESULT_COLOR.PENDING} />
      </div>
    </div>
  );
}
