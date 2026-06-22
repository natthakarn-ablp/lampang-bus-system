import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Map as MapIcon, Plus, Pencil, Trash2, X, Users } from 'lucide-react';
import api from '../../api/axios';
import { AppCard, AlertBanner, StatusBadge, DashboardSection } from '../../components/ui';
import LoadingState from '../../components/LoadingState';
import PickupCoordPicker from '../../components/PickupCoordPicker';
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

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-ink leading-tight flex items-center gap-2">
            <MapIcon className="w-6 h-6 text-brand" strokeWidth={2} />
            ตรวจสอบจุดรับส่ง
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            ภาพรวมจุดรับส่งของรถทั้งหมดในระบบ · {meta.total} จุด
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="shrink-0 inline-flex items-center gap-1.5 bg-brand hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          เพิ่มกรณีพิเศษ
        </button>
      </header>

      {/* Phase 6.1 — admin override role banner.
          The primary creator of pickup points is Driver or School.
          This page exists for governance review + emergency overrides
          when those primary roles can't act (e.g., a school account
          temporarily disabled). */}
      <AlertBanner variant="info" title="หน้าตรวจสอบและกรณีพิเศษ">
        การเพิ่มจุดรับส่งหลักทำผ่านบัญชีคนขับหรือบัญชีโรงเรียน หน้านี้สำหรับผู้ดูแลระบบใช้ตรวจสอบภาพรวม และเพิ่ม/แก้ไขในกรณีพิเศษเท่านั้น
      </AlertBanner>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <select
          value={vehicleFilter}
          onChange={e => { setVehicleFilter(e.target.value); setPage(1); }}
          className="text-sm border border-surface-border rounded-lg px-3 py-1.5 bg-surface text-ink"
        >
          <option value="">รถทุกคัน</option>
          {vehicles.map(v => (
            <option key={v.id} value={v.id}>{v.plate_no}</option>
          ))}
        </select>
      </div>

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
              className="px-3 py-1.5 text-xs rounded-lg border border-surface-border bg-surface hover:bg-surface-border text-ink"
            >
              ยกเลิกการเลือก
            </button>
            <button
              type="button"
              onClick={() => setBulkConfirmOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-danger hover:bg-danger/90 text-white"
            >
              <Trash2 className="w-3.5 h-3.5" strokeWidth={2.5} />
              ลบรายการที่เลือก
            </button>
          </div>
        </div>
      )}

      {error ? (
        <AlertBanner variant="danger" title="โหลดข้อมูลไม่สำเร็จ">{error}</AlertBanner>
      ) : loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <AlertBanner variant="info" title="ยังไม่มีจุดรับส่งในระบบ">
          บัญชีคนขับหรือบัญชีโรงเรียนสามารถเริ่มสร้างจุดรับส่งได้จากแผนที่ของตนเอง — หน้านี้จะแสดงเมื่อมีจุดให้ตรวจสอบ
        </AlertBanner>
      ) : (
        <>
          <DashboardSection title="รายการจุดรับส่ง" description={`หน้า ${meta.page} / ${totalPages}`}>
            <AppCard padding="none">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-border/30 text-ink-muted text-xs uppercase">
                    <tr>
                      <th className="px-3 py-2 w-10">
                        <input
                          ref={headerCheckboxRef}
                          type="checkbox"
                          aria-label={isAllVisibleSelected ? 'ยกเลิกการเลือกทั้งหมด' : 'เลือกทั้งหมดในหน้านี้'}
                          checked={isAllVisibleSelected}
                          disabled={visibleIds.length === 0}
                          onChange={toggleSelectAllVisible}
                          className="w-4 h-4 rounded border-surface-border text-brand focus:ring-brand cursor-pointer disabled:cursor-not-allowed"
                        />
                      </th>
                      <th className="text-left px-3 py-2">ทะเบียนรถ</th>
                      <th className="text-left px-3 py-2">ป้ายชื่อ</th>
                      <th className="text-left px-3 py-2">รอบ</th>
                      <th className="text-right px-3 py-2">นักเรียน</th>
                      <th className="text-left px-3 py-2">พิกัด</th>
                      <th className="text-right px-3 py-2">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const checked = selectedIds.has(r.id);
                      return (
                        <tr
                          key={r.id}
                          className={`border-t border-surface-border ${checked ? 'bg-brand/5' : ''}`}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              aria-label={`เลือก ${r.label}`}
                              checked={checked}
                              onChange={() => toggleSelect(r.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-4 h-4 rounded border-surface-border text-brand focus:ring-brand cursor-pointer"
                            />
                          </td>
                          <td className="px-3 py-2 font-medium text-ink">{r.plate_no || r.vehicle_id}</td>
                          <td className="px-3 py-2 text-ink truncate max-w-[200px]">{r.label}</td>
                          <td className="px-3 py-2">
                            <StatusBadge variant="neutral" size="sm">
                              {SESSION_LABEL[r.session] || r.session}
                            </StatusBadge>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.student_count}</td>
                          <td className="px-3 py-2 text-xs text-ink-muted tabular-nums">
                            {r.latitude?.toFixed(5)}, {r.longitude?.toFixed(5)}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-1">
                              <IconBtn icon={Users} title="จัดการนักเรียน" onClick={() => setAssigning(r)} />
                              <IconBtn icon={Pencil} title="แก้ไข" onClick={() => setEditing(r)} />
                              <IconBtn icon={Trash2} title="ลบ" danger onClick={() => setConfirmDelete(r)} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </AppCard>
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
      {confirmDelete && (
        <DeleteConfirmModal
          row={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onDeleted={() => { setConfirmDelete(null); fetchRows(); }}
        />
      )}
      {bulkConfirmOpen && (
        <BulkDeleteConfirmModal
          items={selectedRows}
          totalSelected={selectedIds.size}
          onClose={() => setBulkConfirmOpen(false)}
          onDone={({ successIds }) => {
            setBulkConfirmOpen(false);
            if (successIds.length > 0) {
              setSelectedIds(prev => {
                const next = new Set(prev);
                successIds.forEach(id => next.delete(id));
                return next;
              });
              fetchRows();
            }
          }}
          toast={toast}
        />
      )}
    </div>
  );
}

/* ── Small icon button ── */
function IconBtn({ icon: Icon, title, danger = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-md transition ${
        danger
          ? 'text-danger hover:bg-danger/10'
          : 'text-ink-muted hover:bg-surface-border hover:text-ink'
      }`}
    >
      <Icon className="w-4 h-4" strokeWidth={2} />
    </button>
  );
}

/* ── Edit/Add modal ─────────────────────────────────────────────────────── */
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

  const coords = useMemo(() => {
    const lat = parseFloat(form.latitude), lng = parseFloat(form.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  }, [form.latitude, form.longitude]);

  return (
    <Modal onClose={onClose} title={isNew ? 'เพิ่มกรณีพิเศษ' : 'แก้ไขจุดรับส่ง'}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="ทะเบียนรถ">
          <select
            value={form.vehicle_id}
            onChange={e => update('vehicle_id', e.target.value)}
            disabled={!isNew}
            className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 bg-surface text-ink disabled:opacity-60"
            required
          >
            <option value="">เลือกรถ…</option>
            {vehicles.map(v => (
              <option key={v.id} value={v.id}>{v.plate_no}</option>
            ))}
          </select>
        </Field>

        <Field label="ป้ายชื่อจุด">
          <input
            type="text" required maxLength={100}
            value={form.label}
            onChange={e => update('label', e.target.value)}
            placeholder="เช่น หน้าโรงเรียน, ปาก ซ.5"
            className="w-full text-sm border border-surface-border rounded-lg px-3 py-2"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude">
            <input
              type="number" step="any" required min={-90} max={90}
              value={form.latitude}
              onChange={e => update('latitude', e.target.value)}
              className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 tabular-nums"
            />
          </Field>
          <Field label="Longitude">
            <input
              type="number" step="any" required min={-180} max={180}
              value={form.longitude}
              onChange={e => update('longitude', e.target.value)}
              className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 tabular-nums"
            />
          </Field>
        </div>

        <p className="text-xs text-ink-muted">คลิกบนแผนที่เพื่อกำหนดพิกัด หรือกรอกตัวเลขโดยตรง</p>
        <PickupCoordPicker
          value={coords}
          onChange={([lat, lng]) => {
            update('latitude', lat.toFixed(6));
            update('longitude', lng.toFixed(6));
          }}
        />

        <Field label="รอบ">
          <div className="flex gap-1.5">
            {['morning', 'evening', 'both'].map(s => (
              <button
                type="button"
                key={s}
                onClick={() => update('session', s)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition border ${
                  form.session === s
                    ? 'bg-brand text-white border-brand'
                    : 'bg-surface text-ink-muted border-surface-border'
                }`}
              >
                {SESSION_LABEL[s]}
              </button>
            ))}
          </div>
        </Field>

        <Field label="หมายเหตุ (ไม่บังคับ)">
          <input
            type="text" maxLength={255}
            value={form.notes}
            onChange={e => update('notes', e.target.value)}
            className="w-full text-sm border border-surface-border rounded-lg px-3 py-2"
          />
        </Field>

        {errors.length > 0 && (
          <AlertBanner variant="danger" title="ข้อมูลไม่ถูกต้อง">
            <ul className="list-disc pl-4 text-xs">
              {errors.map((e, i) => <li key={i}>{e.field ? `${e.field}: ` : ''}{e.message}</li>)}
            </ul>
          </AlertBanner>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-surface-border">
            ยกเลิก
          </button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand hover:bg-brand-700 text-white disabled:opacity-60">
            {saving ? 'กำลังบันทึก…' : isNew ? 'สร้าง' : 'บันทึก'}
          </button>
        </div>
      </form>
    </Modal>
  );
}


