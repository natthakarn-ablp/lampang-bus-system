'use strict';

// Parent leave via LINE (M1, parent audit 2026-11-08, owner-approved).
//
// A verified, linked parent reports "my child will not ride" for a round. The
// row goes into student_leaves (reported_role='parent'), the same table the
// driver roster and school leave list already read, so it takes effect at once.
// Rules (owner decision 2026-11-08):
//   * only a child linked to this LINE account (caller checks the link);
//   * today .. today + maxDaysAhead (Bangkok);
//   * cut-off on the day itself: morning round before morningCutoff, evening
//     round before eveningCutoff, 'both' before the morning cut-off;
//   * the parent may cancel only a leave this LINE account reported, and only
//     before that round's cut-off; the school can cancel any time (existing
//     /api/school leave cancel already covers parent rows).

const { pool } = require('../config/database');
const env = require('../config/env');
const { logAudit } = require('../utils/audit');
const { todayBangkok, toBangkokDate, bangkokParts } = require('../utils/thaiTime');
const { isCalendarDate } = require('../utils/calendarDate');

const SESSIONS = ['morning', 'evening', 'both'];
const SESSION_TH = { morning: 'รอบเช้า', evening: 'รอบเย็น', both: 'ทั้งวัน' };

function fail(statusCode, message, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

// Bangkok calendar day + n days (noon anchor: no DST in Asia/Bangkok, and
// noon keeps the result on the same calendar day whatever the host TZ).
function addDays(dateStr, days) {
  return toBangkokDate(new Date(Date.parse(`${dateStr}T12:00:00+07:00`) + days * 86400000));
}

function hhmm(now) {
  const p = bangkokParts(now);
  return `${p.hour}:${p.minute}`;
}

// Has the cut-off for (leaveDate, session) passed at `now`?
function isPastCutoff(leaveDate, session, now = new Date()) {
  const today = todayBangkok(now);
  if (leaveDate > today) return false;
  if (leaveDate < today) return true;
  const cutoff = session === 'evening' ? env.features.parentLeaveEveningCutoff : env.features.parentLeaveMorningCutoff;
  return hhmm(now) >= cutoff;
}

function cutoffMessage(session) {
  return session === 'evening'
    ? `เลยเวลาแจ้งลารอบเย็นของวันนี้แล้ว (ก่อน ${env.features.parentLeaveEveningCutoff} น.) กรุณาติดต่อครูหรือคนขับโดยตรง`
    : `เลยเวลาแจ้งลารอบเช้าของวันนี้แล้ว (ก่อน ${env.features.parentLeaveMorningCutoff} น.) กรุณาติดต่อครูหรือคนขับโดยตรง`;
}

async function createParentLeave({ lineUserId, studentId, leaveDate, session, reason }, now = new Date()) {
  if (typeof leaveDate !== 'string' || !isCalendarDate(leaveDate)) throw fail(400, 'วันที่ไม่ถูกต้อง');
  if (!SESSIONS.includes(session)) throw fail(400, 'กรุณาเลือกรอบ (เช้า / เย็น / ทั้งวัน)');
  const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 255) : '';
  const today = todayBangkok(now);
  if (leaveDate < today) throw fail(400, 'แจ้งลาย้อนหลังไม่ได้');
  if (leaveDate > addDays(today, env.features.parentLeaveMaxDaysAhead)) {
    throw fail(400, `แจ้งลาล่วงหน้าได้ไม่เกิน ${env.features.parentLeaveMaxDaysAhead} วัน`);
  }
  if (isPastCutoff(leaveDate, session, now)) throw fail(409, cutoffMessage(session), 'PARENT_LEAVE_CUTOFF');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[student]] = await conn.query(
      `SELECT id, vehicle_id, morning_enabled, evening_enabled FROM students
        WHERE id = ? AND is_deleted = FALSE FOR UPDATE`,
      [studentId]
    );
    if (!student) throw fail(404, 'ไม่พบข้อมูลนักเรียน');
    if (!student.vehicle_id) throw fail(409, 'บุตรหลานยังไม่มีรถรับส่งประจำในระบบ กรุณาติดต่อโรงเรียน');
    if (session !== 'both' && !(session === 'morning' ? student.morning_enabled : student.evening_enabled)) {
      throw fail(409, `บุตรหลานไม่ได้ใช้รถ${SESSION_TH[session]}`);
    }
    // Any active leave / self-travel that overlaps this round.
    const [[overlap]] = await conn.query(
      `SELECT id FROM student_leaves
        WHERE student_id = ? AND leave_date = ? AND cancelled = FALSE
          AND (? = 'both' OR session IN (?, 'both')) LIMIT 1`,
      [studentId, leaveDate, session, session]
    );
    if (overlap) throw fail(409, 'มีการแจ้งลาหรือแจ้งเดินทางเองในรอบนี้แล้ว');
    if (leaveDate === today) {
      const [[checked]] = await conn.query(
        `SELECT id FROM checkin_logs WHERE student_id = ? AND check_date = ?
           AND (? = 'both' OR session = ?) AND status <> 'CANCELLED' LIMIT 1`,
        [studentId, leaveDate, session, session]
      );
      if (checked) throw fail(409, 'บุตรหลานถูกเช็กชื่อขึ้นรถในรอบนี้แล้ว กรุณาติดต่อครูหรือคนขับ');
    }

    let result;
    try {
      [result] = await conn.query(
        `INSERT INTO student_leaves (student_id, vehicle_id, leave_date, session, reason,
                                     reported_by, reported_role, reported_line_user_id,
                                     morning_enabled_snapshot, evening_enabled_snapshot)
         VALUES (?, ?, ?, ?, ?, NULL, 'parent', ?, ?, ?)`,
        [studentId, student.vehicle_id, leaveDate, session, cleanReason || null, lineUserId,
          student.morning_enabled ?? null, student.evening_enabled ?? null]
      );
    } catch (dbErr) {
      if (dbErr.code === 'ER_DUP_ENTRY') throw fail(409, 'มีการแจ้งลาในรอบนี้แล้ว');
      throw dbErr;
    }
    await logAudit({
      userId: null, action: 'CREATE', entityType: 'leave', entityId: result.insertId,
      newValue: { studentId, vehicleId: student.vehicle_id, leaveDate, session, reason: cleanReason || null, by: 'parent' },
      conn, required: true,
    });
    await conn.commit();
    return { id: result.insertId, student_id: studentId, leave_date: leaveDate, session };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function cancelParentLeave({ lineUserId, leaveId }, now = new Date()) {
  const [[row]] = await pool.query(
    `SELECT id, student_id, leave_date, session FROM student_leaves
      WHERE id = ? AND reported_role = 'parent' AND reported_line_user_id = ?
        AND cancelled = FALSE`,
    [leaveId, lineUserId]
  );
  // Another account's leave reads as not found (no existence leak).
  if (!row) throw fail(404, 'ไม่พบรายการลาหรือยกเลิกไปแล้ว');
  const leaveDate = toBangkokDate(row.leave_date);
  if (isPastCutoff(leaveDate, row.session, now)) {
    throw fail(409, 'เลยเวลาที่ยกเลิกเองได้แล้ว กรุณาติดต่อครูเพื่อยกเลิก', 'PARENT_LEAVE_CUTOFF');
  }
  const [res] = await pool.query(
    `UPDATE student_leaves SET cancelled = TRUE, cancelled_by = NULL, cancelled_at = NOW()
      WHERE id = ? AND cancelled = FALSE`,
    [leaveId]
  );
  if (res.affectedRows === 0) throw fail(404, 'ไม่พบรายการลาหรือยกเลิกไปแล้ว');
  await logAudit({
    userId: null, action: 'UPDATE', entityType: 'leave', entityId: leaveId,
    newValue: { cancelled: true, by: 'parent' }, required: true,
  });
  return { id: leaveId, cancelled: true };
}

// Upcoming (today..) active leaves of one child, with whether THIS LINE
// account may still cancel each one.
async function listParentLeaves({ lineUserId, studentId }, now = new Date()) {
  const today = todayBangkok(now);
  const [rows] = await pool.query(
    `SELECT id, leave_date, session, attendance_kind, reason, reported_role, reported_line_user_id
       FROM student_leaves
      WHERE student_id = ? AND leave_date >= ? AND cancelled = FALSE
      ORDER BY leave_date ASC, id ASC
      LIMIT 60`,
    [studentId, today]
  );
  return rows.map((r) => {
    const leaveDate = toBangkokDate(r.leave_date);
    const mine = r.reported_role === 'parent' && r.reported_line_user_id === lineUserId;
    return {
      id: r.id,
      leave_date: leaveDate,
      session: r.session,
      kind: r.attendance_kind || 'LEAVE',
      reason: r.reason,
      reported_by: r.reported_role === 'parent' ? (mine ? 'me' : 'parent') : r.reported_role,
      can_cancel: mine && !isPastCutoff(leaveDate, r.session, now),
    };
  });
}

module.exports = { createParentLeave, cancelParentLeave, listParentLeaves, isPastCutoff, SESSION_TH };
