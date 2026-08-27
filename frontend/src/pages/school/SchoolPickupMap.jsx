import { useEffect, useMemo, useState, useCallback } from 'react';
import { Map as MapIcon, Bus, Users, Plus, Pencil, Trash2 } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import {
  AppCard, AlertBanner, StatusBadge, DashboardSection,
  ConfirmDialog, FilterBar, FormField, Modal,
} from '../../components/ui';
import PageHeader from '../../components/PageHeader';
import PickupMap from '../../components/PickupMap';
import PickupPointFields from '../../components/PickupPointFields';
import PickupStudentsModal from '../../components/PickupStudentsModal';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import { classroomLabel } from '../../utils/student';
import { useAuth } from '../../hooks/useAuth';
import { isGradeTeacher } from '../../utils/authScope';

const SESSION_LABEL = { morning: 'รอบเช้า', evening: 'รอบเย็น', both: 'ทั้งวัน' };

export default function SchoolPickupMap() {
  const { user } = useAuth();
  const toast = useToast();
  const isTeacher = isGradeTeacher(user); // read-only for grade teacher
  const [points, setPoints] = useState([]);
  const [sessionFilter, setSessionFilter] = useState('all');
  const [vehicleFilter, setVehicleFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);  // null | { ...point }
  const [deletingId, setDeletingId] = useState(null);
  // window.confirm named nothing and could not say what survives the delete.
  const [confirmDelete, setConfirmDelete] = useState(null);

  const fetchPoints = useCallback(async (sf) => {
    setLoading(true);
    setError(null);
    try {
      const qs = sf === 'all' ? '' : `?session=${sf}`;
      const res = await api.get(`/school/pickup-points${qs}`);
      const list = res.data?.data;
      setPoints(Array.isArray(list) ? list : []);
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
      await api.delete(`/school/pickup-points/${point.id}`);
      toast.success('ลบจุดรับส่งสำเร็จ');
      if (selectedId === point.id) setSelectedId(null);
      setConfirmDelete(null);
      fetchPoints(sessionFilter);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'ลบจุดรับส่งไม่สำเร็จ');
    } finally { setDeletingId(null); }
  }, [fetchPoints, sessionFilter, selectedId, toast]);

  // Vehicle dropdown options derived from the loaded points (so the
  // filter only shows vehicles that actually serve this school).
  const vehicleOptions = useMemo(() => {
    const seen = new Map();
    points.forEach(p => {
      if (p.vehicle_id && !seen.has(p.vehicle_id)) {
        seen.set(p.vehicle_id, p.plate_no || p.vehicle_id);
      }
    });
    return Array.from(seen, ([id, plate]) => ({ id, plate }));
  }, [points]);

  const filteredPoints = useMemo(() => {
    if (vehicleFilter === 'all') return points;
    return points.filter(p => p.vehicle_id === vehicleFilter);
  }, [points, vehicleFilter]);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <PageHeader
        icon={MapIcon}
        title="แผนที่จุดรับส่ง"
        subtitle="จุดรับส่งของนักเรียนในโรงเรียน"
        actions={!isTeacher && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="focus-ring w-full sm:w-auto inline-flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-sm font-medium px-3 min-h-[44px] rounded-lg transition"
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
            เพิ่มจุดรับส่ง
          </button>
        )}
      />

      <FilterBar
        chips={{
          label: 'กรองตามรอบการเดินรถ',
          value: sessionFilter,
          onChange: setSessionFilter,
          options: [['all', 'ทั้งหมด'], ['morning', 'รอบเช้า'], ['evening', 'รอบเย็น']],
        }}
        filters={vehicleOptions.length > 0 ? [{
          key: 'vehicle',
          label: 'รถ',
          value: vehicleFilter === 'all' ? '' : vehicleFilter,
          onChange: v => setVehicleFilter(v || 'all'),
          options: [['', 'รถทุกคัน'], ...vehicleOptions.map(v => [v.id, v.plate])],
        }] : []}
        count={filteredPoints.length}
        countLabel="จุดรับส่ง"
        onClear={() => { setSessionFilter('all'); setVehicleFilter('all'); }}
      />

      {error ? (
        <ErrorState message={error} />
      ) : loading ? (
        <LoadingState message="กำลังโหลดแผนที่และข้อมูล…" />
      ) : filteredPoints.length === 0 ? (
        <AlertBanner variant="info" title="ยังไม่มีจุดรับส่งในขอบเขตนี้">
          {isTeacher
            ? 'ยังไม่มีจุดรับส่งของระดับชั้นนี้ — ให้บัญชีหลักของโรงเรียนเป็นผู้เพิ่มข้อมูล'
            : 'กดปุ่ม "+ เพิ่มจุดรับส่ง" ด้านบนเพื่อเริ่มสร้างจุดแรกของโรงเรียน'}
        </AlertBanner>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
          {/* Left/top: list of points (click → highlight on map) */}
          <DashboardSection title="รายการจุดรับส่ง" description={`${filteredPoints.length} จุด`}>
            <div className="space-y-2 max-h-[50vh] lg:max-h-[60vh] overflow-y-auto pr-1">
              {filteredPoints.map(p => (
                <PickupPointRow
                  key={p.id}
                  point={p}
                  selected={selectedId === p.id}
                  onClick={() => setSelectedId(p.id)}
                  onEdit={isTeacher ? undefined : () => setEditing(p)}
                  onDelete={isTeacher ? undefined : () => setConfirmDelete(p)}
                  deleting={deletingId === p.id}
                />
              ))}
            </div>
          </DashboardSection>

          {/* Right/bottom: the map */}
          <DashboardSection title="แผนที่">
            <div className="h-[50vh] min-h-[320px] lg:h-[60vh] lg:min-h-[400px] rounded-xl overflow-hidden border border-surface-border">
              <PickupMap
                points={filteredPoints}
                selectedPointId={selectedId}
                onMarkerClick={(p) => setSelectedId(p.id)}
              />
            </div>
          </DashboardSection>
        </div>
      )}

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
          apiBase="/school"
          point={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchPoints(sessionFilter); }}
        />
      )}
    </div>
  );
}

