import { useState, useEffect, useCallback, useMemo } from 'react';
import { Users, Plus } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import PageHeader from '../../components/PageHeader';
import {
  DataTable, TableAction, FilterBar, ConfirmDialog, FormField,
  Modal as UiModal, StatusBadge as Badge,
} from '../../components/ui';
import { PASSWORD_MIN_LENGTH, PASSWORD_HELPER, PASSWORD_TOO_SHORT } from '../../utils/passwordPolicy';

/**
 * จัดการผู้ใช้งาน (affiliation) — main accounts of the schools in this
 * affiliation (owner decision 2026-11-12). Grade-teacher accounts are managed
 * by each school ("บัญชีครูประจำสายชั้น") and are not listed here.
 * Backend: /api/affiliation/users (scope enforced server-side).
 */

const SELECT_CLASS = 'focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink transition';
const PRIMARY_BTN = 'focus-ring w-full bg-brand-600 hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50 text-white font-medium min-h-[48px] rounded-lg transition';

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
}

export default function AffUserManagement() {
  const toast = useToast();
  const [view, setView] = useState('active'); // 'active' | 'deleted'
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [schools, setSchools] = useState([]);

  const [modal, setModal] = useState(null); // 'create' | 'edit' | 'reset' | null
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // { kind: 'delete'|'restore'|'toggle', user }

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/affiliation/users?status=${view}`);
      setRows(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดบัญชีผู้ใช้ไม่สำเร็จ');
    } finally { setLoading(false); }
  }, [view]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  useEffect(() => {
    api.get('/affiliation/schools')
      .then((r) => setSchools(Array.isArray(r.data?.data) ? r.data.data : []))
      .catch(() => {});
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((u) => [u.username, u.display_name, u.school_name, u.school_id]
      .some((v) => String(v || '').toLowerCase().includes(q)));
  }, [rows, search]);

  function fail(err, fallback) {
    toast.error(err.response?.data?.message || fallback);
  }

  // ── create ──
  function openCreate() {
    setForm({ school_id: '', username: '', display_name: '' });
    setModal('create');
  }
  async function handleCreate() {
    if (!form.school_id || !form.username) { toast.error('กรุณาเลือกโรงเรียนและกรอกชื่อผู้ใช้'); return; }
    setSaving(true);
    try {
      const res = await api.post('/affiliation/users', form);
      toast.success(res.data?.message || 'สร้างบัญชีสำเร็จ');
      setModal(null);
      if (view === 'active') fetchRows(); else setView('active');
    } catch (err) { fail(err, 'สร้างบัญชีไม่สำเร็จ'); } finally { setSaving(false); }
  }

  // ── rename ──
  function openEdit(user) {
    setSelected(user);
    setForm({ display_name: user.display_name || '' });
    setModal('edit');
  }
  async function handleEdit() {
    if (!String(form.display_name || '').trim()) { toast.error('กรุณากรอกชื่อที่แสดง'); return; }
    setSaving(true);
    try {
      await api.put(`/affiliation/users/${selected.id}`, { display_name: form.display_name });
      toast.success('บันทึกแล้ว');
      setModal(null);
      fetchRows();
    } catch (err) { fail(err, 'บันทึกไม่สำเร็จ'); } finally { setSaving(false); }
  }

  // ── reset password ──
  function openReset(user) {
    setSelected(user);
    setForm({ password: '' });
    setModal('reset');
  }
  async function handleReset() {
    if (!form.password || form.password.length < PASSWORD_MIN_LENGTH) { toast.error(PASSWORD_TOO_SHORT); return; }
    setSaving(true);
    try {
      const res = await api.post(`/affiliation/users/${selected.id}/reset-password`, { password: form.password });
      toast.success(res.data?.message || 'รีเซ็ตรหัสผ่านสำเร็จ');
      setModal(null);
      fetchRows();
    } catch (err) { fail(err, 'รีเซ็ตรหัสผ่านไม่สำเร็จ'); } finally { setSaving(false); }
  }

  // ── toggle / delete / restore (confirmed) ──
  async function handleConfirm() {
    if (!confirm) return;
    const { kind, user } = confirm;
    setSaving(true);
    try {
      let res;
      if (kind === 'toggle') res = await api.put(`/affiliation/users/${user.id}`, { is_active: !user.is_active });
      if (kind === 'delete') res = await api.delete(`/affiliation/users/${user.id}`);
      if (kind === 'restore') res = await api.post(`/affiliation/users/${user.id}/restore`);
      toast.success(res?.data?.message || 'บันทึกแล้ว');
      setConfirm(null);
      fetchRows();
    } catch (err) { fail(err, 'ทำรายการไม่สำเร็จ'); } finally { setSaving(false); }
  }

  const confirmText = confirm && {
    toggle: confirm.user.is_active
      ? { title: 'ปิดบัญชีนี้?', description: 'โรงเรียนจะเข้าใช้งานด้วยบัญชีนี้ไม่ได้ จนกว่าจะเปิดบัญชีอีกครั้ง ข้อมูลของโรงเรียนไม่ถูกลบ', label: 'ปิดบัญชี', tone: 'danger' }
      : { title: 'เปิดบัญชีนี้?', description: 'โรงเรียนจะเข้าใช้งานด้วยบัญชีนี้ได้อีกครั้ง', label: 'เปิดบัญชี', tone: 'brand' },
    delete: { title: 'ลบบัญชีนี้?', description: 'บัญชีจะเข้าใช้งานไม่ได้และหายจากรายการ ข้อมูลนักเรียนและรถของโรงเรียนไม่ถูกลบ กู้คืนได้ที่ "บัญชีที่ลบแล้ว" การกระทำนี้ถูกบันทึกในประวัติการแก้ไข', label: 'ลบบัญชี', tone: 'danger' },
    restore: { title: 'กู้คืนบัญชีนี้?', description: 'บัญชีจะกลับมาในสถานะ "ปิด" กด "เปิดบัญชี" เมื่อพร้อมให้โรงเรียนใช้งาน', label: 'กู้คืน', tone: 'brand' },
  }[confirm.kind];

  const isDeletedView = view === 'deleted';

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="จัดการผู้ใช้งาน"
        subtitle="บัญชีหลักของโรงเรียนในสังกัด: สร้าง แก้ชื่อ รีเซ็ตรหัสผ่าน ปิด/เปิด ลบ และกู้คืน"
        actions={
          <button
            onClick={openCreate}
            className="focus-ring inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-medium px-4 min-h-[44px] rounded-lg transition text-sm"
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
            สร้างบัญชีโรงเรียน
          </button>
        }
      />

      <p className="text-sm text-ink-muted mb-4">
        บัญชีครูประจำสายชั้นไม่อยู่ในหน้านี้ โรงเรียนจัดการเองที่เมนู <strong>บัญชีครูประจำสายชั้น</strong> ·
        เพิ่มโรงเรียนใหม่ที่ยังไม่มีในระบบ ใช้เมนู <strong>เพิ่มโรงเรียนใหม่</strong>
      </p>

      <FilterBar
        className="mb-5"
        search={{ value: search, onChange: setSearch, placeholder: 'ค้นหาชื่อผู้ใช้ ชื่อ หรือโรงเรียน…', label: 'ค้นหาบัญชี' }}
        chips={{
          label: 'แสดงบัญชี',
          value: view,
          onChange: setView,
          options: [['active', 'บัญชีที่ใช้อยู่'], ['deleted', 'บัญชีที่ลบแล้ว']],
        }}
        count={loading || error ? undefined : shown.length}
        countLabel="บัญชี"
        onClear={() => setSearch('')}
      />

      <DataTable
        caption="บัญชีหลักของโรงเรียนในสังกัด"
        loading={loading}
        error={error}
        onRetry={fetchRows}
        rows={shown}
        rowKey={(u) => u.id}
        columns={[
          { key: 'username', header: 'ชื่อผู้ใช้', primary: true,
            cell: (u) => <span className="font-medium text-ink">{u.username}</span> },
          { key: 'school', header: 'โรงเรียน', secondary: true,
            cell: (u) => <span>{u.school_name || u.school_id}</span> },
          { key: 'display_name', header: 'ชื่อที่แสดง', cell: (u) => u.display_name || '-' },
          { key: 'last_login', header: isDeletedView ? 'ลบเมื่อ' : 'เข้าใช้ล่าสุด',
            cell: (u) => <span className="text-ink-muted">{formatDate(isDeletedView ? u.deleted_at : u.last_login)}</span> },
          { key: 'status', header: 'สถานะ', align: 'center', badge: true,
            cell: (u) => (isDeletedView
              ? <Badge variant="neutral">ลบแล้ว</Badge>
              : <AccountStatus active={u.is_active} mustChange={u.must_change_password} />) },
        ]}
        actions={(u) => (isDeletedView ? (
          <TableAction tone="brand" onClick={() => setConfirm({ kind: 'restore', user: u })}>กู้คืน</TableAction>
        ) : (
          <>
            <TableAction tone="brand" onClick={() => openEdit(u)}>แก้ชื่อ</TableAction>
            <TableAction tone="neutral" onClick={() => openReset(u)}>รีเซ็ตรหัส</TableAction>
            <TableAction tone={u.is_active ? 'warn' : 'neutral'} onClick={() => setConfirm({ kind: 'toggle', user: u })}>
              {u.is_active ? 'ปิดบัญชี' : 'เปิดบัญชี'}
            </TableAction>
            <TableAction tone="danger" onClick={() => setConfirm({ kind: 'delete', user: u })}>ลบ</TableAction>
          </>
        ))}
        empty={{
          icon: Users,
          title: search ? 'ไม่พบบัญชีตามคำค้น' : (isDeletedView ? 'ไม่มีบัญชีที่ลบแล้ว' : 'ยังไม่มีบัญชีโรงเรียนในสังกัด'),
          description: search ? 'ลองเปลี่ยนคำค้น' : undefined,
        }}
      />

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirmText?.title || ''}
        itemName={confirm ? `${confirm.user.username} — ${confirm.user.school_name || confirm.user.school_id}` : ''}
        description={confirmText?.description}
        confirmLabel={confirmText?.label}
        tone={confirmText?.tone}
        loading={saving}
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />

      {modal === 'create' && (
        <Modal title="สร้างบัญชีโรงเรียน" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <FormField label="โรงเรียน" required>
              {(ctl) => (
                <select {...ctl} value={form.school_id} onChange={(e) => setForm({ ...form, school_id: e.target.value })} className={SELECT_CLASS}>
                  <option value="">— เลือกโรงเรียน —</option>
                  {schools.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
                </select>
              )}
            </FormField>
            <FormField label="ชื่อผู้ใช้ (รหัส OBEC 6 หลัก)" required value={form.username}
              onChange={(v) => setForm({ ...form, username: v })} inputMode="numeric" />
            <FormField label="ชื่อที่แสดง" helper="ไม่กรอกจะใช้ชื่อโรงเรียน" value={form.display_name}
              onChange={(v) => setForm({ ...form, display_name: v })} />
            <p className="text-sm text-ink-muted">รหัสผ่านเริ่มต้นคือรหัสโรงเรียน โรงเรียนต้องเปลี่ยนรหัสเมื่อเข้าครั้งแรก</p>
            <button onClick={handleCreate} disabled={saving} className={PRIMARY_BTN}>
              {saving ? 'กำลังสร้าง…' : 'สร้างบัญชี'}
            </button>
          </div>
        </Modal>
      )}

      {modal === 'edit' && selected && (
        <Modal title={`แก้ชื่อ: ${selected.username}`} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <FormField label="ชื่อที่แสดง" required value={form.display_name}
              onChange={(v) => setForm({ ...form, display_name: v })} />
            <button onClick={handleEdit} disabled={saving} className={PRIMARY_BTN}>
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        </Modal>
      )}

      {modal === 'reset' && selected && (
        <Modal title={`รีเซ็ตรหัสผ่าน: ${selected.username}`} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-4 py-2 border border-amber-200">
              โรงเรียนต้องเปลี่ยนรหัสผ่านเมื่อเข้าระบบครั้งถัดไป และทุกเครื่องที่เปิดบัญชีนี้ค้างไว้จะถูกออกจากระบบ
            </p>
            <FormField label="รหัสผ่านใหม่" helper={PASSWORD_HELPER} type="password" value={form.password}
              onChange={(v) => setForm({ ...form, password: v })} />
            <button onClick={handleReset} disabled={saving} className={PRIMARY_BTN}>
              {saving ? 'กำลังรีเซ็ต…' : 'รีเซ็ตรหัสผ่าน'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <UiModal title={title} onClose={onClose}>
      {children}
      <button
        onClick={onClose}
        className="focus-ring w-full text-ink-muted hover:text-ink hover:bg-surface text-sm min-h-[44px] rounded-lg mt-2 transition"
      >
        ยกเลิก
      </button>
    </UiModal>
  );
}

function AccountStatus({ active, mustChange }) {
  if (!active) return <Badge variant="danger">ปิด</Badge>;
  if (mustChange) return <Badge variant="warn">รอเปลี่ยนรหัส</Badge>;
  return <Badge variant="success">ใช้งาน</Badge>;
}
