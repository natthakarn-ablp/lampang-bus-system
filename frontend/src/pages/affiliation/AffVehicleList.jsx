import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bus } from 'lucide-react';
import api from '../../api/axios';
import { VehicleSafetySection } from '../../components/VehicleSafety';
import PlateSearchInput from '../../components/PlateSearchInput';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';

export default function AffVehicleList() {
  const [searchParams] = useSearchParams();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [plateSearch, setPlateSearch] = useState(searchParams.get('plate') || '');
  const [expandedVehicle, setExpandedVehicle] = useState(null);
  const [studentCache, setStudentCache] = useState({});

  useEffect(() => {
    api.get('/affiliation/vehicles')
      .then((res) => setVehicles(res.data.data))
      .catch((err) => setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold text-gray-800">รถรับส่ง</h1>
        <PlateSearchInput value={plateSearch} onChange={setPlateSearch} suggestions={vehicles} />
      </div>

      {error && <ErrorState message={error} className="mb-4" />}

      {loading ? (
        <LoadingState />
      ) : vehicles.length === 0 ? (
        <EmptyState
          icon={Bus}
          title="ไม่มีรถรับส่ง"
          description="ยังไม่มีรถในสังกัดนี้"
        />
      ) : (
        <div className="grid gap-4">
          {vehicles.filter(v => !plateSearch || v.plate_no.toLowerCase().includes(plateSearch.toLowerCase())).map((v) => (
            <div key={v.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-800">{v.plate_no}</h3>
                  <p className="text-xs text-gray-500">{v.vehicle_type || 'ไม่ระบุประเภท'}</p>
                  {v.school_names && (
                    <p className="text-xs text-blue-600 mt-0.5">{v.school_names}</p>
                  )}
                </div>
                <span className="text-sm font-medium bg-blue-50 text-blue-700 px-3 py-1 rounded-full">
                  {v.student_count} คน
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">คนขับ</p>
                  <p className="text-gray-700">{v.driver_name || '-'}</p>
                  {v.driver_phone && <p className="text-xs text-gray-400">{v.driver_phone}</p>}
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">ผู้ดูแลรถ</p>
                  <p className="text-gray-700">{v.attendant_name || '-'}</p>
                  {v.attendant_phone && <p className="text-xs text-gray-400">{v.attendant_phone}</p>}
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">เจ้าของรถ</p>
                  <p className="text-gray-700">{v.owner_name || '-'}</p>
                  {v.owner_phone && <p className="text-xs text-gray-400">{v.owner_phone}</p>}
                </div>

              </div>
              <VehicleSafetySection vehicle={v} />

              <button
                onClick={async () => {
                  if (expandedVehicle === v.id) { setExpandedVehicle(null); return; }
                  setExpandedVehicle(v.id);
                  if (!studentCache[v.id]) {
                    try {
                      const res = await api.get(`/affiliation/students?vehicle_id=${v.id}&per_page=100`);
                      setStudentCache(c => ({ ...c, [v.id]: res.data.data }));
                    } catch {}
                  }
                }}
                className="mt-3 text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                {expandedVehicle === v.id ? '▲ ซ่อนรายชื่อนักเรียน' : '▼ แสดงรายชื่อนักเรียน'}
              </button>

              {expandedVehicle === v.id && studentCache[v.id] && (
                <div className="mt-2 border-t border-gray-100 pt-2 overflow-x-auto">
                  {studentCache[v.id].length === 0 ? (
                    <p className="text-xs text-gray-400 py-2">ไม่มีนักเรียน</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 text-left">
                          <th className="py-1.5 pr-3 font-medium">ชื่อ-นามสกุล</th>
                          <th className="py-1.5 pr-3 font-medium">ชั้น/ห้อง</th>
                          <th className="py-1.5 pr-3 font-medium">โรงเรียน</th>
                          <th className="py-1.5 pr-3 font-medium">ผู้ปกครอง</th>
                          <th className="py-1.5 font-medium">เบอร์โทร</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {studentCache[v.id].map(s => (
                          <tr key={s.id}>
                            <td className="py-1.5 pr-3 text-gray-700">{s.prefix}{s.first_name} {s.last_name}</td>
                            <td className="py-1.5 pr-3 text-gray-500">{s.grade && s.classroom ? `${s.grade}/${s.classroom}` : s.grade || '-'}</td>
                            <td className="py-1.5 pr-3 text-gray-600">{s.school_name || '-'}</td>
                            <td className="py-1.5 pr-3 text-gray-600">{s.parent_name || '-'}</td>
                            <td className="py-1.5 text-gray-400">{s.parent_phone || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
