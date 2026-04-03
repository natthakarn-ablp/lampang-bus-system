'use strict';

const { pool } = require('../config/database');
const { logAudit } = require('../utils/audit');

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
 * Cancel a leave.
 */
async function cancelLeave(leaveId, userId) {
  const [result] = await pool.query(
    `UPDATE student_leaves SET cancelled = TRUE, cancelled_by = ?, cancelled_at = NOW()
     WHERE id = ? AND cancelled = FALSE`,
    [userId, leaveId]
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
  return rows;
}

/**
 * Get leaves for a school on a date.
 */
async function getLeavesForSchool(schoolId, date) {
  const [rows] = await pool.query(
    `SELECT sl.id, sl.student_id, sl.vehicle_id, sl.leave_date, sl.session, sl.reason,
            sl.reported_role, sl.cancelled, sl.created_at,
            CONCAT(IFNULL(s.prefix,''), s.first_name, ' ', s.last_name) AS student_name,
            s.grade, s.classroom, v.plate_no
     FROM student_leaves sl
     JOIN students s ON s.id = sl.student_id
     JOIN vehicles v ON v.id = sl.vehicle_id
     WHERE s.school_id = ? AND sl.leave_date = ? AND sl.cancelled = FALSE
     ORDER BY v.plate_no, sl.created_at DESC`,
    [schoolId, date]
  );
  return rows;
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

module.exports = { createLeave, cancelLeave, getLeavesForVehicle, getLeavesForSchool, getActiveLeaves };
