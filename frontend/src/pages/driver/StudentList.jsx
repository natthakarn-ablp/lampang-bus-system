import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../api/axios';
import CheckinPanel from './CheckinPanel';
import {
  resolveSession,
  SESSION_LABEL,
  BULK_LABEL,
  ALL_DONE_LABEL,
} from '../../utils/session';

const POLL_INTERVAL = 30_000; // 30 seconds

export default function StudentList() {
  // Session is resolved from the backend (source of truth) then falls back to
  // local browser time. Stored in a ref so polling doesn't change it mid-shift.
  const [session, setSession] = useState(null); // null = not yet resolved
  const sessionRef = useRef(null);

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMsg,     setBulkMsg]     = useState('');

  // ── Step 1: resolve session from backend status-today ──────────────────────
  useEffect(() => {
    api.get('/driver/status-today')
      .then((res) => {
        const resolved = resolveSession(res.data.data?.current_session);
        sessionRef.current = resolved;
        setSession(resolved);
      })
      .catch(() => {
        // Backend unreachable — fall back to local browser time
        const fallback = resolveSession(null);
        sessionRef.current = fallback;
        setSession(fallback);
      });
  }, []); // run once on mount

  // ── Step 2: fetch roster once session is known, then poll ─────────────────
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
  }, []); // stable — reads session via ref

  useEffect(() => {
    if (!session) return; // wait until session is resolved
    setLoading(true);
    fetchRoster();
    const timer = setInterval(fetchRoster, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [session, fetchRoster]);

  // ── Bulk action ───────────────────────────────────────────────────────────
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
  const pending  = students.filter(s => session === 'morning' ? !s.morning_done : !s.evening_done);
  const done     = students.filter(s => session === 'morning' ? !!s.morning_done : !!s.evening_done);
  const allDone  = !loading && students.length > 0 && pending.length === 0;

  // ── Render ────────────────────────────────────────────────────────────────
  if (!session) {
    return <div className="p-6 text-center text-gray-400">กำลังตรวจสอบโหมด…</div>;
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800">รายชื่อนักเรียน</h1>
          {data?.vehicle && (
            <p className="text-sm text-gray-500 mt-1">
              รถ: <span className="font-medium text-gray-700">{data.vehicle.plate_no}</span>
              {' · '}วันที่: {data.date}
            </p>
          )}
        </div>

        {/* Current mode badge */}
        <span
          className={`text-sm font-semibold px-4 py-1.5 rounded-full flex-shrink-0 ${
            session === 'morning'
              ? 'bg-orange-100 text-orange-700'
              : 'bg-indigo-100 text-indigo-700'
          }`}
        >
          {session === 'morning' ? '🌅' : '🌆'} โหมดปัจจุบัน: {SESSION_LABEL[session]}
        </span>
      </div>

      {/* Bulk action / all-done banner */}
      <div className="flex items-center gap-3 mb-5">
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

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center text-gray-400 py-10">กำลังโหลด…</div>
      )}

      {/* Pending students */}
      {!loading && pending.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            รอดำเนินการ ({pending.length})
          </h2>
          <div className="space-y-3">
            {pending.map((s) => (
              <CheckinPanel key={s.id} student={s} session={session} onDone={fetchRoster} />
            ))}
          </div>
        </section>
      )}

      {/* Done students */}
      {!loading && done.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            เสร็จแล้ว ({done.length})
          </h2>
          <div className="space-y-3">
            {done.map((s) => (
              <CheckinPanel key={s.id} student={s} session={session} onDone={fetchRoster} />
            ))}
          </div>
        </section>
      )}

      {!loading && students.length === 0 && (
        <p className="text-center text-gray-400 py-10">ไม่มีนักเรียนในรถ</p>
      )}

      <p className="text-center text-xs text-gray-300 mt-8">
        รีเฟรชอัตโนมัติทุก 30 วินาที
      </p>
    </div>
  );
}
