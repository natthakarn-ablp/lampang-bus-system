'use strict';

const { gradeEquivalents } = require('../utils/gradeScope');
const { assertAttendanceKind } = require('../utils/attendanceOutcome');
const { logAudit } = require('../utils/audit');
const { existsSync } = require('node:fs');

function fail(message, statusCode) { const error = new Error(message); error.statusCode = statusCode; throw error; }

// Uses the same student-row mutex as bus check-in and leave creation. No bus
// completion row or parent notification is generated for independent travel.
async function recordSelfTravel(pool, { studentId, session, schoolId, gradeFilter, userId }) {
  assertAttendanceKind('SELF', session);
  if (!Number.isSafeInteger(studentId) || studentId < 1 || !schoolId || !userId) fail('ข้อมูลไม่ถูกต้อง', 400);
  // Keep the first rollout rollback-safe: the old frontend cannot create SELF
  // rows, and a newly published frontend cannot do so until the guarded backend
  // and frontend release has completed and removed its existing deploy lock.
  if (existsSync(process.env.SELF_TRAVEL_DEPLOY_LOCK || '/home/schoolbus/deploy-state/deploy-backend.lock')) {
    fail('ระบบกำลังเผยแพร่รุ่นใหม่ กรุณารอสักครู่แล้วลองอีกครั้ง', 503);
  }
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const params = [studentId, schoolId];
    let gradeAnd = '';
    if (gradeFilter) { gradeAnd = ' AND grade IN (?)'; params.push(gradeEquivalents(gradeFilter)); }
    const [[student]] = await conn.query(
      `SELECT id, vehicle_id, morning_enabled, evening_enabled FROM students
        WHERE id = ? AND school_id = ? AND is_deleted = FALSE${gradeAnd} FOR UPDATE`, params);
    if (!student) fail('ไม่พบนักเรียนในขอบเขตที่รับผิดชอบ', 404);
    if (!student.vehicle_id || !student[`${session}_enabled`]) fail('นักเรียนไม่ได้ใช้รถในรอบนี้', 409);
    const [[log]] = await conn.query(
      `SELECT status FROM checkin_logs WHERE student_id = ? AND check_date = CURDATE()
        AND session = ? ORDER BY id DESC LIMIT 1`, [studentId, session]);
    if (log && log.status !== 'CANCELLED') fail('มีการเช็กชื่อแล้ว กรุณาโหลดรายชื่อใหม่', 409);
    const [[existing]] = await conn.query(
      `SELECT id, attendance_kind, cancelled FROM student_leaves
        WHERE student_id = ? AND leave_date = CURDATE() AND session IN (?, 'both')
        AND cancelled = FALSE LIMIT 1`, [studentId, session]);
    if (existing) fail('บันทึกการเดินทางหรือการลารอบนี้แล้ว กรุณาโหลดรายชื่อใหม่', 409);
    const [result] = await conn.query(
      `INSERT INTO student_leaves
        (student_id, vehicle_id, leave_date, session, attendance_kind, reported_by, reported_role,
         morning_enabled_snapshot, evening_enabled_snapshot)
        VALUES (?, ?, CURDATE(), ?, 'SELF', ?, 'school', ?, ?)`,
      [studentId, student.vehicle_id, session, userId, !!student.morning_enabled, !!student.evening_enabled]);
    await logAudit({ conn, required: true, userId, action: 'CREATE', entityType: 'self_travel',
      entityId: String(result.insertId), newValue: { student_id: studentId, session, school_id: schoolId,
        vehicle_id: student.vehicle_id, attendance_kind: 'SELF' } });
    await conn.commit();
    return { id: result.insertId, student_id: studentId, session, attendance_kind: 'SELF' };
  } catch (error) {
    await conn.rollback();
    if (error.code === 'ER_DUP_ENTRY') { error.statusCode = 409; error.message = 'มีรายการรอบนี้แล้ว กรุณาโหลดรายชื่อใหม่'; }
    throw error;
  } finally { conn.release(); }
}

