import { useEffect, useMemo, useState, useCallback } from 'react';
import { Map as MapIcon, Bus, Users, Sunrise, Sunset, Plus, X, Pencil } from 'lucide-react';
import api from '../../api/axios';
import { AppCard, AlertBanner, StatusBadge, DashboardSection } from '../../components/ui';
import PickupMap from '../../components/PickupMap';
import PickupCoordPicker from '../../components/PickupCoordPicker';
import PickupStudentsModal from '../../components/PickupStudentsModal';
import { classroomLabel } from '../../utils/student';
import { useAuth } from '../../hooks/useAuth';
import { isGradeTeacher } from '../../utils/authScope';

const SESSION_LABEL = { morning: 'รอบเช้า', evening: 'รอบเย็น', both: 'ทั้งวัน' };

export default function SchoolPickupMap() {
  const { user } = useAuth();
  const isTeacher = isGradeTeacher(user); // read-only for grade teacher
  const [points, setPoints] = useState([]);
  const [sessionFilter, setSessionFilter] = useState('all');
  const [vehicleFilter, setVehicleFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);  // null | { ...point }

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
      <header>
        <h1 className="text-2xl sm:text-3xl font-semibold text-ink leading-tight flex items-center gap-2">
          <MapIcon className="w-6 h-6 text-brand" strokeWidth={2} />
          แผนที่จุดรับส่ง
        </h1>
        <p className="text-sm text-ink-muted mt-1">
          จุดรับส่งของนักเรียนในโรงเรียน · {filteredPoints.length} จุด
        </p>
      </header>

      {/* Filter strip — session pills, vehicle dropdown, add button */}
      <div className="flex flex-wrap items-center gap-3">
        <SessionFilter value={sessionFilter} onChange={setSessionFilter} />
        {vehicleOptions.length > 0 && (
          <select
            value={vehicleFilter}
            onChange={e => setVehicleFilter(e.target.value)}
            className="text-sm border border-surface-border rounded-lg px-3 py-1.5 bg-surface text-ink"
          >
            <option value="all">รถทุกคัน</option>
            {vehicleOptions.map(v => (
              <option key={v.id} value={v.id}>{v.plate}</option>
            ))}
          </select>
        )}
        {!isTeacher && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="ml-auto inline-flex items-center gap-1.5 bg-brand hover:bg-brand-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition"
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} />
            เพิ่มจุดรับส่ง
          </button>
        )}
      </div>

      {error ? (
        <AlertBanner variant="danger" title="โหลดข้อมูลไม่สำเร็จ">{error}</AlertBanner>
      ) : loading ? (
        <p className="text-ink-muted py-10 text-center">กำลังโหลด…</p>
      ) : filteredPoints.length === 0 ? (
        <AlertBanner variant="info" title="ยังไม่มีจุดรับส่ง">
          {isTeacher
            ? 'ยังไม่มีจุดรับส่งของระดับชั้นนี้ — ให้บัญชีหลักของโรงเรียนเป็นผู้เพิ่มข้อมูล'
            : 'กดปุ่ม "+ เพิ่มจุดรับส่ง" ด้านบนเพื่อเริ่มสร้างจุดแรกของโรงเรียน'}
        </AlertBanner>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
          {/* Left/top: list of points (click → highlight on map) */}
          <DashboardSection title="รายการจุดรับส่ง" description={`${filteredPoints.length} จุด`}>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {filteredPoints.map(p => (
                <PickupPointRow
                  key={p.id}
                  point={p}
                  selected={selectedId === p.id}
                  onClick={() => setSelectedId(p.id)}
                  onEdit={isTeacher ? undefined : () => setEditing(p)}
                />
              ))}
            </div>
          </DashboardSection>

          {/* Right/bottom: the map */}
          <DashboardSection title="แผนที่">
            <div className="h-[60vh] min-h-[400px] rounded-xl overflow-hidden border border-surface-border">
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
  const [filter, setFilter] = useState('');

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);

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

  const visibleStudents = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return students;
    return students.filter(s =>
      `${s.first_name} ${s.last_name} ${s.classroom || ''}`.toLowerCase().includes(q)
    );
  }, [students, filter]);

  const toggleStudent = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allVisibleSelected = visibleStudents.length > 0
    && visibleStudents.every(s => selectedIds.has(s.id));
  const toggleAllVisible = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleStudents.forEach(s => next.delete(s.id));
      } else {
        visibleStudents.forEach(s => next.add(s.id));
      }
      return next;
    });
  };

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const coords = useMemo(() => {
    const lat = parseFloat(form.latitude), lng = parseFloat(form.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  }, [form.latitude, form.longitude]);

  const handleSubmit = async (e) => {
    e.preventDefault();
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

  return (
    <div className="fixed inset-0 z-[9999] isolate flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="relative z-[10000] bg-surface w-full max-w-lg rounded-2xl shadow-elevate max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b border-surface-border sticky top-0 bg-surface">
          <h2 className="font-semibold text-ink">เพิ่มจุดรับส่ง</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-surface-border" aria-label="ปิด">
            <X className="w-4 h-4 text-ink-muted" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {/* Vehicle dropdown — drives the student-checklist fetch */}
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">รถ</label>
            {vehiclesLoading ? (
              <p className="text-sm text-ink-muted">กำลังโหลดรายชื่อรถ…</p>
            ) : vehiclesError ? (
              <AlertBanner variant="danger" title="โหลดรายชื่อรถไม่สำเร็จ">{vehiclesError}</AlertBanner>
            ) : (
              <select
                value={form.vehicle_id}
                onChange={e => update('vehicle_id', e.target.value)}
                required
                className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 bg-surface text-ink"
              >
                <option value="">เลือกรถ…</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.plate_no} {v.student_count != null && `(${v.student_count} คน)`}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">ป้ายชื่อจุด</label>
            <input
              type="text" required maxLength={100}
              value={form.label}
              onChange={e => update('label', e.target.value)}
              placeholder="เช่น หน้าโรงเรียน, ปาก ซ.5"
              className="w-full text-sm border border-surface-border rounded-lg px-3 py-2"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">Latitude</label>
              <input
                type="number" step="any" required min={-90} max={90}
                value={form.latitude}
                onChange={e => update('latitude', e.target.value)}
                className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">Longitude</label>
              <input
                type="number" step="any" required min={-180} max={180}
                value={form.longitude}
                onChange={e => update('longitude', e.target.value)}
                className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 tabular-nums"
              />
            </div>
          </div>

          <p className="text-xs text-ink-muted">คลิกบนแผนที่เพื่อกำหนดพิกัด</p>
          <PickupCoordPicker
            value={coords}
            onChange={([lat, lng]) => {
              update('latitude', lat.toFixed(6));
              update('longitude', lng.toFixed(6));
            }}
          />

          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">รอบ</label>
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
          </div>

          {/* Student checklist — appears AFTER vehicle is picked */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-ink-muted">
                เลือกนักเรียนที่ยังไม่มีจุดรับส่งในรอบนี้
                {students.length > 0 && (
                  <span className="ml-1 tabular-nums">
                    ({selectedIds.size}/{students.length})
                  </span>
                )}
              </label>
              {visibleStudents.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAllVisible}
                  className="text-xs text-brand font-medium hover:underline"
                >
                  {allVisibleSelected ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
                </button>
              )}
            </div>

            {!form.vehicle_id ? (
              <p className="text-sm text-ink-muted py-3 text-center">เลือกรถก่อน เพื่อดูรายชื่อนักเรียน</p>
            ) : studentsLoading ? (
              <p className="text-sm text-ink-muted py-3 text-center">กำลังโหลดรายชื่อ…</p>
            ) : studentsError ? (
              <AlertBanner variant="danger" title="โหลดรายชื่อไม่สำเร็จ">{studentsError}</AlertBanner>
            ) : students.length === 0 ? (
              <p className="text-sm text-ink-muted py-3 text-center">นักเรียนของโรงเรียนในรถคันนี้มีจุดรับส่งครบแล้ว</p>
            ) : (
              <>
                <input
                  type="text"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder="กรองตามชื่อ / ห้อง…"
                  className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 mb-2"
                />
                <div className="border border-surface-border rounded-lg divide-y divide-surface-border max-h-56 overflow-y-auto">
                  {visibleStudents.map(s => {
                    const checked = selectedIds.has(s.id);
                    const cls = classroomLabel(s);
                    return (
                      <label
                        key={s.id}
                        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-border/50"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleStudent(s.id)}
                          className="w-4 h-4 accent-brand"
                        />
                        <span className="flex-1 min-w-0 text-sm">
                          <span className="font-medium text-ink">
                            {s.prefix || ''}{s.first_name} {s.last_name}
                          </span>
                          {cls && (
                            <span className="text-xs text-ink-muted ml-2">· {cls}</span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                  {visibleStudents.length === 0 && filter && (
                    <p className="text-xs text-ink-muted py-3 text-center">ไม่พบนักเรียนตามที่กรอง</p>
                  )}
                </div>
              </>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">หมายเหตุ (ไม่บังคับ)</label>
            <input
              type="text" maxLength={255}
              value={form.notes}
              onChange={e => update('notes', e.target.value)}
              className="w-full text-sm border border-surface-border rounded-lg px-3 py-2"
            />
          </div>

          {errors.length > 0 && (
            <AlertBanner variant="danger" title="บันทึกไม่สำเร็จ">
              <ul className="list-disc pl-4 text-xs">
                {errors.map((e, i) => <li key={i}>{e.field ? `${e.field}: ` : ''}{e.message}</li>)}
              </ul>
            </AlertBanner>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-surface-border">
              ยกเลิก
            </button>
            <button type="submit" disabled={saving || !form.vehicle_id} className="px-4 py-2 text-sm rounded-lg bg-brand hover:bg-brand-700 text-white disabled:opacity-60">
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Session filter pill row (shared shape with DriverPickupMap) ── */
function SessionFilter({ value, onChange }) {
  const options = [
    { key: 'all',     label: 'ทั้งหมด',  icon: null },
    { key: 'morning', label: 'รอบเช้า',  icon: Sunrise },
    { key: 'evening', label: 'รอบเย็น',  icon: Sunset  },
  ];
  return (
    <div className="flex gap-1.5">
      {options.map(opt => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition border ${
              active
                ? 'bg-brand text-white border-brand'
                : 'bg-surface text-ink-muted border-surface-border hover:bg-surface-border'
            }`}
          >
            {opt.icon && <opt.icon className="w-3.5 h-3.5" strokeWidth={2} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Pickup-point row (clickable; highlight = selected on map) ── */
function PickupPointRow({ point, selected, onClick, onEdit }) {
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
        <div className="flex items-center justify-between gap-2 mt-2">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-xs text-brand font-medium hover:underline"
          >
            เปิดใน Google Maps →
          </a>
          {onEdit && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onEdit(); }}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand bg-brand-50 hover:bg-brand-100 rounded-md px-2 py-1 transition"
            >
              <Pencil className="w-3.5 h-3.5" strokeWidth={2} />
              แก้ไขรายชื่อนักเรียน
            </button>
          )}
        </div>
      </AppCard>
    </div>
  );
}
