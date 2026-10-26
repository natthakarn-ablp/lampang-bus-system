'use strict';

const { pool } = require('../config/database');
const { toBangkokDate } = require('../utils/thaiTime');
const { logAudit } = require('../utils/audit');
const { gradeEquivalents } = require('../utils/gradeScope');

/**
 * Create a student leave record.
 */
async function createLeave({ studentId, vehicleId, leaveDate, session, reason, userId, userRole }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Verify student belongs to vehicle
    const [[student]] = await conn.query(
      `SELECT id, school_id FROM students WHERE id = ? AND vehicle_id = ? AND is_deleted = FALSE`,
      [studentId, vehicleId]
    );
    if (!student) {
      const err = new Error('นักเรียนไม่อยู่ในรถคันนี้');
      err.statusCode = 404;
      throw err;
    }

    let result;
    try {
      [result] = await conn.query(
        `INSERT INTO student_leaves (student_id, vehicle_id, leave_date, session, reason, reported_by, reported_role)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [studentId, vehicleId, leaveDate, session, reason || null, userId, userRole]
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
     WHERE id = ? AND vehicle_id = ? AND cancelled = FALSE`,
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
async function cancelLeaveBySchool(leaveId, userId, schoolId) {
  const [[row]] = await pool.query(
    `SELECT sl.id FROM student_leaves sl
       JOIN students s ON s.id = sl.student_id
      WHERE sl.id = ? AND s.school_id = ? AND sl.cancelled = FALSE`,
    [leaveId, schoolId]
  );
  if (!row) {
    const err = new Error('ไม่พบรายการลาหรือยกเลิกไปแล้ว');
    err.statusCode = 404;
    throw err;
  }
  await pool.query(
    `UPDATE student_leaves SET cancelled = TRUE, cancelled_by = ?, cancelled_at = NOW() WHERE id = ?`,
    [userId, leaveId]
  );
  await logAudit({ userId, action: 'UPDATE', entityType: 'leave', entityId: leaveId, newValue: { cancelled: true, by: 'school' } });
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
     WHERE sl.vehicle_id = ? AND sl.leave_date = ? AND sl.cancelled = FALSE
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
     WHERE s.school_id = ?${gradeAnd} AND sl.leave_date = ? AND sl.cancelled = FALSE
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