async function undoSelfTravel(pool, { id, schoolId, gradeFilter, userId }) {
  if (!Number.isSafeInteger(id) || id < 1 || !schoolId || !userId) fail('รายการไม่ถูกต้อง', 400);
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const [[record]] = await conn.query('SELECT student_id FROM student_leaves WHERE id = ?', [id]);
    if (!record) fail('ไม่พบรายการ', 404);
    const params = [record.student_id, schoolId];
    let gradeAnd = '';
    if (gradeFilter) { gradeAnd = ' AND grade IN (?)'; params.push(gradeEquivalents(gradeFilter)); }
    const [[student]] = await conn.query(`SELECT id FROM students WHERE id = ? AND school_id = ?
      AND is_deleted = FALSE${gradeAnd} FOR UPDATE`, params);
    if (!student) fail('ไม่พบรายการในขอบเขตที่รับผิดชอบ', 404);
    const [[current]] = await conn.query(`SELECT id, reported_by FROM student_leaves WHERE id = ?
      AND student_id = ? AND attendance_kind = 'SELF' AND cancelled = FALSE AND leave_date = CURDATE()`, [id, student.id]);
    if (!current || (gradeFilter && current.reported_by !== userId)) fail('ไม่พบรายการที่ยกเลิกได้', 404);
    await conn.query('UPDATE student_leaves SET cancelled = TRUE, cancelled_by = ?, cancelled_at = NOW() WHERE id = ?', [userId, id]);
    await logAudit({ conn, required: true, userId, action: 'UPDATE', entityType: 'self_travel', entityId: String(id), newValue: { cancelled: true } });
    await conn.commit();
    return { id, cancelled: true };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

async function correctSelfTravelTime(pool, { id, schoolId, gradeFilter, userId, time, ipAddress = null, userAgent = null }) {
  if (!Number.isSafeInteger(id) || id < 1 || !schoolId || !userId) fail('รายการไม่ถูกต้อง', 400);
  if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('กรุณาระบุเวลาแบบ HH:mm', 400);
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const [[candidate]] = await conn.query('SELECT student_id FROM student_leaves WHERE id = ?', [id]);
    if (!candidate) fail('ไม่พบรายการ', 404);
    const params = [candidate.student_id, schoolId];
    const gradeAnd = gradeFilter ? ' AND grade IN (?)' : '';
    if (gradeFilter) params.push(gradeEquivalents(gradeFilter));
    const [[student]] = await conn.query(
      `SELECT id FROM students WHERE id = ? AND school_id = ? AND is_deleted = FALSE${gradeAnd} FOR UPDATE`, params);
    if (!student) fail('ไม่พบรายการในขอบเขตที่รับผิดชอบ', 404);
    const [[record]] = await conn.query(
      `SELECT id, student_id, session, created_at,
              DATE_FORMAT(leave_date, '%Y-%m-%d') AS leave_date,
              DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS old_local,
              DATE_FORMAT(created_at, '%H:%i') AS old_time
         FROM student_leaves WHERE id = ? AND student_id = ? AND attendance_kind = 'SELF'
           AND cancelled = FALSE AND leave_date = CURDATE() FOR UPDATE`, [id, student.id]);
    if (!record) fail('แก้เวลาได้เฉพาะรายการมาเองหรือกลับเองของวันนี้', 409);
    const [[clock]] = await conn.query("SELECT TIME_FORMAT(CURTIME(), '%H:%i') AS current_time");
    if (time > clock.current_time) fail('เวลาใหม่ต้องไม่อยู่ในอนาคต', 400);
    if (time === record.old_time) {
      await conn.commit();
      return { id, recorded_at: record.created_at, unchanged: true };
    }
    const nextLocal = `${record.leave_date} ${time}:00`;
    await conn.query('UPDATE student_leaves SET created_at = ? WHERE id = ?', [nextLocal, id]);
    await logAudit({ conn, required: true, userId, action: 'UPDATE', entityType: 'self_travel_time',
      entityId: String(id), oldValue: { recorded_at_local: record.old_local, session: record.session },
      newValue: { recorded_at_local: nextLocal, session: record.session }, ipAddress, userAgent });
    await conn.commit();
    return { id, recorded_at: new Date(`${record.leave_date}T${time}:00+07:00`).toISOString(), time_edited: true };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

module.exports = { recordSelfTravel, undoSelfTravel, correctSelfTravelTime };
