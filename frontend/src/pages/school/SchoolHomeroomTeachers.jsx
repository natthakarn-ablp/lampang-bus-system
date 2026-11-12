import { useState, useEffect, useCallback, useMemo } from 'react';
import { UserCheck, Plus, Phone } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import {
  AppCard, FilterBar, ConfirmDialog, FormField, Modal as UiModal, StatusBadge as Badge,
} from '../../components/ui';

/**
 * ครูประจำชั้น (school main account) — homeroom teacher(s) of each grade/room,
 * name + optional phone (owner decision 2026-11-12, FEATURE_HOMEROOM_TEACHERS).
 * The rooms offered are the ones pupils are actually in, so the names line up
 * with the classroom check page, the student list, the driver's list and the
 * parent's LINE status. Backend: /api/school/homeroom-teachers.
 */

const PRIMARY_BTN = 'focus-ring w-full bg-brand-600 hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50 text-white font-medium min-h-[48px] rounded-lg transition';
const SMALL_BTN = 'focus-ring inline-flex items-center justify-center gap-1 px-3 min-h-[44px] rounded-lg text-sm font-medium transition';

function roomLabel(room) {
  return `${room.grade} / ${room.classroom ? `ห้อง ${room.classroom}` : 'ไม่ระบุห้อง'}`;
}

