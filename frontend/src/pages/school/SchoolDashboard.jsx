import { useState, useEffect } from 'react';
import api from '../../api/axios';
import PlateSearchInput from '../../components/PlateSearchInput';
import { DonutChart, HBarChart } from '../../components/MiniCharts';
import { PAGE_TITLES, CARD_LABELS, CHART_TITLES, SECTION_TITLES, STATUS, UI_MESSAGES, MORNING_SEGMENTS, EVENING_SEGMENTS } from '../../constants/uiLabels';

export default function SchoolDashboard() {
  const [data, setData] = useState(null);
  const [statusData, setStatusData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedVehicle, setExpandedVehicle] = useState(null);
  const [plateSearch, setPlateSearch] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/school/dashboard').then(r => r.data.data),
      api.get('/school/status-today').then(r => r.data.data),
    ])
      .then(([dash, status]) => { setData(dash); setStatusData(status); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function toggleVehicle(vehicleId) {
    setExpandedVehicle(prev => (prev === vehicleId ? null : vehicleId));
  }

  const vehicles = statusData?.vehicles || [];
  const filtered = vehicles.filter(v => !plateSearch || v.plate_no.toLowerCase().includes(plateSearch.toLowerCase()));

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* ── Header ── */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{PAGE_TITLES.SCHOOL_DASHBOARD}</h1>
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
            วันที่ {new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          <span className="ml-3 text-gray-400">{UI_MESSAGES.LOADING}</span>
        </div>
      ) : (
        <>
          {/* ── Summary Cards — Row 1: Overview ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatCard icon="👨‍🎓" label={CARD_LABELS.TOTAL_STUDENTS} value={data?.total_students ?? 0} accent="blue" />
            <StatCard icon="🚐" label={CARD_LABELS.VEHICLES} value={data?.total_vehicles ?? 0} accent="blue" />
            <StatCard icon="📝" label={CARD_LABELS.STUDENT_LEAVE} value={(data?.morning_leave ?? 0) + (data?.evening_leave ?? 0) > 0 ? `${data?.morning_leave ?? 0}/${data?.evening_leave ?? 0}` : '0'} sub={((data?.morning_leave ?? 0) + (data?.evening_leave ?? 0)) > 0 ? 'เช้า/เย็น' : 'ไม่มีคนลา'} accent="amber" />
            <StatCard icon="🚨" label={CARD_LABELS.EMERGENCY} value={data?.recent_emergencies ?? 0} sub="7 วันล่าสุด" accent={data?.recent_emergencies > 0 ? 'red' : 'gray'} />
          </div>

          {/* ── Summary Cards — Row 2: Morning/Evening Status ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <SessionCard
              session="morning"
              label="ส่งเช้า"
              done={data?.morning_done ?? 0}
              total={data?.morning_total ?? 0}
              pending={data?.morning_pending ?? 0}
              leave={data?.morning_leave ?? 0}
            />
            <SessionCard
              session="evening"
              label="รับเย็น"
              done={data?.evening_done ?? 0}
              total={data?.evening_total ?? 0}
              pending={data?.evening_pending ?? 0}
              leave={data?.evening_leave ?? 0}
            />
          </div>

          {/* ── Charts Row ── */}
          {vehicles.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              {/* Morning donut */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs font-semibold text-gray-500 mb-3 text-center">{CHART_TITLES.MORNING_STATUS}</p>
                <DonutChart
                  size={110} thickness={16}
                  label={`${data?.morning_total > 0 ? Math.round(((data?.morning_done ?? 0) / data.morning_total) * 100) : 0}%`}
                  sublabel={STATUS.DONE}
                  segments={MORNING_SEGMENTS(data?.morning_done ?? 0, data?.morning_leave ?? 0, data?.morning_pending ?? 0)}
                />
              </div>
              {/* Evening donut */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs font-semibold text-gray-500 mb-3 text-center">{CHART_TITLES.EVENING_STATUS}</p>
                <DonutChart
                  size={110} thickness={16}
                  label={`${data?.evening_total > 0 ? Math.round(((data?.evening_done ?? 0) / data.evening_total) * 100) : 0}%`}
                  sublabel={STATUS.DONE}
                  segments={EVENING_SEGMENTS(data?.evening_done ?? 0, data?.evening_leave ?? 0, data?.evening_pending ?? 0)}
                />
              </div>
              {/* Top pending vehicles */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <HBarChart
                  label="รถที่มีรายการค้างมากที่สุด"
                  items={(() => {
                    const isMLeave = (s) => s.leave_session === 'morning' || s.leave_session === 'both';
                    return vehicles
                      .map(v => {
                        const mE = v.students.filter(s => s.morning_enabled && !isMLeave(s));
                        const mP = mE.length - mE.filter(s => s.morning_done).length;
                        return { label: v.plate_no, value: mP, color: mP > 5 ? '#ef4444' : mP > 0 ? '#f97316' : '#22c55e' };
                      })
                      .sort((a, b) => b.value - a.value)
                      .slice(0, 6);
                  })()}
                  valueLabel=" คน"
                />
              </div>
            </div>
          )}

          {/* ── Vehicle Status Section ── */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-bold text-gray-800">{SECTION_TITLES.VEHICLE_STATUS}</h2>
              <p className="text-xs text-gray-400">{filtered.length} คัน{plateSearch ? ' (กรอง)' : ''}</p>
            </div>
            <PlateSearchInput value={plateSearch} onChange={setPlateSearch} />
          </div>

          {filtered.length === 0 ? (
            <div className="bg-gray-50 rounded-xl border border-gray-200 py-12 text-center">
              <p className="text-gray-400">{UI_MESSAGES.VEHICLE_NOT_FOUND}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((vehicle) => {
                const isMorningLeave = (s) => s.leave_session === 'morning' || s.leave_session === 'both';
                const isEveningLeave = (s) => s.leave_session === 'evening' || s.leave_session === 'both';
                const mEnabled = vehicle.students.filter(s => s.morning_enabled && !isMorningLeave(s));
                const mDone = mEnabled.filter(s => s.morning_done).length;
                const mPending = mEnabled.length - mDone;
                const eEnabled = vehicle.students.filter(s => s.evening_enabled && !isEveningLeave(s));
                const eDone = eEnabled.filter(s => s.evening_done).length;
                const ePending = eEnabled.length - eDone;
                const leaveCount = vehicle.students.filter(s => s.leave_session).length;
                const isExpanded = expandedVehicle === vehicle.vehicle_id;
                const allMorningDone = mPending === 0 && mEnabled.length > 0;
                const allEveningDone = ePending === 0 && eEnabled.length > 0;

                return (
                  <div key={vehicle.vehicle_id || '__none'} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <button
                      onClick={() => toggleVehicle(vehicle.vehicle_id)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50/50 transition"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2 h-8 rounded-full shrink-0 ${allMorningDone && allEveningDone ? 'bg-green-400' : mPending + ePending > 0 ? 'bg-amber-400' : 'bg-gray-300'}`} />
                        <div className="min-w-0">
                          <h3 className="font-semibold text-gray-800 text-sm truncate">{vehicle.plate_no}</h3>
                          <p className="text-xs text-gray-400">{vehicle.students.length} คน{leaveCount > 0 ? ` · ลา ${leaveCount}` : ''}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-xs">
                        <StatusPill label="เช้า" done={mDone} total={mEnabled.length} pending={mPending} session="morning" />
                        <StatusPill label="เย็น" done={eDone} total={eEnabled.length} pending={ePending} session="evening" />
                        <span className="text-gray-300 text-[10px]">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-100 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50/80 text-gray-500 text-xs">
                              <th className="px-4 py-2 text-left font-medium">ชื่อนักเรียน</th>
                              <th className="px-4 py-2 text-left font-medium">ชั้น/ห้อง</th>
                              <th className="px-4 py-2 text-center font-medium">ส่งเช้า</th>
                              <th className="px-4 py-2 text-center font-medium">รับเย็น</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {vehicle.students.map((s) => (
                              <tr key={s.id} className={`${s.leave_session ? 'bg-amber-50/40' : ''} hover:bg-gray-50/50`}>
                                <td className="px-4 py-2 text-gray-800 text-sm">{s.name}</td>
                                <td className="px-4 py-2 text-gray-500 text-xs">
                                  {s.grade && s.classroom ? `${s.grade}/${s.classroom}` : s.grade || '-'}
                                </td>
                                <td className="px-4 py-2 text-center">
                                  <StudentStatus enabled={s.morning_enabled} done={s.morning_done} ts={s.morning_ts} leave={s.leave_session === 'morning' || s.leave_session === 'both'} />
                                </td>
                                <td className="px-4 py-2 text-center">
                                  <StudentStatus enabled={s.evening_enabled} done={s.evening_done} ts={s.evening_ts} leave={s.leave_session === 'evening' || s.leave_session === 'both'} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Sub-components ── */

function StatCard({ icon, label, value, sub, accent = 'blue' }) {
  const bg = { blue: 'bg-blue-50 border-blue-100', amber: 'bg-amber-50 border-amber-100', red: 'bg-red-50 border-red-100', gray: 'bg-gray-50 border-gray-100', green: 'bg-green-50 border-green-100' };
  const text = { blue: 'text-blue-700', amber: 'text-amber-700', red: 'text-red-700', gray: 'text-gray-600', green: 'text-green-700' };
  return (
    <div className={`rounded-xl border p-4 ${bg[accent] || bg.blue}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">{icon}</span>
        <span className={`text-xs font-medium ${text[accent] || text.blue} opacity-80`}>{label}</span>
      </div>
      <p className={`text-2xl font-bold ${text[accent] || text.blue}`}>{value ?? '–'}</p>
      {sub && <p className="text-[10px] mt-0.5 text-gray-400">{sub}</p>}
    </div>
  );
}

function SessionCard({ session, label, done, total, pending, leave }) {
  const allDone = pending === 0 && total > 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const colors = session === 'morning'
    ? { bg: 'bg-orange-50', border: 'border-orange-200', bar: 'bg-orange-400', text: 'text-orange-700', icon: '🌅' }
    : { bg: 'bg-indigo-50', border: 'border-indigo-200', bar: 'bg-indigo-400', text: 'text-indigo-700', icon: '🌆' };

  return (
    <div className={`rounded-xl border p-4 ${allDone ? 'bg-green-50 border-green-200' : `${colors.bg} ${colors.border}`}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span>{allDone ? '✅' : colors.icon}</span>
          <span className={`text-sm font-semibold ${allDone ? 'text-green-700' : colors.text}`}>{label}</span>
        </div>
        <span className={`text-xs font-bold ${allDone ? 'text-green-600' : colors.text}`}>{pct}%</span>
      </div>
      {/* Progress bar */}
      <div className="w-full bg-white/60 rounded-full h-2 mb-2">
        <div className={`h-2 rounded-full transition-all ${allDone ? 'bg-green-400' : colors.bar}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className={allDone ? 'text-green-600 font-medium' : 'text-gray-500'}>
          {allDone ? `${label}ครบแล้ว ✓` : `${done}/${total - leave} คน`}
        </span>
        <div className="flex gap-2">
          {pending > 0 && <span className="text-red-500 font-medium">{STATUS.PENDING} {pending}</span>}
          {leave > 0 && <span className="text-amber-500">{STATUS.LEAVE} {leave}</span>}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ label, done, total, pending, session }) {
  if (total === 0) return <span className="text-gray-300">{label} -</span>;
  const allDone = pending === 0;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${allDone ? 'bg-green-100 text-green-700' : session === 'morning' ? 'bg-orange-100 text-orange-700' : 'bg-indigo-100 text-indigo-700'}`}>
      {label} {done}/{total}
      {pending > 0 && <span className="text-red-500 font-bold">({pending})</span>}
    </span>
  );
}

function StudentStatus({ enabled, done, ts, leave }) {
  if (!enabled) return <span className="text-gray-300 text-xs">-</span>;
  if (leave) return <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-medium bg-amber-100 px-2 py-0.5 rounded-full">{STATUS.LEAVE}</span>;
  if (done) return (
    <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">
      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
      {ts ? new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '✓'}
    </span>
  );
  return <span className="inline-flex items-center gap-1 text-orange-500 text-xs"><span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />{STATUS.PENDING}</span>;
}
