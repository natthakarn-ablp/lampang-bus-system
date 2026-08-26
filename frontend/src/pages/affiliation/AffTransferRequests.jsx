import { useState, useEffect, useCallback } from 'react';
import {
  Users, RefreshCw, CheckCircle2, XCircle, ArrowRight,
} from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import AppCard from '../../components/ui/AppCard';
import StatusBadge from '../../components/ui/StatusBadge';
import { PageTransition } from '../../lib/motion';

const FILTERS = [
  { key: 'PENDING', label: 'รออนุมัติ' },
  { key: 'APPLIED', label: 'โอนย้ายแล้ว' },
  { key: 'REJECTED', label: 'ไม่อนุมัติ' },
  { key: 'ALL', label: 'ทั้งหมด' },
];

const STATUS_BADGE = {
  PENDING: ['รออนุมัติ', 'warn'],
  APPLIED: ['โอนย้ายแล้ว', 'success'],
  REJECTED: ['ไม่อนุมัติ', 'danger'],
  CANCELLED: ['ยกเลิก', 'neutral'],
  STALE_NEEDS_REVIEW: ['ต้องตรวจสอบใหม่', 'warn'],
};

export default function AffTransferRequests() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('PENDING');
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState('');
  const [action, setAction] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/affiliation/transfer-requests', {
        params: filter === 'ALL' ? {} : { status: filter },
      });
      setRows(res.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function openDetail(id) {
    try {
      const res = await api.get(`/affiliation/transfer-requests/${id}`);
      setDetail(res.data.data);
      setNote('');
      setAction(null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'เปิดรายละเอียดไม่สำเร็จ');
    }
  }

  async function doAction() {
    if (!detail || !action) return;
    setBusy(true);
    try {
      const res = await api.post(`/affiliation/transfer-requests/${detail.id}/${action}`, { admin_note: note });
      toast.success(res.data.message || 'สำเร็จ');
      setDetail(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ดำเนินการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  const pendingCount = rows.filter(r => r.status === 'PENDING').length;

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink flex items-center gap-2">
              <Users className="w-6 h-6 text-brand-700" />
              คำขอโอนย้ายนักเรียน
              {filter === 'PENDING' && pendingCount > 0 && (
                <StatusBadge variant="warn" size="sm">{pendingCount} รออนุมัติ</StatusBadge>
              )}
            </h1>
            <p className="text-sm text-ink-muted mt-0.5">อนุมัติคำขอโอนย้ายนักเรียนระหว่างโรงเรียนในสังกัด</p>
          </div>
          <button onClick={load} className="inline-flex items-center gap-1.5 bg-surface-raised hover:bg-surface text-ink text-sm font-medium px-3 py-2 rounded-lg border border-surface-border transition min-h-[44px]">
            <RefreshCw className="w-4 h-4" /> รีเฟรช
          </button>
        </div>

        <div className="flex gap-1.5">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`min-h-[36px] text-xs px-3 py-1.5 rounded-full border transition ${filter === f.key ? 'bg-brand-800 text-white border-brand-800' : 'bg-surface-raised text-ink-muted border-surface-border hover:bg-surface'}`}>
              {f.label}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={Users} title="ไม่มีคำขอ" description="ยังไม่มีคำขอโอนย้ายนักเรียนในสังกัดของคุณ" />
        ) : (
          <AppCard padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface text-ink-muted text-xs">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">วันที่</th>
                    <th className="text-left font-medium px-3 py-2">นักเรียน</th>
                    <th className="text-left font-medium px-3 py-2">จาก → ไป</th>
                    <th className="text-left font-medium px-3 py-2">สถานะ</th>
                    <th className="text-left font-medium px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const [label, variant] = STATUS_BADGE[r.status] || [r.status, 'neutral'];
                    return (
                      <tr key={r.id} className="border-t border-surface-border hover:bg-surface transition">
                        <td className="px-3 py-2.5 text-xs text-ink-muted">
                          {new Date(r.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-ink">{r.student_name_snapshot}</p>
                          <p className="text-xs text-ink-muted">{r.student_code}</p>
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          <span className="text-ink">{r.source_school_name}</span>
                          <ArrowRight className="inline w-3 h-3 mx-1 text-ink-muted" />
                          <span className="text-ink">{r.destination_school_name}</span>
                        </td>
                        <td className="px-3 py-2.5"><StatusBadge variant={variant} size="sm">{label}</StatusBadge></td>
                        <td className="px-3 py-2.5">
                          <button onClick={() => openDetail(r.id)}
                            className="text-xs font-medium text-brand-700 hover:text-brand-800 px-2 py-1 rounded">
                            รายละเอียด
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </AppCard>
        )}

        {/* Detail modal */}
        {detail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
            <AppCard padding="lg" className="max-w-lg w-full" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-ink mb-3">รายละเอียดคำขอโอนย้าย</h2>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-ink-muted">นักเรียน</p>
                    <p className="font-medium text-ink">{detail.student_name_snapshot}</p>
                    <p className="text-xs text-ink-muted">{detail.student_code}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted">ประเภทคำขอ</p>
                    <p className="font-medium text-ink">{detail.request_type === 'TRANSFER_OUT' ? 'โอนออก' : detail.request_type === 'TRANSFER_IN' ? 'โอนเข้า' : detail.request_type}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted">จากโรงเรียน</p>
                    <p className="font-medium text-ink">{detail.source_school_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted">ไปโรงเรียน</p>
                    <p className="font-medium text-ink">{detail.destination_school_name}</p>
                  </div>
                </div>
                {detail.reason && (
                  <div>
                    <p className="text-xs text-ink-muted">เหตุผล</p>
                    <p className="text-ink">{detail.reason}</p>
                  </div>
                )}
                {detail.evidence_note && (
                  <div>
                    <p className="text-xs text-ink-muted">หลักฐานเพิ่มเติม</p>
                    <p className="text-ink">{detail.evidence_note}</p>
                  </div>
                )}
                {detail.admin_note && (
                  <div>
                    <p className="text-xs text-ink-muted">หมายเหตุผู้อนุมัติ</p>
                    <p className="text-ink">{detail.admin_note}</p>
                  </div>
                )}
              </div>

              {detail.status === 'PENDING' && (
                <div className="mt-4 space-y-3">
                  <textarea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="หมายเหตุ (ไม่บังคับ)"
                    className="w-full min-h-[60px] rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-sm text-ink focus:ring-2 focus:ring-brand-400 outline-none"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => setAction('approve')} disabled={busy}
                      className="inline-flex items-center gap-1.5 bg-success hover:opacity-90 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition min-h-[44px]">
                      <CheckCircle2 className="w-4 h-4" /> อนุมัติ
                    </button>
                    <button onClick={() => setAction('reject')} disabled={busy}
                      className="inline-flex items-center gap-1.5 border border-danger/30 bg-danger-soft hover:bg-danger/10 disabled:opacity-50 text-danger-ink text-sm font-medium px-4 py-2 rounded-lg transition min-h-[44px]">
                      <XCircle className="w-4 h-4" /> ไม่อนุมัติ
                    </button>
                    {action && (
                      <button onClick={doAction} disabled={busy}
                        className="inline-flex items-center bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition min-h-[44px]">
                        {busy ? 'กำลัง...' : 'ยืนยัน'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <button onClick={() => setDetail(null)}
                className="mt-4 w-full text-sm text-ink-muted hover:text-ink py-2">
                ปิด
              </button>
            </AppCard>
          </div>
        )}
      </div>
    </PageTransition>
  );
}
