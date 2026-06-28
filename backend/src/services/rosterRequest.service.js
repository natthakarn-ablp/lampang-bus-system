'use strict';

const { pool } = require('../config/database');
const { logAudit } = require('../utils/audit');

/**
 * Create a roster change request (driver → pending → school approval).
 *
 * For request_type='add', two modes are supported:
 *   1. studentId provided: existing student (move to this vehicle)
 *   2. newStudentData provided: request to add a new student (student doesn't exist yet)
 */
async function createRequest({ vehicleId, studentId, schoolId, requestType, reason, userId, newStudentData }) {
  // ── "add new student" mode ──
  if (requestType === 'add' && newStudentData && !studentId) {
    // Validate required fields
    const { first_name, last_name, school_id, parent_phone } = newStudentData;
    if (!first_name || !last_name) {
      const err = new Error('กรุณากรอกชื่อและนามสกุลนักเรียน');
      err.statusCode = 400;
      throw err;
    }
    if (!school_id) {
      const err = new Error('กรุณาเลือกโรงเรียน');
      err.statusCode = 400;
      throw err;
    }
    if (parent_phone && !/^\d{10}$/.test(parent_phone)) {
      const err = new Error('เบอร์โทรผู้ปกครองต้องเป็นตัวเลข 10 หลัก');
      err.statusCode = 400;
      throw err;
    }

    // Verify school exists
    const [[school]] = await pool.query(
      `SELECT id FROM schools WHERE id = ? AND is_deleted = FALSE`, [school_id]
    );
    if (!school) {
      const err = new Error('ไม่พบโรงเรียนที่เลือก');
      err.statusCode = 404;
      throw err;
    }

    let result;
    try {
      [result] = await pool.query(
        `INSERT INTO roster_change_requests (vehicle_id, student_id, school_id, request_type, reason, new_student_data, requested_by)
         VALUES (?, NULL, ?, ?, ?, ?, ?)`,
        [vehicleId, school_id, requestType, reason || null, JSON.stringify(newStudentData), userId]
      );
    } catch (dbErr) {
      if (dbErr.code === 'ER_BAD_FIELD_ERROR' || (dbErr.message && dbErr.message.includes('Unknown column'))) {
        const err = new Error('ระบบยังไม่รองรับการเพิ่มนักเรียนใหม่ กรุณาแจ้งผู้ดูแลระบบให้รัน migration 009');
        err.statusCode = 500;
        throw err;
      }
      throw dbErr;
    }

    await logAudit({
      userId, action: 'CREATE', entityType: 'roster_request', entityId: result.insertId,
      newValue: { vehicleId, schoolId: school_id, requestType, reason, newStudentData },
    });

    return { id: result.insertId, status: 'pending' };
  }

  // ── Existing student mode (add existing or remove) ──
  if (!studentId) {
    const err = new Error('กรุณาระบุรหัสนักเรียน');
    err.statusCode = 400;
    throw err;
  }

  const [[student]] = await pool.query(
    `SELECT id, school_id, vehicle_id FROM students WHERE id = ? AND is_deleted = FALSE`, [studentId]
  );
  if (!student) {
    const err = new Error('ไม่พบนักเรียนรหัส ' + studentId + ' ในระบบ');
    err.statusCode = 404;
    throw err;
  }

  // H3 fix (authz scope): the student must belong to a school that this
  // vehicle actually serves. Without this check a driver could submit a
  // roster "add" request for ANY student_id in the system (IDs are sequential
  // ints), bypassing the scope constraint that /search-students enforces.
  // A vehicle with no students yet has no served schools → reject.
  if (requestType === 'add') {
    const [[served]] = await pool.query(
      `SELECT 1 WHERE EXISTS (
         SELECT 1 FROM students sx
          WHERE sx.vehicle_id = ? AND sx.is_deleted = FALSE
            AND sx.school_id = ? AND sx.school_id IS NOT NULL
       ) LIMIT 1`,
      [vehicleId, student.school_id]
    );
    if (!served) {
      const err = new Error('นักเรียนไม่ได้อยู่ในโรงเรียนที่รถคันนี้ให้บริการ');
      err.statusCode = 403;
      throw err;
    }
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

  // Check for duplicate pending request (same student + vehicle + type)
  const [[existing]] = await pool.query(
    `SELECT id FROM roster_change_requests
     WHERE student_id = ? AND vehicle_id = ? AND request_type = ? AND status = 'pending'`,
    [studentId, vehicleId, requestType]
  );
  if (existing) {
    const err = new Error('มีคำขอสำหรับนักเรียนคนนี้รออนุมัติอยู่แล้ว');
    err.statusCode = 409;
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
    `SELECT rcr.*,
            CASE WHEN rcr.student_id IS NOT NULL
              THEN CONCAT(IFNULL(s.prefix,''), s.first_name, ' ', s.last_name)
              ELSE JSON_UNQUOTE(JSON_EXTRACT(rcr.new_student_data, '$.first_name'))
            END AS student_name,
            COALESCE(s.grade, JSON_UNQUOTE(JSON_EXTRACT(rcr.new_student_data, '$.grade'))) AS grade,
            COALESCE(s.classroom, JSON_UNQUOTE(JSON_EXTRACT(rcr.new_student_data, '$.classroom'))) AS classroom
     FROM roster_change_requests rcr
     LEFT JOIN students s ON s.id = rcr.student_id
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
async function getRequestsForSchool(schoolId, { status, page = 1, per_page = 20, gradeFilter = null }) {
  // Phase 7.11.3 — teacher accounts only see requests whose
  // affected student matches their grade. We use a portable filter
  // that handles BOTH the existing-student case (LEFT JOIN s on
  // student_id) and the new-student case (grade is inside the
  // new_student_data JSON). For requests with no student_id, the
  // grade is read from new_student_data.grade.
  let where = 'rcr.school_id = ?';
  const params = [schoolId];
  if (status) { where += ' AND rcr.status = ?'; params.push(status); }
  if (gradeFilter) {
    where += ` AND (
      (rcr.student_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM students sx
        WHERE sx.id = rcr.student_id AND sx.grade = ?
      ))
      OR (rcr.student_id IS NULL AND
          JSON_UNQUOTE(JSON_EXTRACT(rcr.new_student_data, '$.grade')) = ?)
    )`;
    params.push(gradeFilter, gradeFilter);
  }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM roster_change_requests rcr WHERE ${where}`, params
  );
  const offset = (page - 1) * per_page;
  const [rows] = await pool.query(
    `SELECT rcr.*,
            CASE WHEN rcr.student_id IS NOT NULL
              THEN CONCAT(IFNULL(s.prefix,''), s.first_name, ' ', s.last_name)
              ELSE CONCAT(
                IFNULL(JSON_UNQUOTE(JSON_EXTRACT(rcr.new_student_data, '$.prefix')), ''),
                JSON_UNQUOTE(JSON_EXTRACT(rcr.new_student_data, '$.first_name')), ' ',
                JSON_UNQUOTE(JSON_EXTRACT(rcr.new_student_data, '$.last_name'))
              )
            END AS student_name,
            COALESCE(s.grade, JSON_UNQUOTE(JSON_EXTRACT(rcr.new_student_data, '$.grade'))) AS grade,
            COALESCE(s.classroom, JSON_UNQUOTE(JSON_EXTRACT(rcr.new_student_data, '$.classroom'))) AS classroom,
            v.plate_no,
            u.display_name AS requested_by_name
     FROM roster_change_requests rcr
     LEFT JOIN students s ON s.id = rcr.student_id
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

    // Audit 2026-06-18 (business-logic-txn): lock the request row FOR UPDATE so two
    // concurrent approvals can't both read it as 'pending' and both apply (which
    // for a new-student request created two duplicate students).
    const [[req]] = await conn.query(
      `SELECT * FROM roster_change_requests WHERE id = ? AND school_id = ? AND status = 'pending' FOR UPDATE`,
      [requestId, schoolId]
    );
    if (!req) {
      const err = new Error('ไม่พบคำขอหรือคำขอถูกดำเนินการแล้ว');
      err.statusCode = 404;
      throw err;
    }

    // Guard the transition on status='pending' and require exactly one row to
    // change, so a racing second approval that slipped past the lock window aborts.
    const [upd] = await conn.query(
      `UPDATE roster_change_requests SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_note = ?
       WHERE id = ? AND status = 'pending'`,
      [status, userId, reviewNote || null, requestId]
    );
    if (!upd.affectedRows) {
      const err = new Error('คำขอถูกดำเนินการไปแล้ว');
      err.statusCode = 409;
      throw err;
    }

    // If approved, apply the roster change
    if (status === 'approved') {
      if (req.request_type === 'add' && req.student_id) {
        // Existing student → assign to vehicle. Audit 2026-06-18
        // (business-logic-txn): re-verify the student still exists, isn't
        // soft-deleted, and still belongs to this school before mutating it (the
        // request may pre-date a delete/transfer).
        const [[stu]] = await conn.query(
          `SELECT id FROM students WHERE id = ? AND school_id = ? AND is_deleted = FALSE FOR UPDATE`,
          [req.student_id, req.school_id]
        );
        if (!stu) {
          const err = new Error('นักเรียนถูกลบหรือย้ายโรงเรียนแล้ว ไม่สามารถอนุมัติคำขอนี้ได้');
          err.statusCode = 409;
          throw err;
        }
        await conn.query(`UPDATE students SET vehicle_id = ? WHERE id = ?`, [req.vehicle_id, req.student_id]);
      } else if (req.request_type === 'add' && !req.student_id && req.new_student_data) {
        // New student → create student record + assign to vehicle
        const data = typeof req.new_student_data === 'string'
          ? JSON.parse(req.new_student_data)
          : req.new_student_data;

        // Resolve student ID: use provided or auto-generate with FOR UPDATE lock
        let newStudentId = data.student_id ? parseInt(data.student_id, 10) : null;
        if (newStudentId) {
          // Check if provided ID already exists (not soft-deleted)
          const [[existingActive]] = await conn.query(
            `SELECT id FROM students WHERE id = ? AND is_deleted = FALSE`, [newStudentId]
          );
          if (existingActive) {
            const err = new Error(`รหัสนักเรียน ${newStudentId} มีอยู่ในระบบแล้ว`);
            err.statusCode = 409;
            throw err;
          }
        }
        if (!newStudentId) {
          // Phase 10.13B-2 — atomic allocator (was SELECT MAX(id)+1 FOR UPDATE,
          // which does not actually serialize concurrent allocators).
          const { allocateStudentId } = require('./idAllocator.service');
          newStudentId = await allocateStudentId(conn);
        }

        // Generate placeholder cid_hash (PDPA: driver doesn't provide national ID)
        const crypto = require('crypto');
        const cidHash = crypto.createHash('sha256')
          .update(`placeholder-${newStudentId}-${Date.now()}-${requestId}`)
          .digest('hex');

        const { getCurrentTermCachedSync } = require('./term.service');

        // INSERT student — no ON DUPLICATE KEY UPDATE for active students
        // (we already checked for duplicates above)
        try {
          await conn.query(
            `INSERT INTO students (id, cid_hash, prefix, first_name, last_name, grade, classroom, school_id, vehicle_id, term_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newStudentId, cidHash,
              data.prefix || null,
              data.first_name, data.last_name,
              data.grade || null, data.classroom || null,
              req.school_id, req.vehicle_id,
              getCurrentTermCachedSync(),
            ]
          );
        } catch (insertErr) {
          if (insertErr.code === 'ER_DUP_ENTRY') {
            const err = new Error(`รหัสนักเรียน ${newStudentId} ซ้ำในระบบ กรุณาลองใหม่`);
            err.statusCode = 409;
            throw err;
          }
          throw insertErr;
        }

        // Create parent record if parent info provided (dedupe by phone if exists)
        if (data.parent_name || data.parent_phone) {
          let parentId;
          if (data.parent_phone) {
            // Try to find existing parent by phone to avoid duplicates
            const [[existingParent]] = await conn.query(
              `SELECT id FROM parents WHERE phone = ? AND is_deleted = FALSE LIMIT 1`,
              [data.parent_phone]
            );
            parentId = existingParent?.id;
          }
          if (!parentId) {
            const [parentResult] = await conn.query(
              `INSERT INTO parents (name, phone) VALUES (?, ?)`,
              [data.parent_name || null, data.parent_phone || null]
            );
            parentId = parentResult.insertId;
          }
          await conn.query(
            `INSERT INTO parent_student (parent_id, student_id, approved, approved_by, approved_at)
             VALUES (?, ?, TRUE, ?, NOW())
             ON DUPLICATE KEY UPDATE approved = TRUE`,
            [parentId, newStudentId, userId]
          );
        }

        // Update the request record with the created student_id
        await conn.query(
          `UPDATE roster_change_requests SET student_id = ? WHERE id = ?`,
          [newStudentId, requestId]
        );
      } else if (req.request_type === 'remove') {
        // Re-verify ownership before clearing the assignment (see add path above).
        const [[stu]] = await conn.query(
          `SELECT id FROM students WHERE id = ? AND school_id = ? AND is_deleted = FALSE FOR UPDATE`,
          [req.student_id, req.school_id]
        );
        if (!stu) {
          const err = new Error('นักเรียนถูกลบหรือย้ายโรงเรียนแล้ว ไม่สามารถอนุมัติคำขอนี้ได้');
          err.statusCode = 409;
          throw err;
        }
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
