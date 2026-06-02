import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, KeyRound, Trash2, ShieldAlert, Users } from 'lucide-react';
import api from '../../api/axios';
import { AppCard, AlertBanner, StatusBadge } from '../../components/ui';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { isGradeTeacher } from '../../utils/authScope';

/**
 * Phase 7.11.5 — school main account manages grade-teacher sub-accounts
 * for its OWN school. Backend resolves school_id from req.user.scopeId
 * (or admin's ?school_id=); teacher accounts are blocked at the route
 * level. This page renders a friendly denied card for teachers in
 * case they navigate here directly.
 */

const GRADES = [
  'อ.1','อ.2','อ.3',
  'ป.1','ป.2','ป.3','ป.4','ป.5','ป.6',
  'ม.1','ม.2','ม.3','ม.4','ม.5','ม.6',
];

function formatDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function TeacherDeniedCard() {
  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <AppCard padding="lg">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-6 h-6 text-warn shrink-0" strokeWidth={2} />
          <div>
            <h1 className="text-lg font-semibold text-ink mb-1">
              ไม่มีสิทธิ์เข้าถึงข้อมูลนี้
            </h1>
            <p className="text-sm text-ink-muted">
              บัญชีครูประจำสายชั้นเข้าถึงได้เฉพาะข้อมูลสำหรับตรวจสอบเท่านั้น
              การจัดการบัญชีครูทำได้เฉพาะบัญชีหลักของโรงเรียน
            </p>
          </div>
        </div>
      </AppCard>
    </div>
  );
}

