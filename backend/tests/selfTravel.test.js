'use strict';
require('./loadTestEnv');
const { getTestConnection } = require('./dbHelper');
const { pool } = require('../src/config/database');
const { recordSelfTravel, undoSelfTravel } = require('../src/services/selfTravel.service');
const { createLeave } = require('../src/services/leave.service');
const { processCheckin } = require('../src/services/checkin.service');
const { getDailyReport, getMonthlyReport, getExportRows } = require('../src/services/report.service');
const { structure, applyAttendanceMigration, filename } = require('../src/services/attendanceMigration.service');
const vehicle = 'V-selftravel01';
const ids = [];
let actorId;
const actor = () => ({ role: 'school', scopeId: '__ST1', gradeScope: 'ป.5' });
const params = (extra = {}) => ({ studentId: ids[0], session: 'morning', schoolId: '__ST1', gradeFilter: 'ป.5', userId: actorId, ...extra });

async function clean(c) {
  if (!ids.length) return;
  const [leaves] = await c.query('SELECT id FROM student_leaves WHERE student_id IN (?)', [ids]);
  const [logs] = await c.query('SELECT id FROM checkin_logs WHERE student_id IN (?)', [ids]);
  if (leaves.length) await c.query("DELETE FROM audit_logs WHERE entity_type IN ('self_travel','leave') AND entity_id IN (?)", [leaves.map(row => String(row.id))]);
  if (logs.length) await c.query("DELETE FROM audit_logs WHERE entity_type='checkin' AND entity_id IN (?)", [logs.map(row => String(row.id))]);
  for (const table of ['student_leaves', 'daily_status', 'checkin_logs']) await c.query(`DELETE FROM ${table} WHERE student_id IN (?)`, [ids]);
}
beforeAll(async () => {
  const c = await getTestConnection();
  try {
    const [[actor]] = await c.query("SELECT id FROM users WHERE username='__test_school'"); actorId = actor.id;
    await c.query("INSERT INTO schools(id,name,affiliation_id) VALUES ('__ST1','__ST school1','__TAFF'),('__ST2','__ST school2','__TAFF')");
    await c.query("INSERT INTO vehicles(id,plate_no,normalized_plate,vehicle_type) VALUES (?,'__ST vehicle','__stvehicle','รถตู้')", [vehicle]);
    const [[{ maxId }]] = await c.query('SELECT COALESCE(MAX(id),0) AS maxId FROM students');
    for (const [index, school, grade] of [[1, '__ST1', 'ป.5'], [2, '__ST1', 'ป.6'], [3, '__ST2', 'ป.5']]) {
      const id = Number(maxId) + 100 + index;
      await c.query(`INSERT INTO students(id,cid_hash,first_name,last_name,school_id,grade,classroom,vehicle_id,morning_enabled,evening_enabled,term_id)
        VALUES (?,SHA2(?,256),'__ST pupil','Test',?,?,'1',?,TRUE,TRUE,'2568-2')`, [id, `__stpupil${index}`, school, grade, vehicle]);
      ids.push(id);
    }
  } finally { await c.end(); }
});
beforeEach(async () => {
  const c = await getTestConnection();
  try { await clean(c); await c.query("UPDATE students SET grade='ป.5',morning_enabled=TRUE,evening_enabled=TRUE WHERE id=?", [ids[0]]); }
  finally { await c.end(); }
});
afterAll(async () => {
  const c = await getTestConnection();
  try {
    await clean(c);
    if (ids.length) await c.query('DELETE FROM students WHERE id IN (?)', [ids]);
    await c.query('DELETE FROM vehicles WHERE id=?', [vehicle]);
    await c.query("DELETE FROM schools WHERE id IN ('__ST1','__ST2')");
  } finally { await c.end(); }
});

