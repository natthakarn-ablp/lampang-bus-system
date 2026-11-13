import { useState, useRef } from 'react';
import { KeyRound, UserCog, UserPlus, UserCheck } from 'lucide-react';
import api from '../api/axios';
import { FormField, Modal, TableAction } from './ui';
import { useToast } from './Toast';

/**
 * DriverAccountActions — the vehicle's driver login, managed by the school (or
 * affiliation) that uses the vehicle (owner decision 2026-11-13). The account
 * belongs to the vehicle: username = plate.
 *
 *   รีเซ็ตรหัสผ่านคนขับ  POST {basePath}/vehicles/:id/driver/reset-password
 *   แก้ไขข้อมูลคนขับ      PUT  {basePath}/vehicles/:id/driver        (same person)
 *   เปลี่ยนคนขับ          POST {basePath}/vehicles/:id/driver/replace (new person;
 *                         the previous driver loses access at once)
 *   เปิดใช้งานบัญชีคนขับ   POST {basePath}/vehicles/:id/driver/reactivate — only
 *                         offered while the account is switched off
 *                         (vehicle.driver_account_active === 0/false), e.g.
 *                         after the admin deactivated it.
 *
 * The temporary password is shown once, here, and never again.
 */
const btn = 'focus-ring text-sm font-medium px-4 min-h-[44px] rounded-lg border border-surface-border bg-surface-raised text-ink hover:bg-surface transition';
const primary = 'focus-ring text-sm font-semibold px-4 min-h-[44px] rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 disabled:pointer-events-none transition';

