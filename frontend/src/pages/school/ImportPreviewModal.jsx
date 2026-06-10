import { useMemo, useState } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

// Phase 10.13A-26B — student import preview / confirm-apply workflow UI.
// Preview NEVER writes student data; apply requires an explicit click and only
// touches can_apply rows. Mirrors the 10.13A-26A backend classifications.

// classification → { label (Thai), tone }. Tones are semantic: emerald=ready,
// slate=neutral duplicate (NOT danger), amber=needs-confirmation, red=real
// blocker, blue=already-applied/info.
const CLASS_META = {
  INSERT_NEW: { label: 'พร้อมนำเข้า', tone: 'emerald' },
  CROSS_SCHOOL_SAME_CODE_ALLOWED: { label: 'รหัสซ้ำต่างโรงเรียน แต่นำเข้าได้', tone: 'emerald' },
  SKIP_DUPLICATE_SAME_SCHOOL: { label: 'มีอยู่แล้วในโรงเรียนนี้', tone: 'slate' },
  GUARDIAN_MISMATCH: { label: 'ผู้ปกครองไม่ตรง', tone: 'amber' },
  SOFT_DELETED_SAME_SCHOOL_REACTIVATE: { label: 'เคยถูกลบ ต้องยืนยันกู้คืน', tone: 'amber' },
  VEHICLE_NOT_FOUND: { label: 'ไม่พบรถ', tone: 'red' },
  VEHICLE_MISSING_PROVINCE: { label: 'ขาดจังหวัดทะเบียน', tone: 'red' },
  VEHICLE_SOFT_DELETED: { label: 'รถถูกปิดใช้งาน', tone: 'red' },
  INVALID_STUDENT_CODE: { label: 'รหัสนักเรียนผิด', tone: 'red' },
  INVALID_REQUIRED_FIELD: { label: 'ข้อมูลไม่ครบ', tone: 'red' },
  INVALID_GUARDIAN_PHONE: { label: 'เบอร์ผู้ปกครองผิด', tone: 'red' },
  APPLIED: { label: 'นำเข้าสำเร็จ', tone: 'emerald' },
  ALREADY_APPLIED: { label: 'นำเข้าแล้ว', tone: 'blue' },
  APPLY_FAILED: { label: 'นำเข้าไม่สำเร็จ', tone: 'red' },
};
const TONE = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  slate: 'bg-slate-50 text-slate-600 border-slate-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
};
const metaFor = (c) => CLASS_META[c] || { label: c, tone: 'slate' };

const FILTERS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'ready', label: 'พร้อมนำเข้า' },
  { key: 'error', label: 'ข้อผิดพลาด' },
  { key: 'warning', label: 'คำเตือน' },
  { key: 'vehicle', label: 'รถมีปัญหา' },
  { key: 'guardian', label: 'ผู้ปกครองไม่ตรง' },
  { key: 'duplicate', label: 'รายการซ้ำ' },
  { key: 'applied', label: 'นำเข้าแล้ว' },
];
function matchesFilter(r, f) {
  switch (f) {
    case 'ready': return r.can_apply && !['APPLIED', 'ALREADY_APPLIED'].includes(r.status);
    case 'error': return r.status === 'ERROR' || r.classification === 'APPLY_FAILED';
    case 'warning': return r.status === 'WARNING';
    case 'vehicle': return String(r.classification).startsWith('VEHICLE_');
    case 'guardian': return r.classification === 'GUARDIAN_MISMATCH';
    case 'duplicate': return r.classification === 'SKIP_DUPLICATE_SAME_SCHOOL';
    case 'applied': return ['APPLIED', 'ALREADY_APPLIED'].includes(r.status);
    default: return true;
  }
}