function formatPhone(phone) {
  const d = String(phone || '');
  if (/^0\d{8,9}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
}

export default function SchoolHomeroomTeachers() {
  const toast = useToast();
  const [rooms, setRooms] = useState([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [onlyMissing, setOnlyMissing] = useState('all');

  const [modal, setModal] = useState(null); // { mode: 'add'|'edit', room, teacher? }
  const [form, setForm] = useState({ teacher_name: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // { room, teacher }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/school/homeroom-teachers');
      setRooms(Array.isArray(res.data?.data?.rooms) ? res.data.data.rooms : []);
      setCanEdit(Boolean(res.data?.data?.can_edit));
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดรายชื่อครูประจำชั้นไม่สำเร็จ');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const missingCount = rooms.filter((r) => r.student_count > 0 && r.teachers.length === 0).length;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rooms.filter((r) => {
      if (onlyMissing === 'missing' && r.teachers.length > 0) return false;
      if (!q) return true;
      return [r.grade, r.classroom, ...r.teachers.map((t) => t.name)]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [rooms, search, onlyMissing]);

  const grades = useMemo(() => [...new Set(shown.map((r) => r.grade))], [shown]);

  function openAdd(room) {
    setForm({ teacher_name: '', phone: '' });
    setModal({ mode: 'add', room });
  }
  function openEdit(room, teacher) {
    setForm({ teacher_name: teacher.name, phone: teacher.phone || '' });
    setModal({ mode: 'edit', room, teacher });
  }

  async function save() {
    if (!form.teacher_name.trim()) { toast.error('กรุณากรอกชื่อครู'); return; }
    setSaving(true);
    try {
      if (modal.mode === 'add') {
        await api.post('/school/homeroom-teachers', {
          grade: modal.room.grade, classroom: modal.room.classroom,
          teacher_name: form.teacher_name, phone: form.phone,
        });
        toast.success('เพิ่มครูประจำชั้นแล้ว');
      } else {
        await api.put(`/school/homeroom-teachers/${modal.teacher.id}`, {
          teacher_name: form.teacher_name, phone: form.phone,
        });
        toast.success('บันทึกแล้ว');
      }
      setModal(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!confirmDelete) return;
    setSaving(true);
    try {
      await api.delete(`/school/homeroom-teachers/${confirmDelete.teacher.id}`);
      toast.success('ลบรายชื่อครูแล้ว');
      setConfirmDelete(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ลบไม่สำเร็จ');
    } finally { setSaving(false); }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="ครูประจำชั้น"
        subtitle="ระบุครูประจำชั้นของแต่ละห้อง ชื่อจะแสดงในหน้าเช็กชื่อ รายชื่อนักเรียน รายชื่อเด็กของคนขับ และข้อความสถานะใน LINE ของผู้ปกครอง"
        icon={UserCheck}
      />

      {!canEdit && !loading && !error && (
        <p className="text-sm text-ink-muted mb-4">ดูได้อย่างเดียว การแก้ไขทำได้จากบัญชีหลักของโรงเรียน</p>
      )}

      <FilterBar
        className="mb-5"
        search={{ value: search, onChange: setSearch, placeholder: 'ค้นหาชั้น ห้อง หรือชื่อครู…', label: 'ค้นหา' }}
        chips={{
          label: 'แสดงห้อง',
          value: onlyMissing,
          onChange: setOnlyMissing,
          options: [['all', 'ทุกห้อง'], ['missing', 'ยังไม่มีครูประจำชั้น', missingCount]],
        }}
        count={loading || error ? undefined : shown.length}
        countLabel="ห้อง"
        onClear={() => setSearch('')}
      />

      {loading && <LoadingState message="กำลังโหลดรายชื่อครูประจำชั้น…" />}
      {error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && shown.length === 0 && (
        <EmptyState
          icon={UserCheck}
          title={rooms.length === 0 ? 'ยังไม่มีนักเรียนที่ระบุชั้นในโรงเรียน' : 'ไม่พบห้องตามเงื่อนไขที่เลือก'}
          description={rooms.length === 0 ? 'เพิ่มชั้นและห้องให้นักเรียนก่อน แล้วกลับมาระบุครูประจำชั้น' : undefined}
        />
      )}

      {!loading && !error && grades.map((grade) => (
        <section key={grade} className="mb-6" aria-labelledby={`grade-${grade}`}>
          <h2 id={`grade-${grade}`} className="text-lg font-bold text-ink mb-2">{grade}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {shown.filter((r) => r.grade === grade).map((room) => (
              <AppCard key={`${room.grade}|${room.classroom}`} padding="none" className="overflow-hidden">
                <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-ink">{roomLabel(room)}</h3>
                    <p className="text-sm text-ink-muted">นักเรียน {room.student_count} คน</p>
                  </div>
                  {room.teachers.length === 0 && room.student_count > 0 && <Badge variant="warn" size="sm">ยังไม่มีครู</Badge>}
                </div>
                <ul className="divide-y divide-surface-border">
                  {room.teachers.map((t) => (
                    <li key={t.id} className="px-4 py-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-ink break-words">{t.name}</p>
                        {t.phone && (
                          <a href={`tel:${t.phone}`} className="text-sm text-brand-700 inline-flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5" aria-hidden="true" />{formatPhone(t.phone)}
                          </a>
                        )}
                      </div>
                      {canEdit && (
                        <div className="flex gap-1.5">
                          <button type="button" onClick={() => openEdit(room, t)} className={`${SMALL_BTN} bg-brand-50 text-brand-700 hover:bg-brand-100`}>แก้ไข</button>
                          <button type="button" onClick={() => setConfirmDelete({ room, teacher: t })} className={`${SMALL_BTN} bg-danger-soft text-danger-ink hover:bg-danger-soft/70`}>ลบ</button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                {canEdit && (
                  <div className="px-4 py-3 border-t border-surface-border">
                    <button type="button" onClick={() => openAdd(room)} className={`${SMALL_BTN} bg-surface hover:bg-surface-border text-ink`}>
                      <Plus className="w-4 h-4" aria-hidden="true" />เพิ่มครูประจำชั้น
                    </button>
                  </div>
                )}
              </AppCard>
            ))}
          </div>
        </section>
      ))}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="ลบรายชื่อครูประจำชั้น?"
        itemName={confirmDelete ? `${confirmDelete.teacher.name} — ${roomLabel(confirmDelete.room)}` : ''}
        description="ชื่อนี้จะไม่แสดงในหน้าเช็กชื่อ รายชื่อนักเรียน รายชื่อของคนขับ และ LINE ของผู้ปกครองอีก"
        confirmLabel="ลบรายชื่อ"
        loading={saving}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(null)}
      />

      {modal && (
        <UiModal title={`${modal.mode === 'add' ? 'เพิ่มครูประจำชั้น' : 'แก้ไขครูประจำชั้น'}: ${roomLabel(modal.room)}`} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <FormField label="ชื่อครู" required value={form.teacher_name}
              onChange={(v) => setForm({ ...form, teacher_name: v })} placeholder="เช่น ครูสมใจ ใจดี" />
            <FormField label="เบอร์โทร" type="tel" inputMode="tel" value={form.phone}
              helper="ไม่บังคับ · คนขับและผู้ปกครองของเด็กในห้องนี้จะเห็นเบอร์นี้"
              onChange={(v) => setForm({ ...form, phone: v })} placeholder="เช่น 0812345678" />
            <button type="button" onClick={save} disabled={saving} className={PRIMARY_BTN}>
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
            <button type="button" onClick={() => setModal(null)}
              className="focus-ring w-full text-ink-muted hover:text-ink hover:bg-surface text-sm min-h-[44px] rounded-lg transition">
              ยกเลิก
            </button>
          </div>
        </UiModal>
      )}
    </div>
  );
}
