import { useState, useEffect } from 'react';
import api from '../../api/axios';

export default function DailyStatus() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedVehicle, setExpandedVehicle] = useState(null);

  useEffect(() => {
    api.get('/school/status-today')
      .then((res) => setData(res.data.data))
      .catch((err) => setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  function toggleVehicle(vehicleId) {
    setExpandedVehicle((prev) => (prev === vehicleId ? null : vehicleId));
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">สถานะวันนี้</h1>
        {data?.date && (
          <span className="text-sm text-gray-500">
            {new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : !data?.vehicles?.length ? (
        <p className="text-gray-400 py-10 text-center">ไม่มีข้อมูล</p>
      ) : (
        <div className="space-y-3">
          {data.vehicles.map((vehicle) => {
            const morningDone = vehicle.students.filter(
              (s) => s.morning_enabled && s.morning_done
            ).length;
            const morningTotal = vehicle.students.filter((s) => s.morning_enabled).length;
            const eveningDone = vehicle.students.filter(
              (s) => s.evening_enabled && s.evening_done
            ).length;
            const eveningTotal = vehicle.students.filter((s) => s.evening_enabled).length;
            const isExpanded = expandedVehicle === vehicle.vehicle_id;

            return (
              <div
                key={vehicle.vehicle_id || '__none'}
                className="bg-white rounded-xl border border-gray-200 overflow-hidden"
              >
                {/* Vehicle header - clickable */}
                <button
                  onClick={() => toggleVehicle(vehicle.vehicle_id)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition"
                >
                  <div>
                    <h3 className="font-semibold text-gray-800">{vehicle.plate_no}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {vehicle.students.length} คน
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className={morningDone === morningTotal && morningTotal > 0 ? 'text-green-600' : 'text-orange-600'}>
                      เช้า {morningDone}/{morningTotal}
                    </span>
                    <span className={eveningDone === eveningTotal && eveningTotal > 0 ? 'text-green-600' : 'text-indigo-600'}>
                      เย็น {eveningDone}/{eveningTotal}
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
                            <td className="px-5 py-2 text-gray-500">{s.grade} {s.classroom}</td>
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
