import { useEffect, useMemo, useState } from 'react';
import { X, Search, AlertTriangle } from 'lucide-react';
import api from '../api/axios';
import { AlertBanner, StatusBadge } from './ui';
import { formatGradeClass } from '../utils/student';

/**
 * School "ยืนยันแทนคนขับ" modal.
 *
 * Two modes, because the school uses this in two different situations:
 *
 *   ยกชุด (default) — the driver ran the route and did not tap. The school
 *     knows the short list of who did not board, not the long list of who did,
 *     so the selection is INVERTED: tick the exceptions, everyone else is
 *     confirmed present. POST /school/checkin-override/all.
 *
 *   รายคน — one pupil needs confirming. The original flow, kept because
 *     removing it would force a whole-session write for a single correction.
 *     POST /school/checkin-override.
 *
 * The inverted mode is the dangerous one: a reader who assumes "tick = present"
 * would invert an entire bus's attendance. Three things guard against that —
 * the tick column is labelled ไม่ได้ขึ้นรถ, a running count of both sides sits
 * above the list and inside the submit button, and submitting goes through a
 * confirm step that restates the numbers.
 *
 * Props:
 *   - vehicles:  vehicle groups from /school/status-today (each with .students
 *                carrying morning_done / evening_done / leave_session)
 *   - onClose:   dismiss
 *   - onSaved:   called after success; parent refetches
 */
