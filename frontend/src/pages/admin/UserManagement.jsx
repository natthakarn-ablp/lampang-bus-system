import { useState, useEffect, useCallback } from 'react';
import { Users, Plus } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import PageHeader from '../../components/PageHeader';
import Pagination from '../../components/Pagination';
import {
  DataTable, TableAction, FilterBar, ConfirmDialog, FormField,
  Modal as UiModal, StatusBadge as Badge,
} from '../../components/ui';

const ROLE_LABELS = {
  driver: 'คนขับ', school: 'โรงเรียน', affiliation: 'สังกัด',
  province: 'จังหวัด', transport: 'ขนส่ง', admin: 'ผู้ดูแลระบบ',
};
const ROLE_OPTIONS = Object.entries(ROLE_LABELS);
const SCOPED_ROLES = ['school', 'affiliation', 'province'];

export default function UserManagement() {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState({ page: 1, per_page: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Modal state
  const [modal, setModal] = useState(null); // 'create' | 'edit' | 'reset' | null
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  // Scope options
  const [schools, setSchools] = useState([]);
  const [affiliations, setAffiliations] = useState([]);

  useEffect(() => {
    api.get('/province/schools?per_page=200').then(r => setSchools(Array.isArray(r.data?.data) ? r.data.data : [])).catch(() => {});
    api.get('/province/affiliations').then(r => setAffiliations(Array.isArray(r.data?.data) ? r.data.data : [])).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const fetchUsers = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('per_page', '50');
      if (filterRole) params.set('role', filterRole);
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res = await api.get(`/admin/users?${params}`);
      setUsers(Array.isArray(res.data.data) ? res.data.data : []);
      setMeta(res.data.meta);
    } catch {} finally { setLoading(false); }
  }, [filterRole, debouncedSearch]);

  useEffect(() => { fetchUsers(1); }, [fetchUsers]);

  // ── Create user ──
  function openCreate() {
    setForm({ username: '', password: '', role: 'school', scope_id: '', display_name: '', grade_scope: '' });
    setModal('create');
  }

  async function handleCreate() {
    if (!form.username || !form.password || !form.role) { toast.error('กรุณากรอกข้อมูลให้ครบ'); return; }
    if (SCOPED_ROLES.includes(form.role) && !form.scope_id) { toast.error('กรุณาเลือกหน่วยงาน'); return; }
    setSaving(true);
    try {
      // Phase 7.11.5 — only send grade_scope when role=school AND a
      // grade has been selected; otherwise omit so backend treats
      // the row as a normal full school account.
      const payload = { ...form };
      if (payload.role !== 'school' || !payload.grade_scope) {
        delete payload.grade_scope;
      }
      await api.post('/admin/users', payload);
      toast.success('สร้างผู้ใช้สำเร็จ');
      setModal(null);
      fetchUsers(meta.page);
    } catch (err) { toast.error(err.response?.data?.message || 'ไม่สามารถสร้างได้'); }
    finally { setSaving(false); }
  }

  // ── Edit user ──
  function openEdit(user) {
    setSelected(user);
    setForm({ display_name: user.display_name || '', is_active: user.is_active });
    setModal('edit');
  }

  async function handleEdit() {
    setSaving(true);
    try {
      await api.put(`/admin/users/${selected.id}`, form);
      toast.success('อัปเดตสำเร็จ');
      setModal(null);
      fetchUsers(meta.page);
    } catch (err) { toast.error(err.response?.data?.message || 'ไม่สามารถอัปเดตได้'); }
    finally { setSaving(false); }
  }

  // ── Reset password ──
  function openReset(user) {
    setSelected(user);
    setForm({ password: '' });
    setModal('reset');
  }

  async function handleReset() {
    if (!form.password || form.password.length < 6) { toast.error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return; }
    setSaving(true);
    try {
      await api.post(`/admin/users/${selected.id}/reset-password`, { password: form.password });
      toast.success('รีเซ็ตรหัสผ่านสำเร็จ — ผู้ใช้จะต้องเปลี่ยนรหัสผ่านเมื่อ login ครั้งถัดไป');
      setModal(null);
      fetchUsers(meta.page);
    } catch (err) { toast.error(err.response?.data?.message || 'ไม่สามารถรีเซ็ตได้'); }
    finally { setSaving(false); }
  }

  // ── Delete ──
  // window.confirm could not name what was being deleted beyond one line of
  // unstyled text, and put the default action under Enter. ConfirmDialog shows
  // the account, marks the action destructive, and starts focus on Cancel.
  const [confirmDelete, setConfirmDelete] = useState(null);

  async function handleDelete() {
    const user = confirmDelete;
    if (!user) return;
    setSaving(true);
    try {
      await api.delete(`/admin/users/${user.id}`);
      toast.success('ลบผู้ใช้สำเร็จ');
      setConfirmDelete(null);
      fetchUsers(meta.page);
    } catch (err) { toast.error(err.response?.data?.message || 'ไม่สามารถลบได้'); }
    finally { setSaving(false); }
  }

  const totalPages = Math.ceil(meta.total / meta.per_page) || 1;

  const scopeOptions = form.role === 'school' ? schools.map(s => ({ id: s.id, name: s.name }))
    : form.role === 'affiliation' ? affiliations.map(a => ({ id: a.id, name: a.name }))
    : form.role === 'province' ? [{ id: 'LPG', name: 'จังหวัดลำปาง' }] : [];

  const hasFilter = Boolean(debouncedSearch || filterRole);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="จัดการผู้ใช้งาน"
        subtitle="สร้าง แก้ไข รีเซ็ตรหัสผ่าน และระงับบัญชีผู้ใช้ระบบ"
        actions={
          <button
            onClick={openCreate}
            className="focus-ring inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-medium px-4 min-h-[44px] rounded-lg transition text-sm"
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
            สร้างผู้ใช้ใหม่
          </button>
        }
      />

      <FilterBar
        className="mb-5"
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'ค้นหาชื่อผู้ใช้…',
          label: 'ค้นหาชื่อผู้ใช้',
        }}
        filters={[{
          key: 'role',
          label: 'กรองตามบทบาท',
          value: filterRole,
          onChange: setFilterRole,
          options: [['', 'ทุกบทบาท'], ...ROLE_OPTIONS],
        }]}
        count={meta.total}
        countLabel="บัญชี"
        onClear={() => { setSearch(''); setFilterRole(''); }}
      />

      <DataTable
        caption="รายการบัญชีผู้ใช้งานระบบ"
        loading={loading}
        rows={users}
        rowKey={u => u.id}
        columns={[
          { key: 'username', header: 'ชื่อผู้ใช้', primary: true,
            cell: u => <span className="font-medium text-ink">{u.username}</span> },
          { key: 'display_name', header: 'ชื่อแสดง', secondary: true,
            cell: u => u.display_name || '-' },
          { key: 'role', header: 'บทบาท', cell: u => <RoleBadge role={u.role} /> },
          { key: 'scope', header: 'หน่วยงาน',
            cell: u => <span className="text-ink-muted">{u.scope_name || u.scope_id || '-'}</span> },
          { key: 'grade', header: 'ระดับชั้น', cell: u => u.grade_scope || '-' },
          { key: 'status', header: 'สถานะ', align: 'center', badge: true,
            cell: u => <AccountStatus active={u.is_active} mustChange={u.must_change_password} /> },
        ]}
        actions={u => (
          <>
            <TableAction tone="brand"  onClick={() => openEdit(u)}>แก้ไข</TableAction>
            <TableAction tone="neutral" onClick={() => openReset(u)}>รีเซ็ตรหัส</TableAction>
            <TableAction tone="danger" onClick={() => setConfirmDelete(u)}>ลบ</TableAction>
          </>
        )}
        empty={{
          icon: Users,
          title: hasFilter ? 'ไม่พบข้อมูลตามเงื่อนไขที่เลือก' : 'ยังไม่มีข้อมูลในขอบเขตนี้',
          description: hasFilter ? 'ลองเปลี่ยนคำค้นหรือตัวกรองบทบาท' : undefined,
        }}
      />

      {users.length > 0 && (
        <Pagination page={meta.page} totalPages={totalPages} total={meta.total} shown={users.length} onPage={(p) => fetchUsers(p)} />
      )}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="ลบผู้ใช้ออกจากระบบ?"
        itemName={confirmDelete ? `${confirmDelete.username}${confirmDelete.display_name ? ` — ${confirmDelete.display_name}` : ''}` : ''}
        description="บัญชีนี้จะเข้าใช้งานระบบไม่ได้อีก การกระทำนี้ถูกบันทึกใน audit log"
        confirmLabel="ลบผู้ใช้"
        loading={saving}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* ── Create Modal ── */}
      {modal === 'create' && (
        <Modal title="สร้างผู้ใช้ใหม่" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <Field label="ชื่อผู้ใช้" required value={form.username} onChange={v => setForm({...form, username: v})} />
            <Field label="รหัสผ่าน" required helper="อย่างน้อย 6 ตัวอักษร" value={form.password} onChange={v => setForm({...form, password: v})} type="password" />
            <FormField label="บทบาท" required>
              {ctl => (
                <select {...ctl} value={form.role} onChange={e => setForm({...form, role: e.target.value, scope_id: ''})}
                  className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink transition">
                  {ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              )}
            </FormField>
            {SCOPED_ROLES.includes(form.role) && (
              <FormField label="หน่วยงาน" required>
                {ctl => (
                  <select {...ctl} value={form.scope_id} onChange={e => setForm({...form, scope_id: e.target.value})}
                    className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink transition">
                    <option value="">— เลือก —</option>
                    {scopeOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                )}
              </FormField>
            )}
            {/* Phase 7.11.5 — grade_scope dropdown enabled only when
                role=school. Empty = full school account; selected = grade
                teacher sub-account (read-only on backend per 7.11.3). */}
            {form.role === 'school' && (
              <FormField
                label="ระดับชั้น (สำหรับครูประจำสายชั้น)"
                helper={form.grade_scope
                  ? `บัญชีครูประจำสายชั้น: ดูข้อมูลเฉพาะระดับชั้น ${form.grade_scope} และเป็นสิทธิ์อ่านอย่างเดียว`
                  : undefined}
              >
                {ctl => (
                  <select {...ctl} value={form.grade_scope || ''}
                    onChange={e => setForm({...form, grade_scope: e.target.value})}
                    className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink transition">
                    <option value="">— ไม่ระบุ (บัญชีหลักของโรงเรียน) —</option>
                    {['อ.1','อ.2','อ.3','ป.1','ป.2','ป.3','ป.4','ป.5','ป.6','ม.1','ม.2','ม.3','ม.4','ม.5','ม.6']
                      .map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                )}
              </FormField>
            )}
            <Field label="ชื่อแสดง" value={form.display_name} onChange={v => setForm({...form, display_name: v})} />
            <button onClick={handleCreate} disabled={saving}
              className="focus-ring w-full bg-brand-600 hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50 text-white font-medium min-h-[48px] rounded-lg transition">
              {saving ? 'กำลังสร้าง…' : 'สร้างผู้ใช้'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Edit Modal ── */}
      {modal === 'edit' && selected && (
        <Modal title={`แก้ไข: ${selected.username}`} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <Field label="ชื่อแสดง" value={form.display_name} onChange={v => setForm({...form, display_name: v})} />
            <FormField label="สถานะ">
              {ctl => (
                <select {...ctl} value={form.is_active ? '1' : '0'} onChange={e => setForm({...form, is_active: e.target.value === '1'})}
                  className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink transition">
                  <option value="1">ใช้งาน</option>
                  <option value="0">ระงับ</option>
                </select>
              )}
            </FormField>
            <button onClick={handleEdit} disabled={saving}
              className="focus-ring w-full bg-brand-600 hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50 text-white font-medium min-h-[48px] rounded-lg transition">
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Reset Password Modal ── */}
      {modal === 'reset' && selected && (
        <Modal title={`รีเซ็ตรหัสผ่าน: ${selected.username}`} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-4 py-2 border border-amber-200">
              ผู้ใช้จะต้องเปลี่ยนรหัสผ่านเมื่อ login ครั้งถัดไป
            </p>
            <Field label="รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)" value={form.password} onChange={v => setForm({...form, password: v})} type="password" />
            <button onClick={handleReset} disabled={saving}
              className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-medium py-3 rounded-lg transition">
              {saving ? 'กำลังรีเซ็ต…' : 'รีเซ็ตรหัสผ่าน'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Sub-components ──
// Delegates to the shared Modal so this page gets the same dialog semantics,
// Escape handling, focus trap and scroll lock as the rest of the app. The local
// wrapper stays so the three call sites below read unchanged.
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

// Thin alias kept so the call sites in this file stay unchanged; the wiring
// (label htmlFor, aria-describedby, error placement) now comes from FormField.
function Field(props) {
  return <FormField {...props} />;
}

// Role is an attribute, not a status, so every role gets the same neutral
// treatment. The old six-colour palette (purple/blue/teal/green/orange/grey)
// competed with the semantic colours that DO carry meaning in this table.
function RoleBadge({ role }) {
  return <Badge variant="neutral">{ROLE_LABELS[role] || role}</Badge>;
}

function AccountStatus({ active, mustChange }) {
  if (!active)    return <Badge variant="danger">ระงับ</Badge>;
  if (mustChange) return <Badge variant="warn">รอเปลี่ยนรหัส</Badge>;
  return <Badge variant="success">ใช้งาน</Badge>;
}
