import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Download } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import LoadingState from '../../components/LoadingState';
import {
  AlertBanner, ConfirmDialog, DataTable, FormField, Modal, StatusBadge, TableAction,
} from '../../components/ui';

// Phase 10.13B-5 — Import History & Correction Center: list past imports, reopen
// detail, download report, continue pending apply, and roll back inserted rows
// (soft-delete only) without manual SQL.

const STATUS_META = {
  PREVIEWED: { label: 'ตรวจสอบแล้ว', variant: 'neutral' },
  APPLIED: { label: 'นำเข้าแล้ว', variant: 'success' },
  APPLIED_PARTIAL: { label: 'นำเข้าบางส่วน', variant: 'warn' },
  GUARDIAN_UPDATED: { label: 'อัปเดตผู้ปกครองแล้ว', variant: 'success' },
  REACTIVATED: { label: 'กู้คืนนักเรียนแล้ว', variant: 'success' },
  ALREADY_APPLIED: { label: 'มีอยู่แล้ว', variant: 'info' },
  SKIP: { label: 'ข้าม', variant: 'neutral' },
  WARNING: { label: 'คำเตือน', variant: 'warn' },
  ERROR: { label: 'ผิดพลาด', variant: 'danger' },
  STALE_NEEDS_REPREVIEW: { label: 'ต้องพรีวิวใหม่', variant: 'warn' },
  VEHICLE_BLOCKED: { label: 'ติดปัญหารถ', variant: 'danger' },
  APPLY_FAILED: { label: 'ไม่สำเร็จ', variant: 'danger' },
  READY: { label: 'พร้อมนำเข้า', variant: 'success' },
  // Was missing, so rolled-back rows fell through to the raw enum and the
  // caller patched the label and the colour back on at each of two call sites.
  ROLLED_BACK: { label: 'ย้อนกลับแล้ว', variant: 'info' },
};
const badge = (s) => STATUS_META[s] || { label: s, variant: 'neutral' };
const fmtDate = (d) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');

const SUMMARY_TONE = {
  neutral: 'bg-surface text-ink-muted border-surface-border',
  success: 'bg-success-soft text-success-ink border-success/30',
  warn:    'bg-warn-soft text-warn-ink border-warn/30',
  danger:  'bg-danger-soft text-danger-ink border-danger/30',
  info:    'bg-info-soft text-info-ink border-info/30',
};

/**
 * A row can offer up to three different confirmations, and they used to be
 * three bare checkboxes stacked in one cell with nothing but a `title` — a
 * screen reader announced three unlabelled checkboxes, and a sighted user had
 * to hover each one to learn what it meant.
 */
function RowChoice({ checked, onChange, label, accent }) {
  return (
    <label className="flex items-center gap-1.5 px-1 min-h-[44px] cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className={`focus-ring w-5 h-5 rounded border-surface-border ${accent}`}
      />
      <span className="text-caption text-ink-muted whitespace-nowrap">{label}</span>
    </label>
  );
}

