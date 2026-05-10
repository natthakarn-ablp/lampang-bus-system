import { useEffect, useState, useCallback, useMemo } from 'react';
import { Map as MapIcon, Sunrise, Sunset, X, Plus } from 'lucide-react';
import api from '../../api/axios';
import { AppCard, AlertBanner, StatusBadge } from '../../components/ui';
import PickupMap from '../../components/PickupMap';
import PickupCoordPicker from '../../components/PickupCoordPicker';

const SESSION_LABEL = { morning: 'รอบเช้า', evening: 'รอบเย็น', both: 'ทั้งวัน' };

export default function DriverPickupMap() {
  const [points, setPoints] = useState([]);
  const [vehicle, setVehicle] = useState(null);
  const [sessionFilter, setSessionFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

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

  const selected = points.find(p => p.id === selectedId) || null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header strip — title + vehicle + add button + session filter */}
      <header className="shrink-0 px-4 py-3 border-b border-surface-border bg-surface">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-ink leading-tight flex items-center gap-2">
              <MapIcon className="w-5 h-5 text-brand" strokeWidth={2} />
              แผนที่จุดรับส่ง
            </h1>
            {vehicle && (
              <p className="text-xs text-ink-muted truncate">
                {vehicle.plate_no} · {points.length} จุด
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={!vehicle}
            className="shrink-0 inline-flex items-center gap-1.5 bg-brand hover:bg-brand-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition disabled:opacity-50"
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} />
            <span className="hidden sm:inline">เพิ่มจุดรับส่ง</span>
            <span className="sm:hidden">เพิ่ม</span>
          </button>
        </div>
        <SessionFilter value={sessionFilter} onChange={setSessionFilter} />
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
          <div className="absolute inset-0 flex items-center justify-center text-ink-muted">
            กำลังโหลด…
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
    </div>
  );
}

/* ── Create-pickup modal: pre-loaded student checklist for driver ── */
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
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);

  // Pre-load students for the driver's vehicle on mount.
  useEffect(() => {
    let cancelled = false;
    api.get('/driver/pickup-students')
      .then(r => {
        if (cancelled) return;
        const list = Array.isArray(r.data?.data) ? r.data.data : [];
        setStudents(list);
      })
      .catch(err => {
        if (cancelled) return;
        setStudentsError(err?.response?.data?.message || 'โหลดรายชื่อนักเรียนไม่สำเร็จ');
      })
      .finally(() => { if (!cancelled) setStudentsLoading(false); });
    return () => { cancelled = true; };
  }, []);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-surface w-full max-w-lg rounded-2xl shadow-elevate max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b border-surface-border sticky top-0 bg-surface">
          <h2 className="font-semibold text-ink">เพิ่มจุดรับส่งของรถคุณ</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-surface-border" aria-label="ปิด">
            <X className="w-4 h-4 text-ink-muted" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
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
          <div className="rounded-xl overflow-hidden border border-surface-border">
            <PickupCoordPicker
              value={coords}
              onChange={([lat, lng]) => {
                update('latitude', lat.toFixed(6));
                update('longitude', lng.toFixed(6));
              }}
            />
          </div>

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

          {/* Student checklist — pre-loaded; client-side filter only */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-ink-muted">
                เลือกนักเรียนที่ขึ้นจุดนี้
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

            {studentsLoading ? (
              <p className="text-sm text-ink-muted py-3 text-center">กำลังโหลดรายชื่อ…</p>
            ) : studentsError ? (
              <AlertBanner variant="danger" title="โหลดรายชื่อไม่สำเร็จ">{studentsError}</AlertBanner>
            ) : students.length === 0 ? (
              <p className="text-sm text-ink-muted py-3 text-center">ไม่มีนักเรียนในรถคันนี้</p>
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
                          {s.classroom && (
                            <span className="text-xs text-ink-muted ml-2">{s.classroom}</span>
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
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand hover:bg-brand-700 text-white disabled:opacity-60">
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Session filter — three pill buttons ── */
function SessionFilter({ value, onChange }) {
  const options = [
    { key: 'all',     label: 'ทั้งหมด',  icon: null },
    { key: 'morning', label: 'รอบเช้า',  icon: Sunrise },
    { key: 'evening', label: 'รอบเย็น',  icon: Sunset  },
  ];
  return (
    <div className="flex gap-1.5 overflow-x-auto">
      {options.map(opt => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition border ${
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

/* ── Selected-point detail card ── */
function SelectedPointCard({ point, onClose }) {
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
          {point.students.map(s => (
            <li key={s.id} className="flex items-center gap-2 min-w-0">
              <span className="truncate text-ink">{s.first_name} {s.last_name}</span>
              {s.classroom && (
                <span className="text-xs text-ink-muted shrink-0">{s.classroom}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <a
        href={`https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full text-center text-sm font-medium text-white bg-brand hover:bg-brand-700 rounded-lg py-2 transition"
      >
        เปิดใน Google Maps →
      </a>
    </AppCard>
  );
}
