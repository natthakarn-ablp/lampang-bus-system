import { useState, useEffect, useCallback } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import {
  AlertBanner, DataTable, TableAction, FormField, Modal, StatusBadge, ConfirmDialog, FilterBar,
} from '../../components/ui';
import { useToast } from '../../components/Toast';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import { PASSWORD_MIN_LENGTH, PASSWORD_HELPER, PASSWORD_TOO_SHORT } from '../../utils/passwordPolicy';

/**
 * บัญชีสังกัดและขนส่ง — the province's own reset desk.
 *
 * Deliberately the same shape as the affiliation's school-account page
 * (pages/affiliation/AffSchoolAccounts.jsx): same table, same reset modal, same
 * two-field confirmation, so an officer who has seen one has seen both. It
 * closes the last gap in the chain — affiliation resets its schools, school
 * resets its teachers, and until now nobody but the single admin could reset an
 * affiliation or transport account.
 *
 * 2026-11-13: also create (server-generated temporary password, shown once),
 * rename, deactivate/activate, delete and restore — so a new สังกัด or a new
 * transport officer no longer waits on the admin.
 */
const SELECT_CLASS = 'focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink transition';

export default function ProvUnitAccounts() {
  const toast = useToast();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resetTarget, setResetTarget] = useState(null);
  const [resetForm, setResetForm] = useState({ password: '', confirm: '' });
  const [resetting, setResetting] = useState(false);
  const [view, setView] = useState('active'); // 'active' | 'deleted'
  const [affiliations, setAffiliations] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ role: 'affiliation', username: '', display_name: '', scope_id: '' });
  const [created, setCreated] = useState(null); // { username, temporary_password } — shown once
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirm, setConfirm] = useState(null); // { kind: 'toggle'|'delete'|'restore', account }
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/province/affiliations')
      .then((r) => setAffiliations(Array.isArray(r.data?.data) ? r.data.data : []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = view === 'deleted'
        ? await api.get('/province/unit-accounts/deleted')
        : await api.get('/province/unit-accounts');
      setAccounts(Array.isArray(res.data.data) ? res.data.data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => { load(); }, [load]);

  async function handleReset() {
    if (!resetTarget) return;
    setResetting(true);
    try {
      await api.post(`/province/unit-accounts/${resetTarget.id}/reset-password`, {
        password: resetForm.password,
      });
      toast.success('รีเซ็ตรหัสผ่านสำเร็จ — ผู้ใช้ต้องตั้งรหัสใหม่เมื่อเข้าสู่ระบบครั้งถัดไป');
      setResetTarget(null);
      setResetForm({ password: '', confirm: '' });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'รีเซ็ตรหัสผ่านไม่สำเร็จ');
    } finally {
      setResetting(false);
    }
  }

  async function handleCreate() {
    setSaving(true);
    try {
      const body = { role: createForm.role, username: createForm.username.trim(), display_name: createForm.display_name };
      if (createForm.role === 'affiliation') body.scope_id = createForm.scope_id;
      const res = await api.post('/province/unit-accounts', body);
      setCreateOpen(false);
      setCreated(res.data?.data || null);
      if (view === 'active') load(); else setView('active');
    } catch (err) {
      toast.error(err.response?.data?.message || 'สร้างบัญชีไม่สำเร็จ');
    } finally { setSaving(false); }
  }

  async function handleRename() {
    setSaving(true);
    try {
      await api.put(`/province/unit-accounts/${renameTarget.id}`, { display_name: renameValue });
      toast.success('บันทึกแล้ว');
      setRenameTarget(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally { setSaving(false); }
  }

  async function handleConfirm() {
    if (!confirm) return;
    const { kind, account } = confirm;
    setSaving(true);
    try {
      let res;
      if (kind === 'toggle') res = await api.put(`/province/unit-accounts/${account.id}`, { is_active: !account.is_active });
      if (kind === 'delete') res = await api.delete(`/province/unit-accounts/${account.id}`);
      if (kind === 'restore') res = await api.post(`/province/unit-accounts/${account.id}/restore`);
      toast.success(res?.data?.message || 'บันทึกแล้ว');
      setConfirm(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ทำรายการไม่สำเร็จ');
    } finally { setSaving(false); }
  }

  const confirmText = confirm && {
    toggle: confirm.account.is_active
      ? { title: 'ปิดบัญชีนี้?', description: 'ผู้ใช้จะเข้าสู่ระบบด้วยบัญชีนี้ไม่ได้ จนกว่าจะเปิดบัญชีอีกครั้ง', label: 'ปิดบัญชี', tone: 'danger' }
      : { title: 'เปิดบัญชีนี้?', description: 'ผู้ใช้จะเข้าสู่ระบบด้วยบัญชีนี้ได้อีกครั้ง', label: 'เปิดบัญชี', tone: 'brand' },
    delete: { title: 'ลบบัญชีนี้?', description: 'บัญชีจะเข้าใช้งานไม่ได้และหายจากรายการ กู้คืนได้ที่ "บัญชีที่ลบแล้ว" การกระทำนี้ถูกบันทึกในประวัติการแก้ไข', label: 'ลบบัญชี', tone: 'danger' },
    restore: { title: 'กู้คืนบัญชีนี้?', description: 'บัญชีจะกลับมาในสถานะ "ปิด" กด "เปิดบัญชี" เมื่อพร้อมใช้งาน', label: 'กู้คืน', tone: 'brand' },
  }[confirm.kind];

  const isDeletedView = view === 'deleted';
  const canCreate = createForm.username.trim().length >= 3 && (createForm.role !== 'affiliation' || createForm.scope_id);

  const ROLE_LABEL = { affiliation: 'สังกัด/เขต', transport: 'ขนส่ง' };

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="บัญชีสังกัดและขนส่ง"
        subtitle="สร้าง แก้ชื่อ รีเซ็ตรหัสผ่าน ปิด/เปิด ลบ และกู้คืนบัญชีสังกัดและขนส่ง"
        actions={
          <button type="button"
            onClick={() => { setCreateForm({ role: 'affiliation', username: '', display_name: '', scope_id: '' }); setCreateOpen(true); }}
            className="focus-ring inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-medium px-4 min-h-[44px] rounded-lg transition text-sm">
            <Plus className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
            สร้างบัญชี
          </button>
        }
      />

      <AlertBanner variant="info" icon={KeyRound} className="mb-4">
        หน้านี้รีเซ็ตได้เฉพาะ <strong>บัญชีสังกัดและบัญชีขนส่ง</strong> เท่านั้น
        บัญชีโรงเรียนให้สังกัดของโรงเรียนนั้นเป็นผู้รีเซ็ต และบัญชีครูประจำสายชั้นให้โรงเรียนเป็นผู้รีเซ็ต
        เมื่อรีเซ็ตแล้วผู้ใช้จะถูกบังคับตั้งรหัสผ่านใหม่ทันทีที่เข้าสู่ระบบครั้งถัดไป
        และการเข้าใช้งานที่ค้างอยู่เดิมจะถูกตัดออกทันที ทุกครั้งมีบันทึกไว้ในประวัติการแก้ไข
      </AlertBanner>

      <FilterBar
        className="mb-4"
        chips={{
          label: 'แสดงบัญชี',
          value: view,
          onChange: setView,
          options: [['active', 'บัญชีที่ใช้อยู่'], ['deleted', 'บัญชีที่ลบแล้ว']],
        }}
      />

      {error && <AlertBanner variant="danger" className="mb-4">{error}</AlertBanner>}

      {loading ? (
        <LoadingState />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={isDeletedView ? 'ไม่มีบัญชีที่ลบแล้ว' : 'ไม่มีบัญชีให้จัดการ'}
          description={isDeletedView ? undefined : 'ยังไม่มีบัญชีสังกัดหรือขนส่งในระบบ กด "สร้างบัญชี" เพื่อเริ่ม'}
        />
      ) : (
        <DataTable
          caption="บัญชีสังกัดและขนส่งที่จังหวัดรีเซ็ตรหัสผ่านได้"
          rows={accounts}
          rowKey={a => a.id}
          columns={[
            {
              key: 'display_name', header: 'บัญชี', primary: true,
              cell: a => (
                <span className="font-medium text-ink">
                  {a.display_name || a.affiliation_name || a.username}
                </span>
              ),
            },
            {
              key: 'role', header: 'ประเภท', badge: true,
              cell: a => (
                <StatusBadge variant={a.role === 'affiliation' ? 'brand' : 'neutral'} size="sm">
                  {ROLE_LABEL[a.role] || a.role}
                </StatusBadge>
              ),
            },
            {
              key: 'username', header: 'ชื่อผู้ใช้', secondary: true,
              cell: a => <span className="font-mono text-xs">{a.username}</span>,
            },
            {
              key: 'last_login', header: 'เข้าใช้ล่าสุด', secondary: true,
              cell: a => (a.last_login
                ? new Date(a.last_login).toLocaleDateString('th-TH')
                : <span className="text-ink-muted">ยังไม่เคยเข้าระบบ</span>),
            },
            {
              key: 'is_active', header: 'สถานะ', align: 'center', badge: true,
              cell: a => (
                <StatusBadge variant={a.is_active ? 'success' : 'neutral'} size="sm">
                  {a.is_active ? 'ใช้งาน' : 'ปิด'}
                </StatusBadge>
              ),
            },
          ]}
          actions={a => (isDeletedView ? (
            <TableAction tone="brand" onClick={() => setConfirm({ kind: 'restore', account: a })}>กู้คืน</TableAction>
          ) : (
            <>
              <TableAction
                tone="brand"
                onClick={() => { setResetTarget(a); setResetForm({ password: '', confirm: '' }); }}
              >
                รีเซ็ตรหัส
              </TableAction>
              <TableAction tone="neutral" onClick={() => { setRenameTarget(a); setRenameValue(a.display_name || ''); }}>แก้ชื่อ</TableAction>
              <TableAction tone={a.is_active ? 'warn' : 'neutral'} onClick={() => setConfirm({ kind: 'toggle', account: a })}>
                {a.is_active ? 'ปิดบัญชี' : 'เปิดบัญชี'}
              </TableAction>
              <TableAction tone="danger" onClick={() => setConfirm({ kind: 'delete', account: a })}>ลบ</TableAction>
            </>
          ))}
        />
      )}

      {/* ─── Reset password modal ────────────────────────────────────────── */}
      <Modal
        open={Boolean(resetTarget)}
        title="รีเซ็ตรหัสผ่านบัญชีสังกัด/ขนส่ง"
        size="sm"
        onClose={() => { if (!resetting) setResetTarget(null); }}
        footer={
          <>
            <button
              type="button"
              onClick={() => setResetTarget(null)}
              disabled={resetting}
              className="focus-ring text-sm font-medium px-4 min-h-[44px] rounded-lg border border-surface-border text-ink hover:bg-surface transition disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              form="prov-reset-password-form"
              disabled={resetting || resetForm.password.length < PASSWORD_MIN_LENGTH || resetForm.password !== resetForm.confirm}
              className="focus-ring text-sm font-semibold px-4 min-h-[44px] rounded-lg bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white transition disabled:opacity-50 disabled:pointer-events-none"
            >
              {resetting ? 'กำลังรีเซ็ต…' : 'รีเซ็ตรหัสผ่าน'}
            </button>
          </>
        }
      >
        {/* Same three-step fallback as the table cell. affiliation_name is
            always null for a transport row, because the LEFT JOIN that supplies
            it is guarded by role = 'affiliation'; and display_name can be null
            on a row edited through PUT /api/admin/users/:id or migrated from
            the legacy system, where the column is nullable with no default. Two
            steps would have left the dialog naming nobody. */}
        <p className="text-sm text-ink-muted mb-4">
          {resetTarget?.display_name || resetTarget?.affiliation_name || resetTarget?.username} ·{' '}
          <span className="font-mono text-xs">{resetTarget?.username}</span>
        </p>
        <form
          id="prov-reset-password-form"
          onSubmit={e => { e.preventDefault(); handleReset(); }}
          className="space-y-3"
        >
          <FormField
            label="รหัสผ่านใหม่"
            type="password"
            required
            autoComplete="new-password"
            helper={`${PASSWORD_HELPER} และต้องไม่ซ้ำกับชื่อผู้ใช้`}
            value={resetForm.password}
            onChange={v => setResetForm({ ...resetForm, password: v })}
            error={resetForm.password && resetForm.password.length < PASSWORD_MIN_LENGTH ? `ต้อง${PASSWORD_HELPER}` : undefined}
          />
          <FormField
            label="ยืนยันรหัสผ่านใหม่"
            type="password"
            required
            autoComplete="new-password"
            value={resetForm.confirm}
            onChange={v => setResetForm({ ...resetForm, confirm: v })}
            error={resetForm.confirm && resetForm.confirm !== resetForm.password ? 'รหัสผ่านไม่ตรงกัน' : undefined}
          />
        </form>
      </Modal>

      {/* ─── Create account ──────────────────────────────────────────────── */}
      <Modal
        open={createOpen}
        title="สร้างบัญชีสังกัด/ขนส่ง"
        size="sm"
        onClose={() => { if (!saving) setCreateOpen(false); }}
        footer={
          <>
            <button type="button" onClick={() => setCreateOpen(false)} disabled={saving}
              className="focus-ring text-sm font-medium px-4 min-h-[44px] rounded-lg border border-surface-border text-ink hover:bg-surface transition disabled:opacity-50">ยกเลิก</button>
            <button type="submit" form="prov-create-account-form" disabled={saving || !canCreate}
              className="focus-ring text-sm font-semibold px-4 min-h-[44px] rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition disabled:opacity-50 disabled:pointer-events-none">
              {saving ? 'กำลังสร้าง…' : 'สร้างบัญชี'}
            </button>
          </>
        }
      >
        <form id="prov-create-account-form" onSubmit={e => { e.preventDefault(); handleCreate(); }} className="space-y-3">
          <FormField label="ประเภทบัญชี" required>
            {(ctl) => (
              <select {...ctl} value={createForm.role} onChange={e => setCreateForm({ ...createForm, role: e.target.value })} className={SELECT_CLASS}>
                <option value="affiliation">สังกัด/เขต</option>
                <option value="transport">ขนส่ง</option>
              </select>
            )}
          </FormField>
          {createForm.role === 'affiliation' && (
            <FormField label="สังกัด" required helper="ยังไม่มีสังกัดในรายการ เพิ่มได้ที่เมนูสังกัดทั้งหมด">
              {(ctl) => (
                <select {...ctl} value={createForm.scope_id} onChange={e => setCreateForm({ ...createForm, scope_id: e.target.value })} className={SELECT_CLASS}>
                  <option value="">— เลือกสังกัด —</option>
                  {affiliations.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
            </FormField>
          )}
          <FormField label="ชื่อผู้ใช้" required value={createForm.username} maxLength={100} autoComplete="off"
            helper="อักษรอังกฤษ ตัวเลข หรือ . _ @ - อย่างน้อย 3 ตัว"
            onChange={v => setCreateForm({ ...createForm, username: v })} />
          <FormField label="ชื่อที่แสดง" value={createForm.display_name} maxLength={200}
            helper={createForm.role === 'affiliation' ? 'ไม่กรอกจะใช้ชื่อสังกัด' : 'เช่น สำนักงานขนส่งจังหวัดลำปาง'}
            onChange={v => setCreateForm({ ...createForm, display_name: v })} />
          <p className="text-sm text-ink-muted">ระบบสร้างรหัสผ่านชั่วคราวให้และแสดงเพียงครั้งเดียว ผู้ใช้ต้องตั้งรหัสใหม่เมื่อเข้าสู่ระบบครั้งแรก</p>
        </form>
      </Modal>

      {/* ─── Temporary password, shown once ─────────────────────────────── */}
      <Modal
        open={Boolean(created)}
        title="สร้างบัญชีแล้ว"
        size="sm"
        onClose={() => setCreated(null)}
        footer={
          <button type="button" onClick={() => setCreated(null)}
            className="focus-ring text-sm font-semibold px-4 min-h-[44px] rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition">
            จดรหัสแล้ว ปิดหน้าต่าง
          </button>
        }
      >
        <AlertBanner variant="warn" className="mb-3">
          รหัสผ่านชั่วคราวแสดง<strong>ครั้งเดียว</strong> จดหรือส่งให้ผู้ใช้ตอนนี้ ถ้าลืม ให้กด "รีเซ็ตรหัส" ภายหลัง
        </AlertBanner>
        <dl className="space-y-2 text-sm">
          <div><dt className="text-ink-muted">ชื่อผู้ใช้</dt><dd className="font-mono text-base text-ink">{created?.username}</dd></div>
          <div><dt className="text-ink-muted">รหัสผ่านชั่วคราว</dt><dd className="font-mono text-lg font-semibold text-ink select-all">{created?.temporary_password}</dd></div>
        </dl>
      </Modal>

      {/* ─── Rename ─────────────────────────────────────────────────────── */}
      <Modal
        open={Boolean(renameTarget)}
        title="แก้ชื่อที่แสดง"
        size="sm"
        onClose={() => { if (!saving) setRenameTarget(null); }}
        footer={
          <>
            <button type="button" onClick={() => setRenameTarget(null)} disabled={saving}
              className="focus-ring text-sm font-medium px-4 min-h-[44px] rounded-lg border border-surface-border text-ink hover:bg-surface transition disabled:opacity-50">ยกเลิก</button>
            <button type="submit" form="prov-rename-account-form" disabled={saving || !renameValue.trim()}
              className="focus-ring text-sm font-semibold px-4 min-h-[44px] rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition disabled:opacity-50 disabled:pointer-events-none">
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </>
        }
      >
        <form id="prov-rename-account-form" onSubmit={e => { e.preventDefault(); handleRename(); }} className="space-y-3">
          <p className="text-sm text-ink-muted font-mono">{renameTarget?.username}</p>
          <FormField label="ชื่อที่แสดง" required value={renameValue} maxLength={200} onChange={setRenameValue} />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirmText?.title || ''}
        itemName={confirm ? `${confirm.account.display_name || confirm.account.affiliation_name || confirm.account.username} · ${confirm.account.username}` : ''}
        description={confirmText?.description}
        confirmLabel={confirmText?.label}
        tone={confirmText?.tone}
        loading={saving}
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