export default function DriverAccountActions({ vehicle, basePath, onChanged }) {
  const toast = useToast();
  const [mode, setMode] = useState(null); // 'reset' | 'edit' | 'replace' | 'reactivate'
  const [form, setForm] = useState({ name: '', phone: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [credentials, setCredentials] = useState(null);
  const lock = useRef(false);

  function open(next) {
    setError('');
    setForm(next === 'edit'
      ? { name: vehicle.driver_name || '', phone: vehicle.driver_phone || '', reason: '' }
      : { name: '', phone: '', reason: '' });
    setMode(next);
  }

  async function submit(e) {
    e?.preventDefault();
    if (lock.current) return;
    lock.current = true; setSaving(true); setError('');
    const url = `${basePath}/vehicles/${encodeURIComponent(vehicle.id)}/driver`;
    try {
      let res;
      if (mode === 'reset') res = await api.post(`${url}/reset-password`);
      else if (mode === 'reactivate') res = await api.post(`${url}/reactivate`);
      else if (mode === 'edit') res = await api.put(url, { name: form.name, phone: form.phone });
      else res = await api.post(`${url}/replace`, { name: form.name, phone: form.phone, reason: form.reason });
      const data = res.data?.data || {};
      setMode(null);
      if (data.temporary_password) {
        setCredentials({ username: data.username, password: data.temporary_password });
      } else {
        toast.success(res.data?.message || 'บันทึกแล้ว');
      }
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.message || 'ดำเนินการไม่สำเร็จ');
    } finally {
      lock.current = false; setSaving(false);
    }
  }

  const titles = { reset: 'รีเซ็ตรหัสผ่านคนขับ', edit: 'แก้ไขข้อมูลคนขับ', replace: 'เปลี่ยนคนขับ', reactivate: 'เปิดใช้งานบัญชีคนขับ' };
  // 0 / false = the plate account exists but is switched off; null/undefined =
  // no account or the list did not say, so the normal actions show.
  const inactive = vehicle.driver_account_active === 0 || vehicle.driver_account_active === false;
  const noFormMode = mode === 'reset' || mode === 'reactivate';

  return (
    <>
      {inactive ? (
        <TableAction tone="brand" onClick={() => open('reactivate')} aria-label={`เปิดใช้งานบัญชีคนขับ ${vehicle.plate_no}`}>
          <UserCheck className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden="true" />
          เปิดใช้งานบัญชีคนขับ
        </TableAction>
      ) : (
        <>
          <TableAction tone="neutral" onClick={() => open('reset')}>
            <KeyRound className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden="true" />
            รีเซ็ตรหัสผ่านคนขับ
          </TableAction>
          {vehicle.driver_name && (
            <TableAction tone="neutral" onClick={() => open('edit')}>
              <UserCog className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden="true" />
              แก้ไขข้อมูลคนขับ
            </TableAction>
          )}
        </>
      )}
      {/* Also offered while the account is switched off: replacing the driver
          rotates the password and re-enables the account in one step, so the
          previous driver never regains access in between. */}
      <TableAction tone="neutral" onClick={() => open('replace')}>
        <UserPlus className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden="true" />
        เปลี่ยนคนขับ
      </TableAction>

      {mode === 'reactivate' && (
        <Modal
          title={titles.reactivate}
          dismissible={!saving}
          onClose={() => { if (!lock.current) setMode(null); }}
          footer={
            <>
              <button type="button" disabled={saving} onClick={() => setMode(null)} className={btn}>ยกเลิก</button>
              <button type="button" onClick={submit} className={primary} disabled={saving}>
                {saving ? 'กำลังบันทึก…' : 'เปิดใช้งาน'}
              </button>
            </>
          }
        >
          <p className="text-sm text-ink-muted mb-3">
            รถ {vehicle.plate_no} · บัญชีคนขับถูกปิดใช้งานอยู่ (เช่น ผู้ดูแลระบบปิดไว้)
          </p>
          <p className="text-sm text-ink">
            ใช้เมื่อคนขับคนเดิมกลับมาขับต่อ คนขับเข้าสู่ระบบใหม่ด้วยรหัสผ่านเดิม
            ถ้าเปลี่ยนเป็นคนขับคนใหม่ ให้กด "เปลี่ยนคนขับ" แทนโดยไม่ต้องเปิดใช้งานก่อน
            (คนขับเดิมจะเข้าระบบไม่ได้) ระบบบันทึกประวัติการเปิดใช้งาน
          </p>
          {error && <p role="alert" className="text-sm text-danger-ink mt-3">{error}</p>}
        </Modal>
      )}

      {mode && mode !== 'reactivate' && (
        <Modal
          title={titles[mode]}
          dismissible={!saving}
          onClose={() => { if (!lock.current) setMode(null); }}
          footer={
            <>
              <button type="button" disabled={saving} onClick={() => setMode(null)} className={btn}>ยกเลิก</button>
              <button type="submit" form="driver-account-form" className={primary}
                disabled={saving || (!noFormMode && !form.name.trim())}>
                {saving ? 'กำลังบันทึก…' : mode === 'reset' ? 'รีเซ็ตรหัสผ่าน' : mode === 'replace' ? 'เปลี่ยนคนขับ' : 'บันทึก'}
              </button>
            </>
          }
        >
          <p className="text-sm text-ink-muted mb-3">
            รถ {vehicle.plate_no} · บัญชีคนขับใช้ชื่อผู้ใช้เป็นทะเบียนรถ
          </p>
          <form id="driver-account-form" onSubmit={submit} className="space-y-3">
            {mode === 'reset' && (
              <p className="text-sm text-ink">
                ระบบจะสร้างรหัสผ่านชั่วคราวใหม่ แสดงครั้งเดียว ให้ส่งแก่คนขับ
                คนขับที่เข้าระบบอยู่จะถูกออกจากระบบทันที และต้องตั้งรหัสใหม่เมื่อเข้าสู่ระบบ
              </p>
            )}
            {mode === 'replace' && (
              <p className="text-sm text-warn-ink">
                ใช้เมื่อเปลี่ยนเป็นคนขับคนใหม่ คนขับเดิมจะเข้าระบบไม่ได้อีก (รหัสผ่านถูกรีเซ็ต)
                ประวัติการรับส่งเดิมยังอยู่ครบ
                {inactive && ' บัญชีที่ถูกปิดไว้จะเปิดใช้งานให้คนขับคนใหม่พร้อมกัน'}
              </p>
            )}
            {mode !== 'reset' && (
              <>
                <FormField label={mode === 'replace' ? 'ชื่อคนขับคนใหม่' : 'ชื่อคนขับ'} required
                  value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} maxLength={100} />
                <FormField label="เบอร์โทรคนขับ" type="tel" inputMode="numeric"
                  value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} maxLength={20} />
              </>
            )}
            {mode === 'replace' && (
              <FormField label="เหตุผล (ถ้ามี)" value={form.reason}
                onChange={v => setForm(f => ({ ...f, reason: v }))} maxLength={200} />
            )}
            {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
          </form>
        </Modal>
      )}

      {credentials && (
        <Modal
          title="รหัสผ่านชั่วคราวของคนขับ"
          onClose={() => setCredentials(null)}
          footer={<button type="button" onClick={() => setCredentials(null)} className={primary}>บันทึกรหัสแล้ว ปิดหน้าต่าง</button>}
        >
          <p className="text-sm text-ink mb-3">แสดงเพียงครั้งเดียว กรุณาจดหรือส่งให้คนขับ คนขับต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก</p>
          <dl className="rounded-lg border border-surface-border bg-surface p-3 text-sm space-y-1">
            <div className="flex gap-2"><dt className="text-ink-muted">ชื่อผู้ใช้:</dt><dd className="font-semibold text-ink break-all">{credentials.username}</dd></div>
            <div className="flex gap-2"><dt className="text-ink-muted">รหัสผ่านชั่วคราว:</dt><dd className="font-mono font-semibold text-ink tracking-wider">{credentials.password}</dd></div>
          </dl>
        </Modal>
      )}
    </>
  );
}
