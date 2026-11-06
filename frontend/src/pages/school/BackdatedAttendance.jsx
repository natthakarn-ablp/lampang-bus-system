import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Search, Sunrise, Sunset } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import { useToast } from '../../components/Toast';
import { AlertBanner, AppCard, ConfirmDialog, Modal, StatusBadge } from '../../components/ui';
import { formatGradeClass } from '../../utils/student';
import { PageTransition } from '../../lib/motion';

/**
 * เช็กชื่อย้อนหลัง — a full-scope school account records a missed check for one
 * of the last 7 days (the backend enforces the window, the scope and the
 * reason). Parents are NOT notified for a past day. A wrong row is reversed
 * with the existing void endpoint, which also needs a reason.
 */

const SESSION_META = {
  morning: {
    label: 'รอบเช้า', icon: Sunrise,
    in: 'รับขึ้นรถ', out: 'ส่งถึงโรงเรียน', enabledKey: 'morning',
  },
  evening: {
    label: 'รอบเย็น', icon: Sunset,
    in: 'รับขึ้นรถ', out: 'ส่งถึงบ้าน', enabledKey: 'evening',
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
      <PageHeader
        title="เช็กชื่อย้อนหลัง"
        subtitle={`บันทึกการขึ้น-ลงรถที่ตกหล่นย้อนหลังได้ไม่เกิน ${data?.max_days ?? 7} วัน ต้องระบุเวลาและเหตุผลทุกครั้ง`}
        icon={History}
      />

      <AlertBanner variant="info" title="ข้อควรทราบ">
        รายการย้อนหลังจะไม่ส่งแจ้งเตือน LINE ถึงผู้ปกครอง และถูกเก็บในประวัติการแก้ไขพร้อมชื่อผู้บันทึกและเหตุผล
        · รายการของวันนี้ให้ใช้ปุ่ม &ldquo;ยืนยันแทนคนขับ&rdquo; ที่หน้าแรก
      </AlertBanner>

      <AppCard className="mt-4">
        <div className="grid gap-3 sm:grid-cols-[auto_auto_1fr] sm:items-end">
          <label className="block">
            <span className="block text-xs font-medium text-ink-muted mb-1">วันที่</span>
            <input
              type="date"
              value={date}
              min={minDate}
              max={maxDate}
              onChange={e => e.target.value && setDate(e.target.value)}
              className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 min-h-[44px] bg-surface"
              aria-label="เลือกวันที่ต้องการเช็กชื่อย้อนหลัง"
            />
          </label>
          <div role="radiogroup" aria-label="รอบ" className="flex gap-2">
            {Object.entries(SESSION_META).map(([key, m]) => {
              const Icon = m.icon;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={session === key}
                  onClick={() => setSession(key)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm min-h-[44px] ${
                    session === key ? 'border-brand-700 bg-brand-50/60 text-ink font-medium' : 'border-surface-border text-ink-muted hover:bg-surface-border/40'
                  }`}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />{m.label}
                </button>
              );
            })}
          </div>
          <div className="relative">
            <Search className="w-4 h-4 text-ink-muted absolute left-2.5 top-3" aria-hidden="true" />
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="ค้นหาจากชื่อ / ชั้น / ทะเบียนรถ"
              aria-label="ค้นหานักเรียน"
              className="w-full text-sm border border-surface-border rounded-lg pl-8 pr-3 py-2 min-h-[44px] bg-surface"
            />
          </div>
        </div>
        <p className="text-sm text-ink mt-3">
          {thaiDate(date)} · {meta.label}
          {data && <span className="text-ink-muted"> · บันทึกแล้ว <span className="tabular-nums">{doneCount}/{rows.length}</span> คน</span>}
        </p>
      </AppCard>

      <div className="mt-4">
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
                    onRecord={status => setRecordFor({ student: s, status })}
                    onVoid={log => setVoidFor({ student: s, log })}
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
    </PageTransition>
  );
}

function StudentRow({ student, session, meta, onRecord, onVoid }) {
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
                <button
                  type="button"
                  onClick={() => onVoid(l)}
                  className="text-xs text-danger-ink hover:underline px-1 min-h-[32px]"
                >
                  ยกเลิก
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        {s.leave ? (
          <StatusBadge variant="neutral" size="sm">{s.leave === 'SELF' ? 'เดินทางเอง' : 'ลา'}</StatusBadge>
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

function RecordDialog({ date, session, meta, student, status, onClose, onSaved }) {
  const [time, setTime] = useState(session === 'morning' ? (status === 'CHECKED_IN' ? '07:00' : '07:45') : (status === 'CHECKED_IN' ? '15:30' : '16:30'));
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
        <label className="block">
          <span className="block text-xs font-medium text-ink-muted mb-1">เวลา <span className="text-danger-ink">*</span></span>
          <input type="time" value={time} onChange={e => setTime(e.target.value)}
            className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 min-h-[44px] bg-surface" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-ink-muted mb-1">
            เหตุผล <span className="text-danger-ink">*</span>
            <span className="ml-2 tabular-nums">{reasonTrimmed.length}/500</span>
          </span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={500} rows={3}
            placeholder="เช่น คนขับแจ้งว่าโทรศัพท์แบตหมด ไม่ได้กดเช็กชื่อในวันนั้น"
            className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 bg-surface resize-none" />
        </label>
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
      <label className="block mt-3">
        <span className="block text-xs font-medium text-ink-muted mb-1">เหตุผล <span className="text-danger-ink">*</span></span>
        <textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={500} rows={2}
          className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 bg-surface resize-none" />
      </label>
      {errorMsg && <p className="text-xs text-danger-ink mt-2">{errorMsg}</p>}
    </ConfirmDialog>
  );
}
