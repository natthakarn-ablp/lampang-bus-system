import { useState, useEffect } from 'react';
import api from '../../api/axios';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';

export default function SystemHealth() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  function refresh() {
    setLoading(true);
    api.get('/admin/system-health')
      .then(r => setData(r.data?.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { refresh(); }, []);

  if (loading) return <LoadingState />;
  if (!data) return <EmptyState title="ยังไม่มีข้อมูล" />;

  const ACTION_TH = { CREATE: 'สร้าง', UPDATE: 'แก้ไข', DELETE: 'ลบ', EXPORT: 'ส่งออก', LOGIN: 'เข้าสู่ระบบ', IMPORT: 'นำเข้า', APPROVE: 'อนุมัติ' };
  const ENTITY_TH = { student: 'นักเรียน', vehicle: 'รถ', checkin: 'เช็กอิน', user: 'ผู้ใช้', leave: 'ลา', roster_request: 'คำขอรายชื่อ', pretrip_checklist: 'ตรวจรถก่อนออก', daily_snapshot: 'Snapshot', password: 'รหัสผ่าน', auth_failure: 'ล็อกอินล้มเหลว', school_notification: 'แจ้งเตือนโรงเรียน', decision_log: 'บันทึกการตัดสินใจ', audit_csv: 'ส่งออก CSV' };

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto pb-10">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-800">สุขภาพระบบ</h1>
          <p className="text-sm text-gray-500">ข้อมูล 30 วันย้อนหลัง</p>
        </div>
        <button onClick={refresh}
          className="text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-4 py-2 rounded-lg transition">
          รีเฟรช
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <HealthKpi label="ผู้ใช้ active (30 วัน)" value={data.active_users_30d} sub={`จาก ${data.total_users} ทั้งหมด`}
          color={data.active_users_30d > 0 ? 'green' : 'red'} />
        <HealthKpi label="เข้าสู่ระบบ (30 วัน)" value={data.logins_30d} color="blue" />
        <HealthKpi label="ล็อกอินล้มเหลว" value={data.login_failures_30d}
          color={data.login_failures_30d > 10 ? 'red' : 'green'} />
        <HealthKpi label="รีเซ็ตรหัสผ่าน" value={data.password_resets_this_month} sub="เดือนนี้" color="amber" />
        <HealthKpi label="Actions ทั้งหมด" value={data.action_breakdown?.reduce((s, a) => s + a.cnt, 0) || 0}
          sub="30 วัน" color="blue" />
      </div>

      {/* Website Visits */}
      {data.visits && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">การเข้าชมเว็บไซต์</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <HealthKpi label="วันนี้" value={data.visits.today.total}
              sub={`สาธารณะ ${data.visits.today.public} · ล็อกอิน ${data.visits.today.logged_in}`}
              color="blue" />
            <HealthKpi label="7 วันล่าสุด" value={data.visits.last_7d.total}
              sub={`สาธารณะ ${data.visits.last_7d.public} · ล็อกอิน ${data.visits.last_7d.logged_in}`}
              color="blue" />
            <HealthKpi label="30 วันล่าสุด" value={data.visits.last_30d.total}
              sub={`สาธารณะ ${data.visits.last_30d.public} · ล็อกอิน ${data.visits.last_30d.logged_in}`}
              color="blue" />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Top Features */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Top 5 ฟีเจอร์ที่ใช้บ่อย</h2>
          <div className="space-y-2">
            {data.top_features?.map((f, i) => (
              <FeatureBar key={f.entity_type} rank={i + 1} label={ENTITY_TH[f.entity_type] || f.entity_type} count={f.cnt}
                max={data.top_features[0]?.cnt || 1} color="bg-green-500" />
            ))}
            {(!data.top_features || data.top_features.length === 0) && (
              <p className="text-sm text-gray-400">ยังไม่มีข้อมูล</p>
            )}
          </div>
        </div>

        {/* Bottom Features */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Bottom 5 ฟีเจอร์ที่ใช้น้อย</h2>
          <div className="space-y-2">
            {data.bottom_features?.map((f, i) => (
              <FeatureBar key={f.entity_type} rank={i + 1} label={ENTITY_TH[f.entity_type] || f.entity_type} count={f.cnt}
                max={data.top_features?.[0]?.cnt || 1} color="bg-gray-400" />
            ))}
            {(!data.bottom_features || data.bottom_features.length === 0) && (
              <p className="text-sm text-gray-400">ยังไม่มีข้อมูล</p>
            )}
          </div>
        </div>
      </div>

      {/* Action Breakdown */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">การใช้งานแยกตามประเภท</h2>
        <div className="flex flex-wrap gap-3">
          {data.action_breakdown?.map(a => (
            <div key={a.action} className="bg-blue-50 rounded-lg px-4 py-2 text-center">
              <p className="text-lg font-semibold text-blue-700">{a.cnt}</p>
              <p className="text-xs text-blue-500">{ACTION_TH[a.action] || a.action}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Role Activity */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">กิจกรรมแยกตามสิทธิ์</h2>
        <div className="flex flex-wrap gap-3">
          {data.role_activity?.map(r => (
            <div key={r.role} className="bg-gray-50 rounded-lg px-4 py-2 text-center">
              <p className="text-lg font-semibold text-gray-700">{r.cnt}</p>
              <p className="text-xs text-gray-500">{r.role || 'ไม่ระบุ'}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Daily Activity Chart (text-based) */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">กิจกรรมรายวัน (14 วัน)</h2>
        {data.daily_activity?.length > 0 ? (
          <div className="space-y-1">
            {data.daily_activity.map(d => {
              const maxCnt = Math.max(...data.daily_activity.map(x => x.cnt));
              const pct = maxCnt > 0 ? Math.round((d.cnt / maxCnt) * 100) : 0;
              return (
                <div key={d.date} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500 w-20 shrink-0">
                    {new Date(d.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                  </span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4">
                    <div className="bg-blue-500 h-4 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-gray-600 font-medium w-12 text-right">{d.cnt}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400">ยังไม่มีข้อมูล</p>
        )}
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-xs text-gray-500">
        <p><strong>หมายเหตุ:</strong> Error count ประมาณจากล็อกอินล้มเหลว — ระบบยังไม่มี persistent error log ที่แยกเก็บ (partial)</p>
      </div>
    </div>
  );
}

function HealthKpi({ label, value, sub, color }) {
  const colors = {
    green: 'bg-green-50 text-green-700 border-green-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
  };
  return (
    <div className={`rounded-xl border p-3 text-center ${colors[color] || colors.blue}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs mt-0.5">{label}</p>
      {sub && <p className="text-xs opacity-70 mt-0.5">{sub}</p>}
    </div>
  );
}

function FeatureBar({ rank, label, count, max, color }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-5">{rank}.</span>
      <span className="text-sm text-gray-700 w-32 truncate">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-3">
        <div className={`h-3 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-600 font-medium w-10 text-right">{count}</span>
    </div>
  );
}
