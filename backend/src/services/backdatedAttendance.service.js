'use strict';

/**
 * Backdated attendance — a school records a missed check for a recent past day.
 *
 * Every other attendance path writes CURDATE(): the driver tap, the teacher
 * check and the "confirm on behalf of the driver" override. When nobody tapped
 * on the day (dead phone, no signal, a substitute driver) the school had no way
 * to put the record right afterwards. This service is that way, and it is
 * deliberately narrower than the same-day paths:
 *
 *   - a school account; a grade teacher only for their own grade and only the
 *     one teacher status per session (TEACHER_STATUS);
 *   - only the last BACKDATE_MAX_DAYS days, never today (today has its own
 *     paths) and never the future;
 *   - one pupil, one session, one status per request, with a wall-clock time
 *     the school states and a mandatory reason;
 *   - NO parent notification — a LINE message saying "your child boarded" for
 *     a day that is already over would read as a live event;
 *   - one `checkin_backdated` audit row carrying the reason and the prior
 *     daily_status, next to the usual CREATE/checkin row, so the correction is
 *     always distinguishable from a live tap.
 *
 * A wrong backdated row is reversed with the existing
 * POST /api/school/checkin/:logId/void, which is date-agnostic.
 */

const { deriveTermIdFromDate } = require('./term.service');
const { logAudit } = require('../utils/audit');
const { todayBangkok, toBangkokDate, daysBetweenBangkok } = require('../utils/thaiTime');
const { gradeEquivalents } = require('../utils/gradeScope');

const BACKDATE_MAX_DAYS = 7;

/**
 * What a teacher records, in the teacher-check model (checkin.service
 * TEACHER_STATUS): morning = arrived at school, evening = boarded to go home.
 * Default wall-clock times the UI pre-fills for those two actions.
 */
const TEACHER_DEFAULT_TIMES = Object.freeze({ morning: '07:00', evening: '16:00' });
const SESSIONS = ['morning', 'evening'];
// The one status a grade teacher may record per session — same model as the
// live teacher check (checkin.service TEACHER_STATUS). Required here because
// the UI limit alone is not a server rule (grade-teacher-04).
const TEACHER_STATUS = Object.freeze({ morning: 'CHECKED_OUT', evening: 'CHECKED_IN' });
const STATUSES = ['CHECKED_IN', 'CHECKED_OUT'];

