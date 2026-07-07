import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../api/axios';
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
  const [schools, setSchools] = useState([]);
  const [showAddExisting, setShowAddExisting] = useState(false);
  const [addForm, setAddForm] = useState({ school_id: '', username: '', display_name: '' });
  const [addingExisting, setAddingExisting] = useState(false);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await api.get('/affiliation/school-accounts');
      setAccounts(res.data.data || []);
    } catch {
      /* keep page usable even if list fails */
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSchools = useCallback(async () => {
    try {
      const res = await api.get('/affiliation/schools');
      setSchools(res.data.data || []);
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
    if (!window.confirm(`ยืนยันนำเข้า ${preview.summary.valid} รายการที่ผ่าน? ระบบจะข้าม ${preview.summary.invalid} รายการที่ไม่ผ่าน`)) return;
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
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800">เพิ่มโรงเรียนใหม่</h1>
        <p className="text-sm text-gray-500 mt-1">
          เพิ่มโรงเรียนในสังกัดและสร้างบัญชีเข้าสู่ระบบให้โรงเรียน
        </p>
      </div>

      {/* ─── Section A: เพิ่มทีละโรงเรียน ───────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-700">A. เพิ่มทีละโรงเรียน</h2>
          <button
            type="button"
            onClick={() => { setShowManual(s => !s); if (showManual) resetManual(); }}
            className="text-sm font-medium px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 transition"
          >
            {showManual ? 'ซ่อนฟอร์ม' : 'เปิดฟอร์ม'}
          </button>
        </div>

        {showManual && (
          <form onSubmit={handleManualCreate} className="mt-4 space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">รหัสโรงเรียน (6-10 หลัก) <span className="text-red-500">*</span></label>
              <input
                type="text" value={manualForm.school_code}
                onChange={e => setManualForm({ ...manualForm, school_code: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                placeholder="เช่น 1052520341" maxLength={10}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" required
              />
              <p className="text-xs text-gray-400 mt-1">รหัสนี้จะถูกใช้เป็นรหัสผ่านเริ่มต้นโดยอัตโนมัติ</p>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">ชื่อโรงเรียน <span className="text-red-500">*</span></label>
              <input
                type="text" value={manualForm.school_name}
                onChange={e => setManualForm({ ...manualForm, school_name: e.target.value })}
                placeholder="เช่น โรงเรียนบ้านตัวอย่าง"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">ชื่อผู้ใช้ (รหัส OBEC 6 หลัก) <span className="text-red-500">*</span></label>
              <input
                type="text" value={manualForm.username}
                onChange={e => setManualForm({ ...manualForm, username: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                required pattern="\d{6}" maxLength={6} placeholder="เช่น 520341"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
              รหัสผ่านเริ่มต้นจะใช้ "รหัสโรงเรียน" โดยอัตโนมัติและจะถูกเข้ารหัสด้วย bcrypt — ผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก
            </div>
            <button
              type="submit" disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
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
            className="text-sm font-medium px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 transition"
          >
            {showAddExisting ? 'ซ่อนฟอร์ม' : 'เปิดฟอร์ม'}
          </button>
        </div>
        {showAddExisting && (
          <form onSubmit={handleAddExisting} className="mt-4 space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">โรงเรียน <span className="text-red-500">*</span></label>
              <select
                value={addForm.school_id}
                onChange={e => setAddForm({ ...addForm, school_id: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" required
              >
                <option value="">— เลือกโรงเรียนในสังกัด —</option>
                {schools.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.id})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">ชื่อผู้ใช้ (รหัส OBEC 6 หลัก) <span className="text-red-500">*</span></label>
              <input
                type="text" value={addForm.username}
                onChange={e => setAddForm({ ...addForm, username: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                required pattern="\d{6}" maxLength={6} placeholder="เช่น 520341"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">ชื่อที่แสดง (ไม่บังคับ)</label>
              <input
                type="text" value={addForm.display_name}
                onChange={e => setAddForm({ ...addForm, display_name: e.target.value })}
                placeholder="เช่น บัญชีธุรการ"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
              ใช้สำหรับโรงเรียนที่อยู่ในระบบแล้วแต่ยังไม่มีบัญชี (หรือต้องการบัญชีเพิ่ม) — รหัสผ่านเริ่มต้นคือรหัสโรงเรียน
            </div>
            <button
              type="submit" disabled={addingExisting}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
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
            className="text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition"
          >
            ดาวน์โหลดไฟล์ตัวอย่าง Excel
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">เลือกไฟล์ (.xlsx หรือ .csv) — สูงสุด 5 MB</label>
            <input
              ref={fileInputRef}
              type="file" accept=".xlsx,.csv"
              onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); }}
              className="w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            {file && (
              <p className="text-xs text-gray-500 mt-1">
                ไฟล์ที่เลือก: <span className="font-medium">{file.name}</span> ({Math.ceil(file.size / 1024)} KB)
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button" onClick={handlePreview} disabled={!file || previewing}
              className="text-sm font-medium px-4 py-2 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50 transition"
            >
              {previewing ? 'กำลังตรวจสอบ…' : 'ตรวจสอบข้อมูล'}
            </button>
            {preview && (
              <>
                <button
                  type="button" onClick={handleCommit}
                  disabled={committing || preview.summary.valid === 0}
                  className="text-sm font-medium px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 transition"
                >
                  {committing ? 'กำลังนำเข้า…' : `ยืนยันนำเข้าเฉพาะรายการที่ผ่าน (${preview.summary.valid})`}
                </button>
                <button
                  type="button" onClick={resetBulk}
                  className="text-sm font-medium px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition"
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

              {/* Preview table */}
              <div className="mt-3 max-h-96 overflow-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm min-w-[560px]">
                  <thead className="sticky top-0 bg-gray-50 text-gray-500 text-xs">
                    <tr>
                      <th className="px-3 py-2 font-medium text-left">แถว</th>
                      <th className="px-3 py-2 font-medium text-left">รหัสโรงเรียน</th>
                      <th className="px-3 py-2 font-medium text-left">ชื่อโรงเรียน</th>
                      <th className="px-3 py-2 font-medium text-left">ชื่อผู้ใช้</th>
                      <th className="px-3 py-2 font-medium text-center">สถานะ</th>
                      <th className="px-3 py-2 font-medium text-left">ข้อความ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.rows.map(r => (
                      <tr key={r.rowNum} className={r.status === 'ok' ? 'hover:bg-green-50/30' : 'bg-red-50/20'}>
                        <td className="px-3 py-2 text-gray-500">{r.rowNum}</td>
                        <td className="px-3 py-2 text-gray-700 font-mono text-xs">{r.school_code || '-'}</td>
                        <td className="px-3 py-2 text-gray-700">{r.school_name || '-'}</td>
                        <td className="px-3 py-2 text-gray-600 font-mono text-xs">{r.username || '-'}</td>
                        <td className="px-3 py-2 text-center">
                          {r.status === 'ok'
                            ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">ผ่าน</span>
                            : <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">ไม่ผ่าน</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500">
                          {r.errors.length === 0 ? '-' : r.errors.map(e => e.message).join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800">
            รหัสผ่านเริ่มต้นจะถูกเข้ารหัสด้วย bcrypt และผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก ระบบจะไม่บันทึกหรือส่งคืนรหัสผ่านในรูปแบบ plaintext หลังนำเข้า
          </div>
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
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">โรงเรียน</th>
                  <th className="px-3 py-2 font-medium">ชื่อผู้ใช้</th>
                  <th className="px-3 py-2 font-medium text-center">สถานะ</th>
                  <th className="px-3 py-2 font-medium text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleAccounts.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-800">{a.school_name}</td>
                    <td className="px-3 py-2 text-gray-600 font-mono text-xs">{a.username}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${a.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {a.is_active ? 'ใช้งาน' : 'ปิด'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => { setResetTarget(a); setResetForm({ password: '', confirm: '' }); }}
                          className="text-xs font-medium px-2.5 py-1 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 transition"
                        >
                          รีเซ็ตรหัส
                        </button>
                        <button
                          type="button"
                          disabled={togglingId === a.id}
                          onClick={() => handleToggle(a)}
                          className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition disabled:opacity-50 ${
                            a.is_active
                              ? 'border-amber-300 text-amber-700 hover:bg-amber-50'
                              : 'border-green-300 text-green-700 hover:bg-green-50'
                          }`}
                        >
                          {togglingId === a.id ? '…' : a.is_active ? 'ปิดบัญชี' : 'เปิดบัญชี'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                className="min-h-[32px] rounded-lg border border-gray-300 px-3 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ก่อนหน้า
              </button>
              {accountPageNumbers.map(page => (
                <button
                  key={page}
                  type="button"
                  aria-current={page === accountsPage ? 'page' : undefined}
                  onClick={() => setAccountsPage(page)}
                  className={`min-h-[32px] min-w-[34px] rounded-lg border px-2.5 text-xs font-medium transition ${
                    page === accountsPage
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {page}
                </button>
              ))}
              <button
                type="button"
                disabled={accountsPage === totalAccountPages}
                onClick={() => setAccountsPage(page => Math.min(totalAccountPages, page + 1))}
                className="min-h-[32px] rounded-lg border border-gray-300 px-3 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ถัดไป
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ─── Reset password modal ──────────────────────────────────────── */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setResetTarget(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-800">รีเซ็ตรหัสผ่านบัญชีโรงเรียน</h3>
            <p className="mt-1 text-sm text-gray-500">{resetTarget.school_name} · <span className="font-mono text-xs">{resetTarget.username}</span></p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)</label>
                <input
                  type="password" value={resetForm.password}
                  onChange={e => setResetForm({ ...resetForm, password: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">ยืนยันรหัสผ่านใหม่</label>
                <input
                  type="password" value={resetForm.confirm}
                  onChange={e => setResetForm({ ...resetForm, confirm: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setResetTarget(null)}
                className="text-sm font-medium px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
                ยกเลิก
              </button>
              <button type="button" disabled={resetting} onClick={handleReset}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition">
                {resetting ? 'กำลังรีเซ็ต…' : 'รีเซ็ตรหัสผ่าน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
