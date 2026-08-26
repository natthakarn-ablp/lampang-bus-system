import { useState, useEffect, useCallback, useRef } from 'react';
import { School } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import {
  AlertBanner, ConfirmDialog, DataTable, TableAction, FormField, Modal, StatusBadge,
} from '../../components/ui';

// Shared by the selects here; FormField supplies the label wiring.
const CONTROL_CLS = 'focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base sm:text-sm text-ink transition';
import { useToast } from '../../components/Toast';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';

const ACCOUNTS_PAGE_SIZE = 10;

/**
 * เพิ่มโรงเรียนใหม่ — Phase 10.2A
 *
 * Two ways to add school accounts:
 *   A) Manual single-school form (school_code + school_name + username)
 *   B) Bulk Excel/CSV import (download template → preview → commit)
 *
 * Self-service (Tier 1) — the affiliation manages its own school accounts
 * without admin: add an account to an existing school, reset a school's
 * password, and enable/disable an account (per-row controls in Section C).
 */
export default function AffSchoolAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [accountsPage, setAccountsPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  // ─── Section A: manual single-add ─────────────────────────────────────
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({ school_code: '', school_name: '', username: '' });
  const [saving, setSaving] = useState(false);

  // ─── Section B: bulk import ───────────────────────────────────────────
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);   // { rows, summary } from API
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const fileInputRef = useRef(null);

  // ─── Self-service: reset password / toggle / add-to-existing ──────────
  const [resetTarget, setResetTarget] = useState(null);           // account row
  const [resetForm, setResetForm] = useState({ password: '', confirm: '' });
  const [resetting, setResetting] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  // Both were window.confirm; closing a school's account locks it out.
  const [confirmCommit, setConfirmCommit] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [schools, setSchools] = useState([]);
  const [showAddExisting, setShowAddExisting] = useState(false);
  const [addForm, setAddForm] = useState({ school_id: '', username: '', display_name: '' });
  const [addingExisting, setAddingExisting] = useState(false);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await api.get('/affiliation/school-accounts');
      setAccounts(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch {
      /* keep page usable even if list fails */
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSchools = useCallback(async () => {
    try {
      const res = await api.get('/affiliation/schools');
      setSchools(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch { /* dropdown optional */ }
  }, []);

  useEffect(() => { fetchAccounts(); fetchSchools(); }, [fetchAccounts, fetchSchools]);

  // ─── Reset password ───────────────────────────────────────────────────
  async function handleReset() {
    if (!resetForm.password || resetForm.password.length < 8) { toast.error('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'); return; }
    if (resetForm.password !== resetForm.confirm) { toast.error('รหัสผ่านยืนยันไม่ตรงกัน'); return; }
    setResetting(true);
    try {
      await api.post(`/affiliation/school-accounts/${resetTarget.id}/reset-password`, { password: resetForm.password });
      toast.success('รีเซ็ตรหัสผ่านสำเร็จ — ผู้ใช้ต้องเปลี่ยนรหัสเมื่อเข้าสู่ระบบครั้งถัดไป');
      setResetTarget(null);
      setResetForm({ password: '', confirm: '' });
    } catch (err) {
      toast.error(err.response?.data?.message || 'รีเซ็ตรหัสผ่านไม่สำเร็จ');
    } finally { setResetting(false); }
  }

  // ─── Toggle enable/disable ────────────────────────────────────────────
  async function handleToggle(acc) {
    setTogglingId(acc.id);
    try {
      await api.put(`/affiliation/school-accounts/${acc.id}`, { is_active: !acc.is_active });
      toast.success(acc.is_active ? 'ปิดการใช้งานบัญชีแล้ว' : 'เปิดการใช้งานบัญชีแล้ว');
      setConfirmToggle(null);
      fetchAccounts();
    } catch (err) {
      toast.error(err.response?.data?.message || 'เปลี่ยนสถานะไม่สำเร็จ');
    } finally { setTogglingId(null); }
  }

  // ─── Add account to an existing school ────────────────────────────────
  async function handleAddExisting(e) {
    e.preventDefault();
    if (!addForm.school_id) { toast.error('กรุณาเลือกโรงเรียน'); return; }
    if (!/^\d{6}$/.test(addForm.username)) { toast.error('ชื่อผู้ใช้ต้องเป็นรหัส OBEC 6 หลัก'); return; }
    setAddingExisting(true);
    try {
      await api.post('/affiliation/school-accounts', {
        school_id: addForm.school_id,
        username: addForm.username,
        display_name: addForm.display_name.trim() || undefined,
      });
      toast.success('เพิ่มบัญชีให้โรงเรียนสำเร็จ — รหัสผ่านเริ่มต้นคือรหัสโรงเรียน');
      setAddForm({ school_id: '', username: '', display_name: '' });
      setShowAddExisting(false);
      fetchAccounts();
    } catch (err) {
      toast.error(err.response?.data?.message || 'เพิ่มบัญชีไม่สำเร็จ');
    } finally { setAddingExisting(false); }
  }

  // ─── Manual single-add ────────────────────────────────────────────────
  function resetManual() {
    setManualForm({ school_code: '', school_name: '', username: '' });
    setShowManual(false);
  }

  async function handleManualCreate(e) {
    e.preventDefault();
    if (!/^\d{6,10}$/.test(manualForm.school_code)) { toast.error('รหัสโรงเรียนต้องเป็นตัวเลข 6-10 หลัก'); return; }
    if (!manualForm.school_name.trim())             { toast.error('กรุณากรอกชื่อโรงเรียน'); return; }
    if (!/^\d{6}$/.test(manualForm.username))       { toast.error('ชื่อผู้ใช้ต้องเป็นรหัส OBEC 6 หลัก'); return; }
    setSaving(true);
    try {
      await api.post('/affiliation/school-accounts/new-school', {
        school_code: manualForm.school_code,
        school_name: manualForm.school_name.trim(),
        username: manualForm.username,
      });
      toast.success('เพิ่มโรงเรียนและสร้างบัญชีสำเร็จ — รหัสผ่านเริ่มต้นคือรหัสโรงเรียน');
      resetManual();
      fetchAccounts();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถเพิ่มโรงเรียนได้');
    } finally { setSaving(false); }
  }

  // ─── Bulk: template download ──────────────────────────────────────────
  async function downloadTemplate() {
    try {
      const res = await api.get('/affiliation/school-accounts/import-template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'school_account_import_template.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('ดาวน์โหลดไฟล์ตัวอย่างไม่สำเร็จ');
    }
  }

  // ─── Bulk: preview ────────────────────────────────────────────────────
  function resetBulk() {
    setFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handlePreview() {
    if (!file) { toast.error('กรุณาเลือกไฟล์ก่อน'); return; }
    setPreviewing(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/affiliation/school-accounts/import/preview', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreview(res.data.data);
      const { valid, invalid, total } = res.data.data.summary;
      if (invalid === 0) {
        toast.success(`ตรวจสอบสำเร็จ: ผ่าน ${valid} / ${total} รายการ`);
      } else {
        toast.error(`ตรวจสอบเสร็จ: ผ่าน ${valid}, ไม่ผ่าน ${invalid} จาก ${total} รายการ`);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถตรวจสอบข้อมูลได้');
    } finally { setPreviewing(false); }
  }

  // ─── Bulk: commit ─────────────────────────────────────────────────────
  async function handleCommit() {
    if (!file) { toast.error('กรุณาเลือกไฟล์ก่อน'); return; }
    if (!preview)                  { toast.error('กรุณากดตรวจสอบข้อมูลก่อน'); return; }
    if (preview.summary.valid === 0) { toast.error('ไม่มีรายการที่ผ่านการตรวจสอบ'); return; }
    setConfirmCommit(false);
    setCommitting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/affiliation/school-accounts/import/commit', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const { created, skipped, total } = res.data.data.summary;
      toast.success(`นำเข้าสำเร็จ: สร้าง ${created} บัญชี, ข้าม ${skipped} จาก ${total} แถว`);
      resetBulk();
      fetchAccounts();
    } catch (err) {
      toast.error(err.response?.data?.message || 'นำเข้าไม่สำเร็จ');
    } finally { setCommitting(false); }
  }

  // ─── Render helpers ───────────────────────────────────────────────────
  const totalAccountPages = Math.max(1, Math.ceil(accounts.length / ACCOUNTS_PAGE_SIZE));
  useEffect(() => {
    setAccountsPage(page => Math.min(page, totalAccountPages));
  }, [totalAccountPages]);
  const accountStartIndex = (accountsPage - 1) * ACCOUNTS_PAGE_SIZE;
  const visibleAccounts = accounts.slice(accountStartIndex, accountStartIndex + ACCOUNTS_PAGE_SIZE);
  const accountRangeStart = accounts.length === 0 ? 0 : accountStartIndex + 1;
  const accountRangeEnd = Math.min(accountStartIndex + visibleAccounts.length, accounts.length);
  const accountPageNumbers = Array.from({ length: totalAccountPages }, (_, index) => index + 1);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        icon={School}
        title="เพิ่มโรงเรียนใหม่"
        subtitle="เพิ่มโรงเรียนในสังกัดและสร้างบัญชีเข้าสู่ระบบให้โรงเรียน"
      />

      {/* ─── Section A: เพิ่มทีละโรงเรียน ───────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-700">A. เพิ่มทีละโรงเรียน</h2>
          <button
            type="button"
            onClick={() => { setShowManual(s => !s); if (showManual) resetManual(); }}
            className="focus-ring text-sm font-medium px-3 min-h-[44px] rounded-lg border border-brand-300 text-brand-700 hover:bg-brand-50 active:bg-brand-100 transition"
          >
            {showManual ? 'ซ่อนฟอร์ม' : 'เปิดฟอร์ม'}
          </button>
        </div>

        {showManual && (
          <form onSubmit={handleManualCreate} className="mt-4 space-y-3">
            <FormField
              label="รหัสโรงเรียน"
              required
              value={manualForm.school_code}
              onChange={v => setManualForm({ ...manualForm, school_code: v.replace(/\D/g, '').slice(0, 10) })}
              placeholder="เช่น 1052520341"
              maxLength={10}
              inputMode="numeric"
              helper="6-10 หลัก · รหัสนี้จะถูกใช้เป็นรหัสผ่านเริ่มต้นโดยอัตโนมัติ"
              error={manualForm.school_code && manualForm.school_code.length < 6 ? 'ต้องมีอย่างน้อย 6 หลัก' : undefined}
            />
            <FormField
              label="ชื่อโรงเรียน"
              required
              value={manualForm.school_name}
              onChange={v => setManualForm({ ...manualForm, school_name: v })}
              placeholder="เช่น โรงเรียนบ้านตัวอย่าง"
            />
            <FormField
              label="ชื่อผู้ใช้"
              required
              value={manualForm.username}
              onChange={v => setManualForm({ ...manualForm, username: v.replace(/\D/g, '').slice(0, 6) })}
              maxLength={6}
              inputMode="numeric"
              placeholder="เช่น 520341"
              helper="รหัส OBEC 6 หลัก"
              error={manualForm.username && manualForm.username.length !== 6 ? 'ต้องเป็นตัวเลข 6 หลัก' : undefined}
            />
            <AlertBanner variant="info" title="รหัสผ่านเริ่มต้น">
              จะใช้ “รหัสโรงเรียน” โดยอัตโนมัติและถูกเข้ารหัสด้วย bcrypt —
              ผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก
            </AlertBanner>
            <button
              type="submit" disabled={saving}
              className="focus-ring bg-brand-600 hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50 disabled:pointer-events-none text-white text-sm font-semibold px-5 min-h-[44px] rounded-lg transition"
            >
              {saving ? 'กำลังเพิ่ม…' : 'เพิ่มโรงเรียนและสร้างบัญชี'}
            </button>
          </form>
        )}
      </section>

      {/* ─── Section A2: เพิ่มบัญชีให้โรงเรียนที่มีอยู่ ───────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-700">เพิ่มบัญชีให้โรงเรียนที่มีอยู่</h2>
          <button
            type="button"
            onClick={() => setShowAddExisting(s => !s)}
            className="focus-ring text-sm font-medium px-3 min-h-[44px] rounded-lg border border-brand-300 text-brand-700 hover:bg-brand-50 active:bg-brand-100 transition"
          >
            {showAddExisting ? 'ซ่อนฟอร์ม' : 'เปิดฟอร์ม'}
          </button>
        </div>
        {showAddExisting && (
          <form onSubmit={handleAddExisting} className="mt-4 space-y-3">
            <FormField label="โรงเรียน" required>
              {ctl => (
                <select
                  {...ctl}
                  value={addForm.school_id}
                  onChange={e => setAddForm({ ...addForm, school_id: e.target.value })}
                  className={CONTROL_CLS}
                  required
                >
                  <option value="">— เลือกโรงเรียนในสังกัด —</option>
                  {schools.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.id})</option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField
              label="ชื่อผู้ใช้"
              required
              value={addForm.username}
              onChange={v => setAddForm({ ...addForm, username: v.replace(/\D/g, '').slice(0, 6) })}
              maxLength={6}
              inputMode="numeric"
              placeholder="เช่น 520341"
              helper="รหัส OBEC 6 หลัก"
              error={addForm.username && addForm.username.length !== 6 ? 'ต้องเป็นตัวเลข 6 หลัก' : undefined}
            />
            <FormField
              label="ชื่อที่แสดง"
              helper="ไม่บังคับ"
              value={addForm.display_name}
              onChange={v => setAddForm({ ...addForm, display_name: v })}
              placeholder="เช่น บัญชีธุรการ"
            />
            <AlertBanner variant="info" title="สำหรับโรงเรียนที่อยู่ในระบบแล้ว">
              ใช้เมื่อโรงเรียนยังไม่มีบัญชี หรือต้องการบัญชีเพิ่ม — รหัสผ่านเริ่มต้นคือรหัสโรงเรียน
            </AlertBanner>
            <button
              type="submit" disabled={addingExisting}
              className="focus-ring bg-brand-600 hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50 disabled:pointer-events-none text-white text-sm font-semibold px-5 min-h-[44px] rounded-lg transition"
            >
              {addingExisting ? 'กำลังเพิ่ม…' : 'เพิ่มบัญชี'}
            </button>
          </form>
        )}
      </section>

      {/* ─── Section B: เพิ่มหลายโรงเรียนจาก Excel ───────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-base font-semibold text-gray-700">B. เพิ่มหลายโรงเรียนจาก Excel</h2>
          <button
            type="button"
            onClick={downloadTemplate}
            className="focus-ring text-sm font-medium px-3 min-h-[44px] rounded-lg border border-surface-border text-ink hover:bg-surface transition"
          >
            ดาวน์โหลดไฟล์ตัวอย่าง Excel
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <FormField label="เลือกไฟล์" helper=".xlsx หรือ .csv — สูงสุด 5 MB">
            {ctl => (
              <input
                {...ctl}
                ref={fileInputRef}
                type="file" accept=".xlsx,.csv"
                onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); }}
                className="focus-ring block w-full min-h-[44px] text-base text-ink-muted file:mr-3 file:h-11 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100 file:cursor-pointer"
              />
            )}
          </FormField>
          {file && (
            <p className="text-caption text-ink-muted">
              ไฟล์ที่เลือก: <span className="font-medium text-ink">{file.name}</span> ({Math.ceil(file.size / 1024)} KB)
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button" onClick={handlePreview} disabled={!file || previewing}
              className="focus-ring text-sm font-medium px-4 min-h-[44px] rounded-lg border border-brand-300 text-brand-700 hover:bg-brand-50 disabled:opacity-50 disabled:pointer-events-none transition"
            >
              {previewing ? 'กำลังตรวจสอบ…' : 'ตรวจสอบข้อมูล'}
            </button>
            {preview && (
              <>
                <button
                  type="button" onClick={() => setConfirmCommit(true)}
                  disabled={committing || preview.summary.valid === 0}
                  className="focus-ring text-sm font-semibold px-4 min-h-[44px] rounded-lg bg-success hover:opacity-90 text-white disabled:opacity-50 disabled:pointer-events-none transition"
                >
                  {committing ? 'กำลังนำเข้า…' : `ยืนยันนำเข้าเฉพาะรายการที่ผ่าน (${preview.summary.valid})`}
                </button>
                <button
                  type="button" onClick={resetBulk}
                  className="focus-ring text-sm font-medium px-4 min-h-[44px] rounded-lg border border-surface-border text-ink hover:bg-surface transition"
                >
                  เริ่มใหม่
                </button>
              </>
            )}
          </div>

          {preview && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-3 mt-4">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500">จำนวนทั้งหมด</p>
                  <p className="text-xl font-bold text-gray-800">{preview.summary.total}</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                  <p className="text-xs text-green-600">ผ่าน</p>
                  <p className="text-xl font-bold text-green-700">{preview.summary.valid}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                  <p className="text-xs text-red-600">ไม่ผ่าน</p>
                  <p className="text-xl font-bold text-red-700">{preview.summary.invalid}</p>
                </div>
              </div>

              <DataTable
                className="mt-3"
                caption="ตัวอย่างรายการที่จะนำเข้า"
                columns={[
                  { key: 'rowNum', header: 'แถว', numeric: true, cell: r => r.rowNum },
                  { key: 'school_code', header: 'รหัสโรงเรียน', secondary: true,
                    cell: r => <span className="font-mono text-xs">{r.school_code || '-'}</span> },
                  { key: 'school_name', header: 'ชื่อโรงเรียน', primary: true, cell: r => r.school_name || '-' },
                  { key: 'username', header: 'ชื่อผู้ใช้',
                    cell: r => <span className="font-mono text-xs">{r.username || '-'}</span> },
                  { key: 'status', header: 'สถานะ', align: 'center', badge: true,
                    cell: r => (
                      <StatusBadge variant={r.status === 'ok' ? 'success' : 'danger'} size="sm">
                        {r.status === 'ok' ? 'ผ่าน' : 'ไม่ผ่าน'}
                      </StatusBadge>
                    ) },
                  { key: 'errors', header: 'ข้อความ',
                    cell: r => (r.errors.length === 0 ? '-' : r.errors.map(e => e.message).join(', ')) },
                ]}
                rows={preview.rows}
                rowKey={r => r.rowNum}
                rowClassName={r => (r.status === 'ok' ? undefined : 'bg-danger-soft/30')}
                empty={{ title: 'ไม่มีรายการในไฟล์' }}
              />
            </>
          )}

          <AlertBanner variant="warn" title="รหัสผ่านหลังนำเข้า">
            รหัสผ่านเริ่มต้นถูกเข้ารหัสด้วย bcrypt และผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก
            ระบบจะไม่บันทึกหรือส่งคืนรหัสผ่านในรูปแบบ plaintext
          </AlertBanner>
        </div>
      </section>

      {/* ─── Section C: บัญชีที่สร้างล่าสุด (read-only) ──────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-base font-semibold text-gray-700 mb-3">บัญชีที่สร้างล่าสุด</h2>
        {loading ? (
          <LoadingState compact />
        ) : visibleAccounts.length === 0 ? (
          <EmptyState title="ยังไม่มีบัญชีโรงเรียน" compact />
        ) : (
          <DataTable
            caption="บัญชีโรงเรียนที่สร้างล่าสุด"
            columns={[
              { key: 'school_name', header: 'โรงเรียน', primary: true, cell: a => a.school_name },
              { key: 'username', header: 'ชื่อผู้ใช้', secondary: true,
                cell: a => <span className="font-mono text-xs">{a.username}</span> },
              { key: 'is_active', header: 'สถานะ', align: 'center', badge: true,
                cell: a => (
                  <StatusBadge variant={a.is_active ? 'success' : 'neutral'} size="sm">
                    {a.is_active ? 'ใช้งาน' : 'ปิด'}
                  </StatusBadge>
                ) },
            ]}
            rows={visibleAccounts}
            actions={a => (
              <>
                <TableAction
                  tone="brand"
                  onClick={() => { setResetTarget(a); setResetForm({ password: '', confirm: '' }); }}
                >
                  รีเซ็ตรหัส
                </TableAction>
                <TableAction
                  tone={a.is_active ? 'warn' : 'neutral'}
                  disabled={togglingId === a.id}
                  onClick={() => setConfirmToggle(a)}
                >
                  {togglingId === a.id ? '…' : a.is_active ? 'ปิดบัญชี' : 'เปิดบัญชี'}
                </TableAction>
              </>
            )}
          />
        )}
        {accounts.length > ACCOUNTS_PAGE_SIZE && (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-gray-500">
              แสดง {accountRangeStart}-{accountRangeEnd} จากทั้งหมด {accounts.length} บัญชี
            </p>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <button
                type="button"
                disabled={accountsPage === 1}
                onClick={() => setAccountsPage(page => Math.max(1, page - 1))}
                className="focus-ring min-h-[44px] rounded-lg border border-surface-border px-3 text-sm font-medium text-ink transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
              >
                ก่อนหน้า
              </button>
              {accountPageNumbers.map(page => (
                <button
                  key={page}
                  type="button"
                  aria-current={page === accountsPage ? 'page' : undefined}
                  onClick={() => setAccountsPage(page)}
                  className={`focus-ring min-h-[44px] min-w-[44px] rounded-lg border px-2.5 text-sm font-medium transition ${
                    page === accountsPage
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-surface-border text-ink hover:bg-surface'
                  }`}
                >
                  {page}
                </button>
              ))}
              <button
                type="button"
                disabled={accountsPage === totalAccountPages}
                onClick={() => setAccountsPage(page => Math.min(totalAccountPages, page + 1))}
                className="focus-ring min-h-[44px] rounded-lg border border-surface-border px-3 text-sm font-medium text-ink transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
              >
                ถัดไป
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ─── Reset password modal ──────────────────────────────────────── */}
      <Modal
        open={Boolean(resetTarget)}
        title="รีเซ็ตรหัสผ่านบัญชีโรงเรียน"
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
              form="reset-password-form"
              disabled={resetting || resetForm.password.length < 8 || resetForm.password !== resetForm.confirm}
              className="focus-ring text-sm font-semibold px-4 min-h-[44px] rounded-lg bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white transition disabled:opacity-50 disabled:pointer-events-none"
            >
              {resetting ? 'กำลังรีเซ็ต…' : 'รีเซ็ตรหัสผ่าน'}
            </button>
          </>
        }
      >
        <p className="text-sm text-ink-muted mb-4">
          {resetTarget?.school_name} · <span className="font-mono text-xs">{resetTarget?.username}</span>
        </p>
        <form
          id="reset-password-form"
          onSubmit={e => { e.preventDefault(); handleReset(); }}
          className="space-y-3"
        >
          <FormField
            label="รหัสผ่านใหม่"
            type="password"
            required
            autoComplete="new-password"
            helper="อย่างน้อย 8 ตัวอักษร"
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

      <ConfirmDialog
        open={confirmCommit}
        tone="brand"
        title="ยืนยันนำเข้าบัญชีโรงเรียน?"
        description={preview
          ? `ระบบจะนำเข้า ${preview.summary.valid} รายการที่ผ่าน และข้าม ${preview.summary.invalid} รายการที่ไม่ผ่าน`
          : undefined}
        confirmLabel="นำเข้า"
        loading={committing}
        onConfirm={handleCommit}
        onCancel={() => setConfirmCommit(false)}
      />

      <ConfirmDialog
        open={Boolean(confirmToggle)}
        tone={confirmToggle?.is_active ? 'danger' : 'brand'}
        title={confirmToggle?.is_active ? 'ปิดบัญชีนี้?' : 'เปิดบัญชีนี้?'}
        itemName={confirmToggle ? `${confirmToggle.school_name} · ${confirmToggle.username}` : undefined}
        description={confirmToggle?.is_active
          ? 'โรงเรียนจะเข้าสู่ระบบด้วยบัญชีนี้ไม่ได้จนกว่าจะเปิดใช้งานอีกครั้ง ข้อมูลของโรงเรียนไม่ถูกลบ'
          : 'โรงเรียนจะกลับมาเข้าสู่ระบบด้วยบัญชีนี้ได้ทันที'}
        confirmLabel={confirmToggle?.is_active ? 'ปิดบัญชี' : 'เปิดบัญชี'}
        loading={togglingId === confirmToggle?.id}
        onConfirm={() => handleToggle(confirmToggle)}
        onCancel={() => setConfirmToggle(null)}
      />
    </div>
  );
}
