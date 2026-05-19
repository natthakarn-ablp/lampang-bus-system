import { useEffect, useMemo, useState } from 'react';
import { X, Search } from 'lucide-react';
import api from '../api/axios';
import { AlertBanner, StatusBadge } from './ui';

/**
 * Phase 10.8C — School "ยืนยันแทนคนขับ" modal.
 *
 * Lets a full-school user confirm a student's check-in/check-out on behalf
 * of the driver when the driver missed the tap. Backend endpoint
 * (POST /api/school/checkin-override) writes the same daily_status /
 * checkin_logs / notifications rows as the driver path and appends a
 * dedicated audit row (entity_type='checkin_override') carrying the reason
 * and actor identity.
 *
 * Props:
 *   - vehicles:  array of vehicle groups from /school/status-today (each
 *                vehicle has .students with morning_done / evening_done /
 *                leave_session fields). Drives the in-modal student picker
 *                so no extra fetch is required.
 *   - onClose:   called when user dismisses (Cancel / overlay / X)
 *   - onSaved:   called after a successful 201; parent should refetch
 *                dashboard + status-today so the chips update.
 */
export default function SchoolOverrideModal({ vehicles = [], onClose, onSaved }) {
  // Flatten the vehicles → students list once. Each option carries enough
  // context for the user to make a confident pick and for the UI to
  // disable students whose chosen session is already done or on leave.
  const allStudents = useMemo(() => {
    const out = [];
    for (const v of vehicles) {
      for (const s of v.students || []) {
        out.push({
          id:               s.id,
          name:             s.name,
          grade:            s.grade,
          classroom:        s.classroom,
          plate_no:         v.plate_no,
          vehicle_id:       v.vehicle_id,
          morning_enabled:  s.morning_enabled,
          morning_done:     s.morning_done,
          evening_enabled:  s.evening_enabled,
          evening_done:     s.evening_done,
          leave_session:    s.leave_session || null,
        });
      }
    }
    return out;
  }, [vehicles]);

  const [session, setSession]       = useState('morning');
  const [status, setStatus]         = useState('CHECKED_IN');
  const [studentId, setStudentId]   = useState('');
  const [reason, setReason]         = useState('');
  const [filter, setFilter]         = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg]     = useState('');
  const [success, setSuccess]       = useState(false);

  // Keep status sensible when the user changes session: morning → CHECKED_IN
  // (boarded the bus), evening → CHECKED_OUT (dropped off home). User can
  // override either dropdown if they have a different scenario in mind.
  useEffect(() => {
    setStatus(session === 'morning' ? 'CHECKED_IN' : 'CHECKED_OUT');
  }, [session]);

  // Filter students by name/classroom/plate. Show all students; mark those
  // whose selected session is done or on leave as disabled with a hint
  // (backend would 409 anyway, but a pre-empt is friendlier UX).
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const base = q
      ? allStudents.filter(s =>
          `${s.name} ${s.classroom || ''} ${s.plate_no || ''}`.toLowerCase().includes(q)
        )
      : allStudents;
    return base.slice(0, 100); // safety cap; school search is fine with ~100 visible
  }, [allStudents, filter]);

  function isStudentBlocked(s) {
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

  const selectedStudent = allStudents.find(s => s.id === studentId);
  const reasonTrimmed   = reason.trim();
  const canSubmit =
    !!studentId && !!session && !!status &&
    reasonTrimmed.length >= 1 && reasonTrimmed.length <= 500 &&
    !submitting && !success;

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMsg('');
    try {
      await api.post('/school/checkin-override', {
        student_id: studentId,
        session,
        status,
        reason: reasonTrimmed,
      });
      setSuccess(true);
      // Give the user a beat to read the success message, then close +
      // bubble the refresh signal to the parent dashboard.
      setTimeout(() => {
        onSaved?.();
        onClose?.();
      }, 700);
    } catch (err) {
      const code = err?.response?.status;
      const apiMsg = err?.response?.data?.message;
      let msg = apiMsg || 'ไม่สามารถดำเนินการได้';
      if (code === 403) msg = apiMsg || 'บัญชีนี้ไม่มีสิทธิ์ยืนยันแทนคนขับ';
      else if (code === 404) msg = apiMsg || 'ไม่พบนักเรียนในโรงเรียนของท่าน';
      // 400 + 409 already carry Thai messages from the backend; surface as-is.
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] isolate flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="relative z-[10000] bg-surface w-full max-w-lg rounded-2xl shadow-elevate max-h-[90vh] overflow-y-auto"
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
            className="p-1 rounded-full hover:bg-surface-border shrink-0 ml-2"
            aria-label="ปิด"
          >
            <X className="w-4 h-4 text-ink-muted" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Session + status — two compact selects on one row */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-ink-muted mb-1">รอบ</span>
              <select
                value={session}
                onChange={e => setSession(e.target.value)}
                className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 bg-surface"
                disabled={submitting || success}
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
                className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 bg-surface"
                disabled={submitting || success}
              >
                <option value="CHECKED_IN">ยืนยันรับ/มาถึง</option>
                <option value="CHECKED_OUT">ยืนยันส่ง/ออก</option>
              </select>
            </label>
          </div>

          {/* Student picker */}
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
                  {selectedStudent.grade}{selectedStudent.classroom ? ` / ${selectedStudent.classroom}` : ''}
                  {selectedStudent.plate_no ? ` · ${selectedStudent.plate_no}` : ''}
                </p>
                {isStudentBlocked(selectedStudent) && (
                  <p className="text-xs text-warn mt-1">
                    หมายเหตุ: {isStudentBlocked(selectedStudent)} — ระบบจะตรวจสอบและอาจปฏิเสธคำขอ
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
                    className="w-full text-sm border border-surface-border rounded-lg pl-8 pr-3 py-2 bg-surface"
                    disabled={submitting || success}
                  />
                </div>
                {allStudents.length === 0 ? (
                  <p className="text-xs text-ink-muted py-3 text-center">
                    ไม่พบรายชื่อนักเรียน — ลองรีเฟรชหน้าหลักก่อน
                  </p>
                ) : (
                  <div className="border border-surface-border rounded-lg divide-y divide-surface-border max-h-60 overflow-y-auto">
                    {filtered.map(s => {
                      const blocked = isStudentBlocked(s);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setStudentId(s.id)}
                          className={`w-full text-left px-3 py-2 hover:bg-surface-border/40 transition ${blocked ? 'opacity-60' : ''}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm text-ink truncate">{s.name}</p>
                              <p className="text-xs text-ink-muted truncate">
                                {s.grade}{s.classroom ? ` / ${s.classroom}` : ''}
                                {s.plate_no ? ` · ${s.plate_no}` : ''}
                              </p>
                            </div>
                            {blocked && (
                              <StatusBadge variant="warn" size="sm">{blocked}</StatusBadge>
                            )}
                          </div>
                        </button>
                      );
                    })}
                    {filtered.length === 0 && (
                      <p className="text-xs text-ink-muted py-3 text-center">ไม่พบนักเรียนตามที่ค้น</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Reason */}
          <label className="block">
            <span className="block text-xs font-medium text-ink-muted mb-1">
              เหตุผล <span className="text-danger">*</span>
              <span className="ml-2 text-ink-muted/70 tabular-nums">{reasonTrimmed.length}/500</span>
            </span>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="เช่น นักเรียนมาถึงโรงเรียนแล้ว แต่คนขับยังไม่ได้กดยืนยัน"
              maxLength={500}
              rows={3}
              className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 bg-surface resize-none"
              disabled={submitting || success}
            />
          </label>

          {/* Error / success banners */}
          {errorMsg && (
            <AlertBanner variant="danger" title="ไม่สามารถยืนยันได้">{errorMsg}</AlertBanner>
          )}
          {success && (
            <AlertBanner variant="success" title="บันทึกสำเร็จ">
              ระบบบันทึกการยืนยันแทนคนขับเรียบร้อยแล้ว — กำลังรีเฟรชข้อมูล…
            </AlertBanner>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-surface-border disabled:opacity-60"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-4 py-2 text-sm rounded-lg bg-brand-700 hover:bg-brand-800 text-white disabled:opacity-60"
            >
              {submitting ? 'กำลังบันทึก…' : 'ยืนยันแทนคนขับ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
