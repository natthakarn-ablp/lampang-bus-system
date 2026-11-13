import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, ShieldAlert, Users, ArchiveRestore } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import { AppCard, AlertBanner, StatusBadge, DataTable, TableAction, FormField, Modal as UiModal, ConfirmDialog} from '../../components/ui';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { isGradeTeacher } from '../../utils/authScope';
import { PASSWORD_MIN_LENGTH, PASSWORD_HELPER, PASSWORD_TOO_SHORT } from '../../utils/passwordPolicy';

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
          <ShieldAlert className="w-6 h-6 text-warn-ink shrink-0" strokeWidth={2} />
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
  const [modal, setModal]       = useState(null); // null | 'create' | 'edit' | 'reset' | 'delete' | 'bulkDelete' | 'deleted'
  const [deletedRows, setDeletedRows] = useState(null); // null = not loaded
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
    if (!form.password || form.password.length < PASSWORD_MIN_LENGTH) { toast.error(PASSWORD_TOO_SHORT); return; }
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
    if (!form.password || form.password.length < PASSWORD_MIN_LENGTH) { toast.error(PASSWORD_TOO_SHORT); return; }
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

  // ── Edit (grade / name / enable-disable) — new school year without recreating ──
  const openEdit = (acc) => {
    setSelected(acc);
    setForm({ display_name: acc.display_name || '', grade_scope: acc.grade_scope, is_active: !!acc.is_active });
    setModal('edit');
  };

  const handleEdit = async () => {
    if (!form.display_name?.trim()) { toast.error('กรุณากรอกชื่อแสดง'); return; }
    setSaving(true);
    try {
      await api.patch(`/school/teacher-accounts/${selected.id}`, {
        display_name: form.display_name.trim(),
        grade_scope: form.grade_scope,
        is_active: !!form.is_active,
      });
      toast.success(form.grade_scope !== selected.grade_scope
        ? `ย้ายครูไประดับชั้น ${form.grade_scope} แล้ว — ครูต้องเข้าสู่ระบบใหม่`
        : 'บันทึกบัญชีครูแล้ว');
      setForm({});
      setModal(null);
      setSelected(null);
      fetchAccounts();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (acc) => {
    try {
      await api.patch(`/school/teacher-accounts/${acc.id}`, { is_active: !acc.is_active });
      toast.success(acc.is_active ? `ปิดใช้งาน ${acc.username} แล้ว` : `เปิดใช้งาน ${acc.username} แล้ว`);
      fetchAccounts();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'เปลี่ยนสถานะไม่สำเร็จ');
    }
  };

  // ── Deleted accounts → restore ──
  const openDeleted = async () => {
    setModal('deleted');
    setDeletedRows(null);
    try {
      const res = await api.get('/school/teacher-accounts/deleted');
      setDeletedRows(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (err) {
      setDeletedRows([]);
      toast.error(err?.response?.data?.message || 'โหลดบัญชีที่ลบแล้วไม่สำเร็จ');
    }
  };

  const handleRestore = async (row) => {
    setSaving(true);
    try {
      const res = await api.post(`/school/teacher-accounts/${row.id}/restore`, {});
      toast.success(res.data?.message || 'กู้คืนบัญชีครูสำเร็จ');
      setDeletedRows(prev => (prev || []).filter(r => r.id !== row.id));
      fetchAccounts();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'กู้คืนไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

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
      <PageHeader
        title="บัญชีครูประจำสายชั้น"
        subtitle="สร้างและจัดการบัญชีครูที่ใช้ตรวจสอบข้อมูลเฉพาะระดับชั้นของโรงเรียน"
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button
          type="button"
          onClick={openDeleted}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 border border-surface-border bg-surface-raised hover:bg-surface text-ink text-sm font-medium px-4 rounded-lg transition min-h-[44px] focus-ring"
        >
          <ArchiveRestore className="w-4 h-4" strokeWidth={2.2} />
          บัญชีที่ลบแล้ว
        </button>
          <button
          type="button"
          onClick={openCreate}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 bg-brand hover:bg-brand-700 text-white text-sm font-medium px-4 rounded-lg transition min-h-[44px] focus-ring"
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          เพิ่มบัญชีครู
        </button>
          </div>
        }
      />

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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-danger-ink hover:bg-danger-ink/90 text-white"
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
        <DataTable
          caption="รายการบัญชีครูประจำสายชั้น"
          rows={accounts}
          rowKey={a => a.id}
          rowClassName={a => (selectedIds.has(a.id) ? 'bg-brand-50' : '')}
          selection={{
            selected: selectedIds,
            headerRef: headerCheckboxRef,
            allSelected: isAllVisibleSelected,
            selectAllDisabled: deletableVisibleIds.length === 0,
            selectAllLabel: isAllVisibleSelected ? 'ยกเลิกการเลือกทั้งหมด' : 'เลือกทั้งหมดในหน้านี้',
            onToggleAll: toggleSelectAllVisible,
            onToggle: a => toggleSelect(a.id),
            isSelectable: a => isDeletable(a),
            rowLabel: a => `เลือกบัญชี ${a.username}`,
            disabledHint: 'ไม่สามารถลบบัญชีตัวเองได้',
          }}
          columns={[
            { key: 'username', header: 'ชื่อผู้ใช้', primary: true,
              cell: a => <span className="font-medium text-ink">{a.username}</span> },
            { key: 'display', header: 'ชื่อแสดง', secondary: true, cell: a => a.display_name || '-' },
            { key: 'grade', header: 'ระดับชั้น', cell: a => a.grade_scope },
            { key: 'status', header: 'สถานะ', align: 'center', badge: true,
              cell: a => (
                <div className="flex flex-col items-center gap-0.5">
                  <StatusBadge variant={a.is_active ? 'success' : 'neutral'}>
                    {a.is_active ? 'ใช้งาน' : 'ปิด'}
                  </StatusBadge>
                  {a.must_change_password ? <StatusBadge variant="warn">ต้องเปลี่ยนรหัส</StatusBadge> : null}
                </div>
              ) },
            { key: 'last_login', header: 'เข้าใช้ล่าสุด', cell: a => <span className="text-ink-muted tabular-nums">{formatDateTime(a.last_login)}</span> },
            { key: 'created', header: 'วันที่สร้าง', cell: a => <span className="text-ink-muted tabular-nums">{formatDateTime(a.created_at)}</span> },
          ]}
          actions={a => (
            <>
              <TableAction tone="neutral" onClick={() => openEdit(a)}>แก้ไข / ย้ายชั้น</TableAction>
              <TableAction tone="neutral" onClick={() => toggleActive(a)}>{a.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</TableAction>
              <TableAction tone="neutral" onClick={() => openReset(a)}>รีเซ็ตรหัส</TableAction>
              <TableAction tone="danger" disabled={!isDeletable(a)} onClick={() => openDelete(a)}>ลบ</TableAction>
            </>
          )}
          empty={{ icon: Users, title: 'ยังไม่มีบัญชีครูประจำสายชั้น' }}
        />
      )}

      {modal === 'create' && (
        <Modal title="สร้างบัญชีครูประจำสายชั้น" onClose={() => { setModal(null); setForm({}); }}>
          <div className="space-y-3">
            <TextField label="ชื่อผู้ใช้ *" value={form.username} onChange={v => setForm({...form, username: v})}
              hint="แนะนำรูปแบบ SCH0001-P4" />
            <TextField label="ชื่อแสดง (ไม่บังคับ)" value={form.display_name}
              onChange={v => setForm({...form, display_name: v})} />
            <div>
              <label className="sr-only">ระดับชั้น</label>
              <select aria-label="ระดับชั้น (จำเป็น)" value={form.grade_scope || ''}
                onChange={e => setForm({...form, grade_scope: e.target.value})}
                className="w-full border border-surface-border rounded-lg px-3 py-2 text-base bg-surface min-h-[44px]">
                <option value="">— เลือกระดับชั้น —</option>
                {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <TextField label={`รหัสผ่าน * (${PASSWORD_HELPER})`} type="password"
              value={form.password} onChange={v => setForm({...form, password: v})} />
            <TextField label="ยืนยันรหัสผ่าน *" type="password"
              value={form.confirm} onChange={v => setForm({...form, confirm: v})} />
            <p className="text-[11px] text-ink-muted">
              บัญชีครูประจำสายชั้นทำงานได้เฉพาะระดับชั้นที่เลือก: เช็กชื่อวันนี้และย้อนหลัง และจัดการนักเรียนในชั้นตัวเอง
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

      {modal === 'edit' && selected && (
        <Modal title={`แก้ไขบัญชีครู: ${selected.username}`}
          onClose={() => { setModal(null); setForm({}); setSelected(null); }}>
          <div className="space-y-3">
            <TextField label="ชื่อแสดง *" value={form.display_name}
              onChange={v => setForm({...form, display_name: v})} />
            <FormField label="ระดับชั้น" helper="ขึ้นปีการศึกษาใหม่: เปลี่ยนระดับชั้นได้เลยไม่ต้องลบแล้วสร้างใหม่ (ครูต้องเข้าสู่ระบบใหม่)">
              {ctl => (
                <select {...ctl} value={form.grade_scope || ''}
                  onChange={e => setForm({...form, grade_scope: e.target.value})}
                  className="focus-ring w-full border border-surface-border rounded-lg px-3 min-h-[44px] text-base bg-surface text-ink">
                  {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              )}
            </FormField>
            <FormField label="สถานะ">
              {ctl => (
                <select {...ctl} value={form.is_active ? '1' : '0'}
                  onChange={e => setForm({...form, is_active: e.target.value === '1'})}
                  className="focus-ring w-full border border-surface-border rounded-lg px-3 min-h-[44px] text-base bg-surface text-ink">
                  <option value="1">ใช้งาน</option>
                  <option value="0">ปิดใช้งาน (เข้าสู่ระบบไม่ได้)</option>
                </select>
              )}
            </FormField>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setModal(null); setForm({}); setSelected(null); }}
                className="px-4 py-2.5 sm:py-2 text-sm rounded-lg border border-surface-border hover:bg-surface-border min-h-[44px]">
                ยกเลิก
              </button>
              <button type="button" onClick={handleEdit} disabled={saving}
                className="px-4 py-2.5 sm:py-2 text-sm rounded-lg bg-brand hover:bg-brand-700 text-white disabled:opacity-60 min-h-[44px]">
                {saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'deleted' && (
        <Modal title="บัญชีครูที่ลบแล้ว" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">
              กู้คืนแล้วบัญชีจะอยู่ในสถานะปิดใช้งาน — กด "เปิดใช้งาน" ในตารางเมื่อพร้อม
            </p>
            {deletedRows === null ? (
              <LoadingState />
            ) : deletedRows.length === 0 ? (
              <p className="text-sm text-ink-muted">ไม่มีบัญชีครูที่ถูกลบ</p>
            ) : (
              <ul className="divide-y divide-surface-border rounded-lg border border-surface-border">
                {deletedRows.map(r => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{r.username}</p>
                      <p className="text-xs text-ink-muted">{r.grade_scope} · ลบเมื่อ {formatDateTime(r.deleted_at)}</p>
                    </div>
                    <button type="button" onClick={() => handleRestore(r)} disabled={saving}
                      className="shrink-0 rounded-lg border border-surface-border px-3 text-sm font-medium text-ink hover:bg-surface disabled:opacity-60 min-h-[44px]">
                      กู้คืน
                    </button>
                  </li>
                ))}
              </ul>
            )}
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

      <ConfirmDialog
        open={modal === 'delete' && Boolean(selected)}
        title="ลบบัญชีครูประจำสายชั้น?"
        itemName={selected ? `${selected.username} · ระดับชั้น ${selected.grade_scope}` : ''}
        description="เป็นการลบแบบ soft-delete — บัญชีจะใช้งานไม่ได้ทันที แต่ประวัติการดำเนินการยังถูกเก็บไว้"
        confirmLabel="ลบบัญชี"
        loading={saving}
        onConfirm={handleDelete}
        onCancel={() => { setModal(null); setSelected(null); }}
      />

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
          className="px-4 py-2.5 sm:py-2 text-sm rounded-lg bg-danger-ink hover:bg-danger-ink/90 text-white disabled:opacity-60 min-h-[40px]"
        >
          {busy ? 'กำลังลบ…' : `ยืนยันลบ ${totalSelected} รายการ`}
        </button>
      </div>
    </Modal>
  );
}

/* ── small UI primitives (local) ─────────────────────────────────────── */

// Delegates to the shared Modal so this page gets dialog semantics, Escape, a
// focus trap and scroll lock. The local name stays so the call sites are
// unchanged.
function Modal({ title, onClose, children }) {
  return <UiModal title={title} onClose={onClose}>{children}</UiModal>;
}

function TextField({ label, value, onChange, type = 'text', hint }) {
  return <FormField label={label} value={value} onChange={onChange} type={type} helper={hint} />;
}
