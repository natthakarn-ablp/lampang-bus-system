'use strict';

/**
 * homeroom.service.js — homeroom teachers per classroom (owner decision
 * 2026-11-12, migration 061, FEATURE_HOMEROOM_TEACHERS).
 *
 * A school's MAIN account keeps, for each grade + room, the homeroom teacher(s):
 * a name and an optional phone. Several teachers per room are allowed. The list
 * is read in four places — the classroom check page, the student list / Excel,
 * the driver's student list and the parent's LINE "สถานะ" reply — through
 * attachHomeroomTeachers(), which is a no-op while the flag is off, so callers
 * need no flag checks of their own.
 *
 * Matching key: (school_id, grade, classroom) against students.grade /
 * students.classroom exactly as stored (trimmed); a pupil without a room
 * matches classroom ''. The management page offers the rooms that pupils are
 * actually in, so the strings line up without guessing at grade spellings.
 */

const { pool } = require('../config/database');
const env = require('../config/env');
const { logAudit } = require('../utils/audit');

const NAME_MAX = 150;
const GRADE_MAX = 20;
const ROOM_MAX = 20;

function enabled() {
  return env.features.homeroomTeachers === true;
}

function httpError(message, statusCode) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

function roomKey(schoolId, grade, classroom) {
  return `${String(schoolId ?? '')}|${String(grade ?? '').trim()}|${String(classroom ?? '').trim()}`;
}

/** Thai phone: keep digits; 9–10 digits starting with 0 (landline or mobile). Empty → null. */
function normalizePhone(value) {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const digits = raw.replace(/[\s\-().]/g, '');
  if (!/^0\d{8,9}$/.test(digits)) throw httpError('เบอร์โทรต้องเป็นตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0', 400);
  return digits;
}

function cleanInput({ grade, classroom, teacherName, phone }) {
  const g = String(grade ?? '').trim();
  const c = String(classroom ?? '').trim();
  const n = String(teacherName ?? '').trim().replace(/\s+/g, ' ');
  if (!g) throw httpError('กรุณาเลือกชั้น', 400);
  if (g.length > GRADE_MAX) throw httpError('ชื่อชั้นยาวเกินไป', 400);
  if (c.length > ROOM_MAX) throw httpError('ชื่อห้องยาวเกินไป', 400);
  if (!n) throw httpError('กรุณากรอกชื่อครู', 400);
  if (n.length > NAME_MAX) throw httpError(`ชื่อครูยาวได้ไม่เกิน ${NAME_MAX} ตัวอักษร`, 400);
  return { grade: g, classroom: c, teacherName: n, phone: normalizePhone(phone) };
}

