import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Download, Upload } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import {
  AlertBanner, ConfirmDialog, DataTable, FilterBar, FormField, Modal, StatusBadge,
} from '../../components/ui';

const THAI_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function fmtThaiDate(isoYmd) {
  if (!isoYmd) return '';
  const [y, m, d] = String(isoYmd).slice(0, 10).split('-').map(Number);
  return `${d} ${THAI_MON[m - 1]} ${y + 543}`;
}

// Phase 10.13A-26B — student import preview / confirm-apply workflow UI.
// Preview NEVER writes student data; apply requires an explicit click and only
// touches can_apply rows. Mirrors the 10.13A-26A backend classifications.

// classification → { label (Thai), tone }. Tones are semantic: emerald=ready,
// slate=neutral duplicate (NOT danger), amber=needs-confirmation, red=real
// blocker, blue=already-applied/info.
const CLASS_META = {
  INSERT_NEW: { label: 'พร้อมนำเข้า', tone: 'emerald' },
  INSERT_NEW_AUTO_VEHICLE: { label: 'พร้อมนำเข้า + สร้างรถ', tone: 'emerald' },
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
// The classification tones above are the vocabulary this file was written in;
// they map onto the design system's semantic variants rather than being
// replaced, so the emerald=ready / slate=neutral-duplicate / amber=needs-
// confirmation / red=blocker / blue=already-applied reading is preserved.
const VARIANT = {
  emerald: 'success',
  slate: 'neutral',
  amber: 'warn',
  red: 'danger',
  blue: 'info',
};
const SUMMARY_TONE = {
  emerald: 'bg-success-soft text-success-ink border-success/30',
  slate:   'bg-surface text-ink-muted border-surface-border',
  amber:   'bg-warn-soft text-warn-ink border-warn/30',
  red:     'bg-danger-soft text-danger-ink border-danger/30',
  blue:    'bg-info-soft text-info-ink border-info/30',
};
// After apply, prefer the row STATUS for the badge (the classification stays the
// original, e.g. GUARDIAN_MISMATCH, while status becomes GUARDIAN_UPDATED).
const STATUS_META = {
  APPLIED: { label: 'นำเข้าแล้ว', tone: 'emerald' },
  GUARDIAN_UPDATED: { label: 'อัปเดตผู้ปกครองแล้ว', tone: 'emerald' },
  REACTIVATED: { label: 'กู้คืนนักเรียนแล้ว', tone: 'emerald' },
  ALREADY_APPLIED: { label: 'มีอยู่แล้ว', tone: 'blue' },
  STALE_NEEDS_REPREVIEW: { label: 'ต้องพรีวิวใหม่', tone: 'amber' },
  VEHICLE_BLOCKED: { label: 'ติดปัญหารถ', tone: 'red' },
  APPLY_FAILED: { label: 'ไม่สำเร็จ', tone: 'red' },
};
const metaFor = (c) => CLASS_META[c] || { label: c, tone: 'slate' };
const badgeFor = (r) => STATUS_META[r.status] || metaFor(r.classification);

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
  // Phase 10.13B-4 — explicit per-row selection for the two confirmed modes.
  const [selGuardian, setSelGuardian] = useState(() => new Set());
  const [selReactivate, setSelReactivate] = useState(() => new Set());
  const [requestedVehicle, setRequestedVehicle] = useState(() => new Set());   // 10.13B-7 restore-requested rows
  const [autoCreateVehicle, setAutoCreateVehicle] = useState(false);
  const [term, setTerm] = useState(null);          // current academic term (date-derived)

  // Tell schools which term today's rows will be tagged as — the term is derived
  // server-side from the entry date, so this banner is the only place they see it.
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    api.get('/terms/current')
      .then((res) => { if (alive) setTerm(res.data.data); })
      .catch(() => { if (alive) setTerm(null); });
    return () => { alive = false; };
  }, [open]);

  const TERMINAL = ['APPLIED', 'ALREADY_APPLIED', 'GUARDIAN_UPDATED', 'REACTIVATED'];
  const canApplyCount = useMemo(() => (rows || []).filter((r) => r.can_apply && !TERMINAL.includes(r.status)).length, [rows]);
  const autoVehicleRows = useMemo(() => (rows || []).filter((r) => r.classification === 'INSERT_NEW_AUTO_VEHICLE' && !TERMINAL.includes(r.status)).length, [rows]);
  const errorCount = useMemo(() => (rows || []).filter((r) => r.status === 'ERROR' || r.classification === 'APPLY_FAILED').length, [rows]);
  const vehicleIssues = useMemo(() => (rows || []).filter((r) => String(r.classification).startsWith('VEHICLE_')).length, [rows]);
  const guardianRows = useMemo(() => (rows || []).filter((r) => r.can_confirm_guardian_update && !TERMINAL.includes(r.status)), [rows]);
  const reactivateRows = useMemo(() => (rows || []).filter((r) => r.can_confirm_reactivate && !TERMINAL.includes(r.status)), [rows]);
  const filtered = useMemo(() => (rows || []).filter((r) => matchesFilter(r, filter)), [rows, filter]);

  function toggleSel(setter, rowNo) {
    setter((prev) => { const n = new Set(prev); n.has(rowNo) ? n.delete(rowNo) : n.add(rowNo); return n; });
  }

  if (!open) return null;

  function reset() {
    setFile(null); setBusy(false); setError(''); setBatchId(null);
    setSummary(null); setRows(null); setFilter('all'); setConfirming(false); setApplyResult(null);
    setSelGuardian(new Set()); setSelReactivate(new Set()); setRequestedVehicle(new Set()); setAutoCreateVehicle(false);
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
      fd.append('auto_create_vehicle', autoCreateVehicle ? 'true' : 'false');
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
      const confirmG = selGuardian.size > 0, confirmR = selReactivate.size > 0;
      const mode = (confirmG || confirmR) ? 'mixed_confirmed' : 'insert_ready';
      const shouldAutoCreateVehicle = autoCreateVehicle || autoVehicleRows > 0;
      const res = await api.post(`/school/students/import/${batchId}/apply`, {
        mode,
        selected_row_ids: [...selGuardian, ...selReactivate],
        confirm_guardian_update: confirmG,
        confirm_reactivate: confirmR,
        auto_create_vehicle: shouldAutoCreateVehicle,
      });
      setApplyResult(res.data.data);
      // Refresh row statuses from the persisted report.
      const rep = await api.get(`/school/students/import/${batchId}/report`);
      const byRow = Object.fromEntries(rep.data.data.rows.map((x) => [x.row_number, x]));
      setRows((prev) => prev.map((r) => {
        const u = byRow[r.row_number];
        return u ? { ...r, status: u.status, classification: u.classification, can_apply: false } : r;
      }));
      toast.success(res.data.message || 'ดำเนินการนำเข้าสำเร็จ');
      onApplied?.();
    } catch (err) {
      const status = err.response?.status;
      if (status === 403) setError('ไม่สามารถเข้าถึงชุดนำเข้านี้ได้');
      else setError(err.response?.data?.message || 'นำเข้าข้อมูลไม่สำเร็จ — รายการพรีวิวยังอยู่ กรุณาลองใหม่');
    } finally { setBusy(false); }
  }

  // Phase 10.13B-7 — from a VEHICLE_SOFT_DELETED row, request a vehicle restore
  // (admin-approved). Never auto-restores.
  async function requestVehicleRestore(r) {
    try {
      await api.post('/school/vehicles/requests', {
        request_type: 'RESTORE_SOFT_DELETED_VEHICLE',
        input_plate: r.input_vehicle_plate,
        import_batch_id: batchId, import_row_id: r.row_number,
        reason: `จากการนำเข้า ชุด #${batchId} แถว ${r.row_number}`,
      });
      setRequestedVehicle((p) => new Set(p).add(r.row_number));
      toast.success('ส่งคำขอกู้คืนรถแล้ว · รอผู้ดูแลระบบตรวจสอบ');
    } catch (err) { toast.error(err.response?.data?.message || 'ส่งคำขอไม่สำเร็จ'); }
  }

  function downloadReport() {
    const cols = ['row_number', 'student_code', 'student_name', 'classification', 'status', 'message_th', 'input_vehicle_plate', 'matched_display_plate', 'guardian_mismatch', 'action_required'];
    // Phase 10.13B-1 — neutralize CSV formula injection: a cell starting with
    // = + - @ (or tab/CR) is prefixed with ' so spreadsheet apps treat it as text.
    const neutralize = (v) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
    const esc = (v) => `"${neutralize(v).replace(/"/g, '""')}"`;
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

  const rowColumns = [
    {
      key: 'choose', header: 'เลือก',
      cell: r => {
        const isG = r.can_confirm_guardian_update && !TERMINAL.includes(r.status);
        const isR = r.can_confirm_reactivate && !TERMINAL.includes(r.status);
        if (!isG && !isR) return null;
        return (
          <div className="flex flex-col">
            {isG && (
              <RowChoice
                checked={selGuardian.has(r.row_number)}
                onChange={() => toggleSel(setSelGuardian, r.row_number)}
                label="อัปเดตผู้ปกครอง"
              />
            )}
            {isR && (
              <RowChoice
                checked={selReactivate.has(r.row_number)}
                onChange={() => toggleSel(setSelReactivate, r.row_number)}
                label="กู้คืนนักเรียน"
              />
            )}
          </div>
        );
      },
    },
    { key: 'row_number', header: 'แถว', numeric: true, cell: r => r.row_number },
    { key: 'student_code', header: 'รหัส', secondary: true, cell: r => r.student_code },
    { key: 'student_name', header: 'ชื่อนักเรียน', primary: true, cell: r => r.student_name || '—' },
    { key: 'input_vehicle_plate', header: 'ทะเบียนในไฟล์', cell: r => r.input_vehicle_plate || '—' },
    { key: 'matched_display_plate', header: 'รถที่จับคู่ได้', cell: r => r.matched_display_plate || '—' },
    {
      key: 'status', header: 'สถานะ', badge: true,
      cell: r => {
        const m = badgeFor(r);
        return <StatusBadge variant={VARIANT[m.tone] || 'neutral'} size="sm">{m.label}</StatusBadge>;
      },
    },
    {
      key: 'message_th', header: 'คำอธิบาย / สิ่งที่ต้องทำ',
      cell: r => (
        <div>
          <div>{r.message_th}</div>
          {r.guardian_mismatch && (
            <div className="text-caption text-warn-ink mt-0.5">
              ผู้ปกครอง: <span className="line-through text-ink-muted">{r.guardian_current || '—'}</span>
              {' '}<span aria-hidden="true">→</span>{' '}
              <span className="font-medium">{r.guardian_input || '—'}</span>
            </div>
          )}
          {r.action_required && !TERMINAL.includes(r.status) && (
            <div className="text-caption text-warn-ink mt-0.5">ต้องทำ: {r.action_required}</div>
          )}
          {/* 10.13B-7 — next actions for vehicle blockers */}
          {r.classification === 'VEHICLE_SOFT_DELETED' && (
            requestedVehicle.has(r.row_number)
              ? <div className="text-caption text-success-ink mt-1">ส่งคำขอกู้คืนรถแล้ว</div>
              : (
                <button
                  type="button"
                  onClick={() => requestVehicleRestore(r)}
                  className="focus-ring inline-flex items-center text-sm font-medium text-brand-700 underline px-1 min-h-[44px] rounded-lg hover:bg-brand-50 transition"
                >
                  ขอกู้คืนรถ
                </button>
              )
          )}
          {r.classification === 'VEHICLE_NOT_FOUND' && (
            <div className="text-caption text-ink-muted mt-1">เพิ่มรถได้ที่เมนู “จัดการรถ” แล้วตรวจสอบไฟล์อีกครั้ง</div>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Modal
        title="ตรวจสอบไฟล์ก่อนนำเข้า"
        size="lg"
        onClose={() => { if (!busy) close(); }}
        footer={rows ? (
          <>
            <p className="text-caption text-ink-muted sm:mr-auto sm:self-center">
              {applied ? 'นำเข้าเสร็จสิ้น' : (
                <>
                  เพิ่มใหม่ <span className="font-semibold text-success-ink">{canApplyCount}</span>
                  {selGuardian.size > 0 && <> · อัปเดตผู้ปกครอง <span className="font-semibold text-warn-ink">{selGuardian.size}</span></>}
                  {selReactivate.size > 0 && <> · กู้คืน <span className="font-semibold text-warn-ink">{selReactivate.size}</span></>}
                  {' · รายการที่มีปัญหาจะยังไม่ถูกบันทึก'}
                </>
              )}
            </p>
            <button
              type="button"
              onClick={downloadReport}
              className="focus-ring inline-flex items-center justify-center gap-1.5 text-sm font-medium text-ink border border-surface-border hover:bg-surface px-3 min-h-[44px] rounded-lg transition"
            >
              <Download className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
              ดาวน์โหลดรายงาน (CSV)
            </button>
            {!applied ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={busy || (canApplyCount === 0 && selGuardian.size === 0 && selReactivate.size === 0)}
                className="focus-ring text-sm bg-success hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none text-white font-semibold px-4 min-h-[44px] rounded-lg transition"
              >
                ยืนยันนำเข้า
              </button>
            ) : (
              <button
                type="button"
                onClick={close}
                className="focus-ring text-sm bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-semibold px-4 min-h-[44px] rounded-lg transition"
              >
                เสร็จสิ้น
              </button>
            )}
          </>
        ) : undefined}
      >
        <p className="text-sm text-ink-muted mb-4">
          {rows
            ? 'ขั้นตอนนี้เป็นการตรวจสอบข้อมูลเท่านั้น ระบบยังไม่บันทึกข้อมูลนักเรียน'
            : 'อัปโหลดไฟล์ CSV หรือ Excel (.xlsx) เพื่อตรวจสอบรายแถวก่อนนำเข้าจริง'}
        </p>

        {/* Current academic term (date-derived) — info, not a warning. */}
        {term && (
          <AlertBanner variant="info" icon={CalendarDays} title="ภาคเรียนที่จะบันทึก" className="mb-4">
            <span className="font-semibold">{term.name || `ภาคเรียน ${term.term_id}`}</span>
            {term.start_date && term.end_date && (
              <span> · ช่วง {fmtThaiDate(term.start_date)} – {fmtThaiDate(term.end_date)}</span>
            )}
            <span className="block text-caption mt-0.5">ระบบกำหนดภาคเรียนจากวันที่นำเข้าโดยอัตโนมัติ</span>
          </AlertBanner>
        )}

        {/* ── Upload step ── */}
        {!rows && (
          <div className="space-y-4 max-w-md mx-auto">
            <div className="border-2 border-dashed border-surface-border rounded-lg p-6">
              <FormField label="ไฟล์รายชื่อนักเรียน" required helper="รองรับ .csv, .xls และ .xlsx">
                {ctl => (
                  <input
                    {...ctl}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => pickFile(e.target.files?.[0] || null)}
                    className="focus-ring block w-full min-h-[44px] text-base text-ink-muted file:mr-3 file:h-11 file:px-4 file:rounded-lg file:border file:border-surface-border file:text-sm file:font-medium file:bg-surface file:text-ink hover:file:bg-surface-border file:cursor-pointer"
                  />
                )}
              </FormField>
              {file && <p className="text-sm text-success-ink mt-2">{file.name}</p>}
            </div>

            <label className="flex items-start gap-2 text-sm text-ink bg-surface-raised border border-surface-border rounded-lg p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoCreateVehicle}
                onChange={(e) => setAutoCreateVehicle(e.target.checked)}
                className="focus-ring mt-0.5 w-5 h-5 rounded border-surface-border accent-brand-600 shrink-0"
              />
              <span>สร้างรถอัตโนมัติสำหรับทะเบียนใหม่ที่มีจังหวัดครบถ้วน โดยบันทึกเป็นรถรอตรวจสอบ</span>
            </label>

            {error && <AlertBanner variant="danger" title="ตรวจสอบไฟล์ไม่สำเร็จ">{error}</AlertBanner>}

            <button
              type="button"
              onClick={runPreview}
              disabled={busy || !file}
              className="focus-ring w-full inline-flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 disabled:opacity-40 disabled:pointer-events-none text-white text-sm font-semibold min-h-[48px] rounded-lg transition"
            >
              <Upload className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
              {busy ? 'กำลังตรวจสอบ…' : 'ตรวจสอบไฟล์ก่อนนำเข้า'}
            </button>

            <a
              href="/templates/student_import_template_th.csv"
              download="แบบฟอร์มนำเข้านักเรียน.csv"
              className="focus-ring flex items-center justify-center text-sm font-medium text-brand-700 min-h-[44px] rounded-lg hover:bg-brand-50 transition"
            >
              ดาวน์โหลดไฟล์ตัวอย่าง
            </a>
          </div>
        )}

        {/* ── Preview step ── */}
        {rows && (
          <div className="space-y-4">
            <AlertBanner
              variant={applied ? 'success' : 'info'}
              title={applied ? 'นำเข้าเสร็จสิ้น' : 'ยังไม่ได้บันทึกข้อมูล'}
            >
              {applied
                ? `นำเข้าสำเร็จ ${applyResult.applied} รายการ${applyResult.already_applied ? ` · มีอยู่แล้ว ${applyResult.already_applied}` : ''}${applyResult.failed ? ` · ไม่สำเร็จ ${applyResult.failed}` : ''} — กรุณาตรวจสอบจำนวนในหน้ารายชื่อนักเรียน`
                : 'ระบบยังไม่ได้บันทึกข้อมูลนักเรียน กรุณาตรวจสอบรายการด้านล่างก่อนกดยืนยันนำเข้า'}
              <span className="block text-caption mt-0.5">ชุดนำเข้า #{batchId}</span>
            </AlertBanner>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <SummaryCard label="ทั้งหมด" value={summary.total} tone="slate" />
              <SummaryCard label="พร้อมนำเข้า" value={canApplyCount} tone="emerald" />
              <SummaryCard label="ซ้ำในโรงเรียน" value={summary.skip} tone="slate" />
              <SummaryCard label="คำเตือน" value={summary.warning} tone="amber" />
              <SummaryCard label="ข้อผิดพลาด" value={errorCount} tone="red" />
              <SummaryCard label="รถมีปัญหา" value={vehicleIssues} tone="red" />
            </div>

            <FilterBar
              chips={{
                label: 'กรองรายการตามสถานะการตรวจสอบ',
                value: filter,
                onChange: setFilter,
                options: FILTERS.map(f => [f.key, f.label]),
              }}
              count={filtered.length}
              countLabel="แถว"
              onClear={filter !== 'all' ? () => setFilter('all') : undefined}
            />

            {autoVehicleRows > 0 && (
              <AlertBanner variant="success" title="จะสร้างรถรอตรวจสอบ">
                ระบบจะสร้างรถสถานะรอตรวจสอบสำหรับทะเบียนใหม่ {autoVehicleRows} รายการตอนยืนยันนำเข้า
              </AlertBanner>
            )}

            {!applied && (guardianRows.length > 0 || reactivateRows.length > 0) && (
              <AlertBanner variant="warn" title="ต้องเลือกยืนยันรายแถว">
                <ul className="space-y-0.5 text-caption">
                  {guardianRows.length > 0 && (
                    <li>
                      ติ๊กเลือก “อัปเดตผู้ปกครอง” — ระบบจะอัปเดตเฉพาะข้อมูลผู้ปกครองของรายการที่เลือกเท่านั้น
                      {' '}(เลือกแล้ว {selGuardian.size} จาก {guardianRows.length})
                    </li>
                  )}
                  {reactivateRows.length > 0 && (
                    <li>
                      ติ๊กเลือก “กู้คืนนักเรียน” — ระบบจะกู้คืนเฉพาะนักเรียนในโรงเรียนเดียวกันและรหัสนักเรียนเดียวกันเท่านั้น
                      {' '}(เลือกแล้ว {selReactivate.size} จาก {reactivateRows.length})
                    </li>
                  )}
                </ul>
              </AlertBanner>
            )}

            <DataTable
              caption={`รายการในไฟล์นำเข้า ชุด #${batchId}`}
              columns={rowColumns}
              rows={filtered}
              rowKey={r => r.row_number}
              empty={{ title: 'ไม่มีรายการในตัวกรองนี้', description: 'ลองเลือกตัวกรองอื่น' }}
            />

            {error && <AlertBanner variant="danger" title="นำเข้าไม่สำเร็จ">{error}</AlertBanner>}
          </div>
        )}
      </Modal>

      {/* Confirm-apply — this is the step that writes student data. */}
      <ConfirmDialog
        open={confirming}
        tone="brand"
        title="ยืนยันการนำเข้า"
        description="ระบบจะดำเนินการเฉพาะรายการที่พร้อมและรายการที่ท่านเลือกยืนยันเท่านั้น"
        confirmLabel={busy ? 'กำลังนำเข้า…' : 'ยืนยันนำเข้า'}
        loading={busy}
        onConfirm={runApply}
        onCancel={() => setConfirming(false)}
      >
        <dl className="text-sm text-ink-muted space-y-1">
          <ConfirmRow label="ชุดนำเข้า" value={`#${batchId}`} />
          <ConfirmRow label="พร้อมเพิ่มใหม่" value={canApplyCount} tone="text-success-ink font-semibold" />
          {autoVehicleRows > 0 && <ConfirmRow label="สร้างรถรอตรวจสอบ" value={autoVehicleRows} tone="text-success-ink font-semibold" />}
          {selGuardian.size > 0 && <ConfirmRow label="ยืนยันอัปเดตผู้ปกครอง" value={selGuardian.size} tone="text-warn-ink font-semibold" />}
          {selReactivate.size > 0 && <ConfirmRow label="ยืนยันกู้คืนนักเรียน" value={selReactivate.size} tone="text-warn-ink font-semibold" />}
          <ConfirmRow label="ข้ามรายการซ้ำ" value={summary?.skip ?? 0} />
          <ConfirmRow label="มีปัญหา/ผิดพลาด (ไม่นำเข้า)" value={errorCount} tone="text-danger-ink font-semibold" />
        </dl>
      </ConfirmDialog>
    </>
  );
}

/**
 * A row can offer two different confirmations, and they used to be two bare
 * checkboxes side by side in one cell with nothing but a `title` — a screen
 * reader announced two unlabelled checkboxes and a sighted user had to hover
 * each to learn which was which.
 */
function RowChoice({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-1.5 px-1 min-h-[44px] cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="focus-ring w-5 h-5 rounded border-surface-border accent-warn"
      />
      <span className="text-caption text-ink-muted whitespace-nowrap">{label}</span>
    </label>
  );
}

function ConfirmRow({ label, value, tone = '' }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className={`tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

function SummaryCard({ label, value, tone }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${SUMMARY_TONE[tone] || SUMMARY_TONE.slate}`}>
      <div className="text-xl font-bold tabular-nums leading-none">{value}</div>
      <div className="text-xs font-medium mt-1 opacity-80">{label}</div>
    </div>
  );
}
