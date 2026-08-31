import { useState } from 'react';
import api from '../../api/axios';
import ErrorState from '../../components/ErrorState';
import { ACTION_LABEL } from '../../utils/session';
import { useToast } from '../../components/Toast';
import { formatGradeClass } from '../../utils/student';

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

  const doneText = session === 'morning' ? 'ส่งแล้ว' : 'รับแล้ว';

  return (
    <div className={`rounded-2xl border-2 overflow-hidden transition ${isDone ? 'border-green-300 bg-green-50/50' : 'border-gray-200'}`}>
      {/* Student info */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-base font-bold text-gray-900 leading-snug">
              {student.first_name} {student.last_name}
            </p>
            <p className="text-sm text-gray-500 mt-0.5">
              {formatGradeClass(student.grade, student.classroom)}
              {student.school_name && <span className="text-gray-400"> · {student.school_name}</span>}
            </p>
          </div>

          {isDone && (
            <span className="text-green-700 bg-green-100 border border-green-300 text-sm font-bold px-3 py-1 rounded-full shrink-0">
              {doneText}
            </span>
          )}
        </div>
      </div>

      {/* Action button */}
      {!isDone && (
        <div className="px-3 pb-3">
          <button
            onClick={handleAction}
            disabled={loading}
            className={`w-full text-white font-bold text-base py-3 rounded-xl transition ${
              session === 'morning'
                ? 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
                : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800'
            } disabled:opacity-50`}
          >
            {loading ? 'กำลังบันทึก…' : ACTION_LABEL[session]}
          </button>
        </div>
      )}

      {error && (
        <div className="px-4 pb-3">
          <ErrorState message={error} onRetry={load} />
        </div>
      )}
    </div>
  );
}
