import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sunrise, Sunset, Bus, CheckCircle2, Undo2, Users } from 'lucide-react';
import api from '../../api/axios';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import LoadingState from '../../components/LoadingState';
import PageHeader from '../../components/PageHeader';
import SchoolWorkflowNav from '../../components/SchoolWorkflowNav';
import { useToast } from '../../components/Toast';
import { AppCard, ConfirmDialog, FilterBar, StatusBadge } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { getGradeScope } from '../../utils/authScope';
import { formatGradeClass } from '../../utils/student';
import { PageTransition } from '../../lib/motion';
import ClassroomCheck from './ClassroomCheck';

/**
 * เช็กชื่อขึ้น-ลงรถ — term 2, phase 1: teachers record attendance themselves.
 *
 * A teacher stands at the school, so the page asks only what a teacher can see:
 *   เช้า → the child has ARRIVED at school
 *   เย็น → the child has BOARDED to go home
 * Grade teachers see only their own grade (the backend enforces it). Drivers
 * may still check in their app; whoever records first counts, and a row the
 * driver already recorded shows as done here.
 */

const SESSIONS = {
  morning: { label: 'เช้า', verb: 'ถึงโรงเรียน', done: 'ถึงโรงเรียนแล้ว', icon: Sunrise },
  evening: { label: 'เย็น', verb: 'ขึ้นรถกลับบ้าน', done: 'ขึ้นรถแล้ว', icon: Sunset },
};

function bangkokHour() {
  return Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false }));
}

function timeTH(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) + ' น.';
}

function whoLabel(st) {
  if (st.checked_by_role === 'driver' || !st.checked_by_role) return 'คนขับ';
  if (st.can_undo) return 'คุณ';
  return st.checked_by_name || 'ครู';
}

export default function TeacherCheck() {
  const { user } = useAuth();
  return user?.role === 'school' && getGradeScope(user) ? <ClassroomCheck /> : <VehicleTeacherCheck />;
}

