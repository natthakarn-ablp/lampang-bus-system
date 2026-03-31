'use strict';

const { pool } = require('../config/database');
const { logAudit } = require('../utils/audit');

/**
 * Create a roster change request (driver → pending → school approval).
 */
async function createRequest({ vehicleId, studentId, schoolId, requestType, reason, userId }) {
  // Validate student exists
  const [[student]] = await pool.query(
    `SELECT id, school_id, vehicle_id FROM students WHERE id = ? AND is_deleted = FALSE`, [studentId]
  );
  if (!student) {
    const err = new Error('ไม่พบนักเรียน');
    err.statusCode = 404;
    throw err;
  }

  // For 'add': student must not already be on this vehicle
  if (requestType === 'add' && student.vehicle_id === vehicleId) {
    const err = new Error('นักเรียนอยู่ในรถคันนี้แล้ว');
    err.statusCode = 400;
    throw err;
  }

  // For 'remove': student must be on this vehicle
  if (requestType === 'remove' && student.vehicle_id !== vehicleId) {
    const err = new Error('นักเรียนไม่ได้อยู่ในรถคันนี้');
    err.statusCode = 400;
    throw err;
  }

  const resolvedSchoolId = student.school_id;

  const [result] = await pool.query(
    `INSERT INTO roster_change_requests (vehicle_id, student_id, school_id, request_type, reason, requested_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [vehicleId, studentId, resolvedSchoolId, requestType, reason || null, userId]
  );

  await logAudit({
    userId, action: 'CREATE', entityType: 'roster_request', entityId: result.insertId,
    newValue: { vehicleId, studentId, schoolId: resolvedSchoolId, requestType, reason },
  });

  return { id: result.insertId, status: 'pending' };
}

/**
 * Get requests for a driver's vehicle.
 */
async function getRequestsForDriver(vehicleId, { status, page = 1, per_page = 20 }) {
  let where = 'rcr.vehicle_id = ?';
  const params = [vehicleId];
  if (status) { where += ' AND rcr.status = ?'; params.push(status); }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM roster_change_requests rcr WHERE ${where}`, params
  );
  const offset = (page - 1) * per_page;
  const [rows] = await pool.query(
    `SELECT rcr.*, CONCAT(IFNULL(s.prefix,''), s.first_name, ' ', s.last_name) AS student_name,
            s.grade, s.classroom
     FROM roster_change_requests rcr
     JOIN students s ON s.id = rcr.student_id
     WHERE ${where}
     ORDER BY rcr.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, per_page, offset]
  );
  return { requests: rows, meta: { page, per_page, total } };
}

/**
 * Get pending requests for a school.
 */
async function getRequestsForSchool(schoolId, { status, page = 1, per_page = 20 }) {
  let where = 'rcr.school_id = ?';
  const params = [schoolId];
  if (status) { where += ' AND rcr.status = ?'; params.push(status); }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM roster_change_requests rcr WHERE ${where}`, params
  );
  const offset = (page - 1) * per_page;
  const [rows] = await pool.query(
    `SELECT rcr.*, CONCAT(IFNULL(s.prefix,''), s.first_name, ' ', s.last_name) AS student_name,
            s.grade, s.classroom, v.plate_no,
            u.display_name AS requested_by_name
     FROM roster_change_requests rcr
     JOIN students s ON s.id = rcr.student_id
     JOIN vehicles v ON v.id = rcr.vehicle_id
     LEFT JOIN users u ON u.id = rcr.requested_by
     WHERE ${where}
     ORDER BY rcr.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, per_page, offset]
  );
  return { requests: rows, meta: { page, per_page, total } };
}

/**
 * Review (approve/reject) a request.
 */
async function reviewRequest({ requestId, schoolId, status, reviewNote, userId }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[req]] = await conn.query(
      `SELECT * FROM roster_change_requests WHERE id = ? AND school_id = ? AND status = 'pending'`,
      [requestId, schoolId]
    );
    if (!req) {
      const err = new Error('ไม่พบคำขอหรือคำขอถูกดำเนินการแล้ว');
      err.statusCode = 404;
      throw err;
    }

    await conn.query(
      `UPDATE roster_change_requests SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_note = ?
       WHERE id = ?`,
      [status, userId, reviewNote || null, requestId]
    );

    // If approved, apply the roster change
    if (status === 'approved') {
      if (req.request_type === 'add') {
        await conn.query(`UPDATE students SET vehicle_id = ? WHERE id = ?`, [req.vehicle_id, req.student_id]);
      } else if (req.request_type === 'remove') {
        await conn.query(`UPDATE students SET vehicle_id = NULL WHERE id = ?`, [req.student_id]);
      }
    }

    await logAudit({
      userId, action: 'APPROVE', entityType: 'roster_request', entityId: requestId,
      newValue: { status, reviewNote, requestType: req.request_type, studentId: req.student_id },
      conn,
    });

    await conn.commit();
    return { id: requestId, status };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { createRequest, getRequestsForDriver, getRequestsForSchool, reviewRequest };