/** 'YYYY-MM-DD' of a UTC-midnight instant built from a calendar date. */
function utcYmd(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function makeError(message, statusCode, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

/**
 * Validate a requested past date. Returns the normalised 'YYYY-MM-DD'.
 * `now` is injectable for tests.
 */
function assertBackdateWindow(checkDate, now = new Date(), { allowToday = false } = {}) {
  if (typeof checkDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(checkDate)) {
    throw makeError('กรุณาระบุวันที่แบบ YYYY-MM-DD', 400, 'INVALID_DATE');
  }
  const parsed = new Date(`${checkDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || utcYmd(parsed.getTime()) !== checkDate) {
    throw makeError('วันที่ไม่ถูกต้อง', 400, 'INVALID_DATE');
  }
  const today = todayBangkok(now);
  const ago = daysBetweenBangkok(checkDate, today);
  if (ago < 0 || (ago === 0 && !allowToday)) {
    throw makeError('เช็คชื่อย้อนหลังได้เฉพาะวันที่ผ่านมาแล้ว — รายการของวันนี้ให้ใช้เมนูยืนยันแทนคนขับ', 400, 'NOT_PAST_DATE');
  }
  if (ago > BACKDATE_MAX_DAYS) {
    throw makeError(`เช็คชื่อย้อนหลังได้ไม่เกิน ${BACKDATE_MAX_DAYS} วัน`, 400, 'OUTSIDE_BACKDATE_WINDOW');
  }
  return checkDate;
}

function assertTime(time) {
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw makeError('กรุณาระบุเวลาแบบ HH:mm', 400, 'INVALID_TIME');
  }
  return time;
}

function assertReason(reason) {
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmed) throw makeError('กรุณาระบุเหตุผลการเช็คชื่อย้อนหลัง', 400, 'REASON_REQUIRED');
  if (trimmed.length > 500) throw makeError('เหตุผลต้องไม่เกิน 500 ตัวอักษร', 400, 'REASON_TOO_LONG');
  return trimmed;
}

/** Earliest and latest date the window allows, for the UI date picker. */
function backdateWindow(now = new Date()) {
  const today = todayBangkok(now);
  const base = Date.parse(`${today}T00:00:00Z`);
  const day = 24 * 60 * 60 * 1000;
  return {
    min_date: utcYmd(base - BACKDATE_MAX_DAYS * day),
    max_date: utcYmd(base - day),
    max_days: BACKDATE_MAX_DAYS,
  };
}

function hhmm(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Roster of the school for one past day: who rides, what was recorded, who was
 * on leave. Each pupil carries the per-session log rows so the UI can offer a
 * void on a wrong one.
 */
async function getBackdatedRoster(pool, { schoolId, gradeFilter = null, checkDate, now = new Date() }) {
  if (!schoolId) throw makeError('ไม่พบข้อมูลโรงเรียน', 400);
  const date = assertBackdateWindow(checkDate, now);

  const [students] = await pool.query(
    `SELECT s.id, s.prefix, s.first_name, s.last_name, s.grade, s.classroom,
            s.vehicle_id, v.plate_no, s.morning_enabled, s.evening_enabled,
            ds.morning_done, ds.morning_ts, ds.evening_done, ds.evening_ts
       FROM students s
       LEFT JOIN vehicles v ON v.id = s.vehicle_id
       LEFT JOIN daily_status ds ON ds.student_id = s.id AND ds.check_date = ?
      WHERE s.school_id = ? AND s.is_deleted = FALSE AND s.vehicle_id IS NOT NULL${gradeFilter ? ' AND s.grade IN (?)' : ''}
      ORDER BY v.plate_no, s.grade, s.classroom, s.first_name
      LIMIT 3000`,
    gradeFilter ? [date, schoolId, gradeEquivalents(gradeFilter)] : [date, schoolId]
  );
  const windowInfo = { ...backdateWindow(now), default_times: TEACHER_DEFAULT_TIMES, grade_scope: gradeFilter };
  if (!students.length) return { check_date: date, ...windowInfo, students: [] };

  const ids = students.map(s => s.id);
  const [logs] = await pool.query(
    `SELECT id, student_id, session, status, checked_at
       FROM checkin_logs
      WHERE check_date = ? AND student_id IN (?)
      ORDER BY id`,
    [date, ids]
  );
  const [leaves] = await pool.query(
    `SELECT student_id, session, attendance_kind
       FROM student_leaves
      WHERE leave_date = ? AND cancelled = FALSE AND student_id IN (?)`,
    [date, ids]
  );

  // A CANCELLED row voids the most recent live row before it in the same
  // session, so fold the log list into the rows still in force.
  const live = new Map();
  for (const l of logs) {
    const key = `${l.student_id}:${l.session}`;
    const list = live.get(key) || [];
    if (l.status === 'CANCELLED') list.pop();
    else if (STATUSES.includes(l.status)) list.push({ log_id: l.id, status: l.status, time: hhmm(l.checked_at) });
    live.set(key, list);
  }
  const leaveBy = new Map();
  for (const l of leaves) {
    const list = leaveBy.get(l.student_id) || [];
    list.push(l);
    leaveBy.set(l.student_id, list);
  }
  const leaveFor = (sid, session) => {
    const hit = (leaveBy.get(sid) || []).find(l => l.session === session || l.session === 'both');
    return hit ? (hit.attendance_kind === 'SELF' ? 'SELF' : 'LEAVE') : null;
  };

  return {
    check_date: date,
    ...windowInfo,
    students: students.map(s => ({
      id: s.id,
      name: `${s.prefix || ''}${s.first_name} ${s.last_name}`.trim(),
      grade: s.grade,
      classroom: s.classroom,
      vehicle_id: s.vehicle_id,
      plate_no: s.plate_no || null,
      morning: {
        enabled: !!s.morning_enabled,
        done: !!s.morning_done,
        leave: leaveFor(s.id, 'morning'),
        logs: live.get(`${s.id}:morning`) || [],
      },
      evening: {
        enabled: !!s.evening_enabled,
        done: !!s.evening_done,
        leave: leaveFor(s.id, 'evening'),
        logs: live.get(`${s.id}:evening`) || [],
      },
    })),
  };
}

/**
 * Record one backdated check.
 */
async function recordBackdatedCheck(pool, {
  userId,
  userRole = null,
  userDisplayName = null,
  ipAddress = null,
  userAgent = null,
  schoolId,
  gradeFilter = null,
  studentId,
  checkDate,
  session,
  status,
  time,
  reason,
  now = new Date(),
  // Internal only (ops backfill script). The HTTP route never sets it: today
  // has its own live paths. Even then the stated time must already be past.
  allowToday = false,
}) {
  if (!schoolId) throw makeError('ไม่พบข้อมูลโรงเรียน', 400);
  const date = assertBackdateWindow(checkDate, now, { allowToday });
  if (!SESSIONS.includes(session)) throw makeError("session ต้องเป็น 'morning' หรือ 'evening'", 400);
  if (!STATUSES.includes(status)) throw makeError("status ต้องเป็น 'CHECKED_IN' หรือ 'CHECKED_OUT'", 400);
  if (gradeFilter && status !== TEACHER_STATUS[session]) {
    throw makeError(
      session === 'morning'
        ? 'ครูประจำชั้นบันทึกรอบเช้าได้เฉพาะ "มาถึงโรงเรียน"'
        : 'ครูประจำชั้นบันทึกรอบเย็นได้เฉพาะ "ขึ้นรถกลับบ้าน"',
      403,
      'TEACHER_STATUS_ONLY'
    );
  }
  assertTime(time);
  if (date === todayBangkok(now)) {
    const nowHm = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
    if (time > nowHm) throw makeError('เวลาที่บันทึกต้องไม่อยู่ในอนาคต', 400, 'TIME_IN_FUTURE');
  }
  const trimmedReason = assertReason(reason);
  const sid = Number.parseInt(studentId, 10);
  if (!Number.isInteger(sid) || sid <= 0) throw makeError('student_id ไม่ถูกต้อง', 400);

  const checkedAt = `${date} ${time}:00`;
  // Term of the day being recorded, not of today: they differ across a term boundary.
  const termId = await deriveTermIdFromDate(pool, date);

  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();

    // Student row lock = the per-student mutex, as in the live check path.
    const [[student]] = await conn.query(
      `SELECT s.id, s.school_id, s.grade, s.vehicle_id, s.cid_hash, s.first_name, s.last_name,
              s.morning_enabled, s.evening_enabled, s.is_deleted, v.plate_no
         FROM students s
         LEFT JOIN vehicles v ON v.id = s.vehicle_id
        WHERE s.id = ?
        LIMIT 1
        FOR UPDATE`,
      [sid]
    );
    if (!student || student.is_deleted || String(student.school_id) !== String(schoolId)) {
      throw makeError('ไม่พบนักเรียนในโรงเรียนนี้', 404);
    }
    // A grade teacher sees only their grade; outside it looks like not found.
    if (gradeFilter && !gradeEquivalents(gradeFilter).includes(student.grade)) {
      throw makeError('ไม่พบนักเรียนในสายชั้นที่รับผิดชอบ', 404);
    }
    if (!student.vehicle_id) throw makeError('นักเรียนยังไม่ได้กำหนดรถรับ-ส่ง', 400);
    if (session === 'morning' ? !student.morning_enabled : !student.evening_enabled) {
      throw makeError('นักเรียนไม่ได้ใช้บริการรอบนี้', 400);
    }

    const [[leaveHit]] = await conn.query(
      `SELECT attendance_kind FROM student_leaves
        WHERE student_id = ? AND leave_date = ? AND cancelled = FALSE
          AND session IN (?, 'both')
        LIMIT 1`,
      [sid, date, session]
    );
    if (leaveHit) {
      throw leaveHit.attendance_kind === 'SELF'
        ? makeError('วันนั้นนักเรียนเดินทางเองในรอบนี้', 409, 'SELF_TRAVEL')
        : makeError('วันนั้นนักเรียนลาในรอบนี้ — ยกเลิกการลาก่อนจึงจะเช็คชื่อได้', 409, 'ON_LEAVE');
    }

    // Same state machine as the live path: no exact duplicate, no going back
    // from dropped-off to boarded. A CANCELLED row undoes the row before it.
    const [rows] = await conn.query(
      `SELECT id, status, checked_at FROM checkin_logs
        WHERE student_id = ? AND session = ? AND check_date = ?
        ORDER BY id`,
      [sid, session, date]
    );
    const liveRows = [];
    for (const r of rows) {
      if (r.status === 'CANCELLED') liveRows.pop();
      else if (STATUSES.includes(r.status)) liveRows.push(r);
    }
    const last = liveRows[liveRows.length - 1];
    if (last) {
      if (liveRows.some(r => r.status === status)) {
        throw makeError('วันนั้นมีรายการนี้อยู่แล้ว', 409, 'DUPLICATE');
      }
      if (last.status === 'CHECKED_OUT' && status === 'CHECKED_IN') {
        throw makeError('วันนั้นนักเรียนถูกส่งแล้วในรอบนี้ — บันทึกรับขึ้นรถซ้ำไม่ได้', 409, 'INVALID_TRANSITION');
      }
      if (status === 'CHECKED_OUT' && hhmm(last.checked_at) > time) {
        throw makeError(`เวลาส่งต้องไม่ก่อนเวลารับขึ้นรถ (${hhmm(last.checked_at)})`, 400, 'TIME_BEFORE_BOARDING');
      }
    }

    const [[prior]] = await conn.query(
      `SELECT morning_done, morning_ts, evening_done, evening_ts
         FROM daily_status WHERE check_date = ? AND student_id = ? LIMIT 1`,
      [date, sid]
    );
    const priorDailyStatus = {
      morning_done: !!prior?.morning_done,
      evening_done: !!prior?.evening_done,
    };

    const studentName = `${student.first_name} ${student.last_name}`;
    const [logResult] = await conn.query(
      `INSERT INTO checkin_logs
         (term_id, vehicle_id, plate_no, student_id, cid_hash,
          student_name, session, status, check_date, checked_at, checked_by, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'web')`,
      [termId, student.vehicle_id, student.plate_no || null, sid, student.cid_hash,
       studentName, session, status, date, checkedAt, userId]
    );

    const doneCol = session === 'morning' ? 'morning_done' : 'evening_done';
    const tsCol = session === 'morning' ? 'morning_ts' : 'evening_ts';
    await conn.query(
      `INSERT INTO daily_status
         (check_date, vehicle_id, student_id, cid_hash, student_name, ${doneCol}, ${tsCol})
       VALUES (?, ?, ?, ?, ?, TRUE, ?)
       ON DUPLICATE KEY UPDATE ${doneCol} = TRUE, ${tsCol} = VALUES(${tsCol})`,
      [date, student.vehicle_id, sid, student.cid_hash, studentName, checkedAt]
    );

    await logAudit({
      conn,
      userId,
      action: 'CREATE',
      entityType: 'checkin',
      entityId: String(logResult.insertId),
      newValue: { studentId: sid, studentName, session, status, vehicleId: student.vehicle_id, backdated: true, checkDate: date },
      required: true,
    });
    await logAudit({
      conn,
      userId,
      action: 'UPDATE',
      entityType: 'checkin_backdated',
      entityId: String(sid),
      oldValue: priorDailyStatus,
      newValue: {
        school_id: schoolId,
        student_id: sid,
        student_name: studentName,
        vehicle_id: student.vehicle_id,
        plate_no: student.plate_no || null,
        check_date: date,
        session,
        status,
        time,
        reason: trimmedReason,
        recorded_by_user_id: userId,
        recorded_by_role: userRole,
        recorded_by_display_name: userDisplayName,
        grade_scope: gradeFilter,
        checkin_log_id: logResult.insertId,
        recorded_at_utc: now.toISOString(),
      },
      ipAddress,
      userAgent,
      required: true,
    });

    await conn.commit();
    return {
      checkin_log_id: logResult.insertId,
      student_id: sid,
      student_name: studentName,
      check_date: toBangkokDate(date),
      session,
      status,
      time,
      backdated: true,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  BACKDATE_MAX_DAYS,
  TEACHER_DEFAULT_TIMES,
  TEACHER_STATUS,
  assertBackdateWindow,
  backdateWindow,
  getBackdatedRoster,
  recordBackdatedCheck,
};
