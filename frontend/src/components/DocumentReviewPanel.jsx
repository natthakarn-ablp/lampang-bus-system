import { useState, useEffect, useCallback } from 'react';
import { FileText, Eye, Check, X } from 'lucide-react';
import api from '../api/axios';
import { useToast } from './Toast';
import { ConfirmDialog, FormField } from './ui';

// Shared review panel for vehicle + driver supporting-evidence documents, reused
// by the school registration review and the transport verification queue. The
// only thing that differs between callers is the SCOPED mount path:
//   list:   `${apiBase}/vehicle/:id`   `${apiBase}/driver/:id`
//   review: `${apiBase}/:kind/:id/review`
// File viewing is always the shared authenticated route GET /documents/:kind/:id/file
// (a plain <img src> can't carry the Bearer token, so it's fetched as a blob).

const DOC_LABEL = {
  VEHICLE_REGISTRATION: 'เล่มทะเบียนรถ', COMPULSORY_INSURANCE: 'พ.ร.บ.', TAX: 'ป้ายภาษีรถ',
  INSURANCE: 'ประกันภัยรถ', DRIVER_LICENCE: 'ใบขับขี่', OTHER: 'เอกสารอื่น ๆ',
};
const DOC_REVIEW = {
  PENDING: { label: 'รอตรวจ', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  APPROVED: { label: 'ผ่าน', cls: 'bg-green-50 text-green-700 border-green-200' },
  REJECTED: { label: 'ไม่ผ่าน', cls: 'bg-red-50 text-red-700 border-red-200' },
};

function DocReviewPill({ status }) {
  const r = DOC_REVIEW[status] || DOC_REVIEW.PENDING;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${r.cls}`}>{r.label}</span>;
}

export default function DocumentReviewPanel({ apiBase, vehicleId, driverId, canReview, title = 'เอกสารรถและคนขับ' }) {
  const toast = useToast();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectNote, setRejectNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [v, d] = await Promise.all([
        vehicleId ? api.get(`${apiBase}/vehicle/${vehicleId}`) : Promise.resolve(null),
        driverId ? api.get(`${apiBase}/driver/${driverId}`) : Promise.resolve(null),
      ]);
      const vd = Array.isArray(v?.data?.data) ? v.data.data.map((x) => ({ ...x, kind: 'vehicle' })) : [];
      const dd = Array.isArray(d?.data?.data) ? d.data.data.map((x) => ({ ...x, kind: 'driver' })) : [];
      setDocs([...vd, ...dd]);
    } catch { setDocs([]); } finally { setLoading(false); }
  }, [apiBase, vehicleId, driverId]);
  useEffect(() => { load(); }, [load]);

  async function view(kind, id) {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await api.get(`/documents/${kind}/${id}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error('เปิดเอกสารไม่ได้');
    } finally { setBusyId(null); }
  }

  async function review(kind, id, decision, note = null) {
    setBusyId(id);
    try {
      await api.post(`${apiBase}/${kind}/${id}/review`, { decision, note });
      toast.success(decision === 'APPROVED' ? 'อนุมัติเอกสารแล้ว' : 'ทำเครื่องหมายไม่ผ่านแล้ว');
      setRejectTarget(null);
      setRejectNote('');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'ไม่สำเร็จ');
    } finally { setBusyId(null); }
  }

  return (
    <div className="mt-6">
      <div className="flex items-center gap-1.5 mb-2">
        <FileText className="w-4 h-4 text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
      </div>

      {loading ? (
        <p className="text-xs text-gray-400 py-2">กำลังโหลดเอกสาร…</p>
      ) : docs.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">ยังไม่มีเอกสารแนบ</p>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <div key={`${d.kind}-${d.id}`} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">{DOC_LABEL[d.doc_type] || 'เอกสาร'}</p>
                  <p className="text-xs text-gray-500 truncate">{d.original_name || '-'}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <DocReviewPill status={d.review_status} />
                    {d.expiry_date && (
                      <span className="text-xs text-gray-400">หมดอายุ {String(d.expiry_date).split('T')[0]}</span>
                    )}
                  </div>
                  {d.review_status === 'REJECTED' && d.review_note && (
                    <p className="text-xs text-red-600 mt-1">เหตุผล: {d.review_note}</p>
                  )}
                </div>
                <button onClick={() => view(d.kind, d.id)} disabled={busyId === d.id}
                  className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50 whitespace-nowrap">
                  <Eye className="w-3.5 h-3.5 inline -mt-0.5" /> ดูไฟล์
                </button>
              </div>

              {canReview && (
                <div className="mt-2.5 pt-2.5 border-t border-gray-100 flex items-center gap-3">
                  <button onClick={() => review(d.kind, d.id, 'APPROVED')} disabled={busyId === d.id}
                    className="text-xs font-medium bg-green-50 border border-green-300 text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-100 disabled:opacity-50">
                    <Check className="w-3.5 h-3.5 inline -mt-0.5" /> ผ่าน
                  </button>
                  <button onClick={() => { setRejectNote(''); setRejectTarget(d); }} disabled={busyId === d.id}
                    className="text-xs font-medium text-gray-500 hover:text-red-600 disabled:opacity-50">
                    <X className="w-3.5 h-3.5 inline -mt-0.5" /> ไม่ผ่าน
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(rejectTarget)}
        title="ยืนยันว่าเอกสารไม่ผ่าน"
        description="ระบุเหตุผลให้ชัดเจนเพื่อให้ผู้ยื่นแก้ไขได้ถูกต้อง"
        itemName={rejectTarget ? `${DOC_LABEL[rejectTarget.doc_type] || 'เอกสาร'} — ${rejectTarget.original_name || '-'}` : undefined}
        confirmLabel="ทำเครื่องหมายไม่ผ่าน"
        loading={busyId === rejectTarget?.id}
        confirmDisabled={!rejectNote.trim()}
        onConfirm={() => review(rejectTarget.kind, rejectTarget.id, 'REJECTED', rejectNote.trim())}
        onCancel={() => {
          if (busyId !== rejectTarget?.id) { setRejectTarget(null); setRejectNote(''); }
        }}
      >
        <FormField
          label="เหตุผลที่ไม่ผ่าน"
          value={rejectNote}
          onChange={setRejectNote}
          placeholder="เช่น เอกสารเบลอ หรือเอกสารหมดอายุ"
          required
        />
      </ConfirmDialog>
    </div>
  );
}
