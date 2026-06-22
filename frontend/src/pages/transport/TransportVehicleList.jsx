import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Bus } from 'lucide-react';
import api from '../../api/axios';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import AppCard from '../../components/ui/AppCard';
import StatusBadge from '../../components/ui/StatusBadge';
import PlateSearchInput from '../../components/PlateSearchInput';
import Pagination from '../../components/Pagination';

const RESULT_BADGE = {
  PASSED:   { label: 'ผ่าน',      variant: 'success' },
  FAILED:   { label: 'ไม่ผ่าน',   variant: 'danger' },
  NEEDS_FIX:{ label: 'ต้องแก้ไข', variant: 'warn' },
  PENDING:  { label: 'รอตรวจ',    variant: 'neutral' },
};

// Phase 10.7A — combined document expiry: pick the nearest of the 4 dates
// per vehicle, return { earliest, status }. status is:
//   'expired'  — at least one doc is past CURDATE()
//   'expiring' — none expired but at least one is within 30 days
//   'ok'       — none expired or expiring (or all NULL — treat as no signal)
const DOC_EXPIRY_FIELDS = [
  'insurance_expiry',
  'registration_expiry',
  'compulsory_insurance_expiry',
  'tax_expiry',
];

function docExpiryStatus(v) {
  const now = Date.now();
  const limit = now + 30 * 86400000;
  let earliest = null;
  let anyExpired = false;
  let anyExpiring = false;
  for (const f of DOC_EXPIRY_FIELDS) {
    if (!v[f]) continue;
    const t = new Date(v[f]).getTime();
    if (earliest == null || t < earliest) earliest = t;
    if (t < now) anyExpired = true;
    else if (t <= limit) anyExpiring = true;
  }
  return {
    earliest: earliest != null ? new Date(earliest).toISOString().slice(0, 10) : null,
    status: anyExpired ? 'expired' : anyExpiring ? 'expiring' : 'ok',
  };
}

export default function TransportVehicleList() {
  const location = useLocation();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ page: 1, per_page: 50, total: 0 });
  // Phase 10.7A — accept ?status=docs_expiring / docs_expired from the
  // dashboard tap-through so the page lands pre-filtered.
  const initialStatus = new URLSearchParams(location.search).get('status') || '';
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  // Plate search — debounced + server-side (searches across all pages, not just
  // the loaded 50). The transport list is paginated, so client-only filtering
  // would miss matches on other pages.
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const fetchVehicles = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('per_page', '50');
      if (statusFilter) params.set('status', statusFilter);
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
      const res = await api.get(`/transport/vehicles?${params}`);
      setVehicles(res.data.data);
      setMeta(res.data.meta);
    } catch {} finally { setLoading(false); }
  }, [statusFilter, debouncedSearch]);

  useEffect(() => { fetchVehicles(1); }, [fetchVehicles]);

  const totalPages = Math.ceil(meta.total / meta.per_page) || 1;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-4">รถรับส่งทั้งหมด</h1>

      <div className="flex flex-wrap gap-3 mb-5">
        <PlateSearchInput value={search} onChange={setSearch} placeholder="ค้นหาทะเบียนรถ…" className="w-full sm:w-72" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
          <option value="">ทุกสถานะ</option>
          <option value="expiring">ประกันใกล้หมด (30 วัน)</option>
          <option value="expired">ประกันหมดแล้ว</option>
          {/* Phase 10.7A — combined-document filters across 4 expiry fields */}
          <option value="docs_expiring">เอกสารใกล้หมด (30 วัน)</option>
          <option value="docs_expired">เอกสารหมดอายุ</option>
        </select>
      </div>

      {loading ? (
        <LoadingState />
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
                  <th className="px-4 py-3 text-center">ผลตรวจล่าสุด</th>
                  <th className="px-4 py-3">วันตรวจ</th>
                  <th className="px-4 py-3">ประกันหมดอายุ</th>
                  <th className="px-4 py-3">เอกสาร</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {vehicles.map(v => {
                  const badge = RESULT_BADGE[v.latest_inspection_result] || { label: 'ยังไม่ตรวจ', variant: 'neutral' };
                  const insExpired = v.insurance_expiry && new Date(v.insurance_expiry) < new Date();
                  const docs = docExpiryStatus(v);
                  const docCellClass =
                    docs.status === 'expired'  ? 'text-red-600 font-medium'  :
                    docs.status === 'expiring' ? 'text-amber-600 font-medium' :
                                                 'text-gray-500';
                  const docLabel = docs.earliest
                    ? (docs.status === 'expired'  ? `หมดอายุ · ${docs.earliest}` :
                       docs.status === 'expiring' ? `ใกล้หมด · ${docs.earliest}` :
                                                    docs.earliest)
                    : '-';
                  return (
                    <tr key={v.id} className="hover:bg-surface transition">
                      <td className="px-4 py-3 font-medium text-gray-800">{v.plate_no}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{v.vehicle_type || '-'}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{v.driver_name || '-'}</td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge variant={badge.variant} size="sm">{badge.label}</StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{v.latest_inspection_date || '-'}</td>
                      <td className={`px-4 py-3 text-xs ${insExpired ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                        {v.insurance_expiry || '-'}
                      </td>
                      <td className={`px-4 py-3 text-xs ${docCellClass}`}>
                        {docLabel}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </AppCard>

          {totalPages > 1 && (
            <Pagination page={meta.page} totalPages={totalPages} total={meta.total} shown={vehicles.length} unit="คัน" onPage={(p) => fetchVehicles(p)} />
          )}
        </>
      )}
    </div>
  );
}