/* ── Delete confirm modal ── */
function DeleteConfirmModal({ row, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const handleDelete = async () => {
    setBusy(true); setError(null);
    try {
      await api.delete(`/admin/pickup-points/${row.id}`);
      onDeleted();
    } catch (err) {
      setError(err?.response?.data?.message || 'ลบไม่สำเร็จ');
      setBusy(false);
    }
  };
  return (
    <Modal onClose={onClose} title="ยืนยันการลบ">
      <p className="text-sm mb-3">
        ต้องการลบจุดรับส่ง <strong>{row.label}</strong> ใช่หรือไม่?
      </p>
      <p className="text-xs text-ink-muted mb-3">
        การลบเป็นแบบ soft-delete — ข้อมูลจะถูกซ่อนแต่ยังคงอยู่ใน audit log
      </p>
      {error && <AlertBanner variant="danger" title="ลบไม่สำเร็จ">{error}</AlertBanner>}
      <div className="flex justify-end gap-2 pt-3">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-surface-border">
          ยกเลิก
        </button>
        <button type="button" onClick={handleDelete} disabled={busy} className="px-4 py-2 text-sm rounded-lg bg-danger hover:bg-danger/90 text-white disabled:opacity-60">
          {busy ? 'กำลังลบ…' : 'ลบ'}
        </button>
      </div>
    </Modal>
  );
}

/* ── Generic modal shell ── */
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[9999] isolate flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative z-[10000] bg-surface w-full max-w-lg rounded-2xl shadow-elevate max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <header className="flex items-center justify-between p-4 border-b border-surface-border">
          <h2 className="font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-surface-border" aria-label="ปิด">
            <X className="w-4 h-4 text-ink-muted" />
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink-muted mb-1">{label}</label>
      {children}
    </div>
  );
}

