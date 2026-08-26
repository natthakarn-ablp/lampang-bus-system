import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bus, Sunrise, Sunset, AlertTriangle, CheckCircle2, Check, X,
  Clock, Building2, ClipboardList, RotateCcw,
} from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import { AppCard, StatusBadge } from '../../components/ui';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import LiveLocationToggle from '../../components/LiveLocationToggle';
import { PageTransition, PulseDot } from '../../lib/motion';
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
  // End-of-route drop-off confirmation (records CHECKED_OUT for everyone boarded —
  // the step that was missing, leaving checkout recorded only ~11% of the time).
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkedOut, setCheckedOut] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const [leaveLoading, setLeaveLoading] = useState({});
  const [showIndividual, setShowIndividual] = useState(false);

  // Pre-trip gate
  const [pretripDone, setPretripDone] = useState(null); // null=loading, object={done,checked_at,all_pass}
  const [pretripLoading, setPretripLoading] = useState(true);

  // Fetch pretrip status
  useEffect(() => {
    api.get('/driver/pretrip-status')
      .then(r => setPretripDone(r.data?.data || { done: false }))
      .catch(() => setPretripDone({ done: false }))
      .finally(() => setPretripLoading(false));
  }, []);

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

  // Derived state
  const students = roster?.students || [];
  const onLeave = students.filter((st) => isOnLeave(st, session));
  const notOnLeave = students.filter((st) => !isOnLeave(st, session));
  const pending = notOnLeave.filter((st) => (session === 'morning' ? !st.morning_done : !st.evening_done));
  const done = notOnLeave.filter((st) => (session === 'morning' ? !!st.morning_done : !!st.evening_done));
  const allDone = !loading && notOnLeave.length > 0 && pending.length === 0;
  const pretripBlocked = !pretripLoading && (!pretripDone || !pretripDone.done);

  async function handleCheckin(studentId) {
    if (pretripBlocked) { toast.error('กรุณาตรวจรถก่อนออกก่อนเช็กชื่อ'); return; }
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

  async function handleCancelLeave(leaveId) {
    if (!leaveId) return;
    try {
      await api.delete(`/driver/leave/${leaveId}`);
      toast.success('ยกเลิกการลาสำเร็จ');
      await fetchData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถยกเลิกได้');
    }
  }

  async function handleBulkAction() {
    if (pretripBlocked) { toast.error('กรุณาตรวจรถก่อนออกก่อนเช็กชื่อ'); return; }
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

  async function handleCheckoutAll() {
    setCheckoutLoading(true);
    try {
      const res = await api.post('/driver/checkout-all', { session });
      const { succeeded, failed } = res.data.data;
      toast.success(`บันทึกส่งลงครบ ${succeeded.length} คน` + (failed.length > 0 ? ` · ล้มเหลว ${failed.length} คน` : ''));
      setCheckedOut(true);
      await fetchData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด');
    } finally {
      setCheckoutLoading(false);
    }
  }

  const s = status?.summary;

  if (!session) {
    return <div className="p-6 text-center text-lg text-ink-muted">กำลังตรวจสอบโหมด…</div>;
  }

  return (
    <PageTransition>
    <div className="p-3 sm:p-5 max-w-2xl mx-auto pb-8">
      {/* ══ BLOCKING PRE-TRIP MODAL (inline checklist) ══ */}
      {pretripBlocked && !pretripLoading && (
        <PretripModal
          onComplete={(result) => {
            setPretripDone({ done: true, checked_at: new Date().toISOString(), all_pass: result.all_pass });
          }}
        />
      )}

      {/* ── Phase 7.3 — Driver location sender (explicit toggle) ── */}
      <LiveLocationToggle />

      {/* ── Top info bar (neutral surface; icon carries session differentiation).
            Phase 10.7D — pretrip status + remaining-checkin pills consolidated
            here for at-a-glance scanning. The wider AlertBanner that previously
            showed "ตรวจรถแล้ววันนี้ เวลา HH:MM" is replaced by a compact pill;
            the underlying pretrip gate (PretripModal) is UNCHANGED. ── */}
      <AppCard padding="md" className="mb-4 motion-safe:animate-fade-in-up">
        <div className="flex items-center justify-between mb-2">
          <span className="inline-flex items-center gap-2 text-lg font-semibold text-ink">
            {session === 'morning'
              ? <Sunrise className="w-5 h-5 text-warn" strokeWidth={2} />
              : <Sunset className="w-5 h-5 text-info" strokeWidth={2} />}
            {session === 'morning' ? 'โหมดส่งเช้า' : 'โหมดรับเย็น'}
          </span>
          <button
            type="button"
            onClick={() => navigate('/driver/emergency')}
            className="focus-ring inline-flex items-center justify-center gap-1.5 bg-danger hover:bg-danger/90 active:bg-danger text-white font-semibold text-sm px-4 min-h-[44px] rounded-xl transition"
          >
            <AlertTriangle className="w-4 h-4" strokeWidth={2.2} />
            ฉุกเฉิน
          </button>
        </div>
        {roster?.vehicle && (
          <p className="inline-flex items-center gap-2 text-base text-ink">
            <Bus className="w-4 h-4 text-ink-muted" strokeWidth={2} />
            <span className="font-semibold">{roster.vehicle.plate_no}</span>
          </p>
        )}

        {/* Phase 10.7D — status pills row. Driver sees, at a glance:
            (a) ตรวจสภาพรถ pass/fail/pending, (b) จำนวนนักเรียนที่เหลือ. */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {/* Pretrip status pill — mirrors the gate state without bypassing it */}
          {pretripLoading ? (
            <StatusBadge variant="neutral" size="sm">กำลังตรวจสถานะรถ…</StatusBadge>
          ) : !pretripDone?.done ? (
            <StatusBadge variant="danger" size="sm" icon={AlertTriangle}>
              ยังไม่ได้ตรวจสภาพรถ
            </StatusBadge>
          ) : pretripDone.all_pass === false ? (
            <StatusBadge variant="warn" size="sm" icon={AlertTriangle}>
              ตรวจสภาพรถแล้ว · มีรายการผิดปกติ
            </StatusBadge>
          ) : (
            <StatusBadge variant="success" size="sm" icon={Check}>
              ตรวจสภาพรถแล้ว
            </StatusBadge>
          )}

          {/* Remaining-checkin pill — only meaningful once roster has loaded */}
          {!loading && notOnLeave.length > 0 && (
            allDone ? (
              <StatusBadge variant="success" size="sm" icon={CheckCircle2}>
                เสร็จครบทุกคน
              </StatusBadge>
            ) : (
              <StatusBadge variant="warn" size="sm" icon={Clock}>
                เหลือเช็กอิน {pending.length} คน
              </StatusBadge>
            )
          )}
        </div>
      </AppCard>

      {error && <ErrorState message={error} className="mb-4" />}

      {loading ? (
        <LoadingState />
      ) : students.length === 0 ? (
        <EmptyState
          icon={Bus}
          title="ยังไม่มีนักเรียนในรถคันนี้"
          description="หากต้องการเพิ่มนักเรียน กรุณาติดต่อโรงเรียน"
        />
      ) : (
        <>
          {/* ── Big progress indicator ── */}
          {(() => {
            const total = notOnLeave.length;
            const pct = total > 0 ? Math.round((done.length / total) * 100) : 0;
            return (
              <div className="mb-4">
                <div className="flex justify-between items-end mb-1">
                  <span className="text-lg font-semibold text-ink">
                    {session === 'morning' ? 'ส่งแล้ว' : 'รับแล้ว'} {done.length}/{total} คน
                  </span>
                  <span className={`text-2xl font-bold tabular-nums ${pct === 100 ? 'text-success' : pct >= 50 ? 'text-warn' : 'text-danger'}`}>{pct}%</span>
                </div>
                <div className="flex w-full h-4 rounded-full overflow-hidden bg-surface">
                  {done.length > 0 && <div className="bg-success h-full transition-all" style={{ width: `${pct}%` }} />}
                  {pending.length > 0 && <div className="bg-danger/80 h-full" style={{ width: `${100 - pct}%` }} />}
                </div>
                {onLeave.length > 0 && (
                  <p className="text-sm text-warn mt-1">ลาวันนี้ {onLeave.length} คน</p>
                )}
              </div>
            );
          })()}

          {/* ── Primary action area ── */}
          <div className="mb-5">
            {allDone ? (
              checkedOut ? (
                <div className="inline-flex w-full items-center justify-center gap-2 bg-success-soft border-2 border-success/40 text-success-ink rounded-xl px-4 py-3 text-center text-lg font-semibold">
                  <CheckCircle2 className="w-5 h-5" strokeWidth={2.2} />
                  จบรอบ — ส่งนักเรียนลงครบแล้ว
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="inline-flex w-full items-center justify-center gap-2 bg-success-soft border-2 border-success/40 text-success-ink rounded-xl px-4 py-3 text-center text-lg font-semibold">
                    <CheckCircle2 className="w-5 h-5" strokeWidth={2.2} />
                    {ALL_DONE_LABEL[session]}
                  </div>
                  {/* End-of-route: one tap records that everyone got off, so checkout
                      data exists (enables a real left-behind check + dwell analytics). */}
                  <button
                    onClick={handleCheckoutAll}
                    disabled={checkoutLoading}
                    className="inline-flex w-full items-center justify-center gap-2 bg-brand-700 hover:bg-brand-700/90 active:bg-brand-700/80 disabled:opacity-50 text-white text-lg font-semibold px-5 py-4 rounded-2xl shadow-soft transition"
                  >
                    {checkoutLoading ? 'กำลังบันทึก…' : 'ยืนยันส่งนักเรียนลงครบแล้ว (จบรอบ)'}
                  </button>
                </div>
              )
            ) : !showIndividual ? (
              /* Default: bulk-first UX */
              <div className="space-y-3">
                <button
                  onClick={handleBulkAction}
                  disabled={bulkLoading || pending.length === 0}
                  className="inline-flex w-full items-center justify-center gap-2 bg-success hover:bg-success/90 active:bg-success/80 disabled:opacity-50 text-white text-xl font-semibold px-5 py-5 rounded-2xl shadow-soft transition"
                >
                  {bulkLoading ? (
                    'กำลังดำเนินการ…'
                  ) : (
                    <>
                      <CheckCircle2 className="w-6 h-6" strokeWidth={2.2} />
                      นักเรียนขึ้นรถครบทุกคน ({pending.length} คน)
                    </>
                  )}
                </button>
                <button
                  onClick={() => setShowIndividual(true)}
                  className="inline-flex w-full items-center justify-center gap-2 bg-warn-soft hover:bg-warn/15 text-warn-ink font-semibold text-lg py-4 rounded-2xl border-2 border-warn/30 transition"
                >
                  <AlertTriangle className="w-5 h-5" strokeWidth={2.2} />
                  มีข้อยกเว้น — เลือกทีละคน
                </button>
              </div>
            ) : (
              /* Individual mode header */
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={handleBulkAction}
                  disabled={bulkLoading || pending.length === 0}
                  className="bg-success hover:bg-success/90 disabled:opacity-50 text-white text-base font-semibold px-5 py-3 rounded-xl transition"
                >
                  {bulkLoading ? '...' : `${BULK_LABEL[session]} (${pending.length} คน)`}
                </button>
                <button onClick={() => setShowIndividual(false)}
                  className="text-sm text-ink-muted hover:text-ink px-3 py-2">
                  ← กลับโหมดรวม
                </button>
              </div>
            )}
            {bulkMsg && (
              <div className="bg-success-soft border border-success/30 rounded-xl px-4 py-3 mt-2 text-center">
                <p className="text-sm text-success font-medium">{bulkMsg}</p>
              </div>
            )}
          </div>

          {/* ── Pending students (shown in individual mode or when needed) ── */}
          {pending.length > 0 && showIndividual && (
            <section className="mb-6">
              <h2 className="inline-flex items-center gap-2 text-base font-semibold text-ink mb-3">
                <Clock className="w-4 h-4 text-ink-muted" strokeWidth={2} />
                รอดำเนินการ ({pending.length})
              </h2>
              {groupBySchool(pending).map(([school, sts]) => (
                <div key={school} className="mb-5 border-l border-surface-border pl-3">
                  <p className="inline-flex items-center gap-1.5 text-base font-semibold text-ink mb-2">
                    <Building2 className="w-4 h-4 text-ink-muted" strokeWidth={2} />
                    {school} ({sts.length} คน)
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
              <h2 className="inline-flex items-center gap-2 text-base font-semibold text-success mb-3">
                <CheckCircle2 className="w-4 h-4" strokeWidth={2.2} />
                เสร็จแล้ว ({done.length})
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
              <h2 className="inline-flex items-center gap-2 text-base font-semibold text-warn mb-3">
                <ClipboardList className="w-4 h-4" strokeWidth={2.2} />
                ลาวันนี้ ({onLeave.length})
              </h2>
              <div className="space-y-2">
                {onLeave.map((st) => (
                  <StudentCard key={st.id} student={st} session={session} state="leave"
                    onCancelLeave={() => handleCancelLeave(st.leave_id)} />
                ))}
              </div>
            </section>
          )}

          {students.length === 0 && (
            <p className="text-center text-ink-muted py-10 text-lg">ไม่มีนักเรียนในรถ</p>
          )}

          <p className="text-center text-xs text-ink-muted mt-6 inline-flex items-center gap-1.5 justify-center">
            <PulseDot color="bg-success" size="sm" />
            รีเฟรชอัตโนมัติทุก 30 วินาที
          </p>
        </>
      )}
    </div>
    </PageTransition>
  );
}

/* ── Summary pill (compact counter) ── */
function SummaryPill({ label, value, color }) {
  const cls = {
    blue:  'bg-brand-50   text-brand-700 border-brand-200',
    green: 'bg-success-soft text-success border-success/30',
    amber: 'bg-warn-soft    text-warn    border-warn/30',
    red:   'bg-danger-soft  text-danger  border-danger/30',
  };
  return (
    <div className={`rounded-xl border text-center py-2 px-1 ${cls[color] || cls.blue}`}>
      <p className="text-2xl font-semibold leading-tight">{value}</p>
      <p className="text-sm font-medium mt-0.5">{label}</p>
    </div>
  );
}

/* ── Student card — big, readable, elderly-friendly ── */
function StudentCard({ student, session, state, onCheckin, onLeave, checkinLoading, leaveLoading, partialLeaveLabel, onCancelLeave }) {
  const [showLeave, setShowLeave] = useState(false);

  const doneText = session === 'morning' ? 'ส่งแล้ว' : 'รับแล้ว';
  const leaveText = LEAVE_LABEL[student.leave_session] || 'ลา';

  const borderCls = {
    pending: 'border-surface-border',
    done: 'border-success/40 bg-success-soft/50',
    leave: 'border-warn/40 bg-warn-soft/50',
  }[state];

  return (
    <div className={`rounded-2xl border overflow-hidden transition ${borderCls}`}>
      {/* ── Student info ── */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-base font-semibold text-ink leading-snug">
              {student.first_name} {student.last_name}
            </p>
            <p className="text-sm text-ink-muted mt-0.5">
              {student.grade && student.classroom ? `${student.grade}/${student.classroom}` : student.grade || '-'}
            </p>
          </div>

          {/* Status badge column — Phase 10.8F-C stacks the override info
              chip below the done/leave status pill in the right column.
              The chip is informational only (no click, no metadata exposed)
              and only appears when the school confirmed this student for
              the CURRENT session via /api/school/checkin-override. */}
          <div className="flex flex-col items-end gap-1 shrink-0">
            {state === 'done' && (
              <StatusBadge variant="success" size="md" icon={Check} className="shrink-0">
                {doneText}
              </StatusBadge>
            )}
            {state === 'leave' && (
              <StatusBadge variant="warn" size="md" className="shrink-0">
                {leaveText}
              </StatusBadge>
            )}
            {partialLeaveLabel && state !== 'leave' && (
              <StatusBadge variant="warn" size="md" className="shrink-0">
                {partialLeaveLabel}
              </StatusBadge>
            )}
            {((session === 'morning' && student.morning_override_by_school) ||
              (session === 'evening' && student.evening_override_by_school)) && (
              <StatusBadge variant="info" size="sm" className="shrink-0">
                ครูยืนยันแทนแล้ว
              </StatusBadge>
            )}
          </div>
        </div>
      </div>

      {/* ── Action area (pending only) ── */}
      {state === 'pending' && !showLeave && (
        <div className="flex gap-2 px-3 pb-3">
          <button
            onClick={onCheckin}
            disabled={checkinLoading}
            className={`flex-1 text-white font-semibold text-base py-3 rounded-xl transition ${
              session === 'morning'
                ? 'bg-brand-600 hover:bg-brand-700 active:bg-brand-800'
                : 'bg-info hover:bg-info/90 active:bg-info/80'
            } disabled:opacity-50`}
          >
            {checkinLoading ? 'กำลังบันทึก…' : ACTION_LABEL[session]}
          </button>
          <button
            onClick={() => setShowLeave(true)}
            disabled={leaveLoading}
            className="bg-warn-soft hover:bg-warn/15 active:bg-warn/25 text-warn-ink font-semibold text-base px-4 py-3 rounded-xl transition border border-warn/30 disabled:opacity-50"
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
              className="bg-warn-soft hover:bg-warn/15 active:bg-warn/25 text-warn-ink font-semibold text-sm py-3 rounded-xl transition border border-warn/30 disabled:opacity-50"
            >
              ลาเช้า
            </button>
            <button
              onClick={() => { onLeave('evening'); setShowLeave(false); }}
              disabled={leaveLoading}
              className="bg-warn-soft hover:bg-warn/15 active:bg-warn/25 text-warn-ink font-semibold text-sm py-3 rounded-xl transition border border-warn/30 disabled:opacity-50"
            >
              ลาเย็น
            </button>
            <button
              onClick={() => { onLeave('both'); setShowLeave(false); }}
              disabled={leaveLoading}
              className="bg-warn/15 hover:bg-warn/25 active:bg-warn/30 text-warn font-semibold text-sm py-3 rounded-xl transition border border-warn/40 disabled:opacity-50"
            >
              ลาทั้งวัน
            </button>
          </div>
          <button
            onClick={() => setShowLeave(false)}
            className="w-full text-ink-muted text-sm py-2 hover:text-ink transition"
          >
            ยกเลิก
          </button>
        </div>
      )}

      {/* ── Cancel leave (on-leave students) ── */}
      {state === 'leave' && onCancelLeave && (
        <div className="px-3 pb-3">
          <button
            onClick={onCancelLeave}
            className="inline-flex w-full items-center justify-center gap-2 bg-surface hover:bg-surface-border active:bg-surface-border text-ink font-semibold text-base py-3 rounded-xl transition border border-surface-border"
          >
            <RotateCcw className="w-4 h-4" strokeWidth={2.2} />
            ยกเลิกการลา
          </button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   PretripModal — blocking inline checklist modal (no navigation)
   ══════════════════════════════════════════════════════════════════════════ */
const PRETRIP_ITEMS = [
  { id: 'tires', label: 'ยางรถ / ลมยาง' },
  { id: 'lights', label: 'ไฟหน้า-ไฟท้าย' },
  { id: 'mirrors', label: 'กระจก / กระจกมองข้าง' },
  { id: 'brakes', label: 'เบรก' },
  { id: 'seatbelts', label: 'เข็มขัดนิรภัย / ที่นั่ง' },
  { id: 'clean', label: 'ความสะอาดภายในรถ' },
];

function PretripModal({ onComplete }) {
  const toast = useToast();
  const [mode, setMode] = useState('summary'); // 'summary' | 'detail'
  const [items, setItems] = useState(() => PRETRIP_ITEMS.map(c => ({ ...c, ok: true })));
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const failedItems = items.filter(i => !i.ok);

  function toggleItem(id) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ok: !i.ok } : i));
  }

  async function handleSubmit(forceAllPass = false) {
    setSubmitting(true);
    try {
      const allPass = forceAllPass || items.every(i => i.ok);
      const submitItems = forceAllPass
        ? PRETRIP_ITEMS.map(c => ({ label: c.label, ok: true }))
        : items.map(i => ({ label: i.label, ok: i.ok }));

      await api.post('/driver/pretrip', {
        all_pass: allPass,
        items: submitItems,
        note: forceAllPass ? null : (note || null),
      });

      toast.success('บันทึกผลตรวจรถสำเร็จ');
      onComplete({ all_pass: allPass });
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/60 z-50 flex items-center justify-center p-3 motion-safe:animate-fade-in">
      <div className="bg-surface-raised border border-surface-border rounded-2xl shadow-elevate max-w-md w-full max-h-[90vh] overflow-y-auto motion-safe:animate-scale-in">

        {/* ── Mode: Summary (default) ── */}
        {mode === 'summary' && (
          <div className="p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-brand-50 inline-flex items-center justify-center">
              <Bus className="w-8 h-8 text-brand-700" strokeWidth={2} aria-hidden="true" />
            </div>
            <h2 className="text-xl font-semibold text-ink mb-1">ตรวจรถก่อนออก</h2>
            <p className="text-base text-ink-muted mb-5">เพื่อความปลอดภัยของนักเรียน</p>

            {/* Checklist preview */}
            <div className="bg-surface rounded-2xl p-4 mb-5 text-left">
              <p className="text-sm font-medium text-ink-muted mb-2">รายการตรวจ 6 รายการ:</p>
              <ul className="space-y-1.5">
                {PRETRIP_ITEMS.map(c => (
                  <li key={c.id} className="flex items-center gap-2 text-base text-ink">
                    <Check className="w-4 h-4 text-success" strokeWidth={2.4} />
                    <span>{c.label}</span>
                  </li>
                ))}
              </ul>
            </div>

            <button onClick={() => handleSubmit(true)} disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 bg-success hover:bg-success/90 active:bg-success/80 text-white font-semibold text-xl py-5 rounded-2xl shadow-soft transition disabled:opacity-50 mb-3">
              {submitting ? 'กำลังบันทึก…' : (
                <>
                  <CheckCircle2 className="w-6 h-6" strokeWidth={2.2} />
                  ทุกรายการปกติ — ออกได้
                </>
              )}
            </button>

            <button onClick={() => setMode('detail')}
              className="inline-flex w-full items-center justify-center gap-2 bg-warn-soft hover:bg-warn/15 text-warn-ink font-semibold text-lg py-4 rounded-2xl border-2 border-warn/30 transition">
              <AlertTriangle className="w-5 h-5" strokeWidth={2.2} />
              มีรายการผิดปกติ
            </button>
          </div>
        )}

        {/* ── Mode: Detail (toggle items) ── */}
        {mode === 'detail' && (
          <div className="p-5">
            <h2 className="text-lg font-semibold text-ink mb-1">ระบุรายการผิดปกติ</h2>
            <p className="text-sm text-ink-muted mb-4">กดรายการที่ <strong>ผิดปกติ</strong></p>

            <div className="space-y-2 mb-4">
              {items.map(item => (
                <button key={item.id} onClick={() => toggleItem(item.id)}
                  className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border text-left text-base font-medium transition ${
                    item.ok
                      ? 'bg-success-soft border-success/40 text-success-ink'
                      : 'bg-danger-soft border-danger/50 text-danger-ink'
                  }`}>
                  {item.ok
                    ? <CheckCircle2 className="w-6 h-6 shrink-0 text-success" strokeWidth={2.2} />
                    : <X className="w-6 h-6 shrink-0 text-danger" strokeWidth={2.4} />}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            {failedItems.length > 0 && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-ink mb-1">
                  รายละเอียด (ถ้ามี)
                </label>
                <textarea value={note} onChange={e => setNote(e.target.value)}
                  rows={2} placeholder="เช่น ยางหลังขวาลมอ่อน…"
                  className="w-full border border-surface-border rounded-xl px-4 py-3 text-base text-ink bg-surface-raised focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/25" />
              </div>
            )}

            {failedItems.length > 0 ? (
              <button onClick={() => handleSubmit(false)} disabled={submitting}
                className="inline-flex w-full items-center justify-center gap-2 bg-danger hover:bg-danger/90 text-white font-semibold text-lg py-4 rounded-2xl shadow-soft transition disabled:opacity-50 mb-3">
                {submitting ? 'กำลังบันทึก…' : (
                  <>
                    <AlertTriangle className="w-5 h-5" strokeWidth={2.2} />
                    บันทึกรายการผิดปกติ ({failedItems.length} รายการ)
                  </>
                )}
              </button>
            ) : (
              <button onClick={() => handleSubmit(true)} disabled={submitting}
                className="inline-flex w-full items-center justify-center gap-2 bg-success hover:bg-success/90 text-white font-semibold text-lg py-4 rounded-2xl shadow-soft transition disabled:opacity-50 mb-3">
                {submitting ? 'กำลังบันทึก…' : (
                  <>
                    <CheckCircle2 className="w-5 h-5" strokeWidth={2.2} />
                    ทุกรายการปกติ — ออกได้
                  </>
                )}
              </button>
            )}

            <button onClick={() => { setMode('summary'); setItems(PRETRIP_ITEMS.map(c => ({ ...c, ok: true }))); setNote(''); }}
              className="w-full text-ink-muted hover:text-ink text-base py-3 transition">
              ← กลับ
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
