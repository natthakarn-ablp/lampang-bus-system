import { useState, useEffect, useCallback } from 'react';
import { Bus } from 'lucide-react';
import api from '../../api/axios';
import EmptyState from '../../components/EmptyState';
import AppCard from '../../components/ui/AppCard';
import StatusBadge from '../../components/ui/StatusBadge';

const RESULT_BADGE = {
  PASSED:   { label: 'ผ่าน',      variant: 'success' },
  FAILED:   { label: 'ไม่ผ่าน',   variant: 'danger' },
  NEEDS_FIX:{ label: 'ต้องแก้ไข', variant: 'warn' },
  PENDING:  { label: 'รอตรวจ',    variant: 'neutral' },
};

export default function TransportVehicleList() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ page: 1, per_page: 50, total: 0 });
  const [statusFilter, setStatusFilter] = useState('');

  const fetchVehicles = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('per_page', '50');
      if (statusFilter) params.set('status', statusFilter);
      const res = await api.get(`/transport/vehicles?${params}`);
      setVehicles(res.data.data);
      setMeta(res.data.meta);
    } catch {} finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { fetchVehicles(1); }, [fetchVehicles]);

  const totalPages = Math.ceil(meta.total / meta.per_page) || 1;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-4">รถรับส่งทั้งหมด</h1>

      <div className="flex flex-wrap gap-3 mb-5">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
          <option value="">ทุกสถานะ</option>
          <option value="expiring">ประกันใกล้หมด (30 วัน)</option>
          <option value="expired">ประกันหมดแล้ว</option>
        </select>
      </div>

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : vehicles.length === 0 ? (
        <EmptyState
          icon={Bus}
          title="ไม่พบรถในระบบ"
          description={statusFilter ? 'ลองเปลี่ยนตัวกรองเพื่อดูผลอื่น' : 'ยังไม่มีรถในรายการให้ตรวจ'}
        />
      ) : (
        <>
          <AppCard padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-ink-muted text-xs font-semibold uppercase tracking-wide">
                <tr className="text-left">
                  <th className="px-4 py-3">ทะเบียนรถ</th>
                  <th className="px-4 py-3">ประเภท</th>
                  <th className="px-4 py-3">คนขับ</th>
                  <th className="px-4 py-3 text-center">นักเรียน</th>
                  <th className="px-4 py-3 text-center">ผลตรวจล่าสุด</th>
                  <th className="px-4 py-3">วันตรวจ</th>
                  <th className="px-4 py-3">ประกันหมดอายุ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {vehicles.map(v => {
                  const badge = RESULT_BADGE[v.latest_inspection_result] || { label: 'ยังไม่ตรวจ', variant: 'neutral' };
                  const insExpired = v.insurance_expiry && new Date(v.insurance_expiry) < new Date();
                  return (
                    <tr key={v.id} className="hover:bg-surface transition">
                      <td className="px-4 py-3 font-medium text-gray-800">{v.plate_no}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{v.vehicle_type || '-'}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{v.driver_name || '-'}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{v.student_count}</td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge variant={badge.variant} size="sm">{badge.label}</StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{v.latest_inspection_date || '-'}</td>
                      <td className={`px-4 py-3 text-xs ${insExpired ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                        {v.insurance_expiry || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </AppCard>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
              <span>แสดง {vehicles.length} จาก {meta.total} คัน</span>
              <div className="flex gap-2">
                <button onClick={() => fetchVehicles(meta.page - 1)} disabled={meta.page <= 1}
                  className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-30">ก่อนหน้า</button>
                <span className="px-3 py-1">หน้า {meta.page}/{totalPages}</span>
                <button onClick={() => fetchVehicles(meta.page + 1)} disabled={meta.page >= totalPages}
                  className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-30">ถัดไป</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
