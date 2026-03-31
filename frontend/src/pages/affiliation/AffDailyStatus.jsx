import { useState, useEffect } from 'react';
import api from '../../api/axios';
import PlateSearchInput from '../../components/PlateSearchInput';

export default function AffDailyStatus() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedSchool, setExpandedSchool] = useState(null);
  const [expandedVehicle, setExpandedVehicle] = useState(null);
  const [plateSearch, setPlateSearch] = useState('');

  useEffect(() => {
    api.get('/affiliation/status-today')
      .then((res) => setData(res.data.data))
      .catch((err) => setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  function toggleSchool(schoolId) {
    setExpandedSchool((prev) => (prev === schoolId ? null : schoolId));
    setExpandedVehicle(null);
  }

  function toggleVehicle(key) {
    setExpandedVehicle((prev) => (prev === key ? null : key));
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
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : !data?.schools?.length ? (
        <p className="text-gray-400 py-10 text-center">ไม่มีข้อมูล</p>
      ) : (
        <div className="space-y-3">
          {data.schools.map((school) => {
            const allStudents = school.vehicles.flatMap((v) => v.students);
            const morningDone = allStudents.filter((s) => s.morning_enabled && s.morning_done).length;
            const morningTotal = allStudents.filter((s) => s.morning_enabled).length;
            const eveningDone = allStudents.filter((s) => s.evening_enabled && s.evening_done).length;
            const eveningTotal = allStudents.filter((s) => s.evening_enabled).length;
            const isSchoolExpanded = expandedSchool === school.school_id;

            return (
              <div key={school.school_id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* School header */}
                <button
                  onClick={() => toggleSchool(school.school_id)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition"
                >
                  <div>
                    <h3 className="font-semibold text-gray-800">{school.school_name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {allStudents.length} คน · {school.vehicles.length} คัน
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className={morningDone === morningTotal && morningTotal > 0 ? 'text-green-600' : 'text-orange-600'}>
                      เช้า {morningDone}/{morningTotal}
                    </span>
                    <span className={eveningDone === eveningTotal && eveningTotal > 0 ? 'text-green-600' : 'text-indigo-600'}>
                      เย็น {eveningDone}/{eveningTotal}
                    </span>
                    <span className="text-gray-400 text-xs">{isSchoolExpanded ? '▲' : '▼'}</span>
                  </div>
                </button>

                {/* Expanded vehicles */}
                {isSchoolExpanded && (
                  <div className="border-t border-gray-100">
                    {school.vehicles.filter(v => !plateSearch || v.plate_no.toLowerCase().includes(plateSearch.toLowerCase())).map((vehicle) => {
                      const vMorningDone = vehicle.students.filter((s) => s.morning_enabled && s.morning_done).length;
                      const vMorningTotal = vehicle.students.filter((s) => s.morning_enabled).length;
                      const vEveningDone = vehicle.students.filter((s) => s.evening_enabled && s.evening_done).length;
                      const vEveningTotal = vehicle.students.filter((s) => s.evening_enabled).length;
                      const vKey = `${school.school_id}-${vehicle.vehicle_id}`;
                      const isVehicleExpanded = expandedVehicle === vKey;

                      return (
                        <div key={vKey} className="border-t border-gray-50">
                          <button
                            onClick={() => toggleVehicle(vKey)}
                            className="w-full flex items-center justify-between px-7 py-3 text-left hover:bg-gray-50 transition"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-600">🚐</span>
                              <span className="text-sm font-medium text-gray-700">{vehicle.plate_no}</span>
                              <span className="text-xs text-gray-400">({vehicle.students.length} คน)</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs">
                              <span className={vMorningDone === vMorningTotal && vMorningTotal > 0 ? 'text-green-600' : 'text-orange-500'}>
                                เช้า {vMorningDone}/{vMorningTotal}
                              </span>
                              <span className={vEveningDone === vEveningTotal && vEveningTotal > 0 ? 'text-green-600' : 'text-indigo-500'}>
                                เย็น {vEveningDone}/{vEveningTotal}
                              </span>
                              <span className="text-gray-400">{isVehicleExpanded ? '▲' : '▼'}</span>
                            </div>
                          </button>

                          {isVehicleExpanded && (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-gray-50 text-gray-500 text-left">
                                  <th className="px-7 py-2 font-medium">ชื่อ</th>
                                  <th className="px-5 py-2 font-medium">ชั้น/ห้อง</th>
                                  <th className="px-5 py-2 font-medium text-center">ส่งเช้า</th>
                                  <th className="px-5 py-2 font-medium text-center">รับเย็น</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {vehicle.students.map((s) => (
                                  <tr key={s.id} className="hover:bg-gray-50">
                                    <td className="px-7 py-2 text-gray-700">{s.name}</td>
                                    <td className="px-5 py-2 text-gray-500">
                                      {s.grade && s.classroom ? `${s.grade}/${s.classroom}` : s.grade || s.classroom || '-'}
                                    </td>
                                    <td className="px-5 py-2 text-center">
                                      {!s.morning_enabled ? (
                                        <span className="text-gray-300 text-xs">-</span>
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
