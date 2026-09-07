import { useState, useEffect, useCallback } from 'react';
import { KeyRound } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import {
  AlertBanner, DataTable, TableAction, FormField, Modal, StatusBadge,
} from '../../components/ui';
import { useToast } from '../../components/Toast';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';

/**
 * บัญชีสังกัดและขนส่ง — the province's own reset desk.
 *
 * Deliberately the same shape as the affiliation's school-account page
 * (pages/affiliation/AffSchoolAccounts.jsx): same table, same reset modal, same
 * two-field confirmation, so an officer who has seen one has seen both. It
 * closes the last gap in the chain — affiliation resets its schools, school
 * resets its teachers, and until now nobody but the single admin could reset an
 * affiliation or transport account.
 */
export default function ProvUnitAccounts() {
  const toast = useToast();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resetTarget, setResetTarget] = useState(null);
  const [resetForm, setResetForm] = useState({ password: '', confirm: '' });
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/province/unit-accounts');
      setAccounts(Array.isArray(res.data.data) ? res.data.data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

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

  const ROLE_LABEL = { affiliation: 'สังกัด/เขต', transport: 'ขนส่ง' };

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="บัญชีสังกัดและขนส่ง"
        subtitle="รีเซ็ตรหัสผ่านให้บัญชีสังกัดและขนส่ง เมื่อผู้ถือบัญชีลืมรหัสผ่าน"
      />

      <AlertBanner variant="info" icon={KeyRound} className="mb-4">
        หน้านี้รีเซ็ตได้เฉพาะ <strong>บัญชีสังกัดและบัญชีขนส่ง</strong> เท่านั้น
        บัญชีโรงเรียนให้สังกัดของโรงเรียนนั้นเป็นผู้รีเซ็ต และบัญชีครูประจำสายชั้นให้โรงเรียนเป็นผู้รีเซ็ต
        เมื่อรีเซ็ตแล้วผู้ใช้จะถูกบังคับตั้งรหัสผ่านใหม่ทันทีที่เข้าสู่ระบบครั้งถัดไป
        และการเข้าใช้งานที่ค้างอยู่เดิมจะถูกตัดออกทันที ทุกครั้งมีบันทึกไว้ในประวัติการแก้ไข
      </AlertBanner>

      {error && <AlertBanner variant="danger" className="mb-4">{error}</AlertBanner>}

      {loading ? (
        <LoadingState />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="ไม่มีบัญชีให้จัดการ"
          description="ยังไม่มีบัญชีสังกัดหรือขนส่งในระบบ"
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
          actions={a => (
            <TableAction
              tone="brand"
              onClick={() => { setResetTarget(a); setResetForm({ password: '', confirm: '' }); }}
            >
              รีเซ็ตรหัส
            </TableAction>
          )}
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
              disabled={resetting || resetForm.password.length < 8 || resetForm.password !== resetForm.confirm}
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
            helper="อย่างน้อย 8 ตัวอักษร และต้องไม่ซ้ำกับชื่อผู้ใช้"
            value={resetForm.password}
            onChange={v => setResetForm({ ...resetForm, password: v })}
            error={resetForm.password && resetForm.password.length < 8 ? 'ต้องมีอย่างน้อย 8 ตัวอักษร' : undefined}
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
    </div>
  );
}
