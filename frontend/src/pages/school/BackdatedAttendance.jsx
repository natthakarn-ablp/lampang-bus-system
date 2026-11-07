import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Sunrise, Sunset } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import { useToast } from '../../components/Toast';
import { AlertBanner, AppCard, ConfirmDialog, FilterBar, FormField, Modal, StatusBadge } from '../../components/ui';
import { formatGradeClass } from '../../utils/student';
import { PageTransition } from '../../lib/motion';
import { useAuth } from '../../hooks/useAuth';
import { isGradeTeacher } from '../../utils/authScope';

/**
 * เช็กชื่อย้อนหลัง — a school account records a missed check for one of the
 * last 7 days (the backend enforces the window, the scope and the reason).
 * Parents are NOT notified for a past day.
 *
 * A grade teacher sees only their grade and records only what a teacher
 * records on the live check page (TEACHER_STATUS): morning = arrived at
 * school, evening = boarded to go home, pre-filled 07:00 / 16:00. Voiding a
 * wrong row stays with the full school account.
 */

// Pre-filled times. The two teacher actions come from the server
// (default_times: มา 07:00 / กลับ 16:00); the other two sit either side.
const FALLBACK_TIMES = { morning: '07:00', evening: '16:00' };
function defaultTime(session, status, defaults = FALLBACK_TIMES) {
  if (session === 'morning') return status === 'CHECKED_OUT' ? defaults.morning : '06:30';
  return status === 'CHECKED_IN' ? defaults.evening : '16:45';
}

const SESSION_META = {
  morning: {
    label: 'รอบเช้า', icon: Sunrise,
    in: 'รับขึ้นรถ', out: 'ส่งถึงโรงเรียน', enabledKey: 'morning',
    teacherStatus: 'CHECKED_OUT', teacherLabel: 'มาถึงโรงเรียน',
  },
  evening: {
    label: 'รอบเย็น', icon: Sunset,
    in: 'รับขึ้นรถ', out: 'ส่งถึงบ้าน', enabledKey: 'evening',
    teacherStatus: 'CHECKED_IN', teacherLabel: 'ขึ้นรถกลับบ้าน',
  },
};

function bangkokToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}
function shiftDate(ymd, days) {
  const d = new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function thaiDate(ymd) {
  if (!ymd) return '';
  return new Date(`${ymd}T00:00:00+07:00`).toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export default function BackdatedAttendance() {
  const toast = useToast();
  const { user } = useAuth();
  const teacher = isGradeTeacher(user);
  const [date, setDate] = useState(() => shiftDate(bangkokToday(), -1));
  const [session, setSession] = useState('morning');
  const [filter, setFilter] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // { student, status } for the record dialog; { student, log } for void
  const [recordFor, setRecordFor] = useState(null);
  const [voidFor, setVoidFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/school/backdated-attendance', { params: { date } });
      setData(res.data.data);
    } catch (err) {
      setError(err?.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const minDate = data?.min_date || shiftDate(bangkokToday(), -7);
  const maxDate = data?.max_date || shiftDate(bangkokToday(), -1);
  const meta = SESSION_META[session];

  const rows = useMemo(() => {
    const list = (data?.students || []).filter(s => s[meta.enabledKey]?.enabled);
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(s =>
      `${s.name} ${s.grade || ''} ${s.classroom || ''} ${s.plate_no || ''}`.toLowerCase().includes(q));
  }, [data, filter, meta.enabledKey]);

  const doneCount = rows.filter(s => s[session].done).length;

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5">
      <PageHeader
        title="เช็กชื่อย้อนหลัง"
        subtitle={`บันทึกการขึ้น-ลงรถที่ตกหล่นย้อนหลังได้ไม่เกิน ${data?.max_days ?? 7} วัน ต้องระบุเวลาและเหตุผลทุกครั้ง`}
        icon={History}
      />

      <AlertBanner variant="info" title="ข้อควรทราบ">
        รายการย้อนหลังจะไม่ส่งแจ้งเตือน LINE ถึงผู้ปกครอง และถูกเก็บในประวัติการแก้ไขพร้อมชื่อผู้บันทึกและเหตุผล
        {teacher
          ? ' · รายการของวันนี้ให้ใช้หน้า “เช็กชื่อวันนี้” · หากบันทึกผิด แจ้งบัญชีโรงเรียนให้ยกเลิกรายการ'
          : ' · รายการของวันนี้ให้ใช้ปุ่ม “ยืนยันแทนคนขับ” ที่หน้าแรก'}
      </AlertBanner>

      <AppCard>
        <FormField
          label="วันที่"
          type="date"
          value={date}
          onChange={v => v && setDate(v)}
          min={minDate}
          max={maxDate}
          helper={`เลือกได้ ${thaiDate(minDate)} ถึง ${thaiDate(maxDate)}`}
          className="max-w-xs mb-3"
        />
        <FilterBar
          chips={{
            label: 'รอบ',
            value: session,
            onChange: setSession,
            options: Object.entries(SESSION_META).map(([key, m]) => [key, m.label]),
          }}
          search={{
            value: filter,
            onChange: setFilter,
            placeholder: 'ค้นหาจากชื่อ / ชั้น / ทะเบียนรถ',
            label: 'ค้นหานักเรียน',
          }}
          count={data ? rows.length : undefined}
          countLabel="คน"
          onClear={() => setFilter('')}
        />
        <p className="text-sm text-ink mt-3">
          {thaiDate(date)} · {meta.label}
          {data && <span className="text-ink-muted"> · บันทึกแล้ว <span className="tabular-nums">{doneCount}/{rows.length}</span> คน</span>}
        </p>
      </AppCard>

      <div>
        {loading ? <LoadingState />
          : error ? <ErrorState message={error} onRetry={load} />
          : rows.length === 0 ? <EmptyState title="ไม่พบนักเรียนที่ใช้บริการรอบนี้" />
          : (
            <AppCard className="p-0 overflow-hidden">
              <ul className="divide-y divide-surface-border">
                {rows.map(s => (
                  <StudentRow
                    key={s.id}
                    student={s}
                    session={session}
                    meta={meta}
                    teacher={teacher}
                    onRecord={status => setRecordFor({ student: s, status })}
                    onVoid={teacher ? null : log => setVoidFor({ student: s, log })}
                  />
                ))}
              </ul>
            </AppCard>
          )}
      </div>

      {recordFor && (
        <RecordDialog
          date={date}
          session={session}
          meta={meta}
          defaults={data?.default_times}
          {...recordFor}
          onClose={() => setRecordFor(null)}
          onSaved={() => { setRecordFor(null); toast?.success?.('บันทึกการเช็กชื่อย้อนหลังแล้ว'); load(); }}
        />
      )}
      {voidFor && (
        <VoidDialog
          {...voidFor}
          meta={meta}
          onClose={() => setVoidFor(null)}
          onSaved={() => { setVoidFor(null); toast?.success?.('ยกเลิกรายการแล้ว'); load(); }}
        />
      )}
      </div>
    </PageTransition>
  );
}

function StudentRow({ student, session, meta, teacher, onRecord, onVoid }) {
  const s = student[session];
  const logs = s.logs || [];
  const hasIn = logs.some(l => l.status === 'CHECKED_IN');
  const hasOut = logs.some(l => l.status === 'CHECKED_OUT');

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink truncate">{student.name}</p>
        <p className="text-xs text-ink-muted truncate">
          {formatGradeClass(student.grade, student.classroom, '')}
          {student.plate_no ? ` · ${student.plate_no}` : ''}
        </p>
        {logs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {logs.map(l => (
              <span key={l.log_id} className="inline-flex items-center gap-1">
                <StatusBadge variant="success" size="sm">
                  {l.status === 'CHECKED_IN' ? meta.in : meta.out} {l.time} น.
                </StatusBadge>
                {onVoid && (
                  <button
                    type="button"
                    onClick={() => onVoid(l)}
                    className="text-xs text-danger-ink hover:underline px-1 min-h-[32px]"
                  >
                    ยกเลิก
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        {s.leave ? (
          <StatusBadge variant="neutral" size="sm">{s.leave === 'SELF' ? 'เดินทางเอง' : 'ลา'}</StatusBadge>
        ) : teacher ? (
          // Morning arrival is the last step of the morning run; evening
          // boarding cannot follow a drop-off already recorded.
          (session === 'morning' ? !hasOut : !hasIn && !hasOut) && (
            <button type="button" onClick={() => onRecord(meta.teacherStatus)}
              className="px-3 py-2 text-sm rounded-lg border border-brand-700 text-brand-700 hover:bg-brand-50 min-h-[44px]">
              บันทึก{meta.teacherLabel}
            </button>
          )
        ) : (
          <>
            {!hasIn && !hasOut && (
              <button type="button" onClick={() => onRecord('CHECKED_IN')}
                className="px-3 py-2 text-sm rounded-lg border border-brand-700 text-brand-700 hover:bg-brand-50 min-h-[44px]">
                บันทึก{meta.in}
              </button>
            )}
            {!hasOut && (
              <button type="button" onClick={() => onRecord('CHECKED_OUT')}
                className="px-3 py-2 text-sm rounded-lg border border-brand-700 text-brand-700 hover:bg-brand-50 min-h-[44px]">
                บันทึก{meta.out}
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

function RecordDialog({ date, session, meta, defaults, student, status, onClose, onSaved }) {
  const [time, setTime] = useState(() => defaultTime(session, status, defaults || FALLBACK_TIMES));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const reasonTrimmed = reason.trim();
  const canSave = /^\d{2}:\d{2}$/.test(time) && reasonTrimmed.length > 0 && reasonTrimmed.length <= 500 && !saving;
  const actionLabel = status === 'CHECKED_IN' ? meta.in : meta.out;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setErrorMsg('');
    try {
      await api.post('/school/backdated-attendance', {
        student_id: student.id, check_date: date, session, status, time, reason: reasonTrimmed,
      });
      onSaved();
    } catch (err) {
      setErrorMsg(err?.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={`บันทึก${actionLabel}ย้อนหลัง`}
      onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-surface-border min-h-[44px]">
            ยกเลิก
          </button>
          <button type="button" onClick={save} disabled={!canSave}
            className="px-4 py-2 text-sm rounded-lg text-white bg-brand-700 hover:bg-brand-800 disabled:opacity-60 min-h-[44px]">
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      )}
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-surface-border bg-surface-2 px-3 py-2 text-sm">
          <p className="font-medium text-ink">{student.name}</p>
          <p className="text-xs text-ink-muted">{thaiDate(date)} · {meta.label} · {actionLabel}</p>
        </div>
        <FormField label="เวลา" type="time" required value={time} onChange={setTime} />
        <FormField label="เหตุผล" required helper={`${reasonTrimmed.length}/500 ตัวอักษร`}>
          {props => (
            <textarea {...props} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} rows={3}
              placeholder="เช่น คนขับแจ้งว่าโทรศัพท์แบตหมด ไม่ได้กดเช็กชื่อในวันนั้น"
              className="focus-ring w-full text-base border border-surface-border rounded-lg px-3 py-2 bg-surface-raised resize-none" />
          )}
        </FormField>
        {errorMsg && <AlertBanner variant="danger" title="บันทึกไม่สำเร็จ">{errorMsg}</AlertBanner>}
      </div>
    </Modal>
  );
}

function VoidDialog({ student, log, meta, onClose, onSaved }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const reasonTrimmed = reason.trim();

  async function confirm() {
    if (!reasonTrimmed) return;
    setSaving(true);
    setErrorMsg('');
    try {
      await api.post(`/school/checkin/${log.log_id}/void`, { reason: reasonTrimmed });
      onSaved();
    } catch (err) {
      setErrorMsg(err?.response?.data?.message || 'ยกเลิกรายการไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ConfirmDialog
      open
      title="ยกเลิกรายการเช็กชื่อ"
      description="รายการเดิมจะยังอยู่ในประวัติ ระบบบันทึกรายการยกเลิกพร้อมเหตุผลเพิ่มเติม"
      itemName={`${student.name} · ${log.status === 'CHECKED_IN' ? meta.in : meta.out} ${log.time} น.`}
      confirmLabel="ยกเลิกรายการ"
      loading={saving}
      confirmDisabled={!reasonTrimmed}
      onConfirm={confirm}
      onCancel={onClose}
    >
      <FormField label="เหตุผล" required className="mt-3">
        {props => (
          <textarea {...props} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} rows={2}
            className="focus-ring w-full text-base border border-surface-border rounded-lg px-3 py-2 bg-surface-raised resize-none" />
        )}
      </FormField>
      {errorMsg && <p className="text-xs text-danger-ink mt-2">{errorMsg}</p>}
    </ConfirmDialog>
  );
}
