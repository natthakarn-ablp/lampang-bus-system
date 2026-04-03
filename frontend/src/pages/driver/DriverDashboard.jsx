import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';
import { useToast } from '../../components/Toast';
import {
  resolveSession,
  SESSION_LABEL,
  ACTION_LABEL,
  BULK_LABEL,
  ALL_DONE_LABEL,
  DONE_LABEL,
} from '../../utils/session';

const POLL_INTERVAL = 30_000;

const LEAVE_LABEL = { morning: 'ลาเช้า', evening: 'ลาเย็น', both: 'ลาทั้งวัน' };

/** Check if student is on leave for the given session */
function isOnLeave(student, session) {
  if (!student.leave_session) return false;
  if (student.leave_session === 'both') return true;
  return student.leave_session === session;
}

/** Check if student has a partial leave (on leave for one session, not the current one) */
function getPartialLeaveLabel(student, session) {
  if (!student.leave_session) return null;
  if (student.leave_session === 'both') return null; // fully on leave
  if (student.leave_session === session) return null; // on leave for current session
  // On leave for the OTHER session — show info badge
  return LEAVE_LABEL[student.leave_session];
}

export default function DriverDashboard() {
  const navigate = useNavigate();
  const toast = useToast();

  const [session, setSession] = useState(null);
  const sessionRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [roster, setRoster] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMsg, setBulkMsg] = useState('');
  const [actionLoading, setActionLoading] = useState({});
  const [leaveLoading, setLeaveLoading] = useState({});

  // Step 1: resolve session
  useEffect(() => {
    api.get('/driver/status-today')
      .then((res) => {
        setStatus(res.data.data);
        const resolved = resolveSession(res.data.data?.current_session);
        sessionRef.current = resolved;
        setSession(resolved);
      })
      .catch((err) => {
        setError(err.response?.data?.message || 'ไม่สามารถโหลดข้อมูลได้');
        const fallback = resolveSession(null);
        sessionRef.current = fallback;
        setSession(fallback);
      });
  }, []);

  // Step 2: fetch roster + status
  const fetchData = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      const [rosterRes, statusRes] = await Promise.all([
        api.get(`/driver/roster?session=${s}`),
        api.get('/driver/status-today'),
      ]);
      setRoster(rosterRes.data.data);
      setStatus(statusRes.data.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    fetchData();
    const timer = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [session, fetchData]);

  // Checkin action
  async function handleCheckin(studentId) {
    setActionLoading((p) => ({ ...p, [studentId]: true }));
    try {
      await api.post('/driver/checkin', { student_id: studentId, session });
      toast.success(ACTION_LABEL[session]);
      await fetchData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด');
    } finally {
      setActionLoading((p) => ({ ...p, [studentId]: false }));
    }
  }

  // Inline leave action with specific leave type
  async function handleLeave(studentId, leaveSession) {
    setLeaveLoading((p) => ({ ...p, [studentId]: true }));
    try {
      await api.post('/driver/leave', { student_id: studentId, session: leaveSession });
      toast.success(`บันทึก${LEAVE_LABEL[leaveSession]}สำเร็จ`);
      await fetchData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถบันทึกการลาได้');
    } finally {
      setLeaveLoading((p) => ({ ...p, [studentId]: false }));
    }
  }

  // Bulk action
  async function handleBulkAction() {
    setBulkLoading(true);
    setBulkMsg('');
    try {
      const res = await api.post('/driver/checkin-all', { session });
      const { succeeded, failed } = res.data.data;
      setBulkMsg(
        `สำเร็จ ${succeeded.length} คน` +
        (failed.length > 0 ? ` · ล้มเหลว ${failed.length} คน` : '')
      );
      await fetchData();
    } catch (err) {
      setBulkMsg(err.response?.data?.message || 'เกิดข้อผิดพลาด');
    } finally {
      setBulkLoading(false);
    }
  }

  const students = roster?.students || [];
  const s = status?.summary;

  // Categorize students: on leave (for THIS session) / done / pending
  const onLeave = students.filter((st) => isOnLeave(st, session));
  const notOnLeave = students.filter((st) => !isOnLeave(st, session));
  const pending = notOnLeave.filter((st) => (session === 'morning' ? !st.morning_done : !st.evening_done));
  const done = notOnLeave.filter((st) => (session === 'morning' ? !!st.morning_done : !!st.evening_done));
  const allDone = !loading && notOnLeave.length > 0 && pending.length === 0;

  if (!session) {
    return <div className="p-6 text-center text-gray-400">กำลังตรวจสอบโหมด…</div>;
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-800">ภาพรวมวันนี้</h1>
          {roster?.vehicle && (
            <p className="text-sm text-gray-500 mt-0.5">
              รถ: <span className="font-medium text-gray-700">{roster.vehicle.plate_no}</span>
            </p>
          )}
          <span
            className={`inline-block mt-2 text-sm font-semibold px-3 py-1 rounded-full ${
              session === 'morning'
                ? 'bg-orange-100 text-orange-700'
                : 'bg-indigo-100 text-indigo-700'
            }`}
          >
            {session === 'morning' ? '🌅' : '🌆'} โหมด: {SESSION_LABEL[session]}
          </span>
        </div>

        <button
          onClick={() => navigate('/driver/emergency')}
          className="flex items-center gap-2 bg-red-100 hover:bg-red-200 text-red-700 font-medium text-sm px-4 py-2 rounded-lg transition flex-shrink-0"
        >
          🚨 แจ้งเหตุฉุกเฉิน
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="mb-5 space-y-3">
            <DashboardCard
              label="นักเรียนทั้งหมด"
              value={s?.total ?? students.length}
              color="blue"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DashboardCard
                label={DONE_LABEL.morning}
                value={s?.morning_done ?? 0}
                sub={
                  parseInt(s?.morning_pending ?? 1, 10) === 0
                    ? ALL_DONE_LABEL.morning
                    : `รอ ${s?.morning_pending ?? 0} คน`
                }
                color={parseInt(s?.morning_pending ?? 1, 10) === 0 ? 'green' : 'gray'}
              />
              <DashboardCard
                label={DONE_LABEL.evening}
                value={s?.evening_done ?? 0}
                sub={
                  parseInt(s?.evening_pending ?? 1, 10) === 0
                    ? ALL_DONE_LABEL.evening
                    : `รอ ${s?.evening_pending ?? 0} คน`
                }
                color={parseInt(s?.evening_pending ?? 1, 10) === 0 ? 'green' : 'gray'}
              />
            </div>
          </div>

          {/* Bulk action */}
          <div className="flex items-center gap-3 mb-4">
            {allDone ? (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-5 py-2 rounded-lg text-sm font-medium">
                ✅ {ALL_DONE_LABEL[session]}
              </div>
            ) : (
              <button
                onClick={handleBulkAction}
                disabled={bulkLoading || pending.length === 0}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
              >
                {bulkLoading
                  ? 'กำลังดำเนินการ…'
                  : `${BULK_LABEL[session]} (${pending.length} คน)`}
              </button>
            )}
            {bulkMsg && <span className="text-sm text-gray-600">{bulkMsg}</span>}
          </div>

          {/* Pending students */}
          {pending.length > 0 && (
            <section className="mb-5">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                รอดำเนินการ ({pending.length})
              </h2>
              <div className="space-y-2">
                {pending.map((st) => (
                  <StudentRow
                    key={st.id}
                    student={st}
                    session={session}
                    rowState="pending"
                    onCheckin={() => handleCheckin(st.id)}
                    onLeave={(leaveType) => handleLeave(st.id, leaveType)}
                    checkinLoading={!!actionLoading[st.id]}
                    leaveLoading={!!leaveLoading[st.id]}
                    partialLeaveLabel={getPartialLeaveLabel(st, session)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Done students */}
          {done.length > 0 && (
            <section className="mb-5">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                เสร็จแล้ว ({done.length})
              </h2>
              <div className="space-y-2">
                {done.map((st) => (
                  <StudentRow key={st.id} student={st} session={session} rowState="done"
                    partialLeaveLabel={getPartialLeaveLabel(st, session)} />
                ))}
              </div>
            </section>
          )}

          {/* On-leave students */}
          {onLeave.length > 0 && (
            <section className="mb-5">
              <h2 className="text-sm font-semibold text-amber-600 uppercase tracking-wide mb-3">
                ลาวันนี้ ({onLeave.length})
              </h2>
              <div className="space-y-2">
                {onLeave.map((st) => (
                  <StudentRow key={st.id} student={st} session={session} rowState="leave" />
                ))}
              </div>
            </section>
          )}

          {students.length === 0 && (
            <p className="text-center text-gray-400 py-10">ไม่มีนักเรียนในรถ</p>
          )}

          <p className="text-center text-xs text-gray-300 mt-6">
            รีเฟรชอัตโนมัติทุก 30 วินาที
          </p>
        </>
      )}
    </div>
  );
}

/**
 * LeaveMenu — dropdown with 3 leave options
 */
function LeaveMenu({ onSelect, loading }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function close(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  function handleSelect(type) {
    setOpen(false);
    onSelect(type);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        className="text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-lg transition disabled:opacity-50"
      >
        {loading ? '…' : 'ลา ▾'}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[120px]">
          <button onClick={() => handleSelect('morning')}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-amber-50 transition">
            ลาเช้า
          </button>
          <button onClick={() => handleSelect('evening')}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-amber-50 transition">
            ลาเย็น
          </button>
          <button onClick={() => handleSelect('both')}
            className="w-full text-left px-3 py-2 text-sm text-amber-700 font-medium hover:bg-amber-50 transition">
            ลาทั้งวัน
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * StudentRow — renders differently based on rowState: 'pending' | 'done' | 'leave'
 */
function StudentRow({ student, session, rowState, onCheckin, onLeave, checkinLoading, leaveLoading, partialLeaveLabel }) {
  const doneText = session === 'morning' ? 'ส่งแล้ว' : 'รับแล้ว';
  const leaveText = LEAVE_LABEL[student.leave_session] || 'ลา';

  const borderClass = {
    pending: 'border-gray-200',
    done: 'border-green-200',
    leave: 'border-amber-200',
  }[rowState];

  return (
    <div className={`bg-white rounded-xl border px-4 py-3 transition ${borderClass}`}>
      <div className="flex items-center justify-between gap-2">
        {/* Student info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-gray-800 text-sm truncate">
              {student.prefix} {student.first_name} {student.last_name}
            </p>
            {/* Partial leave badge: student has leave for other session */}
            {partialLeaveLabel && (
              <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded flex-shrink-0">
                {partialLeaveLabel}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {student.grade && student.classroom ? `${student.grade}/${student.classroom}` : student.grade || '-'}
            {student.school_name && <span className="text-gray-400"> · {student.school_name}</span>}
          </p>
        </div>

        {/* Status / Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {rowState === 'done' && (
            <span className="text-green-700 bg-green-100 text-xs font-medium px-3 py-1 rounded-full">
              ✓ {doneText}
            </span>
          )}
          {rowState === 'leave' && (
            <span className="text-amber-700 bg-amber-100 text-xs font-medium px-3 py-1 rounded-full">
              {leaveText}
            </span>
          )}
          {rowState === 'pending' && (
            <>
              <LeaveMenu onSelect={onLeave} loading={leaveLoading} />
              <button
                onClick={onCheckin}
                disabled={checkinLoading}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition"
              >
                {checkinLoading ? '…' : ACTION_LABEL[session]}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
