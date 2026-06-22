import { useState, useEffect, useCallback } from 'react';
import { Users } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import AppCard from '../../components/ui/AppCard';
import Pagination from '../../components/Pagination';

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
    api.get('/province/schools?per_page=200').then(r => setSchools(r.data.data || [])).catch(() => {});
    api.get('/province/affiliations').then(r => setAffiliations(r.data.data || [])).catch(() => {});
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
      setUsers(res.data.data);
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
  async function handleDelete(user) {
    if (!window.confirm(`ลบผู้ใช้ "${user.username}" ออกจากระบบ?`)) return;
    try {
      await api.delete(`/admin/users/${user.id}`);
      toast.success('ลบผู้ใช้สำเร็จ');
      fetchUsers(meta.page);
    } catch (err) { toast.error(err.response?.data?.message || 'ไม่สามารถลบได้'); }
  }

  const totalPages = Math.ceil(meta.total / meta.per_page) || 1;

  const scopeOptions = form.role === 'school' ? schools.map(s => ({ id: s.id, name: s.name }))
    : form.role === 'affiliation' ? affiliations.map(a => ({ id: a.id, name: a.name }))
    : form.role === 'province' ? [{ id: 'LPG', name: 'จังหวัดลำปาง' }] : [];

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold text-gray-800">จัดการผู้ใช้งาน</h1>
        <button onClick={openCreate}
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-lg transition text-sm">
          + สร้างผู้ใช้ใหม่
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อผู้ใช้…"
          className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
          className="border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 sm:w-48">
          <option value="">ทุกบทบาท</option>
          {ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {loading ? (
        <LoadingState />
      ) : users.length === 0 ? (
        <EmptyState
          icon={Users}
          title={debouncedSearch || filterRole ? 'ไม่พบข้อมูลตามเงื่อนไขที่เลือก' : 'ยังไม่มีข้อมูลในขอบเขตนี้'}
          description={debouncedSearch || filterRole ? 'ลองเปลี่ยนคำค้นหรือตัวกรองบทบาท' : undefined}
        />
      ) : (
        <>
          {/* Desktop table */}
          <AppCard padding="none" className="hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-ink-muted text-xs font-semibold uppercase tracking-wide">
                <tr className="text-left">
                  <th className="px-4 py-3">ชื่อผู้ใช้</th>
                  <th className="px-4 py-3">ชื่อแสดง</th>
                  <th className="px-4 py-3">บทบาท</th>
                  <th className="px-4 py-3">หน่วยงาน</th>
                  <th className="px-4 py-3">ระดับชั้น</th>
                  <th className="px-4 py-3 text-center">สถานะ</th>
                  <th className="px-4 py-3 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-surface transition">
                    <td className="px-4 py-3 text-gray-800 font-medium">{u.username}</td>
                    <td className="px-4 py-3 text-gray-600">{u.display_name || '-'}</td>
                    <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{u.scope_name || u.scope_id || '-'}</td>
                    <td className="px-4 py-3 text-gray-700 text-xs">{u.grade_scope || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge active={u.is_active} mustChange={u.must_change_password} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-1">
                        <button onClick={() => openEdit(u)} className="text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded">แก้ไข</button>
                        <button onClick={() => openReset(u)} className="text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded">รีเซ็ตรหัส</button>
                        <button onClick={() => handleDelete(u)} className="text-xs text-red-600 bg-red-50 hover:bg-red-100 px-2 py-1 rounded">ลบ</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </AppCard>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {users.map(u => (
              <div key={u.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-gray-900 truncate">{u.username}</p>
                    <p className="text-sm text-gray-500 truncate">{u.display_name || '-'}</p>
                  </div>
                  <div className="shrink-0">
                    <StatusBadge active={u.is_active} mustChange={u.must_change_password} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-sm mb-3">
                  <RoleBadge role={u.role} />
                  {u.scope_name && <span className="text-gray-400 truncate">{u.scope_name}</span>}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => openEdit(u)} className="flex-1 min-w-[80px] text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 py-2.5 rounded-lg font-medium min-h-[40px]">แก้ไข</button>
                  <button onClick={() => openReset(u)} className="flex-1 min-w-[100px] text-sm text-amber-700 bg-amber-50 hover:bg-amber-100 py-2.5 rounded-lg font-medium min-h-[40px]">รีเซ็ตรหัส</button>
                  <button onClick={() => handleDelete(u)} className="text-sm text-red-600 bg-red-50 hover:bg-red-100 px-4 py-2.5 rounded-lg min-h-[40px]">ลบ</button>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <Pagination page={meta.page} totalPages={totalPages} total={meta.total} shown={users.length} onPage={(p) => fetchUsers(p)} />
        </>
      )}

      {/* ── Create Modal ── */}
      {modal === 'create' && (
        <Modal title="สร้างผู้ใช้ใหม่" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <Field label="ชื่อผู้ใช้ *" value={form.username} onChange={v => setForm({...form, username: v})} />
            <Field label="รหัสผ่าน * (อย่างน้อย 6 ตัว)" value={form.password} onChange={v => setForm({...form, password: v})} type="password" />
            <div>
              <label className="block text-sm text-gray-500 mb-1">บทบาท *</label>
              <select value={form.role} onChange={e => setForm({...form, role: e.target.value, scope_id: ''})}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base">
                {ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {SCOPED_ROLES.includes(form.role) && (
              <div>
                <label className="block text-sm text-gray-500 mb-1">หน่วยงาน *</label>
                <select value={form.scope_id} onChange={e => setForm({...form, scope_id: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base">
                  <option value="">— เลือก —</option>
                  {scopeOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            )}
            {/* Phase 7.11.5 — grade_scope dropdown enabled only when
                role=school. Empty = full school account; selected = grade
                teacher sub-account (read-only on backend per 7.11.3). */}
            {form.role === 'school' && (
              <div>
                <label className="block text-sm text-gray-500 mb-1">ระดับชั้น (สำหรับครูประจำสายชั้น)</label>
                <select value={form.grade_scope || ''}
                  onChange={e => setForm({...form, grade_scope: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base">
                  <option value="">— ไม่ระบุ (บัญชีหลักของโรงเรียน) —</option>
                  {['อ.1','อ.2','อ.3','ป.1','ป.2','ป.3','ป.4','ป.5','ป.6','ม.1','ม.2','ม.3','ม.4','ม.5','ม.6']
                    .map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                {form.grade_scope && (
                  <p className="text-xs text-gray-500 mt-1">
                    บัญชีครูประจำสายชั้น: ดูข้อมูลเฉพาะระดับชั้น {form.grade_scope} และเป็นสิทธิ์อ่านอย่างเดียว
                  </p>
                )}
              </div>
            )}
            <Field label="ชื่อแสดง" value={form.display_name} onChange={v => setForm({...form, display_name: v})} />
            <button onClick={handleCreate} disabled={saving}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 rounded-lg transition">
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
            <div>
              <label className="block text-sm text-gray-500 mb-1">สถานะ</label>
              <select value={form.is_active ? '1' : '0'} onChange={e => setForm({...form, is_active: e.target.value === '1'})}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base">
                <option value="1">ใช้งาน</option>
                <option value="0">ระงับ</option>
              </select>
            </div>
            <button onClick={handleEdit} disabled={saving}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 rounded-lg transition">
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
function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 sm:p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-800 mb-4">{title}</h2>
        {children}
        <button onClick={onClose} className="w-full text-gray-500 hover:text-gray-700 text-sm py-2 mt-2 transition">ยกเลิก</button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <label className="block text-sm text-gray-500 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
    </div>
  );
}

function RoleBadge({ role }) {
  const cls = {
    admin: 'bg-purple-100 text-purple-700', province: 'bg-blue-100 text-blue-700',
    affiliation: 'bg-teal-100 text-teal-700', school: 'bg-green-100 text-green-700',
    driver: 'bg-orange-100 text-orange-700', transport: 'bg-gray-100 text-gray-700',
  };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls[role] || 'bg-gray-100'}`}>{ROLE_LABELS[role] || role}</span>;
}

function StatusBadge({ active, mustChange }) {
  if (!active) return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-600">ระงับ</span>;
  if (mustChange) return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">รอเปลี่ยนรหัส</span>;
  return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">ใช้งาน</span>;
}
