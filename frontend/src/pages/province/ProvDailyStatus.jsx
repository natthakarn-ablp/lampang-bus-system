import { useState, useEffect } from 'react';
import api from '../../api/axios';
import PlateSearchInput from '../../components/PlateSearchInput';

export default function ProvDailyStatus() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedAff, setExpandedAff] = useState(null);
  const [expandedSchool, setExpandedSchool] = useState(null);
  const [expandedVehicle, setExpandedVehicle] = useState(null);
  const [plateSearch, setPlateSearch] = useState('');

  useEffect(() => {
    api.get('/province/status-today')
      .then((res) => setData(res.data.data))
      .catch((err) => setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  function toggleAff(id) {
    setExpandedAff((p) => (p === id ? null : id));
    setExpandedSchool(null);
    setExpandedVehicle(null);
  }
  function toggleSchool(id) {
    setExpandedSchool((p) => (p === id ? null : id));
    setExpandedVehicle(null);
  }
  function toggleVehicle(id) {
    setExpandedVehicle((p) => (p === id ? null : id));
  }

  function countStatus(students) {
    const mDone = students.filter((s) => s.morning_enabled && s.morning_done).length;
    const mTotal = students.filter((s) => s.morning_enabled).length;
    const eDone = students.filter((s) => s.evening_enabled && s.evening_done).length;
    const eTotal = students.filter((s) => s.evening_enabled).length;
    return { mDone, mTotal, eDone, eTotal };
  }

  function flatStudents(vehicles) {
    return vehicles.flatMap((v) => v.students);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold text-gray-800">สถานะวันนี้</h1>
        <div className="flex items-center gap-3">
          <PlateSearchInput value={plateSearch} onChange={setPlateSearch} />
          {data?.date && (
            <span className="text-sm text-gray-500 whitespace-nowrap">
              {new Date(data.date).toLocaleDateString('th-TH', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : !data?.affiliations?.length ? (
        <p className="text-gray-400 py-10 text-center">ไม่มีข้อมูล</p>
      ) : (
        <div className="space-y-3">
          {data.affiliations.map((aff) => {
            const allStudents = aff.schools.flatMap((s) => flatStudents(s.vehicles));
            const { mDone, mTotal, eDone, eTotal } = countStatus(allStudents);
            const isAffExpanded = expandedAff === aff.affiliation_id;

            return (
              <div key={aff.affiliation_id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Affiliation header */}
                <button onClick={() => toggleAff(aff.affiliation_id)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition">
                  <div>
                    <h3 className="font-semibold text-gray-800">{aff.affiliation_name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {aff.schools.length} โรงเรียน · {allStudents.length} คน
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className={mDone === mTotal && mTotal > 0 ? 'text-green-600' : 'text-orange-600'}>
                      เช้า {mDone}/{mTotal}
                    </span>
                    <span className={eDone === eTotal && eTotal > 0 ? 'text-green-600' : 'text-indigo-600'}>
                      เย็น {eDone}/{eTotal}
                    </span>
                    <span className="text-gray-400 text-xs">{isAffExpanded ? '▲' : '▼'}</span>
                  </div>
                </button>

                {isAffExpanded && (
                  <div className="border-t border-gray-100">
                    {aff.schools.map((school) => {
                      const sStudents = flatStudents(school.vehicles);
                      const ss = countStatus(sStudents);
                      const sKey = `${aff.affiliation_id}-${school.school_id}`;
                      const isSchoolExpanded = expandedSchool === sKey;

                      return (
                        <div key={sKey} className="border-t border-gray-50">
                          <button onClick={() => toggleSchool(sKey)}
                            className="w-full flex items-center justify-between px-7 py-3 text-left hover:bg-gray-50 transition">
                            <div className="flex items-center gap-2">
                              <span className="text-sm">🏫</span>
                              <span className="text-sm font-medium text-gray-700">{school.school_name}</span>
                              <span className="text-xs text-gray-400">({sStudents.length} คน)</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs">
                              <span className={ss.mDone === ss.mTotal && ss.mTotal > 0 ? 'text-green-600' : 'text-orange-500'}>
                                เช้า {ss.mDone}/{ss.mTotal}
                              </span>
                              <span className={ss.eDone === ss.eTotal && ss.eTotal > 0 ? 'text-green-600' : 'text-indigo-500'}>
                                เย็น {ss.eDone}/{ss.eTotal}
                              </span>
                              <span className="text-gray-400">{isSchoolExpanded ? '▲' : '▼'}</span>
                            </div>
                          </button>

                          {isSchoolExpanded && (
                            <div className="pl-4">
                              {school.vehicles.filter(v => !plateSearch || v.plate_no.toLowerCase().includes(plateSearch.toLowerCase())).map((vehicle) => {
                                const vs = countStatus(vehicle.students);
                                const vKey = `${sKey}-${vehicle.vehicle_id}`;
                                const isVehicleExpanded = expandedVehicle === vKey;

                                return (
                                  <div key={vKey} className="border-t border-gray-50">
                                    <button onClick={() => toggleVehicle(vKey)}
                                      className="w-full flex items-center justify-between px-7 py-2.5 text-left hover:bg-gray-50 transition">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs">🚐</span>
                                        <span className="text-sm text-gray-600">{vehicle.plate_no}</span>
                                        <span className="text-xs text-gray-400">({vehicle.students.length})</span>
                                      </div>
                                      <div className="flex items-center gap-3 text-xs">
                                        <span className={vs.mDone === vs.mTotal && vs.mTotal > 0 ? 'text-green-600' : 'text-orange-500'}>
                                          {vs.mDone}/{vs.mTotal}
                                        </span>
                                        <span className={vs.eDone === vs.eTotal && vs.eTotal > 0 ? 'text-green-600' : 'text-indigo-500'}>
                                          {vs.eDone}/{vs.eTotal}
                                        </span>
                                        <span className="text-gray-400">{isVehicleExpanded ? '▲' : '▼'}</span>
                                      </div>
                                    </button>

                                    {isVehicleExpanded && (
                                      <table className="w-full text-sm">
                                        <thead>
                                          <tr className="bg-gray-50 text-gray-500 text-left">
                                            <th className="px-9 py-2 font-medium">ชื่อ</th>
                                            <th className="px-5 py-2 font-medium">ชั้น/ห้อง</th>
                                            <th className="px-5 py-2 font-medium text-center">ส่งเช้า</th>
                                            <th className="px-5 py-2 font-medium text-center">รับเย็น</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                          {vehicle.students.map((st) => (
                                            <tr key={st.id} className="hover:bg-gray-50">
                                              <td className="px-9 py-2 text-gray-700">{st.name}</td>
                                              <td className="px-5 py-2 text-gray-500">
                                                {st.grade && st.classroom ? `${st.grade}/${st.classroom}` : st.grade || st.classroom || '-'}
                                              </td>
                                              <td className="px-5 py-2 text-center">
                                                {!st.morning_enabled ? <span className="text-gray-300 text-xs">-</span>
                                                  : st.morning_done ? <span className="text-green-600 text-xs font-medium">✓ {st.morning_ts && new Date(st.morning_ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span>
                                                  : <span className="text-orange-500 text-xs">รอ</span>}
                                              </td>
                                              <td className="px-5 py-2 text-center">
                                                {!st.evening_enabled ? <span className="text-gray-300 text-xs">-</span>
                                                  : st.evening_done ? <span className="text-green-600 text-xs font-medium">✓ {st.evening_ts && new Date(st.evening_ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span>
                                                  : <span className="text-indigo-500 text-xs">รอ</span>}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