export default function SchoolTeacherAccounts() {
  const { user } = useAuth();
  const toast = useToast();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [modal, setModal]       = useState(null); // null | 'create' | 'reset' | 'delete' | 'bulkDelete'
  const [selected, setSelected] = useState(null);
  const [form, setForm]         = useState({});
  const [saving, setSaving]     = useState(false);

  // Phase 10.10G-C — bulk selection state. Self-account (`user.id`) is excluded
  // from the deletable set so the operator cannot accidentally lock themselves
  // out of the school by bulk-deleting their own row.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const currentUserId = user?.id;
  const isDeletable = useCallback(
    (acc) => !!acc && acc.id !== currentUserId,
    [currentUserId]
  );
  const deletableVisibleIds = useMemo(
    () => accounts.filter(isDeletable).map(a => a.id),
    [accounts, isDeletable]
  );
  const isAllVisibleSelected = deletableVisibleIds.length > 0
    && deletableVisibleIds.every(id => selectedIds.has(id));
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
      if (deletableVisibleIds.length > 0 && deletableVisibleIds.every(id => prev.has(id))) {
        const next = new Set(prev);
        deletableVisibleIds.forEach(id => next.delete(id));
        return next;
      }
      const next = new Set(prev);
      deletableVisibleIds.forEach(id => next.add(id));
      return next;
    });
  }, [deletableVisibleIds]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const selectedRows = useMemo(
    () => accounts.filter(a => selectedIds.has(a.id)),
    [accounts, selectedIds]
  );

  // Prune ids that disappeared from the list (after a successful delete /
  // pagination / scope change). Matches "Clear selection after data reload".
  useEffect(() => {
    if (loading) return;
    setSelectedIds(prev => {
      const visible = new Set(accounts.map(a => a.id));
      let changed = false;
      const next = new Set();
      prev.forEach(id => {
        if (visible.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [loading, accounts]);

  const headerCheckboxRef = useRef(null);
  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = isIndeterminate;
  }, [isIndeterminate]);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/school/teacher-accounts');
      setAccounts(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (err) {
      setError(err?.response?.data?.message || 'โหลดข้อมูลบัญชีครูไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  // Teacher → denied. Render AFTER hooks fire (rules of hooks).
  if (isGradeTeacher(user)) return <TeacherDeniedCard />;

  /* ── handlers ──────────────────────────────────────────────────────── */

  const openCreate = () => {
    setForm({ username: '', display_name: '', grade_scope: '', password: '', confirm: '' });
    setModal('create');
  };

  const handleCreate = async () => {
    if (!form.username?.trim()) { toast.error('กรุณากรอกชื่อผู้ใช้'); return; }
    if (!form.grade_scope)      { toast.error('กรุณาเลือกระดับชั้น'); return; }
    if (!form.password || form.password.length < 6) { toast.error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return; }
    if (form.password !== form.confirm)              { toast.error('รหัสผ่านยืนยันไม่ตรงกัน'); return; }
    setSaving(true);
    try {
      await api.post('/school/teacher-accounts', {
        username:     form.username.trim(),
        password:     form.password,
        display_name: form.display_name?.trim() || form.username.trim(),
        grade_scope:  form.grade_scope,
      });
      toast.success('สร้างบัญชีครูประจำสายชั้นสำเร็จ');
      setForm({});                       // clear password from memory
      setModal(null);
      fetchAccounts();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'สร้างบัญชีไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const openReset = (acc) => {
    setSelected(acc);
    setForm({ password: '', confirm: '' });
    setModal('reset');
  };

  const handleReset = async () => {
    if (!form.password || form.password.length < 6) { toast.error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return; }
    if (form.password !== form.confirm)              { toast.error('รหัสผ่านยืนยันไม่ตรงกัน'); return; }
    setSaving(true);
    try {
      await api.post(`/school/teacher-accounts/${selected.id}/reset-password`, { password: form.password });
      toast.success('รีเซ็ตรหัสผ่านสำเร็จ');
      setForm({});
      setModal(null);
      setSelected(null);
      fetchAccounts();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'รีเซ็ตรหัสผ่านไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const openDelete = (acc) => { setSelected(acc); setModal('delete'); };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await api.delete(`/school/teacher-accounts/${selected.id}`);
      toast.success('ลบบัญชีครูสำเร็จ');
      setModal(null);
      setSelected(null);
      fetchAccounts();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'ลบบัญชีไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  /* ── render ────────────────────────────────────────────────────────── */

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <header className="flex flex-col sm:flex-row sm:flex-wrap sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold text-ink leading-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-brand shrink-0" strokeWidth={2} />
            บัญชีครูประจำสายชั้น
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            สร้างและจัดการบัญชีครูที่ใช้ตรวจสอบข้อมูลเฉพาะระดับชั้นของโรงเรียน
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 bg-brand hover:bg-brand-700 text-white text-sm font-medium px-3 py-2.5 sm:py-2 rounded-lg transition min-h-[40px]"
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          เพิ่มบัญชีครู
        </button>
      </header>

      {error && <ErrorState message={error} />}

      {/* Phase 10.10G-C — sticky selected-action bar (only when ≥1 row selected) */}
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
              onClick={() => setModal('bulkDelete')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-danger hover:bg-danger/90 text-white"
            >
              <Trash2 className="w-3.5 h-3.5" strokeWidth={2.5} />
              ลบบัญชีที่เลือก
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : accounts.length === 0 ? (
        <AlertBanner variant="info" title="ยังไม่มีบัญชีครูประจำสายชั้น">
          กดปุ่ม "+ เพิ่มบัญชีครู" ด้านบนเพื่อสร้างบัญชีแรก
        </AlertBanner>
      ) : (
        <AppCard padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-ink-muted text-xs font-semibold uppercase tracking-wide">
                <tr className="text-left">
                  <th className="px-3 py-3 w-10">
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      aria-label={isAllVisibleSelected ? 'ยกเลิกการเลือกทั้งหมด' : 'เลือกทั้งหมดในหน้านี้'}
                      checked={isAllVisibleSelected}
                      disabled={deletableVisibleIds.length === 0}
                      onChange={toggleSelectAllVisible}
                      className="w-4 h-4 rounded border-surface-border text-brand focus:ring-brand cursor-pointer disabled:cursor-not-allowed"
                    />
                  </th>
                  <th className="px-4 py-3">ชื่อผู้ใช้</th>
                  <th className="px-4 py-3">ชื่อแสดง</th>
                  <th className="px-4 py-3">ระดับชั้น</th>
                  <th className="px-4 py-3 text-center">สถานะ</th>
                  <th className="px-4 py-3">เข้าใช้ล่าสุด</th>
                  <th className="px-4 py-3">วันที่สร้าง</th>
                  <th className="px-4 py-3 text-center">การจัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {accounts.map(a => {
                  const deletable = isDeletable(a);
                  const checked = selectedIds.has(a.id);
                  return (
                    <tr
                      key={a.id}
                      className={`transition ${checked ? 'bg-brand/5' : 'hover:bg-surface'}`}
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label={`เลือกบัญชี ${a.username}`}
                          checked={checked}
                          disabled={!deletable}
                          title={deletable ? undefined : 'ไม่สามารถลบบัญชีตัวเองได้'}
                          onChange={() => toggleSelect(a.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 rounded border-surface-border text-brand focus:ring-brand cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-ink">{a.username}</td>
                      <td className="px-4 py-3 text-ink-muted">{a.display_name || '-'}</td>
                      <td className="px-4 py-3 text-ink">{a.grade_scope}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <StatusBadge variant={a.is_active ? 'success' : 'neutral'} size="sm">
                            {a.is_active ? 'ใช้งาน' : 'ปิด'}
                          </StatusBadge>
                          {a.must_change_password ? (
                            <StatusBadge variant="warn" size="sm">ต้องเปลี่ยนรหัส</StatusBadge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-muted tabular-nums">{formatDateTime(a.last_login)}</td>
                      <td className="px-4 py-3 text-xs text-ink-muted tabular-nums">{formatDateTime(a.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-center gap-1 flex-wrap">
                          <button onClick={() => openReset(a)}
                            className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-1.5 rounded whitespace-nowrap">
                            <KeyRound className="w-3.5 h-3.5" strokeWidth={2} />
                            รีเซ็ตรหัส
                          </button>
                          <button onClick={() => openDelete(a)}
                            className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-2 py-1.5 rounded whitespace-nowrap">
                            <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                            ลบ
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </AppCard>
      )}

      {modal === 'create' && (
        <Modal title="สร้างบัญชีครูประจำสายชั้น" onClose={() => { setModal(null); setForm({}); }}>
          <div className="space-y-3">
            <TextField label="ชื่อผู้ใช้ *" value={form.username} onChange={v => setForm({...form, username: v})}
              hint="แนะนำรูปแบบ SCH0001-P4" />
            <TextField label="ชื่อแสดง (ไม่บังคับ)" value={form.display_name}
              onChange={v => setForm({...form, display_name: v})} />
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">ระดับชั้น *</label>
              <select value={form.grade_scope || ''}
                onChange={e => setForm({...form, grade_scope: e.target.value})}
                className="w-full border border-surface-border rounded-lg px-3 py-2 text-sm bg-surface">
                <option value="">— เลือกระดับชั้น —</option>
                {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <TextField label="รหัสผ่าน * (อย่างน้อย 6 ตัว)" type="password"
              value={form.password} onChange={v => setForm({...form, password: v})} />
            <TextField label="ยืนยันรหัสผ่าน *" type="password"
              value={form.confirm} onChange={v => setForm({...form, confirm: v})} />
            <p className="text-[11px] text-ink-muted">
              บัญชีครูประจำสายชั้นเป็นสิทธิ์อ่านอย่างเดียว เห็นข้อมูลเฉพาะระดับชั้นที่เลือก
            </p>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setModal(null); setForm({}); }}
                className="px-4 py-2.5 sm:py-2 text-sm rounded-lg border border-surface-border hover:bg-surface-border min-h-[40px]">
                ยกเลิก
              </button>
              <button type="button" onClick={handleCreate} disabled={saving}
                className="px-4 py-2.5 sm:py-2 text-sm rounded-lg bg-brand hover:bg-brand-700 text-white disabled:opacity-60 min-h-[40px]">
                {saving ? 'กำลังสร้าง…' : 'สร้างบัญชี'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'reset' && selected && (
        <Modal title={`รีเซ็ตรหัสผ่าน: ${selected.username}`}
          onClose={() => { setModal(null); setForm({}); setSelected(null); }}>
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">
              ตั้งรหัสผ่านใหม่ให้บัญชีครูประจำสายชั้น <strong>{selected.username}</strong>
            </p>
            <TextField label="รหัสผ่านใหม่ *" type="password"
              value={form.password} onChange={v => setForm({...form, password: v})} />
            <TextField label="ยืนยันรหัสผ่าน *" type="password"
              value={form.confirm} onChange={v => setForm({...form, confirm: v})} />
            <p className="text-[11px] text-ink-muted">
              ระบบจะบังคับให้ครูเปลี่ยนรหัสผ่านเมื่อเข้าใช้ครั้งต่อไป
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setModal(null); setForm({}); setSelected(null); }}
                className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-surface-border">
                ยกเลิก
              </button>
              <button type="button" onClick={handleReset} disabled={saving}
                className="px-4 py-2.5 sm:py-2 text-sm rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-60 min-h-[40px]">
                {saving ? 'กำลังบันทึก…' : 'รีเซ็ตรหัสผ่าน'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'delete' && selected && (
        <Modal title="ยืนยันการลบบัญชี"
          onClose={() => { setModal(null); setSelected(null); }}>
          <p className="text-sm mb-3">
            ต้องการลบบัญชี <strong>{selected.username}</strong> (ระดับชั้น {selected.grade_scope}) ใช่หรือไม่?
          </p>
          <p className="text-xs text-ink-muted mb-3">
            การลบเป็นแบบ soft-delete — บัญชีจะใช้งานไม่ได้ทันที แต่ประวัติการดำเนินการยังถูกเก็บไว้
          </p>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <button type="button" onClick={() => { setModal(null); setSelected(null); }}
              className="px-4 py-2.5 sm:py-2 text-sm rounded-lg border border-surface-border hover:bg-surface-border min-h-[40px]">
              ยกเลิก
            </button>
            <button type="button" onClick={handleDelete} disabled={saving}
              className="px-4 py-2.5 sm:py-2 text-sm rounded-lg bg-danger hover:bg-danger/90 text-white disabled:opacity-60 min-h-[40px]">
              {saving ? 'กำลังลบ…' : 'ลบบัญชี'}
            </button>
          </div>
        </Modal>
      )}

      {modal === 'bulkDelete' && (
        <BulkDeleteConfirmModal
          items={selectedRows}
          totalSelected={selectedIds.size}
          onClose={() => setModal(null)}
          onDone={({ successIds }) => {
            setModal(null);
            if (successIds.length > 0) {
              setSelectedIds(prev => {
                const next = new Set(prev);
                successIds.forEach(id => next.delete(id));
                return next;
              });
              fetchAccounts();
            }
          }}
          toast={toast}
        />
      )}
    </div>
  );
}

/* ── Bulk delete confirm modal (Phase 10.10G-C) ─────────────────────────────
 * Sequentially deletes selected teacher accounts via the existing per-id
 * endpoint (DELETE /api/school/teacher-accounts/:id). Per-item failure does
 * not abort the batch — caller gets back successfully-deleted ids so it can
 * prune the selection set and refresh. Permission and soft-delete semantics
 * stay entirely in the backend (requireFullSchoolScope + school-scope guard).
 */
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
    for (let i = 0; i < items.length; i++) {
      const row = items[i];
      try {
        await api.delete(`/school/teacher-accounts/${row.id}`);
        successIds.push(row.id);
      } catch (err) {
        failures.push({
          id: row.id,
          username: row.username,
          message: err?.response?.data?.message || 'ลบไม่สำเร็จ',
        });
      }
      setProgress({ done: i + 1, total: items.length });
    }
    if (failures.length === 0) {
      toast.success(`ลบสำเร็จ ${successIds.length} รายการ`);
    } else if (successIds.length === 0) {
      toast.error('ไม่สามารถลบบัญชีที่เลือกได้');
    } else {
      toast.error(`ลบสำเร็จ ${successIds.length} รายการ ไม่สำเร็จ ${failures.length} รายการ`);
    }
    onDone({ successIds, failures });
  };

  return (
    <Modal
      title="ยืนยันการลบบัญชีหลายรายการ"
      onClose={busy ? () => {} : onClose}
    >
      <p className="text-sm mb-2">
        คุณกำลังจะลบบัญชีครู <strong className="tabular-nums">{totalSelected}</strong> รายการ
      </p>
      {previewItems.length > 0 && (
        <ul className="text-xs text-ink-muted list-disc pl-5 mb-3 space-y-0.5 max-h-32 overflow-y-auto">
          {previewItems.map(r => (
            <li key={r.id} className="truncate">
              <span className="font-medium text-ink">{r.username}</span>
              {r.grade_scope ? ` · ${r.grade_scope}` : ''}
            </li>
          ))}
          {overflowCount > 0 && (
            <li className="list-none italic">และอีก {overflowCount} รายการ</li>
          )}
        </ul>
      )}
      <p className="text-xs text-ink-muted mb-3">
        การดำเนินการนี้จะใช้สิทธิ์และเงื่อนไขเดียวกับการลบทีละรายการ
      </p>
      {busy && (
        <p className="text-xs text-ink-muted mb-2 tabular-nums">
          กำลังลบ… {progress.done} / {progress.total}
        </p>
      )}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="px-4 py-2.5 sm:py-2 text-sm rounded-lg border border-surface-border hover:bg-surface-border disabled:opacity-60 min-h-[40px]"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy || totalSelected === 0}
          className="px-4 py-2.5 sm:py-2 text-sm rounded-lg bg-danger hover:bg-danger/90 text-white disabled:opacity-60 min-h-[40px]"
        >
          {busy ? 'กำลังลบ…' : `ยืนยันลบ ${totalSelected} รายการ`}
        </button>
      </div>
    </Modal>
  );
}

/* ── small UI primitives (local) ─────────────────────────────────────── */

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[9999] isolate flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative z-[10000] bg-surface w-full max-w-md rounded-2xl shadow-elevate max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <header className="flex items-center justify-between p-4 border-b border-surface-border sticky top-0 bg-surface">
          <h2 className="font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-surface-border text-ink-muted">×</button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function TextField({ label, value, onChange, type = 'text', hint }) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink-muted mb-1">{label}</label>
      <input
        type={type}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-surface-border rounded-lg px-3 py-2 text-sm bg-surface text-ink"
      />
      {hint && <p className="text-[11px] text-ink-muted mt-1">{hint}</p>}
    </div>
  );
}