/* ── Bulk delete confirm modal (Phase 10.10G-B) ────────────────────────────
 * Sequentially deletes selected pickup points via the existing per-id endpoint
 * (DELETE /api/admin/pickup-points/:id). Per-item failure does not abort the
 * batch — caller gets back a list of successfully-deleted ids so it can prune
 * the selection set and refresh.                                              */
function BulkDeleteConfirmModal({ items, totalSelected, onClose, onDone, toast }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: totalSelected });
  const previewItems = items.slice(0, 5);
  const overflowCount = Math.max(0, totalSelected - previewItems.length);

  const handleConfirm = async () => {
    setBusy(true);
    setProgress({ done: 0, total: totalSelected });
    const successIds = [];
    const failures = [];

    // Sequential: keeps backend load predictable + makes audit_log per-item ordered.
    for (let i = 0; i < items.length; i++) {
      const row = items[i];
      try {
        await api.delete(`/admin/pickup-points/${row.id}`);
        successIds.push(row.id);
      } catch (err) {
        failures.push({
          id: row.id,
          label: row.label,
          message: err?.response?.data?.message || 'ลบไม่สำเร็จ',
        });
      }
      setProgress({ done: i + 1, total: items.length });
    }

    // Result toast
    if (failures.length === 0) {
      toast.success(`ลบสำเร็จ ${successIds.length} รายการ`);
    } else if (successIds.length === 0) {
      toast.error('ไม่สามารถลบรายการที่เลือกได้');
    } else {
      toast.error(`ลบสำเร็จ ${successIds.length} รายการ ไม่สำเร็จ ${failures.length} รายการ`);
    }
    onDone({ successIds, failures });
  };

  return (
    <Modal onClose={busy ? () => {} : onClose} title="ยืนยันการลบหลายรายการ">
      <p className="text-sm mb-2">
        คุณกำลังจะลบ <strong className="tabular-nums">{totalSelected}</strong> รายการ
      </p>
      {previewItems.length > 0 && (
        <ul className="text-xs text-ink-muted list-disc pl-5 mb-3 space-y-0.5 max-h-32 overflow-y-auto">
          {previewItems.map(r => (
            <li key={r.id} className="truncate">{r.label || `จุดที่ ${r.id}`}</li>
          ))}
          {overflowCount > 0 && (
            <li className="list-none italic">และอีก {overflowCount} รายการ</li>
          )}
        </ul>
      )}
      <p className="text-xs text-ink-muted mb-3">
        การดำเนินการนี้จะซ่อนรายการจากหน้าจอ แต่ไม่ลบประวัติย้อนหลัง
      </p>
      {busy && (
        <p className="text-xs text-ink-muted mb-2 tabular-nums">
          กำลังลบ… {progress.done} / {progress.total}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-surface-border disabled:opacity-60"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy || totalSelected === 0}
          className="px-4 py-2 text-sm rounded-lg bg-danger hover:bg-danger/90 text-white disabled:opacity-60"
        >
          {busy ? 'กำลังลบ…' : `ยืนยันลบ ${totalSelected} รายการ`}
        </button>
      </div>
    </Modal>
  );
}
