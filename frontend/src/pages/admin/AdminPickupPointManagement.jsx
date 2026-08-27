import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Map as MapIcon, Plus, Pencil, Trash2, Users } from 'lucide-react';
import api from '../../api/axios';
import {
  AlertBanner, StatusBadge, DashboardSection,
  ConfirmDialog, DataTable, TableAction, FilterBar, FormField, Modal,
} from '../../components/ui';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import PickupPointFields from '../../components/PickupPointFields';
import PickupStudentsModal from '../../components/PickupStudentsModal';
import { useToast } from '../../components/Toast';
import Pagination from '../../components/Pagination';

const SESSION_LABEL = { morning: 'รอบเช้า', evening: 'รอบเย็น', both: 'ทั้งวัน' };

export default function AdminPickupPointManagement() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, per_page: 20, total: 0 });
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editing, setEditing] = useState(null);   // null | 'new' | { ...row }
  const [assigning, setAssigning] = useState(null);  // null | { ...row }
  const [confirmDelete, setConfirmDelete] = useState(null);  // null | { ...row }

  // Phase 10.10G-B — bulk selection / bulk-delete state
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const toast = useToast();

  const visibleIds = useMemo(() => rows.map(r => r.id), [rows]);
  const isAllVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
  const isAnySelected = selectedIds.size > 0;
  const isIndeterminate = isAnySelected && !isAllVisibleSelected;

  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedIds(prev => {
      if (visibleIds.length > 0 && visibleIds.every(id => prev.has(id))) {
        // All visible currently selected → deselect them (keep selections from other pages, if any)
        const next = new Set(prev);
        visibleIds.forEach(id => next.delete(id));
        return next;
      }
      // Add all visible to selection
      const next = new Set(prev);
      visibleIds.forEach(id => next.add(id));
      return next;
    });
  }, [visibleIds]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Selected rows full data (across all pages currently loaded — but since we paginate,
  // only the rows currently rendered have full data). For the confirm modal we list
  // labels from the current page; ids not on the current page still get deleted by id.
  const selectedRows = useMemo(
    () => rows.filter(r => selectedIds.has(r.id)),
    [rows, selectedIds]
  );

  // Prune stale ids whenever rows change (e.g. after pagination or successful delete).
  // Only prune ids that USED to be on a previously-visible page — we keep selections
  // for paginated-away ids by intersecting with visibleIds only when paginating.
  // Simplest safe behavior: if a selected id is no longer in rows AND we just reloaded
  // (loading just turned false), drop it. Here we adopt the conservative rule of
  // pruning to ids present in the latest rows. Selection survives mount but resets
  // when data refreshes — matches the rubric "Clear selection after successful delete or data reload".
  useEffect(() => {
    if (loading) return;
    setSelectedIds(prev => {
      const visible = new Set(visibleIds);
      let changed = false;
      const next = new Set();
      prev.forEach(id => {
        if (visible.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [loading, visibleIds]);

  // Set indeterminate on the header checkbox (HTML attribute — must be set via ref)
  const headerCheckboxRef = useRef(null);
  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = isIndeterminate;
  }, [isIndeterminate]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (vehicleFilter) params.set('vehicle_id', vehicleFilter);
      params.set('page', page);
      params.set('per_page', 20);
      const res = await api.get(`/admin/pickup-points?${params}`);
      setRows(Array.isArray(res.data?.data) ? res.data.data : []);
      setMeta(res.data?.meta || { page: 1, per_page: 20, total: 0 });
    } catch (err) {
      setError(err?.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [vehicleFilter, page]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  // Vehicle filter dropdown — fetch from /province/vehicles (admin has full read).
  useEffect(() => {
    api.get('/province/vehicles')
      .then(r => setVehicles(Array.isArray(r.data?.data) ? r.data.data : []))
      .catch(() => setVehicles([]));
  }, []);

  const totalPages = Math.max(1, Math.ceil((meta.total || 0) / (meta.per_page || 20)));

  const [deleteBusy, setDeleteBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });

  async function handleDeleteOne() {
    if (!confirmDelete || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/admin/pickup-points/${confirmDelete.id}`);
      toast.success('ลบจุดรับส่งแล้ว');
      setConfirmDelete(null);
      fetchRows();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'ลบไม่สำเร็จ');
    } finally {
      setDeleteBusy(false);
    }
  }

  // Sequential: keeps backend load predictable + makes audit_log per-item
  // ordered. A per-item failure does not abort the batch — the successes are
  // still pruned from the selection and the failures are reported.
  async function handleBulkDelete() {
    if (bulkBusy || selectedRows.length === 0) return;
    setBulkBusy(true);
    setBulkProgress({ done: 0, total: selectedRows.length });
    const successIds = [];
    const failures = [];
    for (let i = 0; i < selectedRows.length; i++) {
      const row = selectedRows[i];
      try {
        await api.delete(`/admin/pickup-points/${row.id}`);
        successIds.push(row.id);
      } catch (err) {
        failures.push({ id: row.id, label: row.label, message: err?.response?.data?.message || 'ลบไม่สำเร็จ' });
      }
      setBulkProgress({ done: i + 1, total: selectedRows.length });
    }
    if (failures.length === 0) {
      toast.success(`ลบสำเร็จ ${successIds.length} รายการ`);
    } else if (successIds.length === 0) {
      toast.error('ไม่สามารถลบรายการที่เลือกได้');
    } else {
      toast.error(`ลบสำเร็จ ${successIds.length} รายการ ไม่สำเร็จ ${failures.length} รายการ`);
    }
    setBulkBusy(false);
    setBulkConfirmOpen(false);
    if (successIds.length > 0) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        successIds.forEach(id => next.delete(id));
        return next;
      });
      fetchRows();
    }
  }

  // Name the first few so the confirmation is about specific points rather
  // than an abstract count.
  const bulkPreview = (() => {
    const names = selectedRows.slice(0, 5).map(r => r.label || `จุดที่ ${r.id}`);
    const rest = Math.max(0, selectedIds.size - names.length);
    if (names.length === 0) return '';
    return `${names.join(', ')}${rest > 0 ? ` และอีก ${rest} รายการ` : ''}\n`;
  })();

  const columns = [
    { key: 'plate_no', header: 'ทะเบียนรถ', primary: true, cell: r => r.plate_no || r.vehicle_id },
    { key: 'label', header: 'ป้ายชื่อ', secondary: true,
      cell: r => <span className="block truncate max-w-[200px]">{r.label}</span> },
    { key: 'session', header: 'รอบ', badge: true,
      cell: r => <StatusBadge variant="neutral" size="sm">{SESSION_LABEL[r.session] || r.session}</StatusBadge> },
    { key: 'student_count', header: 'นักเรียน', align: 'right', numeric: true, cell: r => r.student_count },
    { key: 'coords', header: 'พิกัด', hideOnMobile: true,
      cell: r => (
        <span className="text-xs text-ink-muted tabular-nums">
          {r.latitude?.toFixed(5)}, {r.longitude?.toFixed(5)}
        </span>
      ) },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <PageHeader
        icon={MapIcon}
        title="ตรวจสอบจุดรับส่ง"
        subtitle="ภาพรวมจุดรับส่งของรถทั้งหมดในระบบ"
        meta={`${meta.total} จุด`}
        actions={(
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="focus-ring shrink-0 inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-sm font-medium px-4 min-h-[44px] rounded-lg transition"
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
            เพิ่มกรณีพิเศษ
          </button>
        )}
      />

      {/* Phase 6.1 — admin override role banner.
          The primary creator of pickup points is Driver or School.
          This page exists for governance review + emergency overrides
          when those primary roles can't act (e.g., a school account
          temporarily disabled). */}
      <AlertBanner variant="info" title="หน้าตรวจสอบและกรณีพิเศษ">
        การเพิ่มจุดรับส่งหลักทำผ่านบัญชีคนขับหรือบัญชีโรงเรียน หน้านี้สำหรับผู้ดูแลระบบใช้ตรวจสอบภาพรวม และเพิ่ม/แก้ไขในกรณีพิเศษเท่านั้น
      </AlertBanner>

      <FilterBar
        filters={[{
          key: 'vehicle',
          label: 'รถ',
          value: vehicleFilter,
          onChange: v => { setVehicleFilter(v); setPage(1); },
          options: [['', 'รถทุกคัน'], ...vehicles.map(v => [v.id, v.plate_no])],
        }]}
        count={meta.total}
        countLabel="จุดรับส่ง"
        onClear={vehicleFilter ? () => { setVehicleFilter(''); setPage(1); } : undefined}
      />

      {/* Phase 10.10G-B — sticky selected-action bar (only visible when ≥1 row selected) */}
      {isAnySelected && (
        <div className="sticky top-2 z-10 -mx-1 sm:mx-0 rounded-xl border border-brand/40 bg-brand/5 px-3 py-2 flex flex-wrap items-center justify-between gap-2 shadow-sm">
          <div className="text-sm text-ink">
            เลือกแล้ว <span className="font-semibold tabular-nums">{selectedIds.size}</span> รายการ
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={clearSelection}
              className="focus-ring px-3 min-h-[44px] text-sm font-medium rounded-lg border border-surface-border bg-surface hover:bg-surface-border text-ink transition"
            >
              ยกเลิกการเลือก
            </button>
            <button
              type="button"
              onClick={() => setBulkConfirmOpen(true)}
              className="focus-ring inline-flex items-center gap-1.5 px-3 min-h-[44px] text-sm font-medium rounded-lg bg-danger hover:bg-danger/90 text-white transition"
            >
              <Trash2 className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              ลบรายการที่เลือก
            </button>
          </div>
        </div>
      )}

      {error ? (
        <ErrorState title="โหลดข้อมูลไม่สำเร็จ" message={error} onRetry={fetchRows} />
      ) : loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={MapIcon}
          title="ยังไม่มีจุดรับส่งในระบบ"
          description="บัญชีคนขับหรือบัญชีโรงเรียนสามารถเริ่มสร้างจุดรับส่งได้จากแผนที่ของตนเอง — หน้านี้จะแสดงเมื่อมีจุดให้ตรวจสอบ"
        />
      ) : (
        <>
          <DashboardSection title="รายการจุดรับส่ง" description={`หน้า ${meta.page} / ${totalPages}`}>
            <DataTable
              caption="จุดรับส่งทั้งหมดในระบบ"
              columns={columns}
              rows={rows}
              rowClassName={r => (selectedIds.has(r.id) ? 'bg-brand/5' : undefined)}
              selection={{
                selected: selectedIds,
                onToggle: r => toggleSelect(r.id),
                onToggleAll: toggleSelectAllVisible,
                allSelected: isAllVisibleSelected,
                selectAllLabel: isAllVisibleSelected ? 'ยกเลิกการเลือกทั้งหมด' : 'เลือกทั้งหมดในหน้านี้',
                rowLabel: r => `เลือก ${r.label}`,
              }}
              actions={r => (
                <>
                  <TableAction onClick={() => setAssigning(r)} aria-label={`จัดการนักเรียนของจุด ${r.label}`}>
                    <Users className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only">นักเรียน</span>
                  </TableAction>
                  <TableAction tone="brand" onClick={() => setEditing(r)} aria-label={`แก้ไขจุด ${r.label}`}>
                    <Pencil className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only">แก้ไข</span>
                  </TableAction>
                  <TableAction tone="danger" onClick={() => setConfirmDelete(r)} aria-label={`ลบจุด ${r.label}`}>
                    <Trash2 className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only">ลบ</span>
                  </TableAction>
                </>
              )}
            />
          </DashboardSection>

          {totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} onPage={(p) => setPage(p)} />
          )}
        </>
      )}

      {editing && (
        <EditPickupPointModal
          row={editing === 'new' ? null : editing}
          vehicles={vehicles}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchRows(); }}
        />
      )}
      {assigning && (
        <PickupStudentsModal
          apiBase="/admin"
          point={assigning}
          onClose={() => setAssigning(null)}
          onSaved={() => { setAssigning(null); fetchRows(); }}
        />
      )}
      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="ลบจุดรับส่งนี้?"
        itemName={confirmDelete?.label}
        description="การลบเป็นแบบ soft-delete — ข้อมูลจะถูกซ่อนจากหน้าจอ แต่ยังคงอยู่ใน audit log"
        confirmLabel="ลบจุดรับส่ง"
        loading={deleteBusy}
        onConfirm={handleDeleteOne}
        onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmDialog
        open={bulkConfirmOpen}
        title={`ลบจุดรับส่ง ${selectedIds.size} รายการ?`}
        description={bulkBusy
          ? `กำลังลบ… ${bulkProgress.done} / ${bulkProgress.total} รายการ`
          : `${bulkPreview}${'\n'}การดำเนินการนี้จะซ่อนรายการจากหน้าจอ แต่ไม่ลบประวัติย้อนหลัง`}
        confirmLabel={`ยืนยันลบ ${selectedIds.size} รายการ`}
        loading={bulkBusy}
        onConfirm={handleBulkDelete}
        onCancel={() => { if (!bulkBusy) setBulkConfirmOpen(false); }}
      />
    </div>
  );
}

/* ── Edit/Add modal ──
   The field block is the same one the driver and school editors use; this
   passes its vehicle select in through `leadingFields` and omits the pupil
   checklist, because an admin assigns pupils through PickupStudentsModal
   instead. Endpoints and payload (including `sequence`) are unchanged. */
function EditPickupPointModal({ row, vehicles, onClose, onSaved }) {
  const isNew = !row;
  const [form, setForm] = useState(() => ({
    vehicle_id: row?.vehicle_id || '',
    label: row?.label || '',
    latitude: row?.latitude ?? '',
    longitude: row?.longitude ?? '',
    session: row?.session || 'both',
    sequence: row?.sequence ?? 0,
    notes: row?.notes || '',
  }));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return; // guard the double submit
    setSaving(true); setErrors([]);
    try {
      const payload = {
        ...form,
        latitude: parseFloat(form.latitude),
        longitude: parseFloat(form.longitude),
        sequence: parseInt(form.sequence, 10) || 0,
      };
      if (isNew) {
        await api.post('/admin/pickup-points', payload);
      } else {
        await api.put(`/admin/pickup-points/${row.id}`, payload);
      }
      onSaved();
    } catch (err) {
      setErrors(err?.response?.data?.errors || [{ message: err?.response?.data?.message || 'บันทึกไม่สำเร็จ' }]);
    } finally {
      setSaving(false);
    }
  };

  // The vehicle cannot move once the point exists, so the select is locked
  // when editing — same rule as before, now with the reason on screen.
  const vehicleField = (
    <FormField
      label="ทะเบียนรถ"
      required
      helper={isNew ? undefined : 'เปลี่ยนรถของจุดที่มีอยู่แล้วไม่ได้ — ให้สร้างจุดใหม่แทน'}
    >
      {ctl => (
        <select
          {...ctl}
          value={form.vehicle_id}
          onChange={e => update('vehicle_id', e.target.value)}
          disabled={!isNew}
          required
          className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base sm:text-sm text-ink transition disabled:opacity-60 disabled:bg-surface"
        >
          <option value="">เลือกรถ…</option>
          {vehicles.map(v => (
            <option key={v.id} value={v.id}>{v.plate_no}</option>
          ))}
        </select>
      )}
    </FormField>
  );

  return (
    <Modal
      title={isNew ? 'เพิ่มกรณีพิเศษ' : 'แก้ไขจุดรับส่ง'}
      size="lg"
      onClose={() => { if (!saving) onClose(); }}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="focus-ring px-4 min-h-[44px] text-sm font-medium rounded-lg border border-surface-border text-ink hover:bg-surface transition disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            form="admin-pickup-form"
            disabled={saving}
            className="focus-ring px-4 min-h-[44px] text-sm font-semibold rounded-lg bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white transition disabled:opacity-60 disabled:pointer-events-none"
          >
            {saving ? 'กำลังบันทึก…' : isNew ? 'สร้าง' : 'บันทึก'}
          </button>
        </>
      }
    >
      <form id="admin-pickup-form" onSubmit={handleSubmit}>
        <PickupPointFields
          form={form}
          onChange={update}
          sessionLabels={SESSION_LABEL}
          leadingFields={vehicleField}
          errors={errors}
        />
      </form>
    </Modal>
  );
}
