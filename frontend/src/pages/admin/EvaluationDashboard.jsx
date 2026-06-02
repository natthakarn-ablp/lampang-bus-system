import { useState, useEffect } from 'react';
import api from '../../api/axios';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';

function pct(n, d) { return d > 0 ? Math.round((n / d) * 10000) / 100 : 0; }
function delta(c, b) { return Math.round((c - b) * 100) / 100; }
function trend(d, higher = true) {
  if (d === 0) return { icon: '=', cls: 'text-gray-500', label: 'คงเดิม', bg: 'bg-gray-100' };
  const ok = higher ? d > 0 : d < 0;
  return ok
    ? { icon: '▲', cls: 'text-green-600', label: 'ดีขึ้น', bg: 'bg-green-100' }
    : { icon: '▼', cls: 'text-red-600', label: 'ลดลง', bg: 'bg-red-100' };
}
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'; }

const ROLE_DEFS = [
  { id: 'driver', code: 'DR', name: 'คนขับ', color: 'orange', focus: 'ความสม่ำเสมอ + UX',
    metrics: [
      { label: 'ส่งเช้าครบ', num: 'morning_done', den: 'morning_total' },
      { label: 'รับเย็นครบ', num: 'evening_done', den: 'evening_total' },
    ]},
  { id: 'school', code: 'SC', name: 'โรงเรียน', color: 'green', focus: 'ข้อมูลครบถ้วน + ภาระงาน',
    metrics: [
      { label: 'ข้อมูลครบ (รถ)', num: 'students_with_vehicle', den: 'total_students' },
      { label: 'ผู้ปกครองครบ', num: 'students_with_parent', den: 'total_students' },
    ]},
  { id: 'affiliation', code: 'AF', name: 'สังกัด', color: 'teal', focus: 'ตรวจจับเชิงรุก',
    metrics: [
      { label: 'ข้อมูลครบ (รถ)', num: 'students_with_vehicle', den: 'total_students' },
      { label: 'ตรวจสภาพรถ', num: 'vehicles_inspected', den: 'total_vehicles' },
    ]},
  { id: 'province', code: 'PR', name: 'จังหวัด', color: 'blue', focus: 'คุณภาพการตัดสินใจ',
    metrics: [
      { label: 'ตรวจสภาพ', num: 'vehicles_inspected', den: 'total_vehicles' },
      { label: 'ประกัน', num: 'vehicles_with_insurance', den: 'total_vehicles' },
    ]},
  { id: 'transport', code: 'TR', name: 'ขนส่ง', color: 'indigo', focus: 'ปิดความเสี่ยง',
    metrics: [
      { label: 'ตรวจสภาพ', num: 'vehicles_inspected', den: 'total_vehicles' },
      { label: 'ผ่านตรวจ', num: 'vehicles_passed', den: 'total_vehicles' },
      { label: 'ประกัน', num: 'vehicles_with_insurance', den: 'total_vehicles' },
    ]},
  { id: 'admin', code: 'AD', name: 'แอดมิน', color: 'purple', focus: 'สุขภาพระบบ',
    metrics: [
      { label: 'ผู้ใช้ active', num: 'active_users', den: 'total_users' },
      { label: 'ข้อมูลครบ', num: 'students_with_vehicle', den: 'total_students' },
    ]},
];

const CODE_BG = { orange: 'bg-orange-500', green: 'bg-green-600', teal: 'bg-teal-600', blue: 'bg-blue-600', indigo: 'bg-indigo-600', purple: 'bg-purple-600' };

function evalStatus(roleId, actions, snapHas) {
  const total = actions?.total || 0;
  if (!snapHas || total < 5) return { label: 'ยังต้องเพิ่มหลักฐาน', cls: 'bg-red-100 text-red-700' };
  if (total >= 20) return { label: 'พร้อมประเมิน', cls: 'bg-green-100 text-green-700' };
  return { label: 'ประเมินได้บางส่วน', cls: 'bg-amber-100 text-amber-700' };
}

