'use strict';

const { pool } = require('../config/database');
const { toBangkokDate, todayBangkok } = require('../utils/thaiTime');
const { logAudit } = require('../utils/audit');
const { gradeEquivalents, normalizeGrade } = require('../utils/gradeScope');

/**
 * Create a student leave record.
 */
async function createLeave({ studentId, vehicleId, leaveDate, session, reason, userId, userRole, schoolId = null, gradeScope = null }) {
  // A leave is announced ahead of (or on) the day. The UI only ever sends
  // today, but the API accepted any string, so a past leave_date could be
  // written straight in and silently rewrite a finished day's attendance.
  // Past-day corrections go through the audited backdated-attendance path.
  if (typeof leaveDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(leaveDate)
      || Number.isNaN(Date.parse(`${leaveDate}T00:00:00Z`))) {
    const err = new Error('วันที่ลาไม่ถูกต้อง (YYYY-MM-DD)'); err.statusCode = 400; throw err;
  }
  if (leaveDate < todayBangkok()) {
    const err = new Error('บันทึกการลาย้อนหลังไม่ได้'); err.statusCode = 400; err.code = 'LEAVE_DATE_IN_PAST'; throw err;
  }
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();

    // Verify student belongs to vehicle
    const [[student]] = await conn.query(
      `SELECT id, school_id, grade, morning_enabled, evening_enabled FROM students
        WHERE id = ? AND vehicle_id = ? AND is_deleted = FALSE${schoolId ? ' AND school_id = ?' : ''} FOR UPDATE`,
      schoolId ? [studentId, vehicleId, schoolId] : [studentId, vehicleId]
    );
    if (!student) {
      const err = new Error('นักเรียนไม่อยู่ในรถคันนี้');
      err.statusCode = 404;
      throw err;
    }
    const [[selfTravel]] = await conn.query(
      `SELECT id FROM student_leaves WHERE student_id = ? AND leave_date = ? AND cancelled = FALSE
        AND attendance_kind = 'SELF' AND (? = 'both' OR session IN (?, 'both')) LIMIT 1`,
      [studentId, leaveDate, session, session]);
    if (selfTravel) { const err = new Error('บันทึกการเดินทางเองแล้ว กรุณายกเลิกรายการเดิมก่อน'); err.statusCode = 409; throw err; }
    if (gradeScope) {
      if (String(student.school_id) !== String(schoolId) || normalizeGrade(student.grade) !== gradeScope) {
        const err = new Error('ไม่พบนักเรียนในสายชั้นที่รับผิดชอบ'); err.statusCode = 404; throw err;
      }
      const today = todayBangkok();
      if (leaveDate !== today || !['morning', 'evening'].includes(session)) {
        const err = new Error('บันทึกการลาได้เฉพาะรอบวันนี้'); err.statusCode = 403; throw err;
      }
      if (!(session === 'morning' ? student.morning_enabled : student.evening_enabled)) {
        const err = new Error('นักเรียนไม่ได้ใช้รถในรอบนี้'); err.statusCode = 409; throw err;
      }
      const [[checked]] = await conn.query(
        `SELECT status FROM checkin_logs WHERE student_id = ? AND session = ?
          AND check_date = CURDATE() ORDER BY id DESC LIMIT 1`, [studentId, session]
      );
      if (checked && checked.status !== 'CANCELLED') {
        const err = new Error('มีการเช็กชื่อนักเรียนคนนี้แล้ว กรุณาโหลดรายชื่อใหม่'); err.statusCode = 409; throw err;
      }
      const [[leave]] = await conn.query(
        `SELECT id FROM student_leaves WHERE student_id = ? AND leave_date = CURDATE()
          AND cancelled = FALSE AND session IN (?, 'both') LIMIT 1`, [studentId, session]
      );
      if (leave) {
        const err = new Error('บันทึกการลารอบนี้แล้ว กรุณาโหลดรายชื่อใหม่'); err.statusCode = 409; throw err;
      }
    }

    let result;
    try {
      [result] = await conn.query(
        `INSERT INTO student_leaves (student_id, vehicle_id, leave_date, session, reason, reported_by, reported_role, morning_enabled_snapshot, evening_enabled_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [studentId, vehicleId, leaveDate, session, reason || null, userId, userRole, student.morning_enabled ?? null, student.evening_enabled ?? null]
      );
    } catch (dbErr) {
      if (dbErr.code === 'ER_DUP_ENTRY') {
        const sessionLabel = { morning: 'เช้า', evening: 'เย็น', both: 'ทั้งวัน' }[session] || session;
        const err = new Error(`นักเรียนคนนี้ถูกบันทึกการลา${sessionLabel}ในวันนี้แล้ว`);
        err.statusCode = 409;
        throw err;
      }
      throw dbErr;
    }

    await logAudit({
      userId, action: 'CREATE', entityType: 'leave', entityId: result.insertId,
      newValue: { studentId, vehicleId, leaveDate, session, reason },
      conn,
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

/**
 * Cancel a leave — scoped to the canceller's vehicle (Phase 10.12E — closes H4).
 *
 * The UPDATE is constrained by `vehicle_id` so a driver can only cancel a leave
 * that belongs to their own active vehicle. A leave that does not exist OR
 * belongs to another vehicle both resolve to affectedRows === 0 → 404, which is
 * privacy-preserving (it never reveals that an out-of-scope leave exists).
 *
 * @param {number} leaveId
 * @param {number} userId     - users.id of the canceller (audit + cancelled_by)
 * @param {string} vehicleId  - the canceller's active vehicle scope
 */
async function cancelLeave(leaveId, userId, vehicleId) {
  const [result] = await pool.query(
    `UPDATE student_leaves SET cancelled = TRUE, cancelled_by = ?, cancelled_at = NOW()
     WHERE id = ? AND vehicle_id = ? AND cancelled = FALSE AND attendance_kind = 'LEAVE'`,
    [userId, leaveId, vehicleId]
  );
  if (result.affectedRows === 0) {
    const err = new Error('ไม่พบรายการลาหรือยกเลิกไปแล้ว');
    err.statusCode = 404;
    throw err;
  }
  await logAudit({ userId, action: 'UPDATE', entityType: 'leave', entityId: leaveId, newValue: { cancelled: true } });
  return { id: leaveId, cancelled: true };
}

/**
 * Cancel a leave — scoped to the SCHOOL of the leave's student. A school user
 * may cancel a leave they recorded in error for one of their own students. A
 * leave that does not exist OR belongs to another school both resolve to 404
 * (privacy-preserving — never reveals an out-of-scope leave).
 *
 * @param {number} leaveId
 * @param {number} userId    - users.id of the canceller
 * @param {string} schoolId  - the canceller's school scope
 */
async function cancelLeaveBySchool(leaveId, userId, schoolId, { gradeScope = null } = {}) {
  const [[row]] = await pool.query(
    `SELECT sl.id, sl.leave_date, sl.session, sl.reported_by, s.grade FROM student_leaves sl
       JOIN students s ON s.id = sl.student_id
      WHERE sl.id = ? AND s.school_id = ? AND sl.cancelled = FALSE AND sl.attendance_kind = 'LEAVE'`,
    [leaveId, schoolId]
  );
  if (!row) {
    const err = new Error('ไม่พบรายการลาหรือยกเลิกไปแล้ว');
    err.statusCode = 404;
    throw err;
  }
  // grade-teacher-03: a grade teacher may undo a leave recorded by mistake, but
  // only within what they can record — their own grade, today, one round.
  // Outside the grade reads as not found (no existence leak).
  if (gradeScope) {
    if (normalizeGrade(row.grade) !== gradeScope && !gradeEquivalents(gradeScope).includes(row.grade)) {
      const err = new Error('ไม่พบรายการลาหรือยกเลิกไปแล้ว');
      err.statusCode = 404;
      throw err;
    }
    if (toBangkokDate(row.leave_date) !== todayBangkok() || !['morning', 'evening'].includes(row.session)) {
      const err = new Error('ครูประจำสายชั้นยกเลิกการลาได้เฉพาะรอบวันนี้ — รายการอื่นให้บัญชีโรงเรียนยกเลิก');
      err.statusCode = 403;
      throw err;
    }
    // Only the teacher's own mistakes: a leave a parent, driver or another
    // account reported stays with the school account.
    if (Number(row.reported_by) !== Number(userId)) {
      const err = new Error('ครูประจำสายชั้นยกเลิกได้เฉพาะการลาที่ตนเองบันทึก — รายการที่ผู้ปกครองหรือคนขับแจ้งให้บัญชีโรงเรียนยกเลิก');
      err.statusCode = 403;
      throw err;
    }
  }
  await pool.query(
    `UPDATE student_leaves SET cancelled = TRUE, cancelled_by = ?, cancelled_at = NOW() WHERE id = ? AND cancelled = FALSE`,
    [userId, leaveId]
  );
  await logAudit({ userId, action: 'UPDATE', entityType: 'leave', entityId: leaveId, newValue: { cancelled: true, by: gradeScope ? 'grade_teacher' : 'school' } });
  return { id: leaveId, cancelled: true };
}

// leave_date is a DATE column. mysql2 parses it against the +07:00 connection
// timezone, so a leave stored as 2026-08-05 arrives as a Date at
// 2026-08-04T17:00:00.000Z and JSON.stringify ships exactly that. A client that
// prints it, or slices the first ten characters, shows the day before — a
// student marked absent on the 5th listed under the 4th. Verified against the
// sandbox before this change. created_at is a TIMESTAMP, a real instant, and is
// deliberately left alone.
function withCalendarLeaveDate(row) {
  return { ...row, leave_date: toBangkokDate(row.leave_date) };
}

/**
 * Get leaves for a vehicle on a date.
 */
async function getLeavesForVehicle(vehicleId, date) {
  const [rows] = await pool.query(
    `SELECT sl.id, sl.student_id, sl.leave_date, sl.session, sl.reason, sl.reported_role,
            sl.cancelled, sl.created_at,
            CONCAT(IFNULL(s.prefix,''), s.first_name, ' ', s.last_name) AS student_name,
            s.grade, s.classroom
     FROM student_leaves sl
     JOIN students s ON s.id = sl.student_id
     WHERE sl.vehicle_id = ? AND sl.leave_date = ? AND sl.cancelled = FALSE AND sl.attendance_kind = 'LEAVE'
     ORDER BY sl.created_at DESC`,
    [vehicleId, date]
  );
  return rows.map(withCalendarLeaveDate);
}

/**
 * Get leaves for a school on a date.
 */
async function getLeavesForSchool(schoolId, date, { gradeFilter = null } = {}) {
  // Tolerant grade match — students.grade is stored in several spellings, and an
  // exact `= ?` makes a teacher's own leave list come back empty rather than wrong,
  // which reads as "nobody is on leave today".
  const eq       = gradeFilter ? gradeEquivalents(gradeFilter) : null;
  const gradeAnd = eq ? ` AND s.grade IN (${eq.map(() => '?').join(',')})` : '';
  const params   = eq ? [schoolId, ...eq, date] : [schoolId, date];
  const [rows] = await pool.query(
    `SELECT sl.id, sl.student_id, sl.vehicle_id, sl.leave_date, sl.session, sl.reason,
            sl.reported_role, sl.cancelled, sl.created_at,
            CONCAT(IFNULL(s.prefix,''), s.first_name, ' ', s.last_name) AS student_name,
            s.grade, s.classroom, v.plate_no
     FROM student_leaves sl
     JOIN students s ON s.id = sl.student_id
     JOIN vehicles v ON v.id = sl.vehicle_id
     WHERE s.school_id = ?${gradeAnd} AND sl.leave_date = ? AND sl.cancelled = FALSE AND sl.attendance_kind = 'LEAVE'
     ORDER BY v.plate_no, sl.created_at DESC`,
    params
  );
  return rows.map(withCalendarLeaveDate);
}

/**
 * Get active leaves for a date (used by other services to exclude from pending).
 */
async function getActiveLeaves(date) {
  const [rows] = await pool.query(
    `SELECT student_id, session FROM student_leaves
     WHERE leave_date = ? AND cancelled = FALSE`,
    [date]
  );
  return rows;
}

module.exports = { createLeave, cancelLeave, cancelLeaveBySchool, getLeavesForVehicle, getLeavesForSchool, getActiveLeaves };
