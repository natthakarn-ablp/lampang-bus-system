import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, GraduationCap, Sunrise, Sunset, Undo2 } from 'lucide-react';
import api from '../../api/axios';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import LoadingState from '../../components/LoadingState';
import PageHeader from '../../components/PageHeader';
import SchoolWorkflowNav from '../../components/SchoolWorkflowNav';
import { useToast } from '../../components/Toast';
import { AppCard, ConfirmDialog, StatusBadge } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { getGradeScope } from '../../utils/authScope';
import { groupTeacherClassrooms, classroomPlan } from '../../utils/classroomAttendance';
import { PageTransition } from '../../lib/motion';

const SESSIONS = {
  morning: { label: 'เช้า', action: 'ถึงโรงเรียน', icon: Sunrise },
  evening: { label: 'เย็น', action: 'ขึ้นรถกลับบ้าน', icon: Sunset },
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
  const toast = useToast();
  const [params] = useSearchParams();
  const [session, setSession] = useState(() => initialSession(params));
  const sessionRef = useRef(session);
  const [roster, setRoster] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [leaveIds, setLeaveIds] = useState(() => new Set());
  const [confirmRoom, setConfirmRoom] = useState(null);
  const [saving, setSaving] = useState(false);
  const requestSeq = useRef(0);
  const writeInFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestSeq.current += 1; };
  }, []);

  const load = useCallback(async (round = sessionRef.current) => {
    const request = ++requestSeq.current;
    setLoading(true); setError(''); setRoster(null);
    try {
      const response = await api.get('/school/teacher-check', { params: { session: round } });
      if (!mounted.current || request !== requestSeq.current || round !== sessionRef.current) return;
      if (!Array.isArray(response.data?.data?.vehicles)) throw new Error('invalid roster');
      setRoster({ session: round, vehicles: response.data.data.vehicles });
      setLeaveIds(new Set());
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
  const locked = saving || !!confirmRoom;

  function changeSession(next) {
    if (next === sessionRef.current || locked || writeInFlight.current) return;
    sessionRef.current = next;
    setSession(next);
    setLeaveIds(new Set());
    load(next);
  }

  function toggleLeave(student) {
    if (locked || loading || !data || student.done || student.on_leave || student.no_vehicle) return;
    setLeaveIds(previous => {
      const next = new Set(previous);
      if (next.has(student.id)) next.delete(student.id);
      else next.add(student.id);
      return next;
    });
  }

  function prepareSave(room) {
    if (locked || loading || !data || writeInFlight.current) return;
    const plan = classroomPlan(room, leaveIds);
    if (!plan.presentIds.length && !plan.leaveIds.length) return;
    setConfirmRoom({ ...plan, session, room: room.classroom || 'ไม่ระบุห้อง' });
  }

  async function saveRoom() {
    const snapshot = confirmRoom;
    if (!snapshot || writeInFlight.current || snapshot.session !== sessionRef.current) return;
    writeInFlight.current = true;
    setSaving(true);
    try {
      // A single user action saves the selected absences first, so the normal
      // attendance call can never record one of those pupils as present.
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
      toast.success(`บันทึกห้อง ${snapshot.room} แล้ว · มา ${snapshot.presentIds.length} · ลา ${snapshot.leaveIds.length}`);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'บันทึกไม่ครบ กรุณาตรวจสอบสถานะใหม่ก่อนลองอีกครั้ง');
    } finally {
      if (mounted.current) { setConfirmRoom(null); setSaving(false); }
      await load(snapshot.session);
      writeInFlight.current = false;
    }
  }

  async function undo(student) {
    if (!student.can_undo || !student.log_id || locked || writeInFlight.current || !data) return;
    writeInFlight.current = true; setSaving(true);
    try {
      await api.post(`/school/teacher-check/${student.log_id}/undo`, {});
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
        <PageHeader title="เช็กชื่อรายห้อง" subtitle={`นักเรียนชั้น ${grade} ที่ใช้รถรับส่ง`} icon={GraduationCap} iconColor="teal" />
        <SchoolWorkflowNav current="attendance" />
        <AppCard padding="md" className="space-y-1">
          <p className="font-semibold text-ink">เริ่มต้นถือว่ามาทุกคน เลือก “ลา” เฉพาะคนที่ไม่มา</p>
          <p className="text-sm text-ink-muted">ตรวจรายชื่อทีละห้อง แล้วกด “บันทึกทั้งห้อง” · การลาใช้เฉพาะรอบที่เลือก</p>
          <p className="text-sm text-ink-muted">เช้า: ถึงโรงเรียน · เย็น: ขึ้นรถกลับบ้าน · รายการที่คนขับหรือครูบันทึกแล้วจะไม่บันทึกซ้ำ</p>
        </AppCard>

        <div role="tablist" aria-label="เลือกรอบ" className="grid grid-cols-2 gap-2 p-1 bg-surface border border-surface-border rounded-2xl">
          {Object.entries(SESSIONS).map(([key, cfg]) => {
            const Icon = cfg.icon;
            return <button key={key} type="button" role="tab" aria-selected={session === key} disabled={locked}
              onClick={() => changeSession(key)}
              className={`focus-ring min-h-[52px] rounded-xl inline-flex items-center justify-center gap-2 px-2 font-semibold transition disabled:opacity-60 ${session === key ? 'bg-brand-700 text-white shadow-soft' : 'text-ink-muted hover:bg-surface-raised'}`}>
              <Icon className="w-5 h-5" aria-hidden="true" />{cfg.label} · {cfg.action}
            </button>;
          })}
        </div>

        {error && <ErrorState title="โหลดรายชื่อไม่สำเร็จ" message={error} onRetry={() => load()} />}
        {loading && <LoadingState message="กำลังโหลดรายชื่อห้องเรียน…" />}
        {data && rooms.length === 0 && <EmptyState title="ไม่มีนักเรียนที่ใช้รถรับส่งรอบนี้" description="ตรวจสอบรอบที่เลือกหรือการจัดรถของนักเรียน" />}

        {rooms.map(room => {
          const plan = classroomPlan(room, leaveIds);
          const pending = plan.presentIds.length + plan.leaveIds.length;
          const done = room.students.filter(st => st.done).length;
          const onLeave = room.students.filter(st => st.on_leave).length;
          return <AppCard key={room.key} padding="none" className="overflow-hidden">
            <div className="px-4 py-4 bg-surface border-b border-surface-border">
              <h2 className="text-lg font-bold text-ink">{grade} / {room.classroom ? `ห้อง ${room.classroom}` : 'ไม่ระบุห้อง'}</h2>
              <p className="text-sm text-ink-muted">{room.students.length} คน · บันทึกแล้ว {done} · ลาแล้ว {onLeave} · รอบันทึก {pending}</p>
            </div>
            <ul className="divide-y divide-surface-border">
              {room.students.map(student => {
                const selectable = !student.done && !student.on_leave && !student.no_vehicle;
                const selectedLeave = leaveIds.has(student.id);
                return <li key={student.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-[10rem]">
                    <p className="font-semibold text-ink">{student.name}</p>
                    <p className="text-sm text-ink-muted">{student.plate_no || 'ยังไม่ได้ผูกรถ'}</p>
                  </div>
                  {selectable ? <div className="flex items-center gap-2">
                    <StatusBadge variant={selectedLeave ? 'warn' : 'success'}>{selectedLeave ? 'เลือกลา' : 'มา (ค่าเริ่มต้น)'}</StatusBadge>
                    <button type="button" aria-pressed={selectedLeave} aria-label={`${selectedLeave ? 'ยกเลิกการเลือกลา' : 'เลือกลา'} ${student.name}`}
                      onClick={() => toggleLeave(student)} disabled={locked}
                      className={`focus-ring min-h-[44px] px-4 rounded-lg border text-sm font-semibold disabled:opacity-60 ${selectedLeave ? 'border-warn-ink bg-warn-soft text-warn-ink' : 'border-surface-border bg-surface-raised text-ink hover:bg-surface'}`}>
                      {selectedLeave ? 'ยกเลิกลา' : 'ลา'}
                    </button>
                  </div> : <div className="flex items-center gap-2">
                    <StatusBadge variant={student.on_leave ? 'warn' : student.done ? 'success' : 'neutral'}>
                      {student.on_leave ? 'ลาแล้ว' : student.done ? 'บันทึกแล้ว' : 'ยังไม่มีรถ'}
                    </StatusBadge>
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
                {pending ? `บันทึกทั้งห้อง · มา ${plan.presentIds.length} · ลา ${plan.leaveIds.length}` : 'บันทึกครบแล้ว'}
              </button>
            </div>
          </AppCard>;
        })}

        <ConfirmDialog open={Boolean(confirmRoom)} tone="brand" title="บันทึกทั้งห้อง?"
          description={confirmRoom ? `ห้อง ${confirmRoom.room} รอบ${SESSIONS[confirmRoom.session].label}: มา ${confirmRoom.presentIds.length} คน · ลา ${confirmRoom.leaveIds.length} คน ระบบจะบันทึกเฉพาะรายชื่อที่ยังไม่เช็ก` : ''}
          confirmLabel="ยืนยันบันทึกทั้งห้อง" loading={saving} onConfirm={saveRoom}
          onCancel={() => { if (!saving) setConfirmRoom(null); }} />
      </div>
    </PageTransition>
  );
}