/* ── Create-pickup modal: vehicle dropdown + per-vehicle student checklist ── */
function CreatePickupModal({ onClose, onCreated }) {
  const [vehicles, setVehicles] = useState([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [vehiclesError, setVehiclesError] = useState(null);

  const [form, setForm] = useState({
    vehicle_id: '',
    label: '',
    latitude: '',
    longitude: '',
    session: 'both',
    notes: '',
  });

  const [students, setStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Pre-load the vehicle dropdown on mount.
  useEffect(() => {
    let cancelled = false;
    api.get('/school/pickup-vehicles')
      .then(r => {
        if (cancelled) return;
        setVehicles(Array.isArray(r.data?.data) ? r.data.data : []);
      })
      .catch(err => {
        if (cancelled) return;
        setVehiclesError(err?.response?.data?.message || 'โหลดรายชื่อรถไม่สำเร็จ');
      })
      .finally(() => { if (!cancelled) setVehiclesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // When vehicle OR session is picked/changed, refetch the available
  // students for that combo. Server filters out students already
  // assigned to a conflicting session on the selected vehicle, so the
  // checklist only shows people eligible for the new point.
  useEffect(() => {
    if (!form.vehicle_id) {
      setStudents([]);
      setSelectedIds(new Set());
      return;
    }
    let cancelled = false;
    setStudentsLoading(true);
    setStudentsError(null);
    const url = `/school/pickup-students?vehicle_id=${encodeURIComponent(form.vehicle_id)}&session=${encodeURIComponent(form.session)}`;
    api.get(url)
      .then(r => {
        if (cancelled) return;
        const list = Array.isArray(r.data?.data) ? r.data.data : [];
        setStudents(list);
        // Trim selection to students still allowed (e.g. when session
        // changes from 'morning' → 'both' and some students are now
        // ineligible because they have evening assignments).
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
        setStudents([]);
      })
      .finally(() => { if (!cancelled) setStudentsLoading(false); });
    return () => { cancelled = true; };
  }, [form.vehicle_id, form.session]);

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
  const dirty = Boolean(form.vehicle_id || form.label || form.latitude || form.longitude || form.notes)
    || selectedIds.size > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return; // guard the double-tap
    setSaving(true); setErrors([]);
    try {
      await api.post('/school/pickup-points', {
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

  // A school runs several buses, so the point belongs to one of them and the
  // choice drives which pupils are offered. The driver editor has no such
  // choice, so it stays at this call site rather than inside the shared block.
  const vehicleField = (
    <div>
      {vehiclesLoading ? (
        <>
          <p className="block text-sm font-medium text-ink mb-1">รถ</p>
          <p className="text-sm text-ink-muted">กำลังโหลดรายชื่อรถ…</p>
        </>
      ) : vehiclesError ? (
        <AlertBanner variant="danger" title="โหลดรายชื่อรถไม่สำเร็จ">{vehiclesError}</AlertBanner>
      ) : (
        <FormField label="รถ" required helper="เลือกรถก่อนจึงจะแสดงรายชื่อนักเรียนที่เพิ่มได้">
          {ctl => (
            <select
              {...ctl}
              value={form.vehicle_id}
              onChange={e => update('vehicle_id', e.target.value)}
              required
              className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink transition"
            >
              <option value="">เลือกรถ…</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>
                  {v.plate_no} {v.student_count != null && `(${v.student_count} คน)`}
                </option>
              ))}
            </select>
          )}
        </FormField>
      )}
    </div>
  );

  return (
    <>
      <Modal
        title="เพิ่มจุดรับส่ง"
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
              form="school-pickup-form"
              disabled={saving || !form.vehicle_id}
              className="focus-ring px-4 min-h-[44px] text-sm font-semibold rounded-lg bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white transition disabled:opacity-60 disabled:pointer-events-none"
            >
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </>
        }
      >
        <form id="school-pickup-form" onSubmit={handleSubmit}>
          <PickupPointFields
            form={form}
            onChange={update}
            sessionLabels={SESSION_LABEL}
            leadingFields={vehicleField}
            students={students}
            studentsLoading={studentsLoading}
            studentsError={studentsError}
            studentsEmptyText={form.vehicle_id
              ? 'นักเรียนของรถคันนี้มีจุดรับส่งครบแล้วในรอบที่เลือก'
              : 'เลือกรถก่อนเพื่อดูรายชื่อนักเรียน'}
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

function PickupPointRow({ point, selected, onClick, onEdit, onDelete, deleting }) {
  const studentCount = Array.isArray(point.students) ? point.students.length : 0;
  const previewNames = (point.students || []).slice(0, 3)
    .map(s => `${s.first_name} ${s.last_name}`).join(', ');

  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKey}
      className={`block w-full text-left transition rounded-xl cursor-pointer ${
        selected ? 'ring-2 ring-brand' : 'hover:shadow-md'
      }`}
    >
      <AppCard padding="sm">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="font-semibold text-ink truncate">{point.label}</p>
          <StatusBadge variant="neutral" size="sm">
            {SESSION_LABEL[point.session] || point.session || 'ทั้งวัน'}
          </StatusBadge>
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-muted mb-1">
          <span className="inline-flex items-center gap-1">
            <Bus className="w-3.5 h-3.5" strokeWidth={2} />
            {point.plate_no || '-'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="w-3.5 h-3.5" strokeWidth={2} />
            {studentCount} คน
          </span>
        </div>
        {previewNames && (
          <p className="text-xs text-ink-muted truncate">
            {previewNames}{studentCount > 3 && ` …`}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-2 mt-1">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="focus-ring inline-flex items-center text-sm text-brand-700 font-medium px-1 min-h-[44px] rounded-lg hover:underline"
          >
            เปิดใน Google Maps
            <span aria-hidden="true">&nbsp;→</span>
            <span className="sr-only"> (เปิดในแท็บใหม่)</span>
          </a>
          <div className="flex items-center gap-2">
            {onDelete && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onDelete(); }}
                disabled={deleting}
                className="focus-ring inline-flex items-center gap-1 text-sm font-medium text-danger-ink bg-danger-soft hover:opacity-90 rounded-lg px-2.5 min-h-[44px] transition disabled:opacity-50 disabled:pointer-events-none"
              >
                <Trash2 className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                {deleting ? 'กำลังลบ…' : 'ลบ'}
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onEdit(); }}
                className="focus-ring inline-flex items-center gap-1 text-sm font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 active:bg-brand-100 rounded-lg px-2.5 min-h-[44px] transition"
              >
                <Pencil className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                แก้ไขรายชื่อนักเรียน
              </button>
            )}
          </div>
        </div>
      </AppCard>
    </div>
  );
}
