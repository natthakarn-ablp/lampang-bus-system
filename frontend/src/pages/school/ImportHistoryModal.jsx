import { useEffect, useMemo, useState } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

// Phase 10.13B-5 — Import History & Correction Center: list past imports, reopen
// detail, download report, continue pending apply, and roll back inserted rows
// (soft-delete only) without manual SQL.

const TONE = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  slate: 'bg-slate-50 text-slate-600 border-slate-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
};
const STATUS_META = {
  PREVIEWED: { label: 'ตรวจสอบแล้ว', tone: 'slate' },
  APPLIED: { label: 'นำเข้าแล้ว', tone: 'emerald' },
  APPLIED_PARTIAL: { label: 'นำเข้าบางส่วน', tone: 'amber' },
  GUARDIAN_UPDATED: { label: 'อัปเดตผู้ปกครองแล้ว', tone: 'emerald' },
  REACTIVATED: { label: 'กู้คืนนักเรียนแล้ว', tone: 'emerald' },
  ALREADY_APPLIED: { label: 'มีอยู่แล้ว', tone: 'blue' },
  SKIP: { label: 'ข้าม', tone: 'slate' },
  WARNING: { label: 'คำเตือน', tone: 'amber' },
  ERROR: { label: 'ผิดพลาด', tone: 'red' },
  STALE_NEEDS_REPREVIEW: { label: 'ต้องพรีวิวใหม่', tone: 'amber' },
  VEHICLE_BLOCKED: { label: 'ติดปัญหารถ', tone: 'red' },
  APPLY_FAILED: { label: 'ไม่สำเร็จ', tone: 'red' },
  READY: { label: 'พร้อมนำเข้า', tone: 'emerald' },
};
const badge = (s) => STATUS_META[s] || { label: s, tone: 'slate' };
const fmtDate = (d) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');

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
    try { const res = await api.get('/school/students/import/batches'); setBatches(res.data.data || []); setView('list'); }
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
    setBusy(true); setError('');
    try {
      const confirmG = selG.size > 0, confirmR = selR.size > 0;
      const mode = (confirmG || confirmR) ? 'mixed_confirmed' : 'insert_ready';
      const res = await api.post(`/school/students/import/${detail.batch.id}/apply`, {
        mode, selected_row_ids: [...selG, ...selR], confirm_guardian_update: confirmG, confirm_reactivate: confirmR,
      });
      toast.success(res.data.message || 'ดำเนินการสำเร็จ');
      onChanged?.(); await openDetail(detail.batch.id);
    } catch (err) { setError(err.response?.data?.message || 'ดำเนินการไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  async function runRollback() {
    if (!reason.trim()) { setError('กรุณาระบุเหตุผลในการย้อนกลับ'); return; }
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
  const guardianRows = useMemo(() => (detail?.rows || []).filter((r) => r.can_confirm_guardian_update), [detail]);
  const reactRows = useMemo(() => (detail?.rows || []).filter((r) => r.can_confirm_reactivate), [detail]);
  const pendingReady = useMemo(() => (detail?.rows || []).filter((r) => r.can_apply).length, [detail]);

  // Rules of Hooks: every hook above must run on every render, so the closed-modal
  // early return MUST come after them. Placing `if (!open) return null` before the
  // useMemos changed the hook count when the modal opened → React #310 crash
  // (pre-existing since 10.13B-5). Keep this return here, below all hooks.
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4" onClick={close}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 sm:px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {view === 'detail' && <button onClick={loadList} className="text-sm text-blue-600 hover:text-blue-800">‹ ย้อนกลับ</button>}
            <h2 className="text-lg font-semibold text-gray-800">{view === 'list' ? 'ประวัติการนำเข้า' : `ชุดนำเข้า #${detail?.batch.id} · ${detail?.batch.filename || ''}`}</h2>
          </div>
          <button onClick={close} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-3">{error}</div>}

          {/* ── List ── */}
          {view === 'list' && (
            <div className="border border-gray-100 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">วันที่นำเข้า</th>
                      <th className="text-left font-medium px-3 py-2">ไฟล์</th>
                      <th className="text-left font-medium px-3 py-2">สถานะ</th>
                      <th className="text-right font-medium px-3 py-2">ทั้งหมด</th>
                      <th className="text-right font-medium px-3 py-2">สำเร็จ</th>
                      <th className="text-right font-medium px-3 py-2">ผิดพลาด</th>
                      <th className="text-left font-medium px-3 py-2">ไฟล์หมดอายุ</th>
                      <th className="text-left font-medium px-3 py-2"> </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {batches.map((b) => {
                      const m = badge(b.rollback_status ? b.rollback_status : b.status);
                      return (
                        <tr key={b.batch_id} className="hover:bg-gray-50/50">
                          <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtDate(b.created_at)}</td>
                          <td className="px-3 py-2 text-gray-800">{b.filename || '—'}</td>
                          <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded-full border ${TONE[m.tone]}`}>{b.rollback_status ? 'ย้อนกลับแล้ว' : m.label}</span></td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{b.total_rows}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{b.insert_count}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-red-500">{b.error_count}</td>
                          <td className="px-3 py-2 text-gray-400 text-xs whitespace-nowrap">{fmtDate(b.expires_at)}</td>
                          <td className="px-3 py-2"><button onClick={() => openDetail(b.batch_id)} className="text-sm text-blue-600 hover:text-blue-800">เปิดดู</button></td>
                        </tr>
                      );
                    })}
                    {batches.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400 text-sm">{busy ? 'กำลังโหลด…' : 'ยังไม่มีประวัติการนำเข้า'}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Detail ── */}
          {view === 'detail' && detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                <SummaryCard label="ทั้งหมด" value={detail.summary.total} tone="slate" />
                <SummaryCard label="นำเข้าแล้ว" value={detail.summary.applied} tone="emerald" />
                <SummaryCard label="คำเตือน" value={detail.summary.warning} tone="amber" />
                <SummaryCard label="ผิดพลาด" value={detail.summary.error} tone="red" />
                <SummaryCard label="ย้อนกลับแล้ว" value={detail.summary.rolled_back} tone="blue" />
                <SummaryCard label="พร้อมดำเนินการ" value={detail.summary.ready} tone="emerald" />
              </div>

              {(guardianRows.length > 0 || reactRows.length > 0 || rollbackable.length > 0) && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-800 space-y-1">
                  {pendingReady > 0 && <div>• มีรายการพร้อมนำเข้าที่ยังค้างอยู่ {pendingReady} รายการ</div>}
                  {rollbackable.length > 0 && <div>• ย้อนกลับ: ระบบจะปิดใช้งานนักเรียนที่ถูกเพิ่มจากชุดนำเข้านี้เท่านั้น ไม่ลบข้อมูลถาวร ({selRollback.size}/{rollbackable.length})</div>}
                </div>
              )}

              <div className="border border-gray-100 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-[42vh]">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs sticky top-0">
                      <tr>
                        <th className="text-left font-medium px-3 py-2">เลือก</th>
                        <th className="text-left font-medium px-3 py-2">แถว</th>
                        <th className="text-left font-medium px-3 py-2">รหัส</th>
                        <th className="text-left font-medium px-3 py-2">ชื่อนักเรียน</th>
                        <th className="text-left font-medium px-3 py-2">สถานะ</th>
                        <th className="text-left font-medium px-3 py-2">คำอธิบาย</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {detail.rows.map((r) => {
                        const m = badge(r.rollback_status === 'ROLLED_BACK' ? 'ROLLED_BACK' : r.status);
                        return (
                          <tr key={r.row_number} className="hover:bg-gray-50/50">
                            <td className="px-3 py-2">
                              {r.can_rollback && <input type="checkbox" checked={selRollback.has(r.row_number)} onChange={() => toggle(setSelRollback, r.row_number)} className="accent-red-600" title="เลือกย้อนกลับ" />}
                              {r.can_confirm_guardian_update && <input type="checkbox" checked={selG.has(r.row_number)} onChange={() => toggle(setSelG, r.row_number)} className="accent-amber-600" title="ยืนยันอัปเดตผู้ปกครอง" />}
                              {r.can_confirm_reactivate && <input type="checkbox" checked={selR.has(r.row_number)} onChange={() => toggle(setSelR, r.row_number)} className="accent-amber-600" title="ยืนยันกู้คืนนักเรียน" />}
                            </td>
                            <td className="px-3 py-2 text-gray-400 tabular-nums">{r.row_number}</td>
                            <td className="px-3 py-2 text-gray-700 tabular-nums">{r.student_code}</td>
                            <td className="px-3 py-2 text-gray-800">{r.student_name || '—'}</td>
                            <td className="px-3 py-2 whitespace-nowrap"><span className={`text-xs px-2 py-0.5 rounded-full border ${TONE[(r.rollback_status === 'ROLLED_BACK' ? { tone: 'blue' } : m).tone]}`}>{r.rollback_status === 'ROLLED_BACK' ? 'ย้อนกลับแล้ว' : m.label}</span></td>
                            <td className="px-3 py-2 text-gray-600">
                              <div>{r.message_th}</div>
                              {r.guardian_mismatch && <div className="text-xs text-amber-700 mt-0.5">ผู้ปกครอง: <span className="line-through text-gray-400">{r.guardian_current || '—'}</span> → <span className="font-medium">{r.guardian_input || '—'}</span></div>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {view === 'detail' && detail && (
          <div className="px-5 sm:px-6 py-3 border-t border-gray-100 flex flex-wrap items-center justify-end gap-2">
            <button onClick={downloadReport} className="text-sm text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg transition">ดาวน์โหลดรายงาน (CSV)</button>
            {(pendingReady > 0 || selG.size > 0 || selR.size > 0) && (
              <button onClick={runContinue} disabled={busy} className="text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-medium px-4 py-2 rounded-lg transition">นำเข้ารายการที่ค้าง/ที่เลือก</button>
            )}
            {rollbackable.length > 0 && (
              <button onClick={() => { setError(''); selRollback.size === 0 ? setError('กรุณาเลือกรายการที่ต้องการย้อนกลับ') : setConfirmRollback(true); }}
                disabled={busy} className="text-sm bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-medium px-4 py-2 rounded-lg transition">ย้อนกลับรายการที่เลือก</button>
            )}
          </div>
        )}

        {/* Rollback confirm */}
        {confirmRollback && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmRollback(false)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-base font-semibold text-gray-800 mb-2">ยืนยันการย้อนกลับ</h3>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3">ระบบจะย้อนกลับโดยการปิดใช้งานนักเรียนที่ถูกเพิ่มจากชุดนำเข้านี้เท่านั้น ({selRollback.size} รายการ) ไม่ลบข้อมูลถาวร</p>
              <label className="block text-xs text-gray-500 mb-1">เหตุผล <span className="text-red-500">*</span></label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น นำเข้าผิดไฟล์"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4" />
              <div className="flex gap-2">
                <button onClick={runRollback} disabled={busy || !reason.trim()} className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg transition">{busy ? 'กำลังย้อนกลับ…' : 'ยืนยันย้อนกลับ'}</button>
                <button onClick={() => setConfirmRollback(false)} className="px-4 text-gray-500 hover:text-gray-700 text-sm py-2.5 transition">ยกเลิก</button>
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
