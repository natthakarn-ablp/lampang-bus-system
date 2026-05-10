import { useEffect, useState, useCallback, useMemo } from 'react';
import { Map as MapIcon, Plus, Pencil, Trash2, X, Users } from 'lucide-react';
import api from '../../api/axios';
import { AppCard, AlertBanner, StatusBadge, DashboardSection } from '../../components/ui';
import PickupCoordPicker from '../../components/PickupCoordPicker';
import PickupStudentsModal from '../../components/PickupStudentsModal';

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
        การเพิ่มจุดรับส่งหลักทำผ่าน Driver หรือ School. หน้านี้สำหรับผู้ดูแลระบบใช้ตรวจสอบภาพรวม และเพิ่ม/แก้ไขในกรณีพิเศษเท่านั้น.
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

      {error ? (
        <AlertBanner variant="danger" title="โหลดข้อมูลไม่สำเร็จ">{error}</AlertBanner>
      ) : loading ? (
        <p className="text-ink-muted py-10 text-center">กำลังโหลด…</p>
      ) : rows.length === 0 ? (
        <AlertBanner variant="info" title="ยังไม่มีจุดรับส่งในระบบ">
          Driver หรือ School สามารถเริ่มสร้างจุดรับส่งได้จากแผนที่ของตนเอง — หน้านี้จะแสดงเมื่อมีจุดให้ตรวจสอบ
        </AlertBanner>
      ) : (
        <>
          <DashboardSection title="รายการจุดรับส่ง" description={`หน้า ${meta.page} / ${totalPages}`}>
            <AppCard padding="none">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-border/30 text-ink-muted text-xs uppercase">
                    <tr>
                      <th className="text-left px-3 py-2">ทะเบียนรถ</th>
                      <th className="text-left px-3 py-2">ป้ายชื่อ</th>
                      <th className="text-left px-3 py-2">รอบ</th>
                      <th className="text-right px-3 py-2">นักเรียน</th>
                      <th className="text-left px-3 py-2">พิกัด</th>
                      <th className="text-right px-3 py-2">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id} className="border-t border-surface-border">
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
                    ))}
                  </tbody>
                </table>
              </div>
            </AppCard>
          </DashboardSection>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-surface-border disabled:opacity-50 hover:bg-surface-border"
              >
                ก่อนหน้า
              </button>
              <span className="text-sm text-ink-muted tabular-nums">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm rounded-lg border border-surface-border disabled:opacity-50 hover:bg-surface-border"
              >
                ถัดไป
              </button>
            </div>
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
