import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

/**
 * เพิ่มโรงเรียนใหม่ — Phase 10.2A
 *
 * Two ways to add school accounts:
 *   A) Manual single-school form (school_code + school_name + username)
 *   B) Bulk Excel/CSV import (download template → preview → commit)
 *
 * The page deliberately drops the previous "โรงเรียนที่มีอยู่แล้ว" mode and
 * the per-row reset/toggle controls — those endpoints still exist on the
 * backend but live elsewhere if operators need them. The page below stays
 * focused on the new-school workflow.
 */
export default function AffSchoolAccounts() {
  const [accounts, setAccounts] = useState([]);
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

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

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
  const recentAccounts = accounts.slice(0, 10);

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
              <div className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
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
          <p className="text-gray-400 py-6 text-center text-sm">กำลังโหลด…</p>
        ) : recentAccounts.length === 0 ? (
          <p className="text-gray-400 py-6 text-center text-sm">ยังไม่มีบัญชีโรงเรียน</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">โรงเรียน</th>
                  <th className="px-3 py-2 font-medium">ชื่อผู้ใช้</th>
                  <th className="px-3 py-2 font-medium text-center">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recentAccounts.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-800">{a.school_name}</td>
                    <td className="px-3 py-2 text-gray-600 font-mono text-xs">{a.username}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${a.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {a.is_active ? 'ใช้งาน' : 'ปิด'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {accounts.length > recentAccounts.length && (
          <p className="text-xs text-gray-400 mt-2 text-right">แสดง {recentAccounts.length} จากทั้งหมด {accounts.length} บัญชี</p>
        )}
      </section>
    </div>
  );
}
