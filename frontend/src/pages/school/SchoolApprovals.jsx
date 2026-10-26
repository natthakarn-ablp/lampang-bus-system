import { useState, useEffect, useCallback } from 'react';
import { ClipboardList } from 'lucide-react';
import api from '../../api/axios';
import { ConfirmDialog, FilterBar, FormField } from '../../components/ui';
import EmptyState from '../../components/EmptyState';
import PageHeader from '../../components/PageHeader';
import ApprovalBadge from '../../components/ApprovalBadge';
import LoadingState from '../../components/LoadingState';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { isGradeTeacher } from '../../utils/authScope';
import { formatGradeClass } from '../../utils/student';

export default function SchoolApprovals() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [processingId, setProcessingId] = useState(null); // double-submit guard
  const [rejectTarget, setRejectTarget] = useState(null);
  const [reviewNote, setReviewNote] = useState('');
  const toast = useToast();
  const { user } = useAuth();
  const isTeacher = isGradeTeacher(user); // teacher views in read-only mode

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/school/roster-requests?status=${filter}`);
      setRequests(res.data.data);
    } catch {} finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  async function handleReview(id, status, note = '') {
    // Double-submit guard: prevent approving/rejecting the same request twice
    // (double-click or impatient repeat click).
    if (processingId === id) return;
    setProcessingId(id);
    try {
      await api.put(`/school/roster-requests/${id}`, { status, review_note: note.trim() });
      toast.success(status === 'approved' ? 'อนุมัติสำเร็จ' : 'ปฏิเสธสำเร็จ');
      setRejectTarget(null);
      setReviewNote('');
      fetchRequests();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถดำเนินการได้');
    } finally {
      setProcessingId(null);
    }
  }

  const TYPE_LABEL = { add: 'เพิ่มนักเรียน', remove: 'ถอนนักเรียน' };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <PageHeader
        title="คำขอเปลี่ยนแปลงรายชื่อ"
        subtitle="คำขอเพิ่มหรือถอนนักเรียนจากรถรับส่ง ที่ส่งมาจากคนขับ"
      />

      <FilterBar
        className="mb-4"
        chips={{
          label: 'กรองตามสถานะคำขอ',
          value: filter,
          onChange: setFilter,
          options: [['pending', 'รออนุมัติ'], ['approved', 'อนุมัติแล้ว'], ['rejected', 'ปฏิเสธแล้ว']],
        }}
        count={requests.length}
        countLabel="คำขอ"
      />

      {loading ? (
        <LoadingState />
      ) : requests.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={filter === 'pending' ? 'ยังไม่มีคำขอที่รออนุมัติ' : 'ไม่พบข้อมูลตามเงื่อนไขที่เลือก'}
          description={filter === 'pending' ? 'คำขอจากคนขับจะแสดงที่นี่' : 'ลองเลือกสถานะอื่น'}
        />
      ) : (
        <div className="space-y-3">
          {requests.map(r => (
            <div key={r.id} className="bg-surface-raised rounded-xl border border-surface-border px-4 sm:px-5 py-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink break-words">{TYPE_LABEL[r.request_type]} — {r.student_name}</p>
                  <p className="text-xs text-ink-muted break-words">
                    รถ: {r.plate_no} · {formatGradeClass(r.grade, r.classroom, '')} · ขอโดย: {r.requested_by_name || '-'}
                  </p>
                  {r.reason && <p className="text-xs text-ink-muted mt-0.5 break-words">เหตุผล: {r.reason}</p>}
                  <p className="text-xs text-ink-muted mt-0.5">
                    {new Date(r.created_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {r.review_note && <> · หมายเหตุ: {r.review_note}</>}
                  </p>
                </div>
                <div className="shrink-0">
                  <ApprovalBadge status={r.status} />
                </div>
              </div>

              {r.status === 'pending' && !isTeacher && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                  <button onClick={() => handleReview(r.id, 'approved')}
                    disabled={processingId === r.id}
                    className="flex-1 sm:flex-none bg-green-700 hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-5 py-2.5 rounded-lg transition">
                    {processingId === r.id ? 'กำลังดำเนินการ...' : 'อนุมัติ'}
                  </button>
                  <button onClick={() => { setReviewNote(''); setRejectTarget(r); }}
                    disabled={processingId === r.id}
                    className="flex-1 sm:flex-none bg-red-100 hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed text-red-700 font-medium px-5 py-2.5 rounded-lg transition">
                    {processingId === r.id ? 'กำลังดำเนินการ...' : 'ปฏิเสธ'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(rejectTarget)}
        title="ยืนยันการปฏิเสธคำขอ"
        description="ระบุหมายเหตุได้หากต้องการแจ้งเหตุผลให้ผู้ขอทราบ"
        itemName={rejectTarget?.student_name}
        confirmLabel="ปฏิเสธคำขอ"
        loading={processingId === rejectTarget?.id}
        onConfirm={() => handleReview(rejectTarget.id, 'rejected', reviewNote)}
        onCancel={() => {
          if (processingId !== rejectTarget?.id) { setRejectTarget(null); setReviewNote(''); }
        }}
      >
        <FormField
          label="เหตุผลที่ปฏิเสธ (ถ้ามี)"
          value={reviewNote}
          onChange={setReviewNote}
          placeholder="เช่น ข้อมูลนักเรียนไม่ตรงกับทะเบียน"
        />
      </ConfirmDialog>
    </div>
  );
}