function VehicleTeacherCheck() {
  const { user } = useAuth();
  const toast = useToast();
  const grade = getGradeScope(user);
  const [params] = useSearchParams();
  // ?session=morning|evening opens a round directly (links, screenshots);
  // otherwise the round follows the Bangkok clock.
  const [session, setSession] = useState(() => {
    const q = params.get('session');
    if (q === 'morning' || q === 'evening') return q;
    return bangkokHour() < 12 ? 'morning' : 'evening';
  });
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showPending, setShowPending] = useState(true);
  const [busy, setBusy] = useState({});          // student id → true while saving
  const [confirmBus, setConfirmBus] = useState(null);
  const [savingBus, setSavingBus] = useState(false);
  const requestSeq = useRef(0);
  const sessionRef = useRef(session);
  const writeInFlight = useRef(false);
  const confirmationRef = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestSeq.current += 1; };
  }, []);

  const load = useCallback(async (round = sessionRef.current) => {
    if (!mounted.current) return;
    const request = ++requestSeq.current;
    setLoaded(null);
    setError(null);
    setLoading(true);
    try {
      const r = await api.get('/school/teacher-check', { params: { session: round } });
      if (!mounted.current || request !== requestSeq.current || sessionRef.current !== round) return;
      setLoaded({ session: round, payload: r.data?.data || { vehicles: [] } });
    } catch (err) {
      if (!mounted.current || request !== requestSeq.current || sessionRef.current !== round) return;
      // A failed refresh must not leave the previous round's buttons usable.
      setLoaded(null);
      setError(err.response?.data?.message || 'โหลดรายชื่อไม่สำเร็จ');
    } finally {
      if (mounted.current && request === requestSeq.current && sessionRef.current === round) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => { requestSeq.current += 1; };
  }, [load]);

  const s = SESSIONS[session];
  const data = loaded?.session === session ? loaded.payload : null;
  const vehicles = data?.vehicles || [];
  const interactionLocked = savingBus || Object.values(busy).some(Boolean) || Boolean(confirmBus);
  const totals = useMemo(() => {
    let expected = 0; let done = 0;
    for (const v of vehicles) {
      for (const st of v.students) {
        if (st.on_leave || st.no_vehicle) continue;
        expected += 1;
        if (st.done) done += 1;
      }
    }
    return { expected, done };
  }, [vehicles]);
  const query = search.trim().toLocaleLowerCase('th-TH');
  const visibleVehicles = vehicles.map(v => ({
    ...v,
    visibleStudents: v.students.filter(st => {
      if (showPending && (st.done || st.on_leave || st.no_vehicle)) return false;
      const text = [st.name, st.grade, st.classroom, formatGradeClass(st.grade, st.classroom), v.plate_no]
        .filter(value => value !== null && value !== undefined).join(' ').toLocaleLowerCase('th-TH');
      return !query || query.split(/\s+/).every(word => text.includes(word));
    }),
  })).filter(v => v.visibleStudents.length > 0);
  const visibleCount = visibleVehicles.reduce((count, v) => count + v.visibleStudents.length, 0);
  const allCount = vehicles.reduce((count, v) => count + v.students.length, 0);

  function changeSession(next) {
    if (next === sessionRef.current || writeInFlight.current || confirmationRef.current) return;
    sessionRef.current = next;
    setSession(next);
    load(next);
  }

  function reportResult(result) {
    const { recorded = 0, already = 0, skipped = 0 } = result || {};
    if (recorded) toast.success(`บันทึกแล้ว ${recorded} คน`);
    if (already) toast.info(`${already} คนมีการบันทึกไว้แล้ว (คนขับหรือครูท่านอื่น)`);
    if (skipped) toast.info(`ข้าม ${skipped} คน (ลา / ไม่ได้ใช้รถรอบนี้)`);
  }

  async function record(ids, round) {
    const r = await api.post('/school/teacher-check', { session: round, student_ids: ids });
    if (mounted.current) reportResult(r.data?.data);
  }

  async function tapStudent(st) {
    if (writeInFlight.current || confirmationRef.current || loading || !data || sessionRef.current !== session || st.done || st.on_leave || st.no_vehicle) return;
    writeInFlight.current = true;
    setBusy(b => ({ ...b, [st.id]: true }));
    try {
      await record([st.id], session);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      writeInFlight.current = false;
      if (mounted.current) setBusy(b => ({ ...b, [st.id]: false }));
    }
  }

  async function undo(st) {
    if (!st.can_undo || !st.log_id || writeInFlight.current || confirmationRef.current || loading || !data || sessionRef.current !== session) return;
    writeInFlight.current = true;
    setBusy(b => ({ ...b, [st.id]: true }));
    try {
      await api.post(`/school/teacher-check/${st.log_id}/undo`, {});
      toast.success(`ยกเลิกรายการของ ${st.name} แล้ว`);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ยกเลิกไม่สำเร็จ');
    } finally {
      writeInFlight.current = false;
      if (mounted.current) setBusy(b => ({ ...b, [st.id]: false }));
    }
  }

  function confirmWholeBus(v) {
    if (writeInFlight.current || confirmationRef.current || loading || !data || query || sessionRef.current !== session) return;
    // Search hides the bulk action. In either list view, every remaining pupil
    // is visible, and this snapshot fixes both the exact IDs and the round.
    const ids = v.students.filter(st => !st.done && !st.on_leave && !st.no_vehicle).map(st => st.id);
    if (!ids.length) return;
    const confirmation = { plate_no: v.plate_no, ids, session };
    confirmationRef.current = confirmation;
    setConfirmBus(confirmation);
  }

  function cancelWholeBus() {
    // ConfirmDialog also invokes cancellation for Escape and backdrop clicks.
    if (writeInFlight.current) return;
    confirmationRef.current = null;
    setConfirmBus(null);
  }

  async function recordWholeBus() {
    const confirmation = confirmationRef.current;
    if (!confirmation || writeInFlight.current || confirmation.session !== sessionRef.current) return;
    writeInFlight.current = true;
    setSavingBus(true);
    try {
      await record(confirmation.ids, confirmation.session);
      confirmationRef.current = null;
      setConfirmBus(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      writeInFlight.current = false;
      if (mounted.current) setSavingBus(false);
    }
  }

  function stateBadge(st) {
    if (busy[st.id]) return <span className="text-sm text-ink-muted">กำลังบันทึก…</span>;
    if (st.on_leave) return <StatusBadge variant="neutral">ลา</StatusBadge>;
    if (st.no_vehicle) return <StatusBadge variant="neutral">ไม่มีรถ</StatusBadge>;
    if (st.done) {
      return (
        <StatusBadge variant="success">
          {session === 'evening' && st.status === 'CHECKED_OUT' ? 'ส่งถึงบ้านแล้ว' : s.done} {timeTH(st.checked_at)} · {whoLabel(st)}
        </StatusBadge>
      );
    }
    if (session === 'morning' && st.status === 'CHECKED_IN') {
      return <StatusBadge variant="info">คนขับรับขึ้นรถแล้ว</StatusBadge>;
    }
    return null;
  }

  const pct = totals.expected > 0 ? Math.round((totals.done / totals.expected) * 100) : 0;

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5">
        <PageHeader
          title="เช็กชื่อวันนี้"
          subtitle={grade ? `นักเรียนชั้น ${grade} ที่ใช้รถรับส่ง` : 'นักเรียนทุกชั้นที่ใช้รถรับส่ง'}
          icon={Users}
          iconColor="teal"
        />
        <SchoolWorkflowNav current="attendance" />

        <AppCard padding="md" className="space-y-1">
          <p className="font-semibold text-ink">เห็นเด็กแล้ว แตะชื่อเพื่อบันทึกทันที</p>
          <p className="text-sm text-ink-muted">เช้า: เด็กถึงโรงเรียน · เย็น: เด็กขึ้นรถกลับบ้าน ไม่ต้องกดบันทึกอีกครั้ง</p>
          <p className="text-sm text-ink-muted">ใช้ข้อมูลร่วมกับคนขับและครูท่านอื่น หากขึ้นว่าบันทึกแล้ว ไม่ต้องเช็กซ้ำ</p>
        </AppCard>

        {/* Session switch */}
        <div role="tablist" aria-label="เลือกรอบ" className="grid grid-cols-2 gap-2 p-1 bg-surface border border-surface-border rounded-2xl">
          {Object.entries(SESSIONS).map(([key, cfg]) => {
            const active = key === session;
            const Icon = cfg.icon;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => changeSession(key)}
                disabled={interactionLocked}
                className={`focus-ring min-h-[52px] rounded-xl inline-flex items-center justify-center gap-2 px-2 font-semibold transition disabled:cursor-wait disabled:opacity-70 ${
                  active ? 'bg-brand-700 text-white shadow-soft' : 'text-ink-muted hover:bg-surface-raised'
                }`}
              >
                <Icon className="w-5 h-5" aria-hidden="true" />
                {cfg.label} · {cfg.verb}
              </button>
            );
          })}
        </div>

        {/* Progress */}
        {data && (
          <AppCard padding="md" className="flex items-center gap-4">
            <div className="flex-1">
              <p className="font-semibold text-ink">
                บันทึกแล้ว <span className="tabular-nums">{totals.done}</span> จาก <span className="tabular-nums">{totals.expected}</span> คน
              </p>
              <div className="mt-2 h-3 bg-surface rounded-full overflow-hidden border border-surface-border">
                <div className="h-full bg-success rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <span className="text-2xl font-bold tabular-nums text-ink">{pct}%</span>
          </AppCard>
        )}

        {data && vehicles.length > 0 && (
          <AppCard padding="md" className="space-y-3">
            <fieldset disabled={interactionLocked}>
              <FilterBar
                search={{
                  value: search,
                  onChange: setSearch,
                  label: 'ค้นหานักเรียนหรือรถ',
                  placeholder: 'ชื่อ ชั้น ห้อง หรือทะเบียนรถ',
                }}
                chips={{
                  label: 'กรองรายชื่อ',
                  value: showPending ? 'pending' : 'all',
                  onChange: value => setShowPending(value === 'pending'),
                  options: [
                    ['pending', 'ยังไม่เช็ก', totals.expected - totals.done],
                    ['all', 'ทั้งหมด', allCount],
                  ],
                }}
                count={visibleCount}
                countLabel="คน"
                onClear={() => { setSearch(''); setShowPending(true); }}
              />
            </fieldset>
            <p className="text-sm text-ink-muted">เลือก “ทั้งหมด” เพื่อดูรายการที่บันทึกแล้ว ลา หรือไม่มีรถ</p>
            {query && <p className="text-sm text-ink-muted">ขณะค้นหา บันทึกได้ทีละคน หากต้องการบันทึกทั้งคัน ให้ล้างคำค้นหาก่อน</p>}
          </AppCard>
        )}

        {error && <ErrorState title="โหลดรายชื่อไม่สำเร็จ" message={error} onRetry={() => load()} />}
        {loading && <LoadingState message={`กำลังโหลดรายชื่อรอบ${s.label}…`} />}
        {data && vehicles.length === 0 && (
          <EmptyState title="ไม่มีนักเรียนที่ใช้รถรับส่งรอบนี้" description="ลองเลือกรอบอื่น หรือตรวจสอบการจัดรถของนักเรียน" />
        )}
        {data && vehicles.length > 0 && visibleCount === 0 && (
          <EmptyState
            title={query ? 'ไม่พบรายชื่อตามคำค้นหา' : 'ไม่มีรายชื่อที่ต้องเช็กเพิ่มในรอบนี้'}
            description={query ? 'ลองค้นหาชื่อ ชั้น ห้อง หรือทะเบียนรถใหม่ หรือเลือก “ทั้งหมด”' : 'เลือก “ทั้งหมด” เพื่อดูสถานะนักเรียนแต่ละคนและยกเลิกรายการที่คุณบันทึกได้'}
          />
        )}

        {visibleVehicles.map(v => {
          const pending = v.students.filter(st => !st.done && !st.on_leave && !st.no_vehicle);
          const counted = v.students.filter(st => !st.on_leave && !st.no_vehicle);
          return (
            <AppCard key={v.vehicle_id || 'none'} padding="none" className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-surface-border bg-surface">
                <Bus className="w-5 h-5 text-ink-muted" aria-hidden="true" />
                <div className="flex-1 min-w-[10rem]">
                  <p className="font-bold text-ink">{v.plate_no || 'ยังไม่ได้ผูกรถ'}</p>
                  <p className="text-sm text-ink-muted">บันทึกแล้ว {counted.length - pending.length} / {counted.length} คน</p>
                </div>
                {v.vehicle_id && pending.length > 0 && !query && (
                  <button
                    type="button"
                    onClick={() => confirmWholeBus(v)}
                    disabled={interactionLocked}
                    className="focus-ring w-full sm:w-auto min-h-[44px] px-4 rounded-xl bg-success-ink text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-60"
                  >
                    บันทึกที่เหลือทั้งคัน ({pending.length} คน)
                  </button>
                )}
              </div>
              <ul className="divide-y divide-surface-border">
                {v.visibleStudents.map(st => {
                  const disabled = st.done || st.on_leave || st.no_vehicle;
                  return (
                    <li key={st.id} className="flex items-center gap-3 px-4 py-2">
                      <button
                        type="button"
                        onClick={() => tapStudent(st)}
                        disabled={disabled || interactionLocked}
                        aria-label={disabled ? st.name : `บันทึก ${st.name} ${s.verb}`}
                        className={`focus-ring flex-1 min-w-0 min-h-[52px] flex items-center gap-3 rounded-xl px-2 text-left transition ${
                          disabled ? 'cursor-default' : 'hover:bg-brand-50 active:bg-brand-100'
                        }`}
                      >
                        <span
                          className={`w-8 h-8 shrink-0 rounded-full border-2 inline-flex items-center justify-center ${
                            st.done ? 'bg-success-ink border-success-ink text-white' : 'border-surface-border bg-surface-raised'
                          }`}
                          aria-hidden="true"
                        >
                          {st.done && <CheckCircle2 className="w-5 h-5" />}
                        </span>
                        <span className="min-w-0">
                          <span className={`block font-semibold truncate ${st.on_leave ? 'text-ink-muted line-through' : 'text-ink'}`}>{st.name}</span>
                          <span className="block text-sm text-ink-muted">{formatGradeClass(st.grade, st.classroom)}</span>
                          <span className="block sm:hidden mt-1">{stateBadge(st)}</span>
                        </span>
                      </button>
                      <div className="shrink-0 flex items-center gap-2">
                        <span className="hidden sm:inline-flex">{stateBadge(st)}</span>
                        {!busy[st.id] && st.can_undo && (
                          <button
                            type="button"
                            onClick={() => undo(st)}
                            disabled={interactionLocked}
                            className="focus-ring min-h-[44px] px-3 rounded-lg text-sm font-semibold text-ink-muted hover:bg-surface inline-flex items-center gap-1 disabled:opacity-60"
                            aria-label={`ยกเลิกรายการของ ${st.name}`}
                          >
                            <Undo2 className="w-4 h-4" aria-hidden="true" /> ยกเลิก
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </AppCard>
          );
        })}

        <ConfirmDialog
          open={Boolean(confirmBus)}
          tone="brand"
          title={`บันทึก "${s.verb}" ทั้งคัน?`}
          description={confirmBus
            ? `รอบ${SESSIONS[confirmBus.session].label} รถ ${confirmBus.plate_no} · บันทึกเฉพาะ ${confirmBus.ids.length} คนที่ยังไม่เช็กว่า${SESSIONS[confirmBus.session].verb}แล้ว ให้กดเมื่อเห็นเด็กตามรายชื่อที่เหลือครบทุกคนเท่านั้น`
            : ''}
          confirmLabel={confirmBus ? `ยืนยัน ${confirmBus.ids.length} คน` : 'ยืนยันบันทึก'}
          loading={savingBus}
          onConfirm={recordWholeBus}
          onCancel={cancelWholeBus}
        />
      </div>
    </PageTransition>
  );
}
