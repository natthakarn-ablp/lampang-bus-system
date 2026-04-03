import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';

export default function AffEmergencyList() {
  const [emergencies, setEmergencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState({ page: 1, per_page: 20, total: 0 });

  const fetchEmergencies = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/affiliation/emergencies?page=${page}&per_page=20`);
      setEmergencies(res.data.data);
      setMeta(res.data.meta);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmergencies(1);
  }, [fetchEmergencies]);

  const totalPages = Math.ceil(meta.total / meta.per_page) || 1;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-4">เหตุฉุกเฉิน</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : emergencies.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400 text-lg mb-1">ไม่มีเหตุฉุกเฉิน</p>
          <p className="text-gray-300 text-sm">ยังไม่มีรายงานเหตุฉุกเฉินจากรถในสังกัดนี้</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {emergencies.map((em) => (
              <div key={em.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-red-500 font-medium text-sm">🚨</span>
                    <span className="font-semibold text-gray-800">{em.plate_no}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      em.channel === 'line'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}>
                      {em.channel === 'line' ? 'LINE' : 'เว็บ'}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(em.reported_at).toLocaleString('th-TH', {
                      year: 'numeric', month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>

                <p className="text-sm text-gray-700 mb-2">{em.detail}</p>

                {em.note && (
                  <p className="text-xs text-gray-500">
                    <span className="font-medium">หมายเหตุ:</span> {em.note}
                  </p>
                )}
                {em.result && (
                  <p className="text-xs text-gray-500 mt-1">
                    <span className="font-medium">ผลลัพธ์:</span> {em.result}
                  </p>
                )}
                {em.reported_by_name && (
                  <p className="text-xs text-gray-400 mt-2">
                    รายงานโดย: {em.reported_by_name}
                  </p>
                )}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
              <span>แสดง {emergencies.length} จาก {meta.total} รายการ</span>
              <div className="flex gap-2">
                <button
                  onClick={() => fetchEmergencies(meta.page - 1)}
                  disabled={meta.page <= 1}
                  className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-30"
                >
                  ก่อนหน้า
                </button>
                <span className="px-3 py-1">หน้า {meta.page}/{totalPages}</span>
                <button
                  onClick={() => fetchEmergencies(meta.page + 1)}
                  disabled={meta.page >= totalPages}
                  className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-30"
                >
                  ถัดไป
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
