import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, ChevronDown, CircleHelp, GraduationCap, Sunrise, Sunset, Undo2 } from 'lucide-react';
import api from '../../api/axios';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import LoadingState from '../../components/LoadingState';
import PageHeader from '../../components/PageHeader';
import SchoolWorkflowNav from '../../components/SchoolWorkflowNav';
import { useToast } from '../../components/Toast';
import { AppCard, ConfirmDialog, FormField, StatusBadge } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { getGradeScope } from '../../utils/authScope';
import { groupTeacherClassrooms, classroomPlan } from '../../utils/classroomAttendance';
import { PageTransition } from '../../lib/motion';
import AttendanceTimeDialog, { bangkokTime } from './AttendanceTimeDialog';

const SESSIONS = {
  // `tab` is the short form for the round switch, so it stays on one line at
  // 390px; `action` is the full wording used in rows and confirmations.
  morning: { label: 'เช้า', action: 'ถึงโรงเรียน', tab: 'ถึงโรงเรียน', icon: Sunrise },
  evening: { label: 'เย็น', action: 'ขึ้นรถกลับบ้าน', tab: 'กลับบ้าน', icon: Sunset },
};

function initialSession(params) {
  const requested = params.get('session');
  if (requested === 'morning' || requested === 'evening') return requested;
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false }));
  return hour < 12 ? 'morning' : 'evening';
}