export default function ImportHistoryModal({ open, onClose, onChanged }) {
  const toast = useToast();
  const [view, setView] = useState('list');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [batches, setBatches] = useState([]);
  const [detail, setDetail] = useState(null);
  const [selRollback, setSelRollback] = useState(() => new Set());
  const [selG, setSelG] = useState(() => new Set());
  const [selR, setSelR] = useState(() => new Set());
  const [reason, setReason] = useState('');
  const [confirmRollback, setConfirmRollback] = useState(false);

  useEffect(() => { if (open) loadList(); /* eslint-disable-next-line */ }, [open]);

  function close() { setView('list'); setDetail(null); setError(''); resetSel(); onClose(); }
  function resetSel() { setSelRollback(new Set()); setSelG(new Set()); setSelR(new Set()); setReason(''); setConfirmRollback(false); }
  function toggle(setter, v) { setter((p) => { const n = new Set(p); n.has(v) ? n.delete(v) : n.add(v); return n; }); }

  async function loadList() {
    setBusy(true); setError('');
    try {
      const res = await api.get('/school/students/import/batches');
      setBatches(Array.isArray(res.data?.data) ? res.data.data : []);
      setView('list');
    }
    catch (err) { setError(err.response?.data?.message || 'โหลดประวัติไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  async function openDetail(batchId) {
    setBusy(true); setError(''); resetSel();
    try { const res = await api.get(`/school/students/import/${batchId}`); setDetail(res.data.data); setView('detail'); }
    catch (err) { setError(err.response?.status === 403 ? 'ไม่สามารถเข้าถึงชุดนำเข้านี้ได้' : (err.response?.data?.message || 'โหลดรายละเอียดไม่สำเร็จ')); }
    finally { setBusy(false); }
  }

  async function runContinue() {
    if (busy) return; // an import must not be submitted twice
    setBusy(true); setError('');
    try {
      const confirmG = selG.size > 0, confirmR = selR.size > 0;
      const mode = (confirmG || confirmR) ? 'mixed_confirmed' : 'insert_ready';
      const res = await api.post(`/school/students/import/${detail.batch.id}/apply`, {
        mode, selected_row_ids: [...selG, ...selR], confirm_guardian_update: confirmG, confirm_reactivate: confirmR, auto_create_vehicle: needsAutoCreateVehicle,
      });
      toast.success(res.data.message || 'ดำเนินการสำเร็จ');
      onChanged?.(); await openDetail(detail.batch.id);
    } catch (err) { setError(err.response?.data?.message || 'ดำเนินการไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  async function runRollback() {
    if (!reason.trim()) { setError('กรุณาระบุเหตุผลในการย้อนกลับ'); return; }
    if (busy) return;
    setBusy(true); setError(''); setConfirmRollback(false);
    try {
      const res = await api.post(`/school/students/import/${detail.batch.id}/rollback`, { selected_row_ids: [...selRollback], reason });
      toast.success(res.data.message || 'ย้อนกลับสำเร็จ');
      onChanged?.(); await openDetail(detail.batch.id);
    } catch (err) { setError(err.response?.data?.message || 'ย้อนกลับไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  function downloadReport() {
    const cols = ['row_number', 'student_code', 'student_name', 'classification', 'status', 'rollback_status', 'message_th', 'matched_display_plate'];
    const neutralize = (v) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
    const esc = (v) => `"${neutralize(v).replace(/"/g, '""')}"`;
    const lines = [cols.join(',')];
    for (const r of detail.rows) lines.push(cols.map((c) => esc(r[c])).join(','));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `import-report-${detail.batch.id}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const rollbackable = useMemo(() => (detail?.rows || []).filter((r) => r.can_rollback), [detail]);
  const needsAutoCreateVehicle = useMemo(() => (detail?.rows || []).some((r) => r.classification === 'INSERT_NEW_AUTO_VEHICLE' && r.can_apply), [detail]);
  const guardianRows = useMemo(() => (detail?.rows || []).filter((r) => r.can_confirm_guardian_update), [detail]);
  const reactRows = useMemo(() => (detail?.rows || []).filter((r) => r.can_confirm_reactivate), [detail]);
  const pendingReady = useMemo(() => (detail?.rows || []).filter((r) => r.can_apply).length, [detail]);

  const batchColumns = useMemo(() => [
    { key: 'created_at', header: 'วันที่นำเข้า', secondary: true, cell: b => fmtDate(b.created_at) },
    { key: 'filename', header: 'ไฟล์', primary: true, cell: b => b.filename || '—' },
    {
      key: 'status', header: 'สถานะ', badge: true,
      cell: b => {
        const m = badge(b.rollback_status ? 'ROLLED_BACK' : b.status);
        return <StatusBadge variant={m.variant} size="sm">{m.label}</StatusBadge>;
      },
    },
    { key: 'total_rows', header: 'ทั้งหมด', align: 'right', numeric: true, cell: b => b.total_rows },
    {
      key: 'insert_count', header: 'สำเร็จ', align: 'right', numeric: true,
      cell: b => <span className="text-success-ink font-medium">{b.insert_count}</span>,
    },
    {
      key: 'error_count', header: 'ผิดพลาด', align: 'right', numeric: true,
      cell: b => <span className={b.error_count > 0 ? 'text-danger-ink font-medium' : undefined}>{b.error_count}</span>,
    },
    { key: 'expires_at', header: 'ไฟล์หมดอายุ', hideOnMobile: true, cell: b => fmtDate(b.expires_at) },
  ], []);

  const rowColumns = useMemo(() => [
    {
      key: 'choose', header: 'เลือก',
      cell: r => (
        <div className="flex flex-col">
          {r.can_rollback && (
            <RowChoice
              checked={selRollback.has(r.row_number)}
              onChange={() => toggle(setSelRollback, r.row_number)}
              label="ย้อนกลับ"
              accent="accent-danger"
            />
          )}
          {r.can_confirm_guardian_update && (
            <RowChoice
              checked={selG.has(r.row_number)}
              onChange={() => toggle(setSelG, r.row_number)}
              label="อัปเดตผู้ปกครอง"
              accent="accent-warn"
            />
          )}
          {r.can_confirm_reactivate && (
            <RowChoice
              checked={selR.has(r.row_number)}
              onChange={() => toggle(setSelR, r.row_number)}
              label="กู้คืนนักเรียน"
              accent="accent-warn"
            />
          )}
        </div>
      ),
    },
    { key: 'row_number', header: 'แถว', numeric: true, cell: r => r.row_number },
    { key: 'student_code', header: 'รหัส', secondary: true, cell: r => r.student_code },
    { key: 'student_name', header: 'ชื่อนักเรียน', primary: true, cell: r => r.student_name || '—' },
    {
      key: 'status', header: 'สถานะ', badge: true,
      cell: r => {
        const m = badge(r.rollback_status === 'ROLLED_BACK' ? 'ROLLED_BACK' : r.status);
        return <StatusBadge variant={m.variant} size="sm">{m.label}</StatusBadge>;
      },
    },
    {
      key: 'message_th', header: 'คำอธิบาย',
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
        </div>
      ),
    },
  ], [selRollback, selG, selR]);

  // Rules of Hooks: every hook above must run on every render, so the closed-modal
  // early return MUST come after them. Placing `if (!open) return null` before the
  // useMemos changed the hook count when the modal opened → React #310 crash
  // (pre-existing since 10.13B-5). Keep this return here, below all hooks.
  if (!open) return null;

  const title = view === 'list'
    ? 'ประวัติการนำเข้า'
    : `ชุดนำเข้า #${detail?.batch.id} · ${detail?.batch.filename || ''}`;

  return (
    <>
      <Modal
        title={title}
        size="lg"
        onClose={() => { if (!busy) close(); }}
        footer={view === 'detail' && detail ? (
          <>
            <button
              type="button"
              onClick={downloadReport}
              className="focus-ring inline-flex items-center gap-1.5 text-sm font-medium text-ink border border-surface-border hover:bg-surface px-3 min-h-[44px] rounded-lg transition"
            >
              <Download className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
              ดาวน์โหลดรายงาน (CSV)
            </button>
            {(pendingReady > 0 || selG.size > 0 || selR.size > 0) && (
              <button
                type="button"
                onClick={runContinue}
                disabled={busy}
                className="focus-ring text-sm bg-success hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none text-white font-semibold px-4 min-h-[44px] rounded-lg transition"
              >
                {busy ? 'กำลังดำเนินการ…' : 'นำเข้ารายการที่ค้าง/ที่เลือก'}
              </button>
            )}
            {rollbackable.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setError('');
                  if (selRollback.size === 0) setError('กรุณาเลือกรายการที่ต้องการย้อนกลับ');
                  else setConfirmRollback(true);
                }}
                disabled={busy}
                className="focus-ring text-sm bg-danger hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none text-white font-semibold px-4 min-h-[44px] rounded-lg transition"
              >
                ย้อนกลับรายการที่เลือก
              </button>
            )}
          </>
        ) : undefined}
      >
        {view === 'detail' && (
          <button
            type="button"
            onClick={loadList}
            className="focus-ring inline-flex items-center gap-1 text-sm font-medium text-brand-700 px-2 min-h-[44px] -ml-2 mb-2 rounded-lg hover:bg-brand-50 transition"
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
            ย้อนกลับไปรายการทั้งหมด
          </button>
        )}

        {error && (
          <AlertBanner variant="danger" title="ดำเนินการไม่สำเร็จ" className="mb-3">{error}</AlertBanner>
        )}

        {view === 'list' && (
          <DataTable
            caption="ประวัติการนำเข้านักเรียน"
            columns={batchColumns}
            rows={batches}
            rowKey={b => b.batch_id}
            loading={busy && batches.length === 0}
            empty={{ title: 'ยังไม่มีประวัติการนำเข้า' }}
            actions={b => (
              <TableAction tone="brand" onClick={() => openDetail(b.batch_id)}>เปิดดู</TableAction>
            )}
          />
        )}

        {view === 'detail' && busy && !detail && <LoadingState message="กำลังโหลดรายละเอียด…" />}

        {view === 'detail' && detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <SummaryCard label="ทั้งหมด" value={detail.summary.total} tone="neutral" />
              <SummaryCard label="นำเข้าแล้ว" value={detail.summary.applied} tone="success" />
              <SummaryCard label="คำเตือน" value={detail.summary.warning} tone="warn" />
              <SummaryCard label="ผิดพลาด" value={detail.summary.error} tone="danger" />
              <SummaryCard label="ย้อนกลับแล้ว" value={detail.summary.rolled_back} tone="info" />
              <SummaryCard label="พร้อมดำเนินการ" value={detail.summary.ready} tone="success" />
            </div>

            {(guardianRows.length > 0 || reactRows.length > 0 || rollbackable.length > 0) && (
              <AlertBanner variant="warn" title="ยังมีรายการที่ต้องตัดสินใจ">
                <ul className="space-y-0.5 text-caption">
                  {pendingReady > 0 && <li>มีรายการพร้อมนำเข้าที่ยังค้างอยู่ {pendingReady} รายการ</li>}
                  {rollbackable.length > 0 && (
                    <li>
                      ย้อนกลับ: ระบบจะปิดใช้งานนักเรียนที่ถูกเพิ่มจากชุดนำเข้านี้เท่านั้น ไม่ลบข้อมูลถาวร
                      {' '}(เลือกแล้ว {selRollback.size} จาก {rollbackable.length})
                    </li>
                  )}
                </ul>
              </AlertBanner>
            )}

            <DataTable
              caption={`รายการในชุดนำเข้า #${detail.batch.id}`}
              columns={rowColumns}
              rows={detail.rows}
              rowKey={r => r.row_number}
              empty={{ title: 'ไม่มีรายการในชุดนี้' }}
            />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmRollback}
        title="ยืนยันการย้อนกลับ"
        description={`ระบบจะย้อนกลับโดยการปิดใช้งานนักเรียนที่ถูกเพิ่มจากชุดนำเข้านี้เท่านั้น (${selRollback.size} รายการ) ไม่ลบข้อมูลถาวร`}
        confirmLabel={busy ? 'กำลังย้อนกลับ…' : 'ยืนยันย้อนกลับ'}
        loading={busy}
        confirmDisabled={!reason.trim()}
        onConfirm={runRollback}
        onCancel={() => setConfirmRollback(false)}
      >
        <FormField
          label="เหตุผลในการย้อนกลับ"
          required
          value={reason}
          onChange={setReason}
          placeholder="เช่น นำเข้าผิดไฟล์"
        />
      </ConfirmDialog>
    </>
  );
}

function SummaryCard({ label, value, tone }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${SUMMARY_TONE[tone] || SUMMARY_TONE.neutral}`}>
      <div className="text-xl font-bold tabular-nums leading-none">{value}</div>
      <div className="text-xs font-medium mt-1 opacity-80">{label}</div>
    </div>
  );
}