test('real SQL preserves own-grade scope and separates morning independent arrival from evening bus travel', async () => {
  for (const studentId of ids.slice(1)) await expect(recordSelfTravel(pool, params({ studentId }))).rejects.toMatchObject({ statusCode: 404 });
  await recordSelfTravel(pool, params());
  await processCheckin(pool, { userId: actorId, vehicleId: vehicle, plateNo: '__ST vehicle', studentId: ids[0], session: 'evening', source: 'web' });
  const report = await getDailyReport(actor(), {});
  expect(report).toMatchObject({ total_students: 1, morning_self: 1, morning_leave: 0, morning_done: 0, morning_pending: 0, evening_done: 1, evening_self: 0 });
  const { rows } = await getExportRows(actor(), {});
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ morning_status: 'มาเอง', evening_status: 'เสร็จ' });
});
test('real MySQL generated-key metadata and migration ledger pass the targeted runner verifier', async () => {
  const c = await getTestConnection();
  try {
    expect(await structure(c)).toBe('ready');
    const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../migrations', filename), 'utf8');
    const checksum = require('node:crypto').createHash('sha256').update(sql).digest('hex');
    const first = await applyAttendanceMigration(c, { sql, checksum });
    expect(['already-applied', 'recovered-ledger']).toContain(first.status);
    expect(first.filename).toBe(filename);
    expect(await applyAttendanceMigration(c, { sql, checksum })).toMatchObject({ status: 'already-applied', filename });
  } finally { await c.end(); }
});
test('actual054 DDL preserves legacy leave rows and cancelled history in an owned disposable fixture table', async () => {
  const c = await getTestConnection();
  let created = false;
  try {
    await c.query('CREATE TABLE __test_attendance054 LIKE student_leaves'); created = true;
    await c.query(`ALTER TABLE __test_attendance054 DROP INDEX uk_sl_active_date_student_session,
      DROP COLUMN active_session, DROP COLUMN attendance_kind,
      DROP COLUMN morning_enabled_snapshot, DROP COLUMN evening_enabled_snapshot,
      ADD UNIQUE KEY uk_sl_date_student_session(leave_date,student_id,session)`);
    await c.query("INSERT INTO __test_attendance054(student_id,vehicle_id,leave_date,session,reason,reported_by,reported_role,cancelled) VALUES (?,?,CURDATE(),'morning','__ST legacy',?,'school',TRUE)", [ids[0], vehicle, actorId]);
    const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../migrations', filename), 'utf8');
    await c.query(sql.replace(/\bstudent_leaves\b/g, '__test_attendance054'));
    const [[legacy]] = await c.query('SELECT attendance_kind,reason,cancelled FROM __test_attendance054');
    expect(legacy).toMatchObject({ attendance_kind: 'LEAVE', reason: '__ST legacy', cancelled: 1 });
    const insert = () => c.query("INSERT INTO __test_attendance054(student_id,vehicle_id,leave_date,session,attendance_kind,reported_by,reported_role) VALUES (?,?,CURDATE(),'morning','SELF',?,'school')", [ids[0], vehicle, actorId]);
    const [active] = await insert();
    await expect(insert()).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    await c.query('UPDATE __test_attendance054 SET cancelled=TRUE WHERE id=?', [active.insertId]);
    await insert();
    const [[counts]] = await c.query('SELECT COUNT(*) AS total,SUM(cancelled) AS cancelled FROM __test_attendance054');
    expect(Number(counts.total)).toBe(3); expect(Number(counts.cancelled)).toBe(2);
  } finally {
    try { if (created) await c.query('DROP TABLE __test_attendance054'); }
    finally { await c.end(); }
  }
});
test('driver and leave writers cannot overwrite independent travel', async () => {
  await recordSelfTravel(pool, params());
  await expect(processCheckin(pool, { userId: actorId, vehicleId: vehicle, plateNo: '__ST vehicle', studentId: ids[0], session: 'morning', source: 'web' })).rejects.toMatchObject({ statusCode: 409 });
  await expect(createLeave({ studentId: ids[0], vehicleId: vehicle, leaveDate: require('../src/utils/thaiTime').todayBangkok(), session: 'both', userId: actorId, userRole: 'driver' })).rejects.toMatchObject({ statusCode: 409 });
});
test('cancel and rerecord retains cancelled history and prevents cancelling another school record', async () => {
  const first = await recordSelfTravel(pool, params());
  await expect(undoSelfTravel(pool, { id: first.id, schoolId: '__ST2', gradeFilter: 'ป.5', userId: actorId })).rejects.toMatchObject({ statusCode: 404 });
  await undoSelfTravel(pool, { id: first.id, schoolId: '__ST1', gradeFilter: 'ป.5', userId: actorId });
  const second = await recordSelfTravel(pool, params());
  expect(second.id).not.toBe(first.id);
  const c = await getTestConnection();
  try { const [rows] = await c.query('SELECT cancelled FROM student_leaves WHERE student_id=? ORDER BY id', [ids[0]]); expect(rows.map(row => Number(row.cancelled))).toEqual([1, 0]); }
  finally { await c.end(); }
});
test('simultaneous independent travel and bus boarding produce exactly one effective outcome', async () => {
  const results = await Promise.allSettled([
    recordSelfTravel(pool, params()),
    processCheckin(pool, { userId: actorId, vehicleId: vehicle, plateNo: '__ST vehicle', studentId: ids[0], session: 'morning', source: 'web' }),
  ]);
  expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(row => row.status === 'rejected').reason.statusCode).toBe(409);
  const report = await getDailyReport(actor(), {});
  expect(report.morning_self + report.morning_done).toBe(1);
  expect(report.morning_conflict).toBe(0);
});
test('month includes exception-only days with occurrence and unique pupil metrics', async () => {
  await recordSelfTravel(pool, params());
  const report = await getMonthlyReport(actor(), {});
  expect(report).toMatchObject({ morning_self: 1, morning_self_people: 1, total_morning_done: 0, days_with_data: 1, morning_kpi: null });
  expect(report.daily_trend).toHaveLength(1);
});
test('real SQL counts five occurrence dates as one pupil and keeps eligibility snapshots', async () => {
  const today = require('../src/utils/thaiTime').todayBangkok();
  const current = new Date(today + 'T00:00:00Z');
  current.setUTCMonth(current.getUTCMonth() - 1, 1);
  const month = String(current.getUTCFullYear()) + '-' + String(current.getUTCMonth() + 1).padStart(2, '0');
  const c = await getTestConnection();
  try {
    for (let day = 1; day <= 5; day++) await c.query(
      "INSERT INTO student_leaves(student_id,vehicle_id,leave_date,session,attendance_kind,reported_by,reported_role,morning_enabled_snapshot,evening_enabled_snapshot) VALUES (?,?,?,'morning','SELF',?,'school',TRUE,TRUE)",
      [ids[0], vehicle, month + '-' + String(day).padStart(2, '0'), actorId]);
    await c.query('UPDATE students SET morning_enabled=FALSE WHERE id=?', [ids[0]]);
  } finally { await c.end(); }
  const report = await getMonthlyReport(actor(), { month });
  expect(report).toMatchObject({ morning_self: 5, morning_self_people: 1, days_with_data: 5 });
  expect(report.daily_trend).toHaveLength(5);
});
test('scope is rechecked by the locking read after a concurrent grade move', async () => {
  const writer = await getTestConnection();
  let reached;
  const waiting = new Promise(resolve => { reached = resolve; });
  const original = pool.getConnection.bind(pool);
  const spy = jest.spyOn(pool, 'getConnection').mockImplementation(async () => {
    const connection = await original();
    return new Proxy(connection, { get(target, key) {
      if (key === 'query') return (...args) => {
        if (String(args[0]).includes('FROM students') && String(args[0]).includes('FOR UPDATE')) reached();
        return target.query(...args);
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  try {
    await writer.beginTransaction();
    await writer.query("UPDATE students SET grade='ป.6' WHERE id=?", [ids[0]]);
    const attempt = expect(recordSelfTravel(pool, params())).rejects.toMatchObject({ statusCode: 404 });
    await waiting;
    await writer.commit();
    await attempt;
    const [rows] = await writer.query('SELECT id FROM student_leaves WHERE student_id=?', [ids[0]]);
    expect(rows).toHaveLength(0);
  } finally { spy.mockRestore(); await writer.rollback(); await writer.end(); }
}, 20000);
