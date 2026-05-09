import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../api/axios';
import CheckinPanel from './CheckinPanel';
import {
  resolveSession,
  SESSION_LABEL,
  BULK_LABEL,
  ALL_DONE_LABEL,
} from '../../utils/session';

const POLL_INTERVAL = 30_000;

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

export default function StudentList() {
  const [session, setSession] = useState(null);
  const sessionRef = useRef(null);

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMsg,     setBulkMsg]     = useState('');

  useEffect(() => {
    api.get('/driver/status-today')
      .then((res) => {
        const resolved = resolveSession(res.data.data?.current_session);
        sessionRef.current = resolved;
        setSession(resolved);
      })
      .catch(() => {
        const fallback = resolveSession(null);
        sessionRef.current = fallback;
        setSession(fallback);
      });
  }, []);

  const fetchRoster = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      const res = await api.get(`/driver/roster?session=${s}`);
      setData(res.data.data);
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
    fetchRoster();
    const timer = setInterval(fetchRoster, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [session, fetchRoster]);

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
      await fetchRoster();
    } catch (err) {
      setBulkMsg(err.response?.data?.message || 'เกิดข้อผิดพลาด');
    } finally {
      setBulkLoading(false);
    }
  }

  const students = data?.students || [];
  const pending  = students.filter(st => session === 'morning' ? !st.morning_done : !st.evening_done);
  const done     = students.filter(st => session === 'morning' ? !!st.morning_done : !!st.evening_done);
  const allDone  = !loading && students.length > 0 && pending.length === 0;

  if (!session) {
    return <div className="p-6 text-center text-lg text-gray-400">กำลังตรวจสอบโหมด…</div>;
  }

  return (
    <div className="p-3 sm:p-5 max-w-2xl mx-auto pb-8">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-800">รายชื่อนักเรียน</h1>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {data?.vehicle && (
            <span className="text-sm text-gray-600">
              🚌 <span className="font-semibold">{data.vehicle.plate_no}</span>
            </span>
          )}
          <span className={`text-sm font-semibold px-3 py-1 rounded-full ${
            session === 'morning'
              ? 'bg-orange-100 text-orange-700'
              : 'bg-indigo-100 text-indigo-700'
          }`}>
            {session === 'morning' ? '🌅' : '🌆'} {SESSION_LABEL[session]}
          </span>
        </div>
      </div>

      {/* Bulk action */}
      <div className="mb-5">
        {allDone ? (
          <div className="bg-green-100 border-2 border-green-300 text-green-800 rounded-xl px-4 py-3 text-center text-lg font-semibold">
            ✅ {ALL_DONE_LABEL[session]}
          </div>
        ) : (
          <button
            onClick={handleBulkAction}
            disabled={bulkLoading || pending.length === 0}
            className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 disabled:opacity-50 text-white text-lg font-semibold px-5 py-4 rounded-xl transition"
          >
            {bulkLoading
              ? 'กำลังดำเนินการ…'
              : `${BULK_LABEL[session]} (${pending.length} คน)`}
          </button>
        )}
        {bulkMsg && <p className="text-center text-sm text-gray-600 mt-2">{bulkMsg}</p>}
      </div>

      {error && (
        <div className="bg-red-50 border-2 border-red-200 text-red-700 rounded-xl px-4 py-3 mb-4 text-base font-medium">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-center text-gray-400 py-10 text-lg">กำลังโหลด…</div>
      )}

      {/* Pending students — grouped by school */}
      {!loading && pending.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base font-semibold text-gray-600 mb-3">
            ⏳ รอดำเนินการ ({pending.length})
          </h2>
          {groupBySchool(pending).map(([school, sts]) => (
            <div key={school} className="mb-4">
              <p className="text-sm font-semibold text-blue-600 bg-blue-50 rounded-lg px-3 py-1.5 mb-2">
                🏫 {school}
              </p>
              <div className="space-y-3">
                {sts.map((st) => (
                  <CheckinPanel key={st.id} student={st} session={session} onDone={fetchRoster} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Done students */}
      {!loading && done.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base font-semibold text-green-600 mb-3">
            ✅ เสร็จแล้ว ({done.length})
          </h2>
          <div className="space-y-2">
            {done.map((st) => (
              <CheckinPanel key={st.id} student={st} session={session} onDone={fetchRoster} />
            ))}
          </div>
        </section>
      )}

      {!loading && students.length === 0 && (
        <p className="text-center text-gray-400 py-10 text-lg">ไม่มีนักเรียนในรถ</p>
      )}

      <p className="text-center text-xs text-gray-300 mt-8">
        รีเฟรชอัตโนมัติทุก 30 วินาที
      </p>
    </div>
  );
}
