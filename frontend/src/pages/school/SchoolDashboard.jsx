import { useState, useEffect } from 'react';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';
import PlateSearchInput from '../../components/PlateSearchInput';

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
      .then(([dash, status]) => {
        setData(dash);
        setStatusData(status);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function toggleVehicle(vehicleId) {
    setExpandedVehicle((prev) => (prev === vehicleId ? null : vehicleId));
  }

  const vehicles = statusData?.vehicles || [];
  const filtered = vehicles.filter(v => !plateSearch || v.plate_no.toLowerCase().includes(plateSearch.toLowerCase()));

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* ── Section 1: ภาพรวมโรงเรียน ── */}
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
            <DashboardCard label="นักเรียนทั้งหมด" value={data?.total_students ?? 0} color="blue" />
            <DashboardCard label="รถรับส่ง" value={data?.total_vehicles ?? 0} color="blue" />
            <DashboardCard
              label="เหตุฉุกเฉิน (7 วัน)"
              value={data?.recent_emergencies ?? 0}
              color={data?.recent_emergencies > 0 ? 'red' : 'gray'}
            />
          </div>

          {/* Morning/Evening summary cards */}
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

          {/* ── Section 2: สถานะวันนี้ (per vehicle) ── */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h2 className="text-lg font-bold text-gray-800">สถานะวันนี้</h2>
            <div className="flex items-center gap-3">
              <PlateSearchInput value={plateSearch} onChange={setPlateSearch} />
              {statusData?.date && (
                <span className="text-sm text-gray-500 whitespace-nowrap">
                  {new Date(statusData.date).toLocaleDateString('th-TH', { month: 'short', day: 'numeric' })}
                </span>
              )}
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="text-gray-400 py-6 text-center">ไม่มีข้อมูลรถ</p>
          ) : (
            <div className="space-y-3">
              {filtered.map((vehicle) => {
                const isMorningLeave = (s) => s.leave_session === 'morning' || s.leave_session === 'both';
                const isEveningLeave = (s) => s.leave_session === 'evening' || s.leave_session === 'both';
                const morningEnabled = vehicle.students.filter(s => s.morning_enabled && !isMorningLeave(s));
                const morningDone = morningEnabled.filter(s => s.morning_done).length;
                const morningPending = morningEnabled.length - morningDone;
                const eveningEnabled = vehicle.students.filter(s => s.evening_enabled && !isEveningLeave(s));
                const eveningDone = eveningEnabled.filter(s => s.evening_done).length;
                const eveningPending = eveningEnabled.length - eveningDone;
                const isExpanded = expandedVehicle === vehicle.vehicle_id;

                return (
                  <div key={vehicle.vehicle_id || '__none'} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    {/* Vehicle header */}
                    <button
                      onClick={() => toggleVehicle(vehicle.vehicle_id)}
                      className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition"
                    >
                      <div>
                        <h3 className="font-semibold text-gray-800">{vehicle.plate_no}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">{vehicle.students.length} คน</p>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className={morningPending === 0 && morningEnabled.length > 0 ? 'text-green-600' : 'text-orange-600'}>
                          เช้า {morningDone}/{morningEnabled.length}
                          {morningPending > 0 && <span className="text-xs text-red-500 ml-1">(รอ {morningPending})</span>}
                        </span>
                        <span className={eveningPending === 0 && eveningEnabled.length > 0 ? 'text-green-600' : 'text-indigo-600'}>
                          เย็น {eveningDone}/{eveningEnabled.length}
                          {eveningPending > 0 && <span className="text-xs text-red-500 ml-1">(รอ {eveningPending})</span>}
                        </span>
                        <span className="text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </button>

                    {/* Expanded student list */}
                    {isExpanded && (
                      <div className="border-t border-gray-100">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 text-gray-500 text-left">
                              <th className="px-5 py-2 font-medium">ชื่อ</th>
                              <th className="px-5 py-2 font-medium">ชั้น</th>
                              <th className="px-5 py-2 font-medium text-center">ส่งเช้า</th>
                              <th className="px-5 py-2 font-medium text-center">รับเย็น</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {vehicle.students.map((s) => (
                              <tr key={s.id} className="hover:bg-gray-50">
                                <td className="px-5 py-2 text-gray-700">{s.name}</td>
                                <td className="px-5 py-2 text-gray-500">
                                  {s.grade && s.classroom ? `${s.grade}/${s.classroom}` : s.grade || s.classroom || '-'}
                                </td>
                                <td className="px-5 py-2 text-center">
                                  {!s.morning_enabled ? (
                                    <span className="text-gray-300 text-xs">-</span>
                                  ) : (s.leave_session === 'morning' || s.leave_session === 'both') ? (
                                    <span className="text-amber-600 text-xs font-medium">ลา</span>
                                  ) : s.morning_done ? (
                                    <span className="text-green-600 text-xs font-medium">
                                      ✓ {s.morning_ts && new Date(s.morning_ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  ) : (
                                    <span className="text-orange-500 text-xs">รอ</span>
                                  )}
                                </td>
                                <td className="px-5 py-2 text-center">
                                  {!s.evening_enabled ? (
                                    <span className="text-gray-300 text-xs">-</span>
                                  ) : (s.leave_session === 'evening' || s.leave_session === 'both') ? (
                                    <span className="text-amber-600 text-xs font-medium">ลา</span>
                                  ) : s.evening_done ? (
                                    <span className="text-green-600 text-xs font-medium">
                                      ✓ {s.evening_ts && new Date(s.evening_ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  ) : (
                                    <span className="text-indigo-500 text-xs">รอ</span>
                                  )}
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