/** Display form of a phone: 0812345678 → 081-234-5678, 053123456 → 053-123-456. */
function formatPhone(phone) {
  const d = String(phone || '');
  if (/^0\d{9}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (/^0\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
}

/** "ครูสมใจ ใจดี (081-234-5678), ครูสมศรี" — '' when the list is empty. */
function formatTeachers(list, { withPhone = true } = {}) {
  if (!Array.isArray(list) || list.length === 0) return '';
  return list
    .map((t) => (withPhone && t.phone ? `${t.name} (${formatPhone(t.phone)})` : t.name))
    .join(', ');
}

/**
 * Rooms of a school with their teachers: every grade/room that has a pupil
 * (with pupil count) plus any room that only has teachers listed (count 0, so a
 * room left empty after promotion can still be cleaned up).
 * `grades` (optional) limits the result to those grade strings.
 */
async function listRooms(db, schoolId, { grades = null } = {}) {
  const gradeSql = grades ? ` AND grade IN (${grades.map(() => '?').join(',')})` : '';
  const [roomRows] = await db.query(
    `SELECT TRIM(grade) AS grade, COALESCE(TRIM(classroom), '') AS classroom, COUNT(*) AS student_count
       FROM students
      WHERE school_id = ? AND is_deleted = FALSE AND grade IS NOT NULL AND TRIM(grade) <> ''${gradeSql}
      GROUP BY TRIM(grade), COALESCE(TRIM(classroom), '')`,
    [schoolId, ...(grades || [])],
  );
  const [teacherRows] = await db.query(
    `SELECT id, grade, classroom, teacher_name, phone, updated_at
       FROM homeroom_teachers
      WHERE school_id = ?${gradeSql}
      ORDER BY id`,
    [schoolId, ...(grades || [])],
  );
  const rooms = new Map();
  const ensure = (grade, classroom) => {
    const k = roomKey(schoolId, grade, classroom);
    if (!rooms.has(k)) rooms.set(k, { grade, classroom, student_count: 0, teachers: [] });
    return rooms.get(k);
  };
  for (const r of roomRows) ensure(r.grade, r.classroom).student_count = Number(r.student_count);
  for (const t of teacherRows) {
    ensure(t.grade, t.classroom).teachers.push({ id: t.id, name: t.teacher_name, phone: t.phone, updated_at: t.updated_at });
  }
  return [...rooms.values()].sort((a, b) => a.grade.localeCompare(b.grade, 'th', { numeric: true })
    || a.classroom.localeCompare(b.classroom, 'th', { numeric: true }));
}

async function addTeacher(db, { schoolId, input, actorId, ip = null, userAgent = null }) {
  const v = cleanInput(input);
  const [r] = await db.query(
    `INSERT INTO homeroom_teachers (school_id, grade, classroom, teacher_name, phone, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [schoolId, v.grade, v.classroom, v.teacherName, v.phone, actorId, actorId],
  );
  await logAudit({
    userId: actorId, action: 'CREATE', entityType: 'homeroom_teacher', entityId: r.insertId,
    newValue: { school_id: schoolId, grade: v.grade, classroom: v.classroom, teacher_name: v.teacherName, has_phone: Boolean(v.phone) },
    ipAddress: ip, userAgent, conn: db,
  });
  return { id: r.insertId, ...v };
}

async function findOwn(db, schoolId, id) {
  const [[row]] = await db.query(
    'SELECT id, grade, classroom, teacher_name, phone FROM homeroom_teachers WHERE id = ? AND school_id = ?',
    [id, schoolId],
  );
  return row || null;
}

async function updateTeacher(db, { schoolId, id, input, actorId, ip = null, userAgent = null }) {
  const before = await findOwn(db, schoolId, id);
  if (!before) throw httpError('ไม่พบรายชื่อครูนี้ในโรงเรียน', 404);
  const v = cleanInput({
    grade: input.grade ?? before.grade,
    classroom: input.classroom ?? before.classroom,
    teacherName: input.teacherName ?? before.teacher_name,
    phone: input.phone === undefined ? before.phone : input.phone,
  });
  await db.query(
    `UPDATE homeroom_teachers SET grade = ?, classroom = ?, teacher_name = ?, phone = ?, updated_by = ?
      WHERE id = ? AND school_id = ?`,
    [v.grade, v.classroom, v.teacherName, v.phone, actorId, id, schoolId],
  );
  await logAudit({
    userId: actorId, action: 'UPDATE', entityType: 'homeroom_teacher', entityId: id,
    oldValue: { grade: before.grade, classroom: before.classroom, teacher_name: before.teacher_name, has_phone: Boolean(before.phone) },
    newValue: { grade: v.grade, classroom: v.classroom, teacher_name: v.teacherName, has_phone: Boolean(v.phone) },
    ipAddress: ip, userAgent, conn: db,
  });
  return { id, ...v };
}

async function deleteTeacher(db, { schoolId, id, actorId, ip = null, userAgent = null }) {
  const before = await findOwn(db, schoolId, id);
  if (!before) throw httpError('ไม่พบรายชื่อครูนี้ในโรงเรียน', 404);
  await db.query('DELETE FROM homeroom_teachers WHERE id = ? AND school_id = ?', [id, schoolId]);
  await logAudit({
    userId: actorId, action: 'DELETE', entityType: 'homeroom_teacher', entityId: id,
    oldValue: { grade: before.grade, classroom: before.classroom, teacher_name: before.teacher_name, has_phone: Boolean(before.phone) },
    ipAddress: ip, userAgent, conn: db,
  });
  return { id };
}

/**
 * Adds `homeroom_teachers: [{ name, phone }]` to each row (by its school,
 * grade and classroom). One query for all rows. While the flag is off the rows
 * come back untouched; a missing table (flag on before migration — the boot
 * guard should prevent it) degrades to "no teachers" instead of failing the
 * page that only wanted to show them.
 */
async function attachHomeroomTeachers(db, rows, {
  schoolKey = 'school_id', gradeKey = 'grade', roomKey: classroomKey = 'classroom', withPhone = true,
} = {}) {
  if (!enabled() || !Array.isArray(rows) || rows.length === 0) return rows;
  const schoolIds = [...new Set(rows.map((r) => r && r[schoolKey]).filter(Boolean))];
  if (!schoolIds.length) return rows;
  let found = [];
  try {
    [found] = await db.query(
      `SELECT school_id, grade, classroom, teacher_name, phone
         FROM homeroom_teachers
        WHERE school_id IN (${schoolIds.map(() => '?').join(',')})
        ORDER BY id`,
      schoolIds,
    );
  } catch (err) {
    if (err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146)) return rows;
    throw err;
  }
  const byRoom = new Map();
  for (const t of found) {
    const k = roomKey(t.school_id, t.grade, t.classroom);
    if (!byRoom.has(k)) byRoom.set(k, []);
    byRoom.get(k).push(withPhone ? { name: t.teacher_name, phone: t.phone } : { name: t.teacher_name });
  }
  for (const r of rows) {
    if (!r) continue;
    r.homeroom_teachers = byRoom.get(roomKey(r[schoolKey], r[gradeKey], r[classroomKey])) || [];
  }
  return rows;
}

/**
 * Rooms of one school that have teachers listed: [{ grade, classroom, teachers:
 * [{ name, phone }] }]. [] while the flag is off. Used by the classroom check
 * page, which groups its own pupils into rooms and only needs the names.
 */
async function teachersBySchool(db, schoolId, { grades = null } = {}) {
  if (!enabled() || !schoolId) return [];
  const gradeSql = grades ? ` AND grade IN (${grades.map(() => '?').join(',')})` : '';
  let rows = [];
  try {
    [rows] = await db.query(
      `SELECT grade, classroom, teacher_name, phone FROM homeroom_teachers
        WHERE school_id = ?${gradeSql} ORDER BY id`,
      [schoolId, ...(grades || [])],
    );
  } catch (err) {
    if (err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146)) return [];
    throw err;
  }
  const rooms = new Map();
  for (const t of rows) {
    const k = roomKey(schoolId, t.grade, t.classroom);
    if (!rooms.has(k)) rooms.set(k, { grade: t.grade, classroom: t.classroom, teachers: [] });
    rooms.get(k).teachers.push({ name: t.teacher_name, phone: t.phone });
  }
  return [...rooms.values()];
}

module.exports = {
  teachersBySchool,
  enabled,
  listRooms,
  addTeacher,
  updateTeacher,
  deleteTeacher,
  attachHomeroomTeachers,
  formatTeachers,
  formatPhone,
  normalizePhone,
  _roomKey: roomKey,
  defaultPool: pool,
};
