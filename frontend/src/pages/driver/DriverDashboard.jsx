import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
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

function isOnLeave(student, session) {
  if (!student.leave_session) return false;
  if (student.leave_session === 'both') return true;
  return student.leave_session === session;
}

function getPartialLeaveLabel(student, session) {
  if (!student.leave_session) return null;
  if (student.leave_session === 'both') return null;
  if (student.leave_session === session) return null;
  return LEAVE_LABEL[student.leave_session];
}

/** Group students by school_name */
function groupBySchool(students) {
  const groups = {};
  for (const st of students) {
    const key = st.school_name || 'ไม่ระบุโรงเรียน';
    if (!groups[key]) groups[key] = [];
    groups[key].push(st);
  }
  return Object.entries(groups);
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

  const onLeave = students.filter((st) => isOnLeave(st, session));
  const notOnLeave = students.filter((st) => !isOnLeave(st, session));
  const pending = notOnLeave.filter((st) => (session === 'morning' ? !st.morning_done : !st.evening_done));
  const done = notOnLeave.filter((st) => (session === 'morning' ? !!st.morning_done : !!st.evening_done));
  const allDone = !loading && notOnLeave.length > 0 && pending.length === 0;

  if (!session) {
    return <div className="p-6 text-center text-lg text-gray-400">กำลังตรวจสอบโหมด…</div>;
  }

  return (
    <div className="p-3 sm:p-5 max-w-2xl mx-auto pb-8">
      {/* ── Top info bar ── */}
      <div className={`rounded-2xl p-4 mb-4 ${session === 'morning' ? 'bg-orange-50 border-2 border-orange-200' : 'bg-indigo-50 border-2 border-indigo-200'}`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-lg font-bold ${session === 'morning' ? 'text-orange-700' : 'text-indigo-700'}`}>
            {session === 'morning' ? '🌅 โหมดส่งเช้า' : '🌆 โหมดรับเย็น'}
          </span>
          <button
            onClick={() => navigate('/driver/emergency')}
            className="bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-4 py-2 rounded-xl transition"
          >
            🚨 ฉุกเฉิน
          </button>
        </div>
        {roster?.vehicle && (
          <p className="text-base text-gray-700">
            🚌 <span className="font-bold">{roster.vehicle.plate_no}</span>
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border-2 border-red-200 text-red-700 rounded-xl px-4 py-3 mb-4 text-base font-medium">{error}</div>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center text-lg">กำลังโหลด…</p>
      ) : (
        <>
          {/* ── Compact summary row ── */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            <SummaryPill label="ทั้งหมด" value={s?.total ?? students.length} color="blue" />
            <SummaryPill label={session === 'morning' ? 'ส่งแล้ว' : 'รับแล้ว'} value={done.length} color="green" />
            <SummaryPill label="ลา" value={onLeave.length} color="amber" />
            <SummaryPill label="รอ" value={pending.length} color={pending.length > 0 ? 'red' : 'green'} />
          </div>

          {/* ── Bulk action ── */}
          <div className="mb-5">
            {allDone ? (
              <div className="bg-green-100 border-2 border-green-300 text-green-800 rounded-xl px-4 py-3 text-center text-lg font-bold">
                ✅ {ALL_DONE_LABEL[session]}
              </div>
            ) : (
              <button
                onClick={handleBulkAction}
                disabled={bulkLoading || pending.length === 0}
                className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 disabled:opacity-50 text-white text-lg font-bold px-5 py-4 rounded-xl transition"
              >
                {bulkLoading
                  ? 'กำลังดำเนินการ…'
                  : `${BULK_LABEL[session]} (${pending.length} คน)`}
              </button>
            )}
            {bulkMsg && <p className="text-center text-sm text-gray-600 mt-2">{bulkMsg}</p>}
          </div>

          {/* ── Pending students (grouped by school) ── */}
          {pending.length > 0 && (
            <section className="mb-6">
              <h2 className="text-base font-bold text-gray-600 mb-3">
                ⏳ รอดำเนินการ ({pending.length})
              </h2>
              {groupBySchool(pending).map(([school, sts]) => (
                <div key={school} className="mb-4">
                  <p className="text-sm font-semibold text-blue-600 bg-blue-50 rounded-lg px-3 py-1.5 mb-2">
                    🏫 {school}
                  </p>
                  <div className="space-y-3">
                    {sts.map((st) => (
                      <StudentCard
                        key={st.id}
                        student={st}
                        session={session}
                        state="pending"
                        onCheckin={() => handleCheckin(st.id)}
                        onLeave={(type) => handleLeave(st.id, type)}
                        checkinLoading={!!actionLoading[st.id]}
                        leaveLoading={!!leaveLoading[st.id]}
                        partialLeaveLabel={getPartialLeaveLabel(st, session)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* ── Done students ── */}
          {done.length > 0 && (
            <section className="mb-6">
              <h2 className="text-base font-bold text-green-600 mb-3">
                ✅ เสร็จแล้ว ({done.length})
              </h2>
              <div className="space-y-2">
                {done.map((st) => (
                  <StudentCard key={st.id} student={st} session={session} state="done"
                    partialLeaveLabel={getPartialLeaveLabel(st, session)} />
                ))}
              </div>
            </section>
          )}

          {/* ── On leave ── */}
          {onLeave.length > 0 && (
            <section className="mb-6">
              <h2 className="text-base font-bold text-amber-600 mb-3">
                📋 ลาวันนี้ ({onLeave.length})
              </h2>
              <div className="space-y-2">
                {onLeave.map((st) => (
                  <StudentCard key={st.id} student={st} session={session} state="leave" />
                ))}
              </div>
            </section>
          )}

          {students.length === 0 && (
            <p className="text-center text-gray-400 py-10 text-lg">ไม่มีนักเรียนในรถ</p>
          )}

          <p className="text-center text-xs text-gray-300 mt-6">
            รีเฟรชอัตโนมัติทุก 30 วินาที
          </p>
        </>
      )}
    </div>
  );
}

/* ── Summary pill (compact counter) ── */
function SummaryPill({ label, value, color }) {
  const cls = {
    blue:  'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    red:   'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <div className={`rounded-xl border-2 text-center py-2 px-1 ${cls[color] || cls.blue}`}>
      <p className="text-2xl font-bold leading-tight">{value}</p>
      <p className="text-xs font-medium mt-0.5">{label}</p>
    </div>
  );
}

/* ── Student card — big, readable, elderly-friendly ── */
function StudentCard({ student, session, state, onCheckin, onLeave, checkinLoading, leaveLoading, partialLeaveLabel }) {
  const [showLeave, setShowLeave] = useState(false);

  const doneText = session === 'morning' ? 'ส่งแล้ว' : 'รับแล้ว';
  const leaveText = LEAVE_LABEL[student.leave_session] || 'ลา';

  const borderCls = {
    pending: 'border-gray-200',
    done: 'border-green-300 bg-green-50/50',
    leave: 'border-amber-300 bg-amber-50/50',
  }[state];

  return (
    <div className={`rounded-2xl border-2 overflow-hidden transition ${borderCls}`}>
      {/* ── Student info ── */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-base font-bold text-gray-900 leading-snug">
              {student.first_name} {student.last_name}
            </p>
            <p className="text-sm text-gray-500 mt-0.5">
              {student.grade && student.classroom ? `${student.grade}/${student.classroom}` : student.grade || '-'}
            </p>
          </div>

          {/* Status badge */}
          {state === 'done' && (
            <span className="text-green-700 bg-green-100 border border-green-300 text-sm font-bold px-3 py-1 rounded-full shrink-0">
              ✓ {doneText}
            </span>
          )}
          {state === 'leave' && (
            <span className="text-amber-700 bg-amber-100 border border-amber-300 text-sm font-bold px-3 py-1 rounded-full shrink-0">
              {leaveText}
            </span>
          )}
          {partialLeaveLabel && state !== 'leave' && (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full shrink-0">
              {partialLeaveLabel}
            </span>
          )}
        </div>
      </div>

      {/* ── Action area (pending only) ── */}
      {state === 'pending' && !showLeave && (
        <div className="flex gap-2 px-3 pb-3">
          <button
            onClick={onCheckin}
            disabled={checkinLoading}
            className={`flex-1 text-white font-bold text-base py-3 rounded-xl transition ${
              session === 'morning'
                ? 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
                : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800'
            } disabled:opacity-50`}
          >
            {checkinLoading ? 'กำลังบันทึก…' : ACTION_LABEL[session]}
          </button>
          <button
            onClick={() => setShowLeave(true)}
            disabled={leaveLoading}
            className="bg-amber-100 hover:bg-amber-200 active:bg-amber-300 text-amber-800 font-bold text-base px-4 py-3 rounded-xl transition border border-amber-300 disabled:opacity-50"
          >
            ลา
          </button>
        </div>
      )}

      {/* ── Leave options (expanded) ── */}
      {state === 'pending' && showLeave && (
        <div className="px-3 pb-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => { onLeave('morning'); setShowLeave(false); }}
              disabled={leaveLoading}
              className="bg-amber-100 hover:bg-amber-200 active:bg-amber-300 text-amber-800 font-bold text-sm py-3 rounded-xl transition border border-amber-300 disabled:opacity-50"
            >
              ลาเช้า
            </button>
            <button
              onClick={() => { onLeave('evening'); setShowLeave(false); }}
              disabled={leaveLoading}
              className="bg-amber-100 hover:bg-amber-200 active:bg-amber-300 text-amber-800 font-bold text-sm py-3 rounded-xl transition border border-amber-300 disabled:opacity-50"
            >
              ลาเย็น
            </button>
            <button
              onClick={() => { onLeave('both'); setShowLeave(false); }}
              disabled={leaveLoading}
              className="bg-amber-200 hover:bg-amber-300 active:bg-amber-400 text-amber-900 font-bold text-sm py-3 rounded-xl transition border border-amber-400 disabled:opacity-50"
            >
              ลาทั้งวัน
            </button>
          </div>
          <button
            onClick={() => setShowLeave(false)}
            className="w-full text-gray-500 text-sm py-2 hover:text-gray-700 transition"
          >
            ยกเลิก
          </button>
        </div>
      )}
    </div>
  );
}
