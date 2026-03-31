import { useState, useEffect } from 'react';
import api from '../../api/axios';

export default function VehicleList() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/school/vehicles')
      .then((res) => setVehicles(res.data.data))
      .catch((err) => setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-4">รถรับส่งนักเรียน</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : vehicles.length === 0 ? (
        <p className="text-gray-400 py-10 text-center">ไม่มีรถรับส่ง</p>
      ) : (
        <div className="grid gap-4">
          {vehicles.map((v) => (
            <div
              key={`${v.id}-${v.driver_name || ''}-${v.attendant_name || ''}`}
              className="bg-white rounded-xl border border-gray-200 p-5"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-800">{v.plate_no}</h3>
                  <p className="text-xs text-gray-500">{v.vehicle_type || 'ไม่ระบุประเภท'}</p>
                </div>
                <span className="text-sm font-medium bg-blue-50 text-blue-700 px-3 py-1 rounded-full">
                  {v.student_count} คน
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                {/* Driver */}
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">คนขับ</p>
                  <p className="text-gray-700">{v.driver_name || '-'}</p>
                  {v.driver_phone && (
                    <p className="text-xs text-gray-400">{v.driver_phone}</p>
                  )}
                </div>

                {/* Attendant */}
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">ผู้ดูแลรถ</p>
                  <p className="text-gray-700">{v.attendant_name || '-'}</p>
                  {v.attendant_phone && (
                    <p className="text-xs text-gray-400">{v.attendant_phone}</p>
                  )}
                </div>

                {/* Owner */}
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">เจ้าของรถ</p>
                  <p className="text-gray-700">{v.owner_name || '-'}</p>
                  {v.owner_phone && (
                    <p className="text-xs text-gray-400">{v.owner_phone}</p>
                  )}
                </div>

                {/* Insurance */}
                <div className="col-span-2 md:col-span-3 border-t border-gray-100 pt-3 mt-1">
                  <p className="text-xs text-gray-400 mb-0.5">ประกันภัย</p>
                  <div className="flex items-center gap-3 text-sm">
                    <span className={`font-medium ${v.insurance_status === 'มี' ? 'text-green-600' : 'text-red-600'}`}>
                      {v.insurance_status || 'ไม่ระบุ'}
                    </span>
                    {v.insurance_type && (
                      <span className="text-gray-500">({v.insurance_type})</span>
                    )}
                    {v.insurance_expiry && (
                      <span className="text-gray-400 text-xs">
                        หมดอายุ: {new Date(v.insurance_expiry).toLocaleDateString('th-TH')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
