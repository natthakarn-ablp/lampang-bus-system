import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import ApprovalBadge from '../../components/ApprovalBadge';
import LoadingState from '../../components/LoadingState';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { isGradeTeacher } from '../../utils/authScope';

export default function SchoolApprovals() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
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

  async function handleReview(id, status) {
    const note = status === 'rejected' ? prompt('เหตุผลที่ปฏิเสธ (ถ้ามี):') : '';
    try {
      await api.put(`/school/roster-requests/${id}`, { status, review_note: note || '' });
      toast.success(status === 'approved' ? 'อนุมัติสำเร็จ' : 'ปฏิเสธสำเร็จ');
      fetchRequests();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถดำเนินการได้');
    }
  }

  const TYPE_LABEL = { add: 'เพิ่มนักเรียน', remove: 'ถอนนักเรียน' };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-4">คำขอเปลี่ยนแปลงรายชื่อ</h1>

      <div className="flex gap-2 mb-4">
        {['pending', 'approved', 'rejected'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`flex-1 sm:flex-none px-4 py-2.5 text-sm font-medium rounded-lg transition min-h-[40px] ${filter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s === 'pending' ? 'รออนุมัติ' : s === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว'}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState />
      ) : requests.length === 0 ? (
        <p className="text-gray-400 py-10 text-center">
          {filter === 'pending' ? 'ยังไม่มีคำขอที่รออนุมัติ' : 'ไม่พบข้อมูลตามเงื่อนไขที่เลือก'}
        </p>
      ) : (
        <div className="space-y-3">
          {requests.map(r => (
            <div key={r.id} className="bg-white rounded-xl border border-gray-200 px-4 sm:px-5 py-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 break-words">{TYPE_LABEL[r.request_type]} — {r.student_name}</p>
                  <p className="text-xs text-gray-500 break-words">
                    รถ: {r.plate_no} · {r.grade && r.classroom ? `${r.grade}/${r.classroom}` : ''} · ขอโดย: {r.requested_by_name || '-'}
                  </p>
                  {r.reason && <p className="text-xs text-gray-400 mt-0.5 break-words">เหตุผล: {r.reason}</p>}
                  <p className="text-xs text-gray-400 mt-0.5">
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
                    className="flex-1 sm:flex-none bg-green-600 hover:bg-green-700 text-white font-medium px-5 py-2.5 rounded-lg transition">
                    อนุมัติ
                  </button>
                  <button onClick={() => handleReview(r.id, 'rejected')}
                    className="flex-1 sm:flex-none bg-red-100 hover:bg-red-200 text-red-700 font-medium px-5 py-2.5 rounded-lg transition">
                    ปฏิเสธ
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
