import { useState } from 'react';
import api from '../../api/axios';
import { ACTION_LABEL } from '../../utils/session';
import { useToast } from '../../components/Toast';

export default function CheckinPanel({ student, session, onDone }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const toast = useToast();

  const isDone = session === 'morning' ? !!student.morning_done : !!student.evening_done;

  async function handleAction() {
    setError('');
    setLoading(true);
    try {
      await api.post('/driver/checkin', { student_id: student.id, session });
      toast.success(`${student.first_name} — ${ACTION_LABEL[session]}`);
      onDone?.();
    } catch (err) {
      setError(err.response?.data?.message || 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }

  // Done badge wording: morning = "ส่งแล้ว", evening = "รับแล้ว"
  const doneText = session === 'morning' ? 'ส่งแล้ว' : 'รับแล้ว';

  return (
    <div
      className={`flex flex-col bg-white rounded-xl border px-5 py-4 shadow-sm transition
        ${isDone ? 'border-green-200' : 'border-gray-200'}`}
    >
      <div className="flex items-center justify-between">
        {/* Student info */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 truncate">
            {student.prefix} {student.first_name} {student.last_name}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            ชั้น {student.grade && student.classroom ? `${student.grade}/${student.classroom}` : student.grade || student.classroom || '-'} · {student.dropoff_address || 'ไม่ระบุที่อยู่'}
          </p>
        </div>

        {/* Action / done state */}
        <div className="ml-4 flex-shrink-0">
          {isDone ? (
            <span className="text-green-700 bg-green-100 text-xs font-medium px-3 py-1 rounded-full">
              ✓ {doneText}
            </span>
          ) : (
            <button
              onClick={handleAction}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition"
            >
              {loading ? '…' : ACTION_LABEL[session]}
            </button>
          )}
        </div>
      </div>

      {/* Inline error */}
      {error && (
        <p className="text-xs text-red-600 mt-2">{error}</p>
      )}
    </div>
  );
}