export default function ClassroomCheck() {
  const { user } = useAuth();
  const grade = getGradeScope(user);
  const [selectedGrade, setSelectedGrade] = useState('');
  const toast = useToast();
  const [params] = useSearchParams();
  const [session, setSession] = useState(() => initialSession(params));
  const sessionRef = useRef(session);
  const [roster, setRoster] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [leaveIds, setLeaveIds] = useState(() => new Set());
  const [selfIds, setSelfIds] = useState(() => new Set());
  const [confirmRoom, setConfirmRoom] = useState(null);
  const [timeStudent, setTimeStudent] = useState(null);
  const [saving, setSaving] = useState(false);
  const requestSeq = useRef(0);
  const writeInFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestSeq.current += 1; };
  }, []);

  const load = useCallback(async (round = sessionRef.current, resetSelections = true) => {
    const request = ++requestSeq.current;
    setLoading(true); setError(''); setRoster(null);
    try {
      const response = await api.get('/school/teacher-check', { params: { session: round } });
      if (!mounted.current || request !== requestSeq.current || round !== sessionRef.current) return;
      if (!Array.isArray(response.data?.data?.vehicles)) throw new Error('invalid roster');
      setRoster({ session: round, vehicles: response.data.data.vehicles });
      if (resetSelections) { setLeaveIds(new Set()); setSelfIds(new Set()); }
    } catch (err) {
      if (!mounted.current || request !== requestSeq.current || round !== sessionRef.current) return;
      setError(err.response?.data?.message || 'โหลดรายชื่อไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      if (mounted.current && request === requestSeq.current && round === sessionRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const data = roster?.session === session ? roster : null;
  const rooms = useMemo(() => groupTeacherClassrooms(data?.vehicles || []), [data]);
  const grades = useMemo(() => [...new Set(rooms.map(room => room.grade))], [rooms]);
  const activeGrade = grade || (grades.includes(selectedGrade) ? selectedGrade : '');
  const visibleRooms = rooms.filter(room => room.grade === activeGrade);
  const locked = saving || !!confirmRoom || !!timeStudent;

  function changeSession(next) {
    if (next === sessionRef.current || locked || writeInFlight.current) return;
    sessionRef.current = next;
    setSession(next);
    setLeaveIds(new Set()); setSelfIds(new Set());
    load(next);
  }

  function toggleLeave(student) {
    if (locked || loading || !data || student.done || student.status || student.on_leave || student.no_vehicle) return;
    setSelfIds(previous => { const next = new Set(previous); next.delete(student.id); return next; });
    setLeaveIds(previous => {
      const next = new Set(previous);
      if (next.has(student.id)) next.delete(student.id);
      else next.add(student.id);
      return next;
    });
  }

  function toggleSelf(student) {
    if (locked || loading || !data || student.done || student.status || student.on_leave || student.self_travel || student.no_vehicle) return;
    setLeaveIds(previous => { const next = new Set(previous); next.delete(student.id); return next; });
    setSelfIds(previous => { const next = new Set(previous); if (next.has(student.id)) next.delete(student.id); else next.add(student.id); return next; });
  }

  function prepareSave(room) {
    if (locked || loading || !data || writeInFlight.current || room.grade !== activeGrade) return;
    const plan = classroomPlan(room, leaveIds, selfIds);
    if (!plan.presentIds.length && !plan.leaveIds.length && !plan.selfIds.length) return;
    setConfirmRoom({ ...plan, session, grade: room.grade, room: room.classroom || 'ไม่ระบุห้อง' });
  }

  async function confirmOne(student) {
    if (locked || loading || !data || writeInFlight.current || student.done || student.on_leave || student.self_travel || student.no_vehicle) return;
    const round = sessionRef.current;
    const mode = selfIds.has(student.id) ? 'self' : leaveIds.has(student.id) ? 'leave' : 'bus';
    if (mode !== 'bus' && student.status) return;
    writeInFlight.current = true;
    setSaving(true);
    try {
      if (mode === 'self') await api.post('/school/self-travel', { student_id: student.id, session: round });
      else if (mode === 'leave') await api.post('/school/leave', { student_id: student.id, session: round });
      else {
        const response = await api.post('/school/teacher-check', { session: round, student_ids: [student.id] });
        if (response.data?.data?.results?.[0]?.result !== 'ok') {
          throw new Error('รายการนี้ยังไม่ถูกบันทึก กรุณาตรวจสอบสถานะใหม่');
        }
      }
      toast.success(`บันทึก ${student.name} แล้ว`);
      setLeaveIds(previous => { const next = new Set(previous); next.delete(student.id); return next; });
      setSelfIds(previous => { const next = new Set(previous); next.delete(student.id); return next; });
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'บันทึกไม่สำเร็จ');
    } finally {
      await load(round, false);
      writeInFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  async function saveRoom() {
    const snapshot = confirmRoom;
    if (!snapshot || writeInFlight.current || snapshot.session !== sessionRef.current) return;
    writeInFlight.current = true;
    setSaving(true);
    try {
      // A single user action saves the selected absences first, so the normal
      // attendance call can never record one of those pupils as present.
      for (const studentId of snapshot.selfIds) {
        await api.post('/school/self-travel', { student_id: studentId, session: snapshot.session });
      }
      for (const studentId of snapshot.leaveIds) {
        await api.post('/school/leave', { student_id: studentId, session: snapshot.session });
      }
      for (let i = 0; i < snapshot.presentIds.length; i += 200) {
        const ids = snapshot.presentIds.slice(i, i + 200);
        const response = await api.post('/school/teacher-check', { session: snapshot.session, student_ids: ids });
        const results = response.data?.data?.results;
        if (!Array.isArray(results) || results.length !== ids.length || results.some(row => !['ok', 'already'].includes(row.result))) {
          throw new Error('บางรายชื่อยังบันทึกไม่สำเร็จ กรุณาตรวจสอบสถานะใหม่');
        }
      }
      toast.success(`บันทึก ${snapshot.grade} ห้อง ${snapshot.room} แล้ว · ใช้รถ ${snapshot.presentIds.length} · ${snapshot.session === 'morning' ? 'มาเอง' : 'กลับเอง'} ${snapshot.selfIds.length} · ลา ${snapshot.leaveIds.length}`);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'บันทึกไม่ครบ กรุณาตรวจสอบสถานะใหม่ก่อนลองอีกครั้ง');
    } finally {
      if (mounted.current) { setConfirmRoom(null); setSaving(false); }
      await load(snapshot.session);
      writeInFlight.current = false;
    }
  }

  async function undo(student) {
    if (!student.can_undo || !(student.self_id || student.log_id || student.leave_id) || locked || writeInFlight.current || !data) return;
    writeInFlight.current = true; setSaving(true);
    try {
      if (student.self_travel) await api.post(`/school/self-travel/${student.self_id}/undo`, {});
      else if (student.on_leave && student.leave_id) await api.delete(`/school/leaves/${student.leave_id}`);
      else await api.post(`/school/teacher-check/${student.log_id}/undo`, {});
      toast.success(`ยกเลิกรายการของ ${student.name} แล้ว`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'ยกเลิกไม่สำเร็จ');
    } finally {
      await load();
      writeInFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5">
        <PageHeader title="เช็กชื่อรายห้อง" subtitle={grade ? `นักเรียนชั้น ${grade} ที่ใช้รถรับส่ง` : 'เลือกสายชั้น แล้วเช็กชื่อทีละห้องเรียน'} icon={GraduationCap} iconColor="teal" />
        <SchoolWorkflowNav current="attendance" />
        {/* Closed by default: on a phone the roster must start on the first
            screen. The same four rules, one tap away. */}
        <details className="group rounded-xl border border-surface-border bg-surface-raised">
          <summary className="focus-ring cursor-pointer list-none [&::-webkit-details-marker]:hidden min-h-[44px] flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-ink hover:bg-surface">
            <CircleHelp className="w-5 h-5 shrink-0 text-ink-muted" aria-hidden="true" />
            <span className="flex-1">วิธีใช้หน้านี้</span>
            <ChevronDown className="w-5 h-5 shrink-0 text-ink-muted transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <ul className="list-disc pl-9 pr-4 pb-3 space-y-1 text-sm text-ink-muted">
            <li>เริ่มต้นใช้รถทุกคน เลือก “มาเอง/กลับเอง” หรือ “ลา” ตามจริง</li>
            <li>ตรวจรายชื่อทีละห้อง แล้วกด “บันทึกทั้งห้อง” · การลาใช้เฉพาะรอบที่เลือก</li>
            <li>เช้า: ถึงโรงเรียน · เย็น: ขึ้นรถกลับบ้าน · รายการที่คนขับหรือครูบันทึกแล้วจะไม่บันทึกซ้ำ</li>
            <li>ยืนยันรายคนเพื่อเก็บเวลาที่กดจริง · บันทึกทั้งห้องเป็นเวลาของชุดนั้น ไม่ใช่เวลารับจริงรายคน</li>
          </ul>
        </details>

        <div role="tablist" aria-label="เลือกรอบ" className="grid grid-cols-2 gap-2 p-1 bg-surface border border-surface-border rounded-2xl">
          {Object.entries(SESSIONS).map(([key, cfg]) => {
            const Icon = cfg.icon;
            return <button key={key} type="button" role="tab" aria-selected={session === key} disabled={locked}
              onClick={() => changeSession(key)}
              className={`focus-ring min-h-[52px] rounded-xl inline-flex items-center justify-center gap-2 px-2 font-semibold transition disabled:opacity-60 ${session === key ? 'bg-brand-700 text-white shadow-soft' : 'text-ink-muted hover:bg-surface-raised'}`}>
              <Icon className="w-5 h-5 shrink-0" aria-hidden="true" /><span className="whitespace-nowrap">{cfg.label} · {cfg.tab}</span>
            </button>;
          })}
        </div>

        {!grade && data && grades.length > 0 && <FormField label="สายชั้นที่ต้องการเช็กชื่อ" disabled={locked}>
          {props => <select {...props} value={activeGrade} onChange={event => {
            if (locked || writeInFlight.current) return;
            setSelectedGrade(event.target.value);
            setLeaveIds(new Set()); setSelfIds(new Set());
          }} className="focus-ring w-full min-h-[44px] px-3 rounded-lg border border-surface-border bg-surface-raised text-base text-ink disabled:opacity-60">
            <option value="">เลือกสายชั้น</option>
            {grades.map(value => <option key={value} value={value}>{value}</option>)}
          </select>}
        </FormField>}

        {error && <ErrorState title="โหลดรายชื่อไม่สำเร็จ" message={error} onRetry={() => load()} />}
        {loading && <LoadingState message="กำลังโหลดรายชื่อห้องเรียน…" />}
        {data && rooms.length === 0 && <EmptyState title="ไม่มีนักเรียนที่ใช้รถรับส่งรอบนี้" description="ตรวจสอบรอบที่เลือกหรือการจัดรถของนักเรียน" />}
        {data && rooms.length > 0 && !activeGrade && <EmptyState title="เลือกสายชั้นเพื่อเช็กชื่อ" description="รายชื่อจะแยกเป็นห้องเรียนในสายชั้นที่เลือก" />}

        {visibleRooms.map(room => {
          const plan = classroomPlan(room, leaveIds, selfIds);
          const pending = plan.presentIds.length + plan.leaveIds.length + plan.selfIds.length;
          const done = room.students.filter(st => st.done).length;
          const onLeave = room.students.filter(st => st.on_leave).length;
          const selfCount = room.students.filter(st => st.self_travel).length;
          return <AppCard key={room.key} padding="none" className="overflow-hidden">
            <div className="px-4 py-4 bg-surface border-b border-surface-border">
              <h2 className="text-lg font-bold text-ink">{room.grade} / {room.classroom ? `ห้อง ${room.classroom}` : 'ไม่ระบุห้อง'}</h2>
              <p className="text-sm text-ink-muted">{room.students.length} คน · ใช้รถ {done} · {session === 'morning' ? 'มาเอง' : 'กลับเอง'} {selfCount} · ลา {onLeave} · รอบันทึก {pending}</p>
            </div>
            <ul className="divide-y divide-surface-border">
              {room.students.map(student => {
                const selectable = !student.done && !student.on_leave && !student.self_travel && !student.no_vehicle;
                const selectedLeave = leaveIds.has(student.id);
                const selectedSelf = selfIds.has(student.id);
                return <li key={student.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-[10rem]">
                    <p className="font-semibold text-ink">{student.name}</p>
                    <p className="text-sm text-ink-muted">{student.plate_no || 'ยังไม่ได้ผูกรถ'}</p>
                    {student.done && student.checked_at && <p className="text-sm text-ink-muted">
                      {session === 'evening' && student.status === 'CHECKED_OUT' ? 'ส่งถึงบ้าน' : SESSIONS[session].action} {bangkokTime(student.checked_at)} น.
                      {student.time_edited ? ' · แก้ไขเวลาแล้ว' : ''}
                    </p>}
                    {session === 'morning' && student.status === 'CHECKED_IN' && student.checked_at && <p className="text-sm text-ink-muted">
                      รับขึ้นรถ {bangkokTime(student.checked_at)} น.{student.time_edited ? ' · แก้ไขเวลาแล้ว' : ''}
                    </p>}
                    {student.self_travel && student.self_recorded_at && <p className="text-sm text-ink-muted">
                      {session === 'morning' ? 'มาเอง' : 'กลับเอง'} {bangkokTime(student.self_recorded_at)} น.
                      {student.self_time_edited ? ' · แก้ไขเวลาแล้ว' : ''}
                    </p>}
                  </div>
                  {selectable ? <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge variant={selectedLeave ? 'warn' : 'success'}>{selectedLeave ? 'เลือกลา' : selectedSelf ? (session === 'morning' ? 'มาเอง' : 'กลับเอง') : 'ใช้รถ (ค่าเริ่มต้น)'}</StatusBadge>
                    <button type="button" aria-pressed={selectedSelf} onClick={() => toggleSelf(student)} disabled={locked || !!student.status}
                      aria-label={`${session === 'morning' ? 'มาเอง' : 'กลับเอง'} ${student.name}`}
                      className="focus-ring min-h-[44px] px-4 rounded-lg border border-surface-border bg-surface-raised text-sm font-semibold text-ink disabled:opacity-60">
                      {session === 'morning' ? 'มาเอง' : 'กลับเอง'}
                    </button>
                    <button type="button" aria-pressed={selectedLeave} aria-label={`${selectedLeave ? 'ยกเลิกการเลือกลา' : 'เลือกลา'} ${student.name}`}
                      onClick={() => toggleLeave(student)} disabled={locked || !!student.status}
                      className={`focus-ring min-h-[44px] px-4 rounded-lg border text-sm font-semibold disabled:opacity-60 ${selectedLeave ? 'border-warn-ink bg-warn-soft text-warn-ink' : 'border-surface-border bg-surface-raised text-ink hover:bg-surface'}`}>
                      {selectedLeave ? 'ยกเลิกลา' : 'ลา'}
                    </button>
                    <button type="button" onClick={() => confirmOne(student)} disabled={locked || loading || (student.status && (selectedSelf || selectedLeave))}
                      aria-label={`ยืนยันรายคน ${student.name}`}
                      className="focus-ring min-h-[44px] px-4 rounded-lg bg-brand-700 text-white text-sm font-semibold disabled:opacity-60">
                      ยืนยันรายคน
                    </button>
                    {student.status === 'CHECKED_IN' && student.log_id && <button type="button" onClick={() => setTimeStudent(student)} disabled={locked}
                      aria-label={`แก้เวลา ${student.name}`}
                      className="focus-ring min-h-[44px] px-3 rounded-lg text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-60">
                      แก้เวลา
                    </button>}
                  </div> : <div className="flex items-center gap-2">
                    <StatusBadge variant={student.on_leave ? 'warn' : student.done ? 'success' : 'neutral'}>
                      {student.self_travel ? (session === 'morning' ? 'มาเอง' : 'กลับเอง') : student.on_leave ? 'ลาแล้ว' : student.done ? 'บันทึกแล้ว' : 'ยังไม่มีรถ'}
                    </StatusBadge>
                    {((student.done && student.log_id) || (student.self_travel && student.self_id)) && <button type="button" onClick={() => setTimeStudent(student)} disabled={locked}
                      aria-label={`แก้เวลา ${student.name}`}
                      className="focus-ring min-h-[44px] px-3 rounded-lg text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-60">
                      แก้เวลา
                    </button>}
                    {student.can_undo && <button type="button" onClick={() => undo(student)} disabled={locked}
                      aria-label={`ยกเลิกรายการของ ${student.name}`}
                      className="focus-ring min-h-[44px] px-3 rounded-lg text-sm text-ink-muted hover:bg-surface inline-flex items-center gap-1 disabled:opacity-60">
                      <Undo2 className="w-4 h-4" aria-hidden="true" /> ยกเลิก
                    </button>}
                    {student.done && <CheckCircle2 className="w-5 h-5 text-success-ink" aria-hidden="true" />}
                  </div>}
                </li>;
              })}
            </ul>
            <div className="px-4 py-4 border-t border-surface-border">
              <button type="button" onClick={() => prepareSave(room)} disabled={!pending || locked || loading}
                className="focus-ring w-full min-h-[48px] rounded-xl bg-brand-700 text-white font-semibold disabled:opacity-50">
                {pending ? `บันทึกทั้งห้อง · ใช้รถ ${plan.presentIds.length} · ${session === 'morning' ? 'มาเอง' : 'กลับเอง'} ${plan.selfIds.length} · ลา ${plan.leaveIds.length}` : 'บันทึกครบแล้ว'}
              </button>
            </div>
          </AppCard>;
        })}

        <ConfirmDialog open={Boolean(confirmRoom)} tone="brand" title="บันทึกทั้งห้อง?"
          description={confirmRoom ? `${confirmRoom.grade} ห้อง ${confirmRoom.room} รอบ${SESSIONS[confirmRoom.session].label}: ใช้รถ ${confirmRoom.presentIds.length} คน · ${confirmRoom.session === 'morning' ? 'มาเอง' : 'กลับเอง'} ${confirmRoom.selfIds.length} คน · ลา ${confirmRoom.leaveIds.length} คน ระบบจะบันทึกเฉพาะรายชื่อที่ยังไม่เช็กเป็นชุด ไม่ได้ยืนยันเวลาจริงรายคน` : ''}
          confirmLabel="ยืนยันบันทึกทั้งห้อง" loading={saving} onConfirm={saveRoom}
          onCancel={() => { if (!saving) setConfirmRoom(null); }} />
        {timeStudent && <AttendanceTimeDialog key={timeStudent.log_id || `self-${timeStudent.self_id}`} student={timeStudent}
          onClose={() => setTimeStudent(null)} onSaved={() => load(sessionRef.current, false)} />}
      </div>
    </PageTransition>
  );
}
