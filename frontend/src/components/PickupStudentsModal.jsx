import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import api from '../api/axios';
import { AlertBanner, StatusBadge } from './ui';
import { classroomLabel } from '../utils/student';

const SESSION_LABEL = { morning: 'รอบเช้า', evening: 'รอบเย็น', both: 'ทั้งวัน' };

/**
 * Phase 6.1 hotfix — shared "manage students on a pickup point" modal.
 * Used by Driver, School, and Admin pages so all three present the same
 * checklist UX (pre-checked currently-assigned students, "อยู่ในจุดนี้"
 * badge, classroom label, replace-by-PUT save).
 *
 * Props:
 *   - apiBase: '/driver' | '/school' | '/admin'
 *   - point:   { id, label, session, ... }
 *   - title:   optional override (defaults to "จัดการนักเรียนของจุด: <label>")
 *   - onClose, onSaved: callbacks
 *
 * Endpoint contract (all three roles):
 *   GET  {apiBase}/pickup-points/:id/assignable-students
 *        → { data: { point, students: [{ id, currently_assigned, ... }] } }
 *   PUT  {apiBase}/pickup-points/:id/students  { student_ids: [...] }
 */
export default function PickupStudentsModal({ apiBase, point, title, onClose, onSaved }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    api.get(`${apiBase}/pickup-points/${point.id}/assignable-students`)
      .then(r => {
        if (cancelled) return;
        const list = Array.isArray(r.data?.data?.students) ? r.data.data.students : [];
        setStudents(list);
        const initial = new Set(list.filter(s => s.currently_assigned).map(s => s.id));
        setSelectedIds(initial);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err?.response?.data?.message || 'โหลดรายชื่อนักเรียนไม่สำเร็จ');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiBase, point.id]);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true); setErrors([]);
    try {
      await api.put(`${apiBase}/pickup-points/${point.id}/students`, {
        student_ids: Array.from(selectedIds),
      });
      onSaved();
    } catch (err) {
      setErrors(err?.response?.data?.errors
        || [{ message: err?.response?.data?.message || 'บันทึกไม่สำเร็จ' }]);
    } finally {
      setSaving(false);
    }
  };

  const heading = title || `จัดการนักเรียนของจุด: ${point.label}`;

  return (
    <div className="fixed inset-0 z-[9999] isolate flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="relative z-[10000] bg-surface w-full max-w-lg rounded-2xl shadow-elevate max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b border-surface-border sticky top-0 bg-surface">
          <h2 className="font-semibold text-ink truncate pr-2">{heading}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-surface-border" aria-label="ปิด">
            <X className="w-4 h-4 text-ink-muted" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="text-sm">
            <p className="font-semibold text-ink">{point.label}</p>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge variant="neutral" size="sm">
                {SESSION_LABEL[point.session] || point.session || 'ทั้งวัน'}
              </StatusBadge>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-ink-muted">
                เลือกนักเรียนสำหรับจุดรับส่งนี้
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

            {loading ? (
              <p className="text-sm text-ink-muted py-3 text-center">กำลังโหลดรายชื่อ…</p>
            ) : error ? (
              <AlertBanner variant="danger" title="โหลดรายชื่อไม่สำเร็จ">{error}</AlertBanner>
            ) : students.length === 0 ? (
              <p className="text-sm text-ink-muted py-3 text-center">ไม่มีนักเรียนเพิ่มเติมที่สามารถเลือกได้</p>
            ) : (
              <>
                <input
                  type="text"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder="กรองตามชื่อ / ห้อง…"
                  className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 mb-2"
                />
                <div className="border border-surface-border rounded-lg divide-y divide-surface-border max-h-72 overflow-y-auto">
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
                          {s.currently_assigned && (
                            <span className="text-xs text-success ml-2">· อยู่ในจุดนี้</span>
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
            <button type="submit" disabled={saving || loading} className="px-4 py-2 text-sm rounded-lg bg-brand hover:bg-brand-700 text-white disabled:opacity-60">
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