export default function SchoolOverrideModal({ vehicles = [], onClose, onSaved }) {
  const allStudents = useMemo(() => {
    const out = [];
    for (const v of vehicles) {
      for (const s of v.students || []) {
        out.push({
          id: s.id,
          name: s.name,
          grade: s.grade,
          classroom: s.classroom,
          plate_no: v.plate_no,
          vehicle_id: v.vehicle_id,
          morning_enabled: s.morning_enabled,
          morning_done: s.morning_done,
          evening_enabled: s.evening_enabled,
          evening_done: s.evening_done,
          leave_session: s.leave_session || null,
        });
      }
    }
    return out;
  }, [vehicles]);

  const [mode, setMode] = useState('bulk');           // 'bulk' | 'single'
  const [session, setSession] = useState('morning');
  const [status, setStatus] = useState('CHECKED_IN');
  const [studentId, setStudentId] = useState('');
  const [absentIds, setAbsentIds] = useState(() => new Set());
  const [reason, setReason] = useState('');
  const [filter, setFilter] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    setStatus(session === 'morning' ? 'CHECKED_IN' : 'CHECKED_OUT');
    // Ticks describe one session. Carrying them across a session switch would
    // silently mark the wrong pupils absent in the other half of the day.
    setAbsentIds(new Set());
    setConfirming(false);
  }, [session]);

  /** Why this pupil cannot be confirmed for the selected session, or null. */
  function ineligibleReason(s) {
    if (session === 'morning') {
      if (!s.morning_enabled) return 'ไม่ได้ใช้บริการรอบเช้า';
      if (s.leave_session === 'morning' || s.leave_session === 'both') return 'ลารอบเช้า';
      if (s.morning_done) return 'รับเข้าแล้ว';
    } else {
      if (!s.evening_enabled) return 'ไม่ได้ใช้บริการรอบเย็น';
      if (s.leave_session === 'evening' || s.leave_session === 'both') return 'ลารอบเย็น';
      if (s.evening_done) return 'ส่งกลับแล้ว';
    }
    return null;
  }

  // Mirrors the backend's eligibility query. Anything ineligible is never
  // counted and never confirmed, whether or not the user ticked it.
  const eligible = useMemo(
    () => allStudents.filter(s => !ineligibleReason(s)),
    [allStudents, session] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const base = q
      ? allStudents.filter(s =>
        `${s.name} ${s.classroom || ''} ${s.plate_no || ''}`.toLowerCase().includes(q))
      : allStudents;
    return base.slice(0, 300);
  }, [allStudents, filter]);

  const absentEligibleCount = eligible.filter(s => absentIds.has(s.id)).length;
  const confirmCount = eligible.length - absentEligibleCount;

  const selectedStudent = allStudents.find(s => s.id === studentId);
  const reasonTrimmed = reason.trim();
  const reasonOk = reasonTrimmed.length >= 1 && reasonTrimmed.length <= 500;
  const busy = submitting || !!successMsg;

  const canSubmit = mode === 'bulk'
    ? reasonOk && confirmCount > 0 && !busy
    : !!studentId && reasonOk && !busy;

  function toggleAbsent(id) {
    setAbsentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setConfirming(false);
  }

  function describeError(err, fallback) {
    const code = err?.response?.status;
    const apiMsg = err?.response?.data?.message;
    if (code === 403) return apiMsg || 'บัญชีนี้ไม่มีสิทธิ์ยืนยันแทนคนขับ';
    if (code === 404) return apiMsg || 'ไม่พบนักเรียนในโรงเรียนของท่าน';
    return apiMsg || fallback;
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (!canSubmit) return;
    // Bulk writes attendance for the whole session; make the user see the two
    // numbers once more before anything is recorded.
    if (mode === 'bulk' && !confirming) { setConfirming(true); return; }

    setSubmitting(true);
    setErrorMsg('');
    try {
      if (mode === 'bulk') {
        const res = await api.post('/school/checkin-override/all', {
          session,
          status,
          reason: reasonTrimmed,
          absent_student_ids: eligible.filter(s => absentIds.has(s.id)).map(s => s.id),
        });
        const d = res?.data?.data || {};
        setSuccessMsg(
          `ยืนยันแล้ว ${d.confirmed_count ?? confirmCount} คน` +
          ` · ไม่ยืนยัน ${d.absent_marked_count ?? absentEligibleCount} คน` +
          (d.failed_count ? ` · ล้มเหลว ${d.failed_count} คน` : '')
        );
      } else {
        await api.post('/school/checkin-override', {
          student_id: studentId, session, status, reason: reasonTrimmed,
        });
        setSuccessMsg('บันทึกการยืนยันแทนคนขับเรียบร้อยแล้ว');
      }
      setTimeout(() => { onSaved?.(); onClose?.(); }, 1200);
    } catch (err) {
      setErrorMsg(describeError(err, 'ไม่สามารถดำเนินการได้'));
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel = submitting
    ? 'กำลังบันทึก…'
    : mode === 'single'
      ? 'ยืนยันแทนคนขับ'
      : confirming
        ? `ยืนยันแน่นอน — ${confirmCount} คน`
        : `ยืนยัน ${confirmCount} คน`;

  return (
    <div
      className="fixed inset-0 z-[9999] isolate flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="relative z-[10000] bg-surface w-full max-w-xl rounded-2xl shadow-elevate max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b border-surface-border sticky top-0 bg-surface z-10">
          <div className="min-w-0">
            <h2 className="font-semibold text-ink truncate">ยืนยันแทนคนขับ</h2>
            <p className="text-xs text-ink-muted mt-0.5">
              ใช้เมื่อตรวจสอบแล้วว่านักเรียนมา/กลับจริง แต่คนขับยังไม่ได้กดยืนยัน
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring tap-target p-1 rounded-full hover:bg-surface-border shrink-0 ml-2"
            aria-label="ปิด"
          >
            <X className="w-4 h-4 text-ink-muted" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Mode */}
          <div role="radiogroup" aria-label="รูปแบบการยืนยัน" className="grid grid-cols-2 gap-2">
            {[
              ['bulk', 'ทั้งรอบ', 'ติ๊กเฉพาะคนที่ไม่ได้ขึ้นรถ'],
              ['single', 'รายคน', 'เลือกทีละคน'],
            ].map(([key, title, sub]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={mode === key}
                onClick={() => { setMode(key); setConfirming(false); }}
                disabled={busy}
                className={`text-left px-3 py-2 rounded-lg border transition min-h-[44px] ${
                  mode === key
                    ? 'border-brand-700 bg-brand-50/60 text-ink'
                    : 'border-surface-border hover:bg-surface-border/40 text-ink-muted'
                }`}
              >
                <span className="block text-sm font-medium">{title}</span>
                <span className="block text-xs mt-0.5">{sub}</span>
              </button>
            ))}
          </div>

          {/* Session + status */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-ink-muted mb-1">รอบ</span>
              <select
                value={session}
                onChange={e => setSession(e.target.value)}
                className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 min-h-[44px] bg-surface"
                disabled={busy}
              >
                <option value="morning">ส่งเช้า</option>
                <option value="evening">รับเย็น</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-ink-muted mb-1">สถานะ</span>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 min-h-[44px] bg-surface"
                disabled={busy}
              >
                <option value="CHECKED_IN">ยืนยันรับ/มาถึง</option>
                <option value="CHECKED_OUT">ยืนยันส่ง/ออก</option>
              </select>
            </label>
          </div>

          {mode === 'bulk' ? (
            <>
              {/* Running count. Sits directly above the list so the two numbers
                  are in view while ticking, not only at submit time. */}
              <div className="rounded-lg border border-surface-border bg-surface-2 px-3 py-2.5">
                <p className="text-sm text-ink">
                  จะยืนยันว่า<strong className="text-success"> ขึ้นรถ {confirmCount} คน</strong>
                  {' · '}
                  <strong className="text-warn">ไม่ยืนยัน {absentEligibleCount} คน</strong>
                </p>
                <p className="text-xs text-ink-muted mt-1">
                  ติ๊กเฉพาะคนที่<strong>ไม่ได้ขึ้นรถ</strong> — ที่ไม่ติ๊กถือว่ามาตามปกติ
                </p>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-ink-muted absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder="ค้นหาจากชื่อ / ห้อง / ทะเบียนรถ"
                  aria-label="ค้นหานักเรียนในรายการ"
                  className="w-full text-sm border border-surface-border rounded-lg pl-8 pr-3 py-2 min-h-[44px] bg-surface"
                  disabled={busy}
                />
              </div>

              {allStudents.length === 0 ? (
                <p className="text-xs text-ink-muted py-3 text-center">
                  ไม่พบรายชื่อนักเรียน — ลองรีเฟรชหน้าหลักก่อน
                </p>
              ) : (
                <div className="border border-surface-border rounded-lg divide-y divide-surface-border max-h-72 overflow-y-auto">
                  {visible.map(s => {
                    const reasonWhy = ineligibleReason(s);
                    const ticked = absentIds.has(s.id);
                    return (
                      <label
                        key={s.id}
                        className={`flex items-center gap-3 px-3 py-2.5 min-h-[44px] ${
                          reasonWhy ? 'opacity-55' : 'hover:bg-surface-border/30 cursor-pointer'
                        }`}
                      >
                        {/* tap-target extends the hit box to 44px without
                            inflating the visual box — same utility the rest of
                            the app uses for small controls. */}
                        <input
                          type="checkbox"
                          checked={ticked && !reasonWhy}
                          onChange={() => toggleAbsent(s.id)}
                          disabled={!!reasonWhy || busy}
                          className="focus-ring tap-target w-5 h-5 shrink-0 accent-warn"
                          aria-label={`${s.name} ไม่ได้ขึ้นรถ`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-ink truncate">{s.name}</span>
                          <span className="block text-xs text-ink-muted truncate">
                            {formatGradeClass(s.grade, s.classroom, '')}
                            {s.plate_no ? ` · ${s.plate_no}` : ''}
                          </span>
                        </span>
                        {reasonWhy
                          ? <StatusBadge variant="neutral" size="sm">{reasonWhy}</StatusBadge>
                          : ticked
                            ? <StatusBadge variant="warn" size="sm">ไม่ได้ขึ้นรถ</StatusBadge>
                            : null}
                      </label>
                    );
                  })}
                  {visible.length === 0 && (
                    <p className="text-xs text-ink-muted py-3 text-center">ไม่พบนักเรียนตามที่ค้น</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="block text-xs font-medium text-ink-muted">
                  เลือกนักเรียน
                  {allStudents.length > 0 && (
                    <span className="ml-1 tabular-nums">({allStudents.length} คน)</span>
                  )}
                </span>
                {selectedStudent && (
                  <button
                    type="button"
                    onClick={() => { setStudentId(''); setFilter(''); }}
                    className="text-xs text-brand-700 hover:underline"
                  >
                    ล้างที่เลือก
                  </button>
                )}
              </div>

              {selectedStudent ? (
                <div className="border border-brand-700/40 bg-brand-50/40 rounded-lg p-3 text-sm">
                  <p className="font-medium text-ink">{selectedStudent.name}</p>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {formatGradeClass(selectedStudent.grade, selectedStudent.classroom, '')}
                    {selectedStudent.plate_no ? ` · ${selectedStudent.plate_no}` : ''}
                  </p>
                  {ineligibleReason(selectedStudent) && (
                    <p className="text-xs text-warn mt-1">
                      หมายเหตุ: {ineligibleReason(selectedStudent)} — ระบบจะตรวจสอบและอาจปฏิเสธคำขอ
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div className="relative mb-2">
                    <Search className="w-4 h-4 text-ink-muted absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      value={filter}
                      onChange={e => setFilter(e.target.value)}
                      placeholder="ค้นหาจากชื่อ / ห้อง / ทะเบียนรถ"
                      aria-label="ค้นหานักเรียนเพื่อเลือก"
                      className="w-full text-sm border border-surface-border rounded-lg pl-8 pr-3 py-2 min-h-[44px] bg-surface"
                      disabled={busy}
                    />
                  </div>
                  {allStudents.length === 0 ? (
                    <p className="text-xs text-ink-muted py-3 text-center">
                      ไม่พบรายชื่อนักเรียน — ลองรีเฟรชหน้าหลักก่อน
                    </p>
                  ) : (
                    <div className="border border-surface-border rounded-lg divide-y divide-surface-border max-h-60 overflow-y-auto">
                      {visible.map(s => {
                        const reasonWhy = ineligibleReason(s);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setStudentId(s.id)}
                            disabled={busy}
                            className={`w-full text-left px-3 py-2 min-h-[44px] hover:bg-surface-border/40 transition ${reasonWhy ? 'opacity-60' : ''}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm text-ink truncate">{s.name}</p>
                                <p className="text-xs text-ink-muted truncate">
                                  {formatGradeClass(s.grade, s.classroom, '')}
                                  {s.plate_no ? ` · ${s.plate_no}` : ''}
                                </p>
                              </div>
                              {reasonWhy && (
                                <StatusBadge variant="warn" size="sm">{reasonWhy}</StatusBadge>
                              )}
                            </div>
                          </button>
                        );
                      })}
                      {visible.length === 0 && (
                        <p className="text-xs text-ink-muted py-3 text-center">ไม่พบนักเรียนตามที่ค้น</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Reason */}
          <label className="block">
            <span className="block text-xs font-medium text-ink-muted mb-1">
              เหตุผล <span className="text-danger">*</span>
              <span className="ml-2 text-ink-muted/70 tabular-nums">{reasonTrimmed.length}/500</span>
            </span>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={mode === 'bulk'
                ? 'เช่น คนขับโทรแจ้งว่ารับส่งครบแล้ว แต่โทรศัพท์แบตหมดจึงยังไม่ได้กดยืนยัน'
                : 'เช่น นักเรียนมาถึงโรงเรียนแล้ว แต่คนขับยังไม่ได้กดยืนยัน'}
              maxLength={500}
              rows={3}
              className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 bg-surface resize-none"
              disabled={busy}
            />
          </label>

          {mode === 'bulk' && confirming && !successMsg && (
            <AlertBanner variant="warn" title="ตรวจตัวเลขอีกครั้งก่อนบันทึก">
              <span className="inline-flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  ระบบจะบันทึกว่า <strong>ขึ้นรถ {confirmCount} คน</strong> และ
                  <strong> ไม่ยืนยัน {absentEligibleCount} คน</strong> ในรอบ
                  {session === 'morning' ? 'ส่งเช้า' : 'รับเย็น'} ของวันนี้
                  — กดปุ่มอีกครั้งเพื่อบันทึก
                </span>
              </span>
            </AlertBanner>
          )}

          {errorMsg && <AlertBanner variant="danger" title="ไม่สามารถยืนยันได้">{errorMsg}</AlertBanner>}
          {successMsg && (
            <AlertBanner variant="success" title="บันทึกสำเร็จ">
              {successMsg} — กำลังรีเฟรชข้อมูล…
            </AlertBanner>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-surface-border disabled:opacity-60 min-h-[44px]"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`px-4 py-2 text-sm rounded-lg text-white disabled:opacity-60 min-h-[44px] ${
                confirming ? 'bg-warn hover:bg-warn/90' : 'bg-brand-700 hover:bg-brand-800'
              }`}
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
