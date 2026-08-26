import { useEffect, useState, useCallback } from 'react';
import { Map as MapIcon, Plus, Pencil, Trash2, X } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import { AppCard, AlertBanner, StatusBadge, ConfirmDialog, FilterBar, Modal } from '../../components/ui';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import PickupMap from '../../components/PickupMap';
import PickupPointFields from '../../components/PickupPointFields';
import PickupStudentsModal from '../../components/PickupStudentsModal';
import { classroomLabel } from '../../utils/student';

const SESSION_LABEL = { morning: 'รอบเช้า', evening: 'รอบเย็น', both: 'ทั้งวัน' };

export default function DriverPickupMap() {
  const toast = useToast();
  const [points, setPoints] = useState([]);
  const [vehicle, setVehicle] = useState(null);
  const [sessionFilter, setSessionFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null); // null | { ...point }
  const [deletingId, setDeletingId] = useState(null);
  // window.confirm could not name the point, could not be dismissed with the
  // keyboard on the driver's phone, and put the default action on OK.
  const [confirmDelete, setConfirmDelete] = useState(null);

  const fetchPoints = useCallback(async (filter) => {
    setLoading(true);
    setError(null);
    try {
      const qs = filter === 'all' ? '' : `?session=${filter}`;
      const res = await api.get(`/driver/pickup-points${qs}`);
      const payload = res.data?.data || {};
      setVehicle(payload.vehicle || null);
      setPoints(Array.isArray(payload.points) ? payload.points : []);
    } catch (err) {
      setError(err?.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPoints(sessionFilter); }, [fetchPoints, sessionFilter]);

  const handleDelete = useCallback(async (point) => {
    setDeletingId(point.id);
    try {
      await api.delete(`/driver/pickup-points/${point.id}`);
      toast.success('ลบจุดรับส่งสำเร็จ');
      setSelectedId(null);
      setConfirmDelete(null);
      fetchPoints(sessionFilter);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'ลบจุดรับส่งไม่สำเร็จ');
    } finally { setDeletingId(null); }
  }, [fetchPoints, sessionFilter, toast]);

  const selected = points.find(p => p.id === selectedId) || null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header strip — title + vehicle + add button + session filter */}
      <header className="shrink-0 px-4 py-3 border-b border-surface-border bg-surface">
        <PageHeader
          compact
          icon={MapIcon}
          title="แผนที่จุดรับส่ง"
          subtitle={vehicle ? `${vehicle.plate_no} · ${points.length} จุด` : undefined}
          actions={
            <button
              type="button"
              onClick={() => setCreating(true)}
              disabled={!vehicle}
              className="focus-ring shrink-0 inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-sm font-medium px-3 min-h-[44px] rounded-lg transition disabled:opacity-50 disabled:pointer-events-none"
            >
              <Plus className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span className="hidden sm:inline">เพิ่มจุดรับส่ง</span>
              <span className="sm:hidden">เพิ่ม</span>
            </button>
          }
        />
        <FilterBar
          className="mt-2"
          chips={{
            label: 'กรองตามรอบการเดินรถ',
            value: sessionFilter,
            onChange: setSessionFilter,
            options: [['all', 'ทั้งหมด'], ['morning', 'รอบเช้า'], ['evening', 'รอบเย็น']],
          }}
        />
      </header>

      {/* Map fills remaining space */}
      <div className="flex-1 relative">
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <AlertBanner variant="danger" title="โหลดข้อมูลไม่สำเร็จ" className="max-w-sm">
              {error}
            </AlertBanner>
          </div>
        ) : loading ? (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <LoadingState message="กำลังโหลดจุดรับส่ง…" />
          </div>
        ) : (
          <>
            <PickupMap
              points={points}
              selectedPointId={selectedId}
              onMarkerClick={(p) => setSelectedId(p.id)}
              className="h-full w-full"
            />

            {/* Empty-state overlay — non-blocking; user can still pan around */}
            {points.length === 0 && (
              <div className="absolute top-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm pointer-events-none">
                <AppCard padding="md" className="pointer-events-auto">
                  <p className="text-sm font-semibold text-ink mb-1">ยังไม่มีจุดรับส่ง</p>
                  <p className="text-xs text-ink-muted">
                    กดปุ่ม "+ เพิ่มจุดรับส่ง" ด้านบนเพื่อเริ่มสร้างจุดแรกของรถคันนี้
                  </p>
                </AppCard>
              </div>
            )}

            {/* Selected-point card — overlays bottom of map on mobile,
                bottom-right on desktop */}
            {selected && (
              <div className="absolute bottom-3 left-3 right-3 sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-sm">
                <SelectedPointCard
                  point={selected}
                  onClose={() => setSelectedId(null)}
                  onEdit={() => setEditing(selected)}
                  onDelete={() => setConfirmDelete(selected)}
                  deleting={deletingId === selected.id}
                />
              </div>
            )}
          </>
        )}
      </div>

      {creating && (
        <CreatePickupModal
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); fetchPoints(sessionFilter); }}
        />
      )}
      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="ลบจุดรับส่งนี้?"
        itemName={confirmDelete?.label}
        description="นักเรียนในจุดนี้จะไม่ถูกลบออกจากรถ แต่จะไม่มีจุดรับส่งจนกว่าจะกำหนดใหม่"
        confirmLabel="ลบจุดรับส่ง"
        loading={deletingId === confirmDelete?.id}
        onConfirm={() => handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      {editing && (
        <PickupStudentsModal
          apiBase="/driver"
          point={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchPoints(sessionFilter); }}
        />
      )}
    </div>
  );
}

/* ── Create-pickup modal ──
   The field block is shared with SchoolPickupMap (PickupPointFields); this
   owns the driver-scoped fetch, the payload and the submit. Endpoints and
   request shape are unchanged. */
