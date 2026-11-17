'use strict';
const { gradeEquivalents } = require('../utils/gradeScope');
const { correctTeacherCheckTime } = require('./checkin.service');
const { correctSelfTravelTime } = require('./selfTravel.service');
function fail(message, statusCode) { const e = new Error(message); e.statusCode = statusCode; throw e; }

async function correctAttendanceTimes(pool, { schoolId, gradeFilter = null, userId, session, time, entries, ipAddress, userAgent }) {
  if (!schoolId || !userId || !['morning', 'evening'].includes(session)
      || typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
      || !Array.isArray(entries) || !entries.length || entries.length > 1000) fail('ข้อมูลปรับเวลาไม่ถูกต้อง (ไม่เกิน 1,000 รายการต่อครั้ง)', 400);
  const keys = new Set();
  for (const e of entries) {
    if (!e || !['bus', 'self'].includes(e.kind) || !Number.isSafeInteger(e.id) || e.id < 1
        || typeof e.expected_at !== 'string' || !Number.isFinite(Date.parse(e.expected_at))) fail('รายการปรับเวลาไม่ถูกต้อง', 400);
    const key = `${e.kind}:${e.id}`;
    if (keys.has(key)) fail('มีรายการซ้ำในชุดปรับเวลา', 400);
    keys.add(key);
  }
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    // Lock all affected pupils in stable order before taking event locks. Each
    // per-event correction rechecks school/grade, date, round and snapshot.
    const bus = entries.filter(e => e.kind === 'bus').map(e => e.id);
    const self = entries.filter(e => e.kind === 'self').map(e => e.id);
    const params = [schoolId];
    const gradeAnd = gradeFilter ? ' AND s.grade IN (?)' : '';
    if (gradeFilter) params.push(gradeEquivalents(gradeFilter));
    const clauses = [];
    if (bus.length) { clauses.push('s.id IN (SELECT student_id FROM checkin_logs WHERE id IN (?))'); params.push(bus); }
    if (self.length) { clauses.push('s.id IN (SELECT student_id FROM student_leaves WHERE id IN (?))'); params.push(self); }
    const [students] = await conn.query(`SELECT s.id FROM students s WHERE s.school_id = ?
      AND s.is_deleted = FALSE${gradeAnd} AND (${clauses.join(' OR ')}) ORDER BY s.id FOR UPDATE`, params);
    if (!students.length) fail('ไม่พบรายการในขอบเขตที่รับผิดชอบ', 404);
    let updated = 0;
    for (const e of entries) {
      const options = { schoolId, gradeFilter, userId, time, ipAddress, userAgent,
        connection: conn, expectedAt: e.expected_at, expectedSession: session };
      let result;
      try {
        result = e.kind === 'bus'
          ? await correctTeacherCheckTime(pool, { ...options, logId: e.id })
          : await correctSelfTravelTime(pool, { ...options, id: e.id });
      } catch (error) {
        // Only annotate scoped ordering failures. Never echo unknown/out-of-scope IDs.
        const order = error.errors?.find(item => item.code === 'EVENT_TIME_ORDER');
        if (order) error.errors = [{ ...order, entry_index: entries.indexOf(e) }];
        throw error;
      }
      if (!result.unchanged) updated++;
    }
    await conn.commit();
    return { updated, unchanged: entries.length - updated, total: entries.length };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}
module.exports = { correctAttendanceTimes };