export default function EvaluationDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState('');

  useEffect(() => {
    api.get('/admin/evaluation-summary')
      .then(r => setData(r.data?.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (!data) return <EmptyState title="ยังไม่มีข้อมูล" />;

  const { baseline, latest, role_actions, role_exports } = data;
  const bData = baseline?.data || {};
  const lData = latest?.data || {};
  const hasSnap = !!baseline && !!latest;

  const readyCount = ROLE_DEFS.filter(r => evalStatus(r.id, role_actions[r.id], hasSnap).label === 'พร้อมประเมิน').length;
  const partialCount = ROLE_DEFS.filter(r => evalStatus(r.id, role_actions[r.id], hasSnap).label === 'ประเมินได้บางส่วน').length;

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto pb-10">
      {/* Header */}
      <div className="bg-blue-800 text-white rounded-xl px-5 py-4 mb-5">
        <p className="text-xs text-blue-200 uppercase tracking-wider">Role-by-Role Evaluation</p>
        <h1 className="text-lg font-semibold">แดชบอร์ดประเมินผลแยกตามสิทธิ์</h1>
        <p className="text-sm text-blue-200 mt-0.5">Snapshot • Action Logs • Export Evidence</p>
      </div>

      {/* Global summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <SummaryPill label="Baseline" value={baseline ? fmtDate(baseline.date) : 'ยังไม่มี'} color={baseline ? 'blue' : 'gray'} />
        <SummaryPill label="Snapshot ล่าสุด" value={latest ? fmtDate(latest.date) : 'ยังไม่มี'} color={latest ? 'blue' : 'gray'} />
        <SummaryPill label="พร้อมประเมิน" value={`${readyCount} / ${ROLE_DEFS.length} role`} color={readyCount >= 4 ? 'green' : 'amber'} />
        <SummaryPill label="ยังต้องเพิ่ม" value={`${ROLE_DEFS.length - readyCount - partialCount} role`} color="gray" />
      </div>

      {/* Role cards */}
      <div className="space-y-3">
        {ROLE_DEFS.map(role => {
          const actions = role_actions[role.id] || { actions: {}, total: 0 };
          const exports = role_exports[role.id] || 0;
          const status = evalStatus(role.id, actions, hasSnap);
          const isOpen = expanded === role.id;

          return (
            <div key={role.id} className={`bg-white rounded-xl border-2 overflow-hidden transition ${isOpen ? 'border-gray-300 shadow-sm' : 'border-gray-200'}`}>
              {/* Card header */}
              <button onClick={() => setExpanded(isOpen ? '' : role.id)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 transition">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0 ${CODE_BG[role.color]}`}>
                  {role.code}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800">{role.name}</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
                  </div>
                  <p className="text-xs text-gray-500">{role.focus} · {actions.total || 0} actions · {exports} exports</p>
                </div>
                {/* Mini metrics */}
                <div className="hidden sm:flex gap-2 shrink-0">
                  {role.metrics.slice(0, 2).map(m => {
                    const cv = pct(lData[m.num] || 0, lData[m.den] || 0);
                    return <span key={m.label} className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{m.label} {cv}%</span>;
                  })}
                </div>
                <span className="text-gray-400 shrink-0">{isOpen ? '▲' : '▼'}</span>
              </button>

              {/* Expanded detail */}
              {isOpen && (
                <div className="border-t border-gray-200 px-4 py-4 space-y-4">
                  {/* Evidence coverage */}
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className={`px-2 py-0.5 rounded-full font-medium ${hasSnap ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      Snapshots: {hasSnap ? '✅' : '❌'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full font-medium ${(actions.total || 0) > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      Audit logs: {(actions.total || 0) > 0 ? `✅ ${actions.total}` : '❌'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full font-medium ${exports > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      Exports: {exports > 0 ? `✅ ${exports}` : '—'}
                    </span>
                    <span className="px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">
                      External: ⚠️ ต้องใช้ร่วม
                    </span>
                  </div>

                  {/* Action breakdown */}
                  {actions.actions && Object.keys(actions.actions).length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-1">Action breakdown</p>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(actions.actions).map(([action, cnt]) => (
                          <span key={action} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                            {action}: {cnt}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Metric comparison */}
                  {hasSnap && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-2">Baseline vs Current</p>
                      <div className="bg-gray-50 rounded-lg overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-gray-400">
                              <th className="px-3 py-2 text-left font-medium">ตัวชี้วัด</th>
                              <th className="px-3 py-2 text-center font-medium">Baseline</th>
                              <th className="px-3 py-2 text-center font-medium">ปัจจุบัน</th>
                              <th className="px-3 py-2 text-center font-medium">เปลี่ยนแปลง</th>
                            </tr>
                          </thead>
                          <tbody>
                            {role.metrics.map(m => {
                              const bv = pct(bData[m.num] || 0, bData[m.den] || 0);
                              const cv = pct(lData[m.num] || 0, lData[m.den] || 0);
                              const d = delta(cv, bv);
                              const t = trend(d);
                              return (
                                <tr key={m.label} className="border-t border-gray-100">
                                  <td className="px-3 py-2 text-gray-700 font-medium">{m.label}</td>
                                  <td className="px-3 py-2 text-center text-gray-500">{bv}%</td>
                                  <td className="px-3 py-2 text-center font-semibold text-gray-800">{cv}%</td>
                                  <td className={`px-3 py-2 text-center font-semibold ${t.cls}`}>
                                    {t.icon} {d > 0 ? '+' : ''}{d}%
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Missing note */}
                  <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                    ⚠️ บาง metric ของ role นี้ต้องใช้หลักฐานภายนอก (แบบสอบถาม, สัมภาษณ์, บันทึกประชุม) ร่วมด้วย — ดูรายละเอียดที่หน้า "กรอบวัดผลระบบ"
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryPill({ label, value, color }) {
  const bg = { blue: 'bg-blue-50 text-blue-700', green: 'bg-green-50 text-green-700', amber: 'bg-amber-50 text-amber-700', gray: 'bg-gray-50 text-gray-600' };
  return (
    <div className={`rounded-xl p-3 text-center ${bg[color] || bg.gray}`}>
      <p className="text-sm font-semibold">{value}</p>
      <p className="text-xs mt-0.5 opacity-70">{label}</p>
    </div>
  );
}
