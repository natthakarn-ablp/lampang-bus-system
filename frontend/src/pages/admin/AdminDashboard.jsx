import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [users, setUsers] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/province/dashboard').then(r => r.data.data).catch(() => null),
      api.get('/admin/users?per_page=5&is_active=false').then(r => r.data).catch(() => null),
    ])
      .then(([dash, u]) => { setData(dash); setUsers(u); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-400 py-10 text-center text-lg">กำลังโหลด…</p>;

  const totalUsers = users?.meta?.total ?? 0;
  const inactiveUsers = users?.data?.length ?? 0;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-800">ศูนย์ควบคุมระบบ</h1>
        <p className="text-sm text-gray-500">ภาพรวมระบบรถรับส่งนักเรียนจังหวัดลำปาง</p>
      </div>

      {/* ── 1. System Status Alert ── */}
      {(() => {
        const issues = [];
        if (data?.morning_pending > 0) issues.push(`รอส่งเช้า ${data.morning_pending} คน`);
        if (data?.evening_pending > 0) issues.push(`รอรับเย็น ${data.evening_pending} คน`);
        if (data?.recent_emergencies > 0) issues.push(`เหตุฉุกเฉิน ${data.recent_emergencies} ครั้ง`);

        return issues.length > 0 ? (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 mb-6">
            <p className="text-base font-bold text-amber-800 mb-2">⚠️ สิ่งที่ต้องติดตามวันนี้</p>
            <ul className="text-sm text-amber-700 space-y-1">
              {issues.map((msg, i) => <li key={i}>• {msg}</li>)}
            </ul>
          </div>
        ) : (
          <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-4 mb-6 text-center">
            <p className="text-lg font-bold text-green-700">✅ ระบบปกติ ไม่มีสิ่งที่ต้องติดตามเร่งด่วน</p>
          </div>
        );
      })()}

      {/* ── 2. Quick Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatBox icon="🚌" label="รถรับส่ง" value={data?.total_vehicles ?? '-'} color="blue" />
        <StatBox icon="👨‍🎓" label="นักเรียน" value={data?.total_students ?? '-'} color="blue" />
        <StatBox icon="🏫" label="โรงเรียน" value={data?.total_schools ?? '-'} color="blue" />
        <StatBox icon="👤" label="ผู้ใช้งาน" value={totalUsers || '-'} color="blue" />
      </div>

      {/* ── 3. Admin Quick Actions ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <ActionCard icon="👤" title="จัดการผู้ใช้งาน" desc="สร้าง แก้ไข รีเซ็ตรหัสผ่าน"
          onClick={() => navigate('/admin/users')} color="blue" />
        <ActionCard icon="📋" title="ประวัติการใช้งาน" desc="ตรวจสอบ audit log ทั้งระบบ"
          onClick={() => navigate('/admin/audit-logs')} color="gray" />
        <ActionCard icon="🏫" title="จัดการโรงเรียน" desc="ข้อมูลนักเรียน รถ ของโรงเรียน"
          onClick={() => navigate('/school')} color="green" />
        <ActionCard icon="🔧" title="ตรวจสภาพรถ" desc="ดูสถานะและบันทึกตรวจ"
          onClick={() => navigate('/transport')} color="amber" />
      </div>

      {/* ── 4. System Overview ── */}
      {data && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-base font-bold text-gray-700 mb-3">สรุประบบวันนี้</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500 mb-1">ส่งเช้า</p>
              <ProgressMini done={data.morning_done} total={data.morning_total} />
            </div>
            <div>
              <p className="text-gray-500 mb-1">รับเย็น</p>
              <ProgressMini done={data.evening_done} total={data.evening_total} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ icon, label, value, color }) {
  const bg = { blue: 'bg-blue-50 border-blue-200', green: 'bg-green-50 border-green-200', amber: 'bg-amber-50 border-amber-200' };
  const text = { blue: 'text-blue-700', green: 'text-green-700', amber: 'text-amber-700' };
  return (
    <div className={`rounded-xl border-2 p-4 text-center ${bg[color] || bg.blue}`}>
      <p className="text-2xl mb-1">{icon}</p>
      <p className={`text-2xl font-bold ${text[color] || text.blue}`}>{value}</p>
      <p className="text-sm text-gray-600">{label}</p>
    </div>
  );
}

function ActionCard({ icon, title, desc, onClick, color }) {
  const border = { blue: 'hover:border-blue-300', green: 'hover:border-green-300', amber: 'hover:border-amber-300', gray: 'hover:border-gray-300' };
  return (
    <button onClick={onClick}
      className={`bg-white rounded-xl border-2 border-gray-200 p-4 text-left transition hover:shadow-sm ${border[color] || ''}`}>
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className="font-bold text-gray-800">{title}</p>
          <p className="text-sm text-gray-500">{desc}</p>
        </div>
      </div>
    </button>
  );
}

function ProgressMini({ done, total }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="font-medium text-gray-700">{done}/{total} คน</span>
        <span className={`font-bold ${pct === 100 ? 'text-green-600' : 'text-amber-600'}`}>{pct}%</span>
      </div>
      <div className="flex w-full h-3 rounded-full overflow-hidden bg-gray-100">
        <div className="bg-green-500 h-full" style={{ width: `${pct}%` }} />
        {pct < 100 && <div className="bg-red-300 h-full" style={{ width: `${100 - pct}%` }} />}
      </div>
    </div>
  );
}
