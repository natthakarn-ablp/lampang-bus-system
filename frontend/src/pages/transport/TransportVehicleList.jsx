import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bus } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import Pagination from '../../components/Pagination';
import { StatusBadge, DataTable, FilterBar, FormField, Modal, TableAction } from '../../components/ui';
import { useToast } from '../../components/Toast';
import AdminVehicleActions from '../../components/AdminVehicleActions';
import { useAuth } from '../../hooks/useAuth';
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
  const toast = useToast();
  // Admin also opens this page (/transport allows admin): delete and duplicate
  // merge are admin-only endpoints, so the buttons show only for admin.
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // 2026-11-13 — transport keeps document expiry dates and fixes plate typos
  // itself (PUT .../document-expiry, POST .../fix-plate), no admin hand-off.
  const [docTarget, setDocTarget] = useState(null);
  const [docForm, setDocForm] = useState({});
  const [plateTarget, setPlateTarget] = useState(null);
  const [plateForm, setPlateForm] = useState({ plate_no: '', reason: '' });
  const [saving, setSaving] = useState(false);
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

  function openDocs(v) {
    setDocTarget(v);
    setDocForm({
      registration_expiry: toBangkokDate(v.registration_expiry) || '',
      compulsory_insurance_expiry: toBangkokDate(v.compulsory_insurance_expiry) || '',
      tax_expiry: toBangkokDate(v.tax_expiry) || '',
    });
  }
  async function saveDocs() {
    setSaving(true);
    try {
      const res = await api.put(`/transport/vehicles/${encodeURIComponent(docTarget.id)}/document-expiry`, docForm);
      toast.success(res.data?.message || 'บันทึกแล้ว');
      setDocTarget(null);
      fetchVehicles(meta.page);
    } catch (err) {
      toast.error(err.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally { setSaving(false); }
  }
  function openPlate(v) {
    setPlateTarget(v);
    setPlateForm({ plate_no: v.plate_no || '', reason: '' });
  }
  async function savePlate() {
    setSaving(true);
    try {
      const res = await api.post(`/transport/vehicles/${encodeURIComponent(plateTarget.id)}/fix-plate`, plateForm);
      toast.success(res.data?.message || 'แก้ทะเบียนแล้ว');
      setPlateTarget(null);
      fetchVehicles(meta.page);
    } catch (err) {
      toast.error(err.response?.data?.message || 'แก้ทะเบียนไม่สำเร็จ');
    } finally { setSaving(false); }
  }
  const plateChanged = Boolean(plateTarget && plateForm.plate_no.trim() && plateForm.plate_no.trim() !== plateTarget.plate_no);

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
        actionsHeader="จัดการ"
        actions={v => <><Link to={`/transport/vehicles/${encodeURIComponent(v.id)}/incident-roster`} aria-label={`ดูนักเรียนและข้อมูลรถ ${v.plate_no}`} className="focus-ring inline-flex items-center justify-center min-h-12 px-4 py-2 rounded-xl bg-brand-700 text-white font-semibold">ดูนักเรียนและข้อมูลรถ</Link>
          <TableAction tone="neutral" onClick={() => openDocs(v)} aria-label={`แก้วันหมดอายุเอกสาร ${v.plate_no}`}>วันหมดอายุเอกสาร</TableAction>
          <TableAction tone="neutral" onClick={() => openPlate(v)} aria-label={`แก้ทะเบียนพิมพ์ผิด ${v.plate_no}`}>แก้ทะเบียน</TableAction>
          {isAdmin && <AdminVehicleActions vehicle={v} onChanged={() => fetchVehicles(meta.page)} />}</>}
        columns={[
          { key: 'plate', header: 'ทะเบียนรถ', primary: true,
            cell: v => <Link to={`/transport/vehicles/${encodeURIComponent(v.id)}/incident-roster`} className="flex min-h-[44px] items-center whitespace-normal break-words font-semibold text-brand-700 underline focus-ring rounded">{v.plate_no}</Link> },
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

      <Modal
        open={Boolean(docTarget)}
        title={`วันหมดอายุเอกสาร: ${docTarget?.plate_no || ''}`}
        size="sm"
        onClose={() => { if (!saving) setDocTarget(null); }}
        footer={
          <>
            <button type="button" onClick={() => setDocTarget(null)} disabled={saving}
              className="focus-ring text-base font-medium px-4 min-h-[44px] rounded-lg border border-surface-border text-ink hover:bg-surface transition disabled:opacity-50">ยกเลิก</button>
            <button type="submit" form="transport-doc-expiry-form" disabled={saving}
              className="focus-ring text-base font-semibold px-4 min-h-[44px] rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition disabled:opacity-50">
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </>
        }
      >
        <form id="transport-doc-expiry-form" onSubmit={e => { e.preventDefault(); saveDocs(); }} className="space-y-3">
          <p className="text-sm text-ink-muted">ระบบคำนวณสถานะความพร้อมของรถใหม่ทันทีหลังบันทึก · เว้นว่างหากยังไม่มีข้อมูล · ประกันภัยภาคสมัครใจให้เจ้าของรถหรือคนขับแก้ในระบบคนขับ</p>
          <FormField label="ทะเบียนรถ (เล่มทะเบียน) หมดอายุ" type="date" value={docForm.registration_expiry}
            onChange={val => setDocForm({ ...docForm, registration_expiry: val })} />
          <FormField label="พ.ร.บ. หมดอายุ" type="date" value={docForm.compulsory_insurance_expiry}
            onChange={val => setDocForm({ ...docForm, compulsory_insurance_expiry: val })} />
          <FormField label="ภาษีรถหมดอายุ" type="date" value={docForm.tax_expiry}
            onChange={val => setDocForm({ ...docForm, tax_expiry: val })} />
        </form>
      </Modal>

      <Modal
        open={Boolean(plateTarget)}
        title="แก้ทะเบียนรถที่พิมพ์ผิด"
        size="sm"
        onClose={() => { if (!saving) setPlateTarget(null); }}
        footer={
          <>
            <button type="button" onClick={() => setPlateTarget(null)} disabled={saving}
              className="focus-ring text-base font-medium px-4 min-h-[44px] rounded-lg border border-surface-border text-ink hover:bg-surface transition disabled:opacity-50">ยกเลิก</button>
            <button type="submit" form="transport-fix-plate-form" disabled={saving || !plateChanged || !plateForm.reason.trim()}
              className="focus-ring text-base font-semibold px-4 min-h-[44px] rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition disabled:opacity-50">
              {saving ? 'กำลังบันทึก…' : 'แก้ทะเบียน'}
            </button>
          </>
        }
      >
        <form id="transport-fix-plate-form" onSubmit={e => { e.preventDefault(); savePlate(); }} className="space-y-3">
          <p className="text-sm text-ink-muted">ทะเบียนเดิม: <strong className="text-ink">{plateTarget?.plate_no}</strong></p>
          <p className="text-sm text-warn-ink">
            ชื่อผู้ใช้ของคนขับคือทะเบียนรถ เมื่อแก้แล้วคนขับต้องเข้าสู่ระบบด้วยทะเบียนใหม่ (รหัสผ่านเดิม) กรุณาแจ้งคนขับ ·
            ถ้าเป็นรถซ้ำสองคันให้แจ้งผู้ดูแลระบบรวมรถแทน
          </p>
          <FormField label="ทะเบียนใหม่ (พร้อมจังหวัด)" required value={plateForm.plate_no} placeholder="เช่น นข 1234 ลำปาง"
            onChange={val => setPlateForm({ ...plateForm, plate_no: val })} />
          <FormField label="เหตุผล" required value={plateForm.reason} placeholder="เช่น พิมพ์ตัวอักษรผิดตอนเพิ่มรถ"
            onChange={val => setPlateForm({ ...plateForm, reason: val })} maxLength={500} />
        </form>
      </Modal>

      {!loading && !searching && !error && totalPages > 1 && (
        <Pagination page={meta.page} totalPages={totalPages} total={meta.total} shown={vehicles.length} unit="คัน" onPage={(p) => fetchVehicles(p)} />
      )}
    </div>
  );
}