function CreatePickupModal({ onClose, onCreated }) {
  const [students, setStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentsError, setStudentsError] = useState(null);

  const [form, setForm] = useState({
    label: '',
    latitude: '',
    longitude: '',
    session: 'both',
    notes: '',
  });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Pre-load (and re-load on session change) the available students.
  // Server filters out students already assigned to a conflicting
  // session on this vehicle, so the checklist only ever shows people
  // who can actually be added to the new point.
  useEffect(() => {
    let cancelled = false;
    setStudentsLoading(true);
    setStudentsError(null);
    api.get(`/driver/pickup-students?session=${encodeURIComponent(form.session)}`)
      .then(r => {
        if (cancelled) return;
        const list = Array.isArray(r.data?.data) ? r.data.data : [];
        setStudents(list);
        // Trim selection to only students still in the new available
        // list — when session changes, some previously-available
        // students may no longer be selectable.
        setSelectedIds(prev => {
          const allowed = new Set(list.map(s => s.id));
          const next = new Set();
          prev.forEach(id => { if (allowed.has(id)) next.add(id); });
          return next;
        });
      })
      .catch(err => {
        if (cancelled) return;
        setStudentsError(err?.response?.data?.message || 'โหลดรายชื่อนักเรียนไม่สำเร็จ');
      })
      .finally(() => { if (!cancelled) setStudentsLoading(false); });
    return () => { cancelled = true; };
  }, [form.session]);

  const toggleStudent = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // A half-filled form is worth a confirmation before it is thrown away; an
  // untouched one is not.
  const dirty = Boolean(form.label || form.latitude || form.longitude || form.notes)
    || selectedIds.size > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return; // guard the double-tap on a phone
    setSaving(true); setErrors([]);
    try {
      await api.post('/driver/pickup-points', {
        ...form,
        latitude: parseFloat(form.latitude),
        longitude: parseFloat(form.longitude),
        student_ids: Array.from(selectedIds),
      });
      onCreated();
    } catch (err) {
      setErrors(err?.response?.data?.errors
        || [{ message: err?.response?.data?.message || 'บันทึกไม่สำเร็จ' }]);
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (saving) return;
    if (dirty) { setConfirmDiscard(true); return; }
    onClose();
  };

  return (
    <>
      <Modal
        title="เพิ่มจุดรับส่งของรถคุณ"
        size="lg"
        onClose={requestClose}
        footer={
          <>
            <button
              type="button"
              onClick={requestClose}
              className="focus-ring px-4 min-h-[44px] text-sm font-medium rounded-lg border border-surface-border text-ink hover:bg-surface transition"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              form="driver-pickup-form"
              disabled={saving}
              className="focus-ring px-4 min-h-[44px] text-sm font-semibold rounded-lg bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white transition disabled:opacity-60 disabled:pointer-events-none"
            >
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </>
        }
      >
        <form id="driver-pickup-form" onSubmit={handleSubmit}>
          <PickupPointFields
            form={form}
            onChange={update}
            sessionLabels={SESSION_LABEL}
            students={students}
            studentsLoading={studentsLoading}
            studentsError={studentsError}
            studentsEmptyText="นักเรียนของรถคันนี้มีจุดรับส่งครบแล้ว"
            selectedIds={selectedIds}
            onToggleStudent={toggleStudent}
            onSetSelected={setSelectedIds}
            errors={errors}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDiscard}
        tone="warn"
        title="ละทิ้งจุดรับส่งที่กรอกไว้?"
        description="ข้อมูลที่กรอกและนักเรียนที่เลือกไว้จะหายไป"
        confirmLabel="ละทิ้ง"
        cancelLabel="กรอกต่อ"
        onConfirm={() => { setConfirmDiscard(false); onClose(); }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
}

/* ── Selected-point detail card ── */
function SelectedPointCard({ point, onClose, onEdit, onDelete, deleting }) {
  return (
    <AppCard padding="md" className="shadow-elevate">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink truncate">{point.label}</p>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge variant="neutral" size="sm">
              {SESSION_LABEL[point.session] || point.session || 'ทั้งวัน'}
            </StatusBadge>
            <span className="text-xs text-ink-muted">
              {(point.students?.length ?? 0)} คน
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 p-1 rounded-full hover:bg-surface-border transition"
          aria-label="ปิด"
        >
          <X className="w-4 h-4 text-ink-muted" strokeWidth={2} />
        </button>
      </div>

      {Array.isArray(point.students) && point.students.length > 0 && (
        <ul className="text-sm space-y-1 mb-3 max-h-40 overflow-y-auto">
          {point.students.map(s => {
            const cls = classroomLabel(s);
            return (
              <li key={s.id} className="flex items-center gap-2 min-w-0">
                <span className="truncate text-ink">{s.first_name} {s.last_name}</span>
                {cls && (
                  <span className="text-xs text-ink-muted shrink-0">· {cls}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center justify-center gap-1.5 w-full text-sm font-medium text-brand bg-brand-50 hover:bg-brand-100 rounded-lg py-2 transition"
        >
          <Pencil className="w-4 h-4" strokeWidth={2} />
          แก้ไขรายชื่อนักเรียน
        </button>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center text-sm font-medium text-white bg-brand hover:bg-brand-700 rounded-lg py-2 transition"
        >
          เปิดใน Google Maps →
        </a>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="inline-flex items-center justify-center gap-1.5 w-full text-sm font-medium text-danger-ink bg-danger-soft hover:opacity-90 rounded-lg py-2 transition disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" strokeWidth={2} />
            {deleting ? 'กำลังลบ…' : 'ลบจุดรับส่ง'}
          </button>
        )}
      </div>
    </AppCard>
  );
}