export default function ImportPreviewModal({ open, onClose, onApplied }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [batchId, setBatchId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState(null);          // null = upload step
  const [filter, setFilter] = useState('all');
  const [confirming, setConfirming] = useState(false);
  const [applyResult, setApplyResult] = useState(null);

  const canApplyCount = useMemo(() => (rows || []).filter((r) => r.can_apply && !['APPLIED', 'ALREADY_APPLIED'].includes(r.status)).length, [rows]);
  const errorCount = useMemo(() => (rows || []).filter((r) => r.status === 'ERROR' || r.classification === 'APPLY_FAILED').length, [rows]);
  const vehicleIssues = useMemo(() => (rows || []).filter((r) => String(r.classification).startsWith('VEHICLE_')).length, [rows]);
  const guardianIssues = useMemo(() => (rows || []).filter((r) => r.classification === 'GUARDIAN_MISMATCH').length, [rows]);
  const filtered = useMemo(() => (rows || []).filter((r) => matchesFilter(r, filter)), [rows, filter]);

  if (!open) return null;

  function reset() {
    setFile(null); setBusy(false); setError(''); setBatchId(null);
    setSummary(null); setRows(null); setFilter('all'); setConfirming(false); setApplyResult(null);
  }
  function close() { reset(); onClose(); }

  function pickFile(f) {
    setError('');
    if (f && !/\.(csv|xlsx?|)$/i.test(f.name)) { setError('รองรับเฉพาะไฟล์ CSV หรือ Excel (.xlsx) เท่านั้น'); return; }
    setFile(f || null);
  }

  async function runPreview() {
    if (!file) { setError('กรุณาเลือกไฟล์ก่อน'); return; }
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/school/students/import/preview', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const d = res.data.data;
      if (!d.rows || d.rows.length === 0) { setError('ไม่พบข้อมูลในไฟล์ (ไม่มีแถวข้อมูล)'); setBusy(false); return; }
      setBatchId(d.batch_id); setSummary(d.summary); setRows(d.rows); setFilter('all');
    } catch (err) {
      const status = err.response?.status;
      if (status === 403) setError('ไม่สามารถเข้าถึงชุดนำเข้านี้ได้');
      else if (err.code === 'ECONNABORTED') setError('การเชื่อมต่อหมดเวลา กรุณาลองใหม่อีกครั้ง');
      else setError(err.response?.data?.message || 'ตรวจสอบไฟล์ไม่สำเร็จ กรุณาลองใหม่');
    } finally { setBusy(false); }
  }

  async function runApply() {
    setBusy(true); setError(''); setConfirming(false);
    try {
      const res = await api.post(`/school/students/import/${batchId}/apply`);
      setApplyResult(res.data.data);
      // Refresh row statuses from the persisted report.
      const rep = await api.get(`/school/students/import/${batchId}/report`);
      const byRow = Object.fromEntries(rep.data.data.rows.map((x) => [x.row_number, x]));
      setRows((prev) => prev.map((r) => {
        const u = byRow[r.row_number];
        return u ? { ...r, status: u.status, classification: u.classification, can_apply: false } : r;
      }));
      toast.success('นำเข้าข้อมูลสำเร็จ กรุณาตรวจสอบจำนวนในหน้ารายชื่อนักเรียน');
      onApplied?.();
    } catch (err) {
      const status = err.response?.status;
      if (status === 403) setError('ไม่สามารถเข้าถึงชุดนำเข้านี้ได้');
      else setError(err.response?.data?.message || 'นำเข้าข้อมูลไม่สำเร็จ — รายการพรีวิวยังอยู่ กรุณาลองใหม่');
    } finally { setBusy(false); }
  }

  function downloadReport() {
    const cols = ['row_number', 'student_code', 'student_name', 'classification', 'status', 'message_th', 'input_vehicle_plate', 'matched_display_plate', 'guardian_mismatch', 'action_required'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.join(',')];
    for (const r of rows) {
      lines.push(cols.map((c) => esc(c === 'guardian_mismatch' ? (r.guardian_mismatch ? 'yes' : 'no') : r[c])).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `import-report-${batchId}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const applied = !!applyResult;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4" onClick={close}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">ตรวจสอบไฟล์ก่อนนำเข้า</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              {rows ? 'ขั้นตอนนี้เป็นการตรวจสอบข้อมูลเท่านั้น ระบบยังไม่บันทึกข้อมูลนักเรียน' : 'อัปโหลดไฟล์ CSV หรือ Excel (.xlsx) เพื่อตรวจสอบรายแถวก่อนนำเข้าจริง'}
            </p>
          </div>
          <button onClick={close} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4">
          {/* ── Upload step ── */}
          {!rows && (
            <div className="space-y-4 max-w-md mx-auto">
              <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center">
                <input type="file" accept=".xlsx,.xls,.csv"
                  onChange={(e) => pickFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border file:border-gray-200 file:text-sm file:bg-gray-50 file:text-gray-700 hover:file:bg-gray-100" />
                {file && <p className="text-sm text-emerald-600 mt-2">{file.name}</p>}
              </div>
              {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}
              <button onClick={runPreview} disabled={busy || !file}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium py-3 rounded-lg transition">
                {busy ? 'กำลังตรวจสอบ…' : 'ตรวจสอบไฟล์ก่อนนำเข้า'}
              </button>
              <a href="/templates/student_import_template_th.csv" download="แบบฟอร์มนำเข้านักเรียน.csv"
                className="block text-center text-sm text-blue-600 hover:text-blue-800 py-1">ดาวน์โหลดไฟล์ตัวอย่าง</a>
            </div>
          )}

          {/* ── Preview step ── */}
          {rows && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800">
                {applied
                  ? `นำเข้าสำเร็จ ${applyResult.applied} รายการ${applyResult.already_applied ? ` · มีอยู่แล้ว ${applyResult.already_applied}` : ''}${applyResult.failed ? ` · ไม่สำเร็จ ${applyResult.failed}` : ''} — กรุณาตรวจสอบจำนวนในหน้ารายชื่อนักเรียน`
                  : 'ระบบยังไม่ได้บันทึกข้อมูลนักเรียน กรุณาตรวจสอบรายการด้านล่างก่อนกดยืนยันนำเข้า'}
                <span className="text-blue-400"> · ชุดนำเข้า #{batchId}</span>
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                <SummaryCard label="ทั้งหมด" value={summary.total} tone="slate" />
                <SummaryCard label="พร้อมนำเข้า" value={canApplyCount} tone="emerald" />
                <SummaryCard label="ซ้ำในโรงเรียน" value={summary.skip} tone="slate" />
                <SummaryCard label="คำเตือน" value={summary.warning} tone="amber" />
                <SummaryCard label="ข้อผิดพลาด" value={errorCount} tone="red" />
                <SummaryCard label="รถมีปัญหา" value={vehicleIssues} tone="red" />
              </div>

              {/* Filters */}
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => (
                  <button key={f.key} onClick={() => setFilter(f.key)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition ${filter === f.key ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                    {f.label}
                  </button>
                ))}
              </div>

              {/* Row table */}
              <div className="border border-gray-100 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-[42vh]">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs sticky top-0">
                      <tr>
                        <th className="text-left font-medium px-3 py-2">แถว</th>
                        <th className="text-left font-medium px-3 py-2">รหัส</th>
                        <th className="text-left font-medium px-3 py-2">ชื่อนักเรียน</th>
                        <th className="text-left font-medium px-3 py-2">ทะเบียนในไฟล์</th>
                        <th className="text-left font-medium px-3 py-2">รถที่จับคู่ได้</th>
                        <th className="text-left font-medium px-3 py-2">สถานะ</th>
                        <th className="text-left font-medium px-3 py-2">คำอธิบาย / สิ่งที่ต้องทำ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filtered.map((r) => {
                        const m = metaFor(r.classification);
                        return (
                          <tr key={r.row_number} className="hover:bg-gray-50/50">
                            <td className="px-3 py-2 text-gray-400 tabular-nums">{r.row_number}</td>
                            <td className="px-3 py-2 text-gray-700 tabular-nums">{r.student_code}</td>
                            <td className="px-3 py-2 text-gray-800">{r.student_name || '—'}</td>
                            <td className="px-3 py-2 text-gray-500">{r.input_vehicle_plate || '—'}</td>
                            <td className="px-3 py-2 text-gray-500">{r.matched_display_plate || '—'}</td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <span className={`text-xs px-2 py-0.5 rounded-full border ${TONE[m.tone]}`}>{m.label}</span>
                            </td>
                            <td className="px-3 py-2 text-gray-600">
                              <div>{r.message_th}</div>
                              {r.action_required && <div className="text-xs text-amber-600 mt-0.5">ต้องทำ: {r.action_required}</div>}
                            </td>
                          </tr>
                        );
                      })}
                      {filtered.length === 0 && (
                        <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400 text-sm">ไม่มีรายการในตัวกรองนี้</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}
            </div>
          )}
        </div>

        {/* Footer actions */}
        {rows && (
          <div className="px-5 sm:px-6 py-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-gray-500">
              {applied ? 'นำเข้าเสร็จสิ้น' : <>ระบบจะนำเข้าเฉพาะ <span className="font-semibold text-emerald-600">{canApplyCount}</span> รายการที่พร้อม · รายการที่มีปัญหาจะยังไม่ถูกบันทึก</>}
            </div>
            <div className="flex gap-2">
              <button onClick={downloadReport} className="text-sm text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg transition">ดาวน์โหลดรายงาน (CSV)</button>
              {!applied
                ? <button onClick={() => setConfirming(true)} disabled={busy || canApplyCount === 0}
                    className="text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-medium px-4 py-2 rounded-lg transition">
                    ยืนยันนำเข้ารายการที่พร้อม
                  </button>
                : <button onClick={close} className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg transition">เสร็จสิ้น</button>}
            </div>
          </div>
        )}

        {/* Confirm-apply modal */}
        {confirming && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirming(false)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-base font-semibold text-gray-800 mb-2">ยืนยันการนำเข้า</h3>
              <div className="text-sm text-gray-600 space-y-1 mb-3">
                <div className="flex justify-between"><span>ชุดนำเข้า</span><span className="text-gray-400">#{batchId}</span></div>
                <div className="flex justify-between"><span>จะนำเข้า</span><span className="font-semibold text-emerald-600">{canApplyCount} รายการ</span></div>
                <div className="flex justify-between"><span>ข้ามรายการซ้ำ</span><span className="text-slate-500">{summary.skip}</span></div>
                <div className="flex justify-between"><span>มีปัญหา (ไม่นำเข้า)</span><span className="text-red-500">{errorCount}</span></div>
              </div>
              <p className="text-xs text-gray-400 mb-4">ระบบจะนำเข้าเฉพาะรายการที่พร้อมเท่านั้น</p>
              <div className="flex gap-2">
                <button onClick={runApply} disabled={busy}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg transition">
                  {busy ? 'กำลังนำเข้า…' : 'ยืนยันนำเข้า'}
                </button>
                <button onClick={() => setConfirming(false)} className="px-4 text-gray-500 hover:text-gray-700 text-sm py-2.5 transition">ยกเลิก</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${TONE[tone]}`}>
      <div className="text-xl font-bold tabular-nums leading-none">{value}</div>
      <div className="text-xs font-medium mt-1 opacity-80">{label}</div>
    </div>
  );
}
