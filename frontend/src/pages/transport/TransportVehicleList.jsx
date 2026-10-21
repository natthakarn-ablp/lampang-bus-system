import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bus } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import Pagination from '../../components/Pagination';
import { StatusBadge, DataTable, FilterBar } from '../../components/ui';
import { toBangkokDate } from '../../utils/thaiTime';

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
    earliest: earliest != null ? toBangkokDate(new Date(earliest)) : null,
    status: anyExpired ? 'expired' : anyExpiring ? 'expiring' : 'ok',
  };
}

export default function TransportVehicleList() {
  const location = useLocation();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const currentRequest = useRef(null);
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
    currentRequest.current?.abort();
    const controller = new AbortController();
    currentRequest.current = controller;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('per_page', '50');
      if (statusFilter) params.set('status', statusFilter);
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
      const res = await api.get(`/transport/vehicles?${params}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setVehicles(Array.isArray(res.data.data) ? res.data.data : []);
      setMeta(res.data.meta);
    } catch {
      if (!controller.signal.aborted) setError('ยังโหลดรายการรถไม่ได้ กรุณาลองใหม่อีกครั้ง');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [statusFilter, debouncedSearch]);

  useEffect(() => {
    fetchVehicles(1);
    return () => currentRequest.current?.abort();
  }, [fetchVehicles]);

  const searching = search.trim() !== debouncedSearch.trim();

  const totalPages = Math.ceil(meta.total / meta.per_page) || 1;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="ค้นรถและนักเรียน"
        subtitle="ค้นทะเบียนและจังหวัด แล้วเลือกดูรายชื่อนักเรียนหรือบันทึกขึ้น–ลงของรถคันนั้น"
      />

      <div className="mb-4 rounded-2xl border border-surface-border bg-surface-raised p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="transport-plate-search" className="block text-base font-semibold text-ink">ทะเบียนรถหรือจังหวัด</label>
          {search && <button type="button" onClick={() => setSearch('')} className="focus-ring min-h-11 rounded-lg px-3 text-brand-700 underline">ล้างคำค้น</button>}
        </div>
        <input id="transport-plate-search" type="search" value={search} onChange={event => setSearch(event.target.value)}
          placeholder="เช่น นข 1234 หรือ ลำปาง" className="focus-ring mt-2 block min-h-12 w-full rounded-xl border border-surface-border bg-surface-raised px-3 text-base" />
        <p className="mt-2 text-sm text-ink-muted">ค้นจากรถทุกหน้า ตรวจทะเบียนและจังหวัดให้ตรงก่อนเปิดข้อมูล</p>
      </div>

      <details className="mb-4 rounded-xl border border-surface-border p-3" open={!!statusFilter}>
      <summary className="focus-ring min-h-11 cursor-pointer rounded-lg py-2 font-medium text-ink">กรองสถานะเอกสาร (ถ้าต้องการ)</summary>
      <FilterBar
        className="mb-5"
        filters={[{
          key: 'status',
          label: 'กรองตามสถานะเอกสาร',
          value: statusFilter,
          onChange: setStatusFilter,
          options: [
            ['', 'ทุกสถานะ'],
            ['expiring', 'ประกันใกล้หมด (30 วัน)'],
            ['expired', 'ประกันหมดแล้ว'],
            // Phase 10.7A — combined-document filters across 4 expiry fields
            ['docs_expiring', 'เอกสารใกล้หมด (30 วัน)'],
            ['docs_expired', 'เอกสารหมดอายุ'],
          ],
        }]}
        onClear={statusFilter || search ? () => { setStatusFilter(''); setSearch(''); } : undefined}
      />
      </details>
      {!loading && !searching && !error && <p role="status" className="mb-3 text-sm text-ink-muted">พบ {meta.total} คัน · กดทะเบียนหรือปุ่มเพื่อดูนักเรียนและข้อมูลรถ</p>}

      <DataTable
        caption="รายการรถรับส่งและสถานะการตรวจสภาพ"
        loading={loading || searching}
        error={error}
        onRetry={() => fetchVehicles(meta.page)}
        rows={vehicles}
        rowKey={v => v.id}
        actionsHeader="ข้อมูลเมื่อเกิดเหตุ"
        actions={v => <Link to={`/transport/vehicles/${encodeURIComponent(v.id)}/incident-roster`} aria-label={`ดูนักเรียนและข้อมูลรถ ${v.plate_no}`} className="focus-ring inline-flex items-center justify-center min-h-12 px-4 py-2 rounded-xl bg-brand-700 text-white font-semibold">ดูนักเรียนและข้อมูลรถ</Link>}
        columns={[
          { key: 'plate', header: 'ทะเบียนรถ', primary: true,
            cell: v => <Link to={`/transport/vehicles/${encodeURIComponent(v.id)}/incident-roster`} className="block whitespace-normal break-words font-semibold text-brand-700 underline focus-ring rounded">{v.plate_no}</Link> },
          { key: 'type', header: 'ประเภท', secondary: true, cell: v => v.vehicle_type || '-' },
          { key: 'driver', header: 'คนขับ', cell: v => v.driver_name || '-' },
          { key: 'result', header: 'ผลตรวจล่าสุด', align: 'center', badge: true,
            cell: v => {
              const badge = RESULT_BADGE[v.latest_inspection_result] || { label: 'ยังไม่ตรวจ', variant: 'neutral' };
              return <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>;
            } },
          { key: 'inspected', header: 'วันตรวจ', hideOnMobile: true, cell: v => v.latest_inspection_date || '-' },
          { key: 'insurance', header: 'ประกันหมดอายุ',
            cell: v => {
              const expired = v.insurance_expiry && new Date(v.insurance_expiry) < new Date();
              // Expiry state carries a word as well as a colour — a red date
              // alone does not say what is wrong with it.
              return (
                <span className={expired ? 'text-danger-ink font-medium' : 'text-ink-muted'}>
                  {v.insurance_expiry || '-'}{expired ? ' · หมดอายุ' : ''}
                </span>
              );
            } },
          { key: 'docs', header: 'เอกสาร',
            cell: v => {
              const docs = docExpiryStatus(v);
              if (!docs.earliest) return <span className="text-ink-muted">-</span>;
              const cls = docs.status === 'expired'  ? 'text-danger-ink font-medium'
                        : docs.status === 'expiring' ? 'text-warn-ink font-medium'
                        :                              'text-ink-muted';
              const label = docs.status === 'expired'  ? `หมดอายุ · ${docs.earliest}`
                          : docs.status === 'expiring' ? `ใกล้หมด · ${docs.earliest}`
                          :                              docs.earliest;
              return <span className={cls}>{label}</span>;
            } },
        ]}
        empty={{
          icon: Bus,
          title: search || statusFilter ? 'ไม่พบรถที่ตรงกับการค้นหา' : 'ยังไม่มีรถในรายการ',
          description: search ? 'ตรวจทะเบียนและจังหวัด หรือล้างคำค้นเพื่อดูรถทั้งหมด' : statusFilter ? 'ลองเปลี่ยนตัวกรองเพื่อดูผลอื่น' : 'ยังไม่มีข้อมูลรถให้เปิดดู',
        }}
      />

      {!loading && !searching && !error && totalPages > 1 && (
        <Pagination page={meta.page} totalPages={totalPages} total={meta.total} shown={vehicles.length} unit="คัน" onPage={(p) => fetchVehicles(p)} />
      )}
    </div>
  );
}
