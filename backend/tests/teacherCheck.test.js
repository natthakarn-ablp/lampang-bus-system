'use strict';

/**
 * teacherCheck.test.js — term 2, phase 1: teachers record attendance.
 *
 * GET/POST /api/school/teacher-check and POST /teacher-check/:logId/undo.
 * Verifies: a grade teacher may record their own grade (no reason needed);
 * morning = arrival at school (CHECKED_OUT), evening = boarding (CHECKED_IN);
 * another grade / another school reads as not_found and writes nothing;
 * leave is skipped; first record wins against the driver; undo is limited to
 * the teacher's own latest tap and keeps an earlier driver tap's "done";
 * the parent sees what the teacher actually saw.
 */

require('dotenv').config();
const request = require('supertest');
const bcrypt  = require('bcrypt');
const { getTestConnection } = require('./dbHelper');
const app     = require('../src/app');
const lineSvc = require('../src/services/line.service');

const STUDENT_ID      = 99999;          // tests/setup.js fixture: __TSCH, ป.1, V-test000000ab
const OTHER_SCHOOL    = '__TSCH3';
const OTHER_STUDENT   = 99997;
const T1 = { username: '__test_teacher_p1', password: 'testpass123' };
const T2 = { username: '__test_teacher_p2', password: 'testpass123' };

let t1 = '';
let t2 = '';
let schoolToken = '';
let t1Id = 0;

const db = () => getTestConnection();

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data?.access_token || '';
}

async function clean(conn) {
  const ids = [STUDENT_ID, OTHER_STUDENT];
  await conn.query('DELETE FROM checkin_logs   WHERE student_id IN (?) AND check_date >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)', [ids]);
  await conn.query('DELETE FROM daily_status   WHERE student_id IN (?) AND check_date >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)', [ids]);
  await conn.query('DELETE FROM student_leaves WHERE student_id IN (?) AND leave_date >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)', [ids]);
  await conn.query('DELETE FROM notifications  WHERE student_id IN (?)', [ids]);
  await conn.query(
    `DELETE FROM audit_logs WHERE entity_type IN ('checkin_teacher','checkin','checkin_time','self_travel','self_travel_time')
      AND user_id IN (SELECT id FROM users WHERE username IN (?, ?, ?))`,
    [T1.username, T2.username, '__test_school']
  );
}

/** A driver tap, written the way the driver transaction writes it. */
async function driverTap(conn, session, status) {
  await conn.query(
    `INSERT INTO checkin_logs (term_id, vehicle_id, plate_no, student_id, cid_hash, student_name,
                               session, status, check_date, checked_by, source)
     SELECT '2568-2', vehicle_id, NULL, id, cid_hash, CONCAT(first_name,' ',last_name),
            ?, ?, CURDATE(), NULL, 'web' FROM students WHERE id = ?`,
    [session, status, STUDENT_ID]
  );
  const col = session === 'morning' ? 'morning' : 'evening';
  await conn.query(
    `INSERT INTO daily_status (check_date, vehicle_id, student_id, cid_hash, student_name, ${col}_done, ${col}_ts)
     SELECT CURDATE(), vehicle_id, id, cid_hash, CONCAT(first_name,' ',last_name), TRUE, NOW()
       FROM students WHERE id = ?
     ON DUPLICATE KEY UPDATE ${col}_done = TRUE, ${col}_ts = NOW()`,
    [STUDENT_ID]
  );
}

async function post(token, body) {
  return request(app).post('/api/school/teacher-check').set('Authorization', `Bearer ${token}`).send(body);
}

function expectSaved(res) {
  expect(res.status === 200 ? 200 : `${res.status}: ${res.body?.message}`).toBe(200);
}

beforeAll(async () => {
  const conn = await db();
  const hash = await bcrypt.hash('testpass123', 12);
  for (const [u, g] of [[T1.username, 'ป.1'], [T2.username, 'ป.2']]) {
    await conn.query(
      `INSERT INTO users (username, password_hash, role, scope_type, scope_id, grade_scope, display_name)
       VALUES (?, ?, 'school', 'SCHOOL', '__TSCH', ?, ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), grade_scope = VALUES(grade_scope),
                               is_active = TRUE, must_change_password = FALSE`,
      [u, hash, g, `__ครู ${g}`]
    );
  }
  await conn.query(
    `INSERT INTO schools (id, name, affiliation_id) VALUES (?, '__Test School 3', '__TAFF')
     ON DUPLICATE KEY UPDATE name = VALUES(name)`, [OTHER_SCHOOL]
  );
  await conn.query(
    `INSERT INTO students (id, cid_hash, prefix, first_name, last_name, grade, classroom,
                           school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
     VALUES (?, SHA2('2222222222222', 256), 'เด็กหญิง', '__Elsewhere', 'Student', 'ป.1', '1',
             ?, 'V-test000000ab', TRUE, TRUE, '2568-2')
     ON DUPLICATE KEY UPDATE school_id = VALUES(school_id)`,
    [OTHER_STUDENT, OTHER_SCHOOL]
  );
  const [[u]] = await conn.query('SELECT id FROM users WHERE username = ?', [T1.username]);
  t1Id = u.id;
  await clean(conn);
  await conn.end();
  t1 = await login(T1);
  t2 = await login(T2);
  schoolToken = await login({ username: '__test_school', password: 'testpass123' });
});

describe('teacher check — correction of recorded time', () => {
  const patchTime = (token, id, time) => request(app)
    .patch(`/api/school/teacher-check/${id}/time`)
    .set('Authorization', `Bearer ${token}`).send({ time });

  // Morning, so 00:00 is both in the past and inside the round whatever the
  // CI clock says (an evening time must be 11:00 or later — live QA gt1-04).
  test('own-grade correction updates the log and latest daily snapshot, with old/new audit', async () => {
    const created = await post(t1, { session: 'morning', student_ids: [STUDENT_ID] });
    const id = created.body.data.results[0].log_id;
    const conn = await db();
    await conn.query("UPDATE checkin_logs SET checked_at = TIMESTAMP(CURDATE(), '00:05:00') WHERE id = ?", [id]);
    await conn.query("UPDATE daily_status SET morning_ts = TIMESTAMP(CURDATE(), '00:05:00') WHERE student_id = ? AND check_date = CURDATE()", [STUDENT_ID]);
    await conn.end();

    const res = await patchTime(t1, id, '00:00');
    expectSaved(res);
    const verify = await db();
    const [[log]] = await verify.query("SELECT DATE_FORMAT(checked_at, '%H:%i') AS time FROM checkin_logs WHERE id = ?", [id]);
    const [[daily]] = await verify.query("SELECT DATE_FORMAT(morning_ts, '%H:%i') AS time FROM daily_status WHERE student_id = ? AND check_date = CURDATE()", [STUDENT_ID]);
    const [[audit]] = await verify.query("SELECT user_id, old_value, new_value FROM audit_logs WHERE entity_type = 'checkin_time' AND entity_id = ? ORDER BY id DESC LIMIT 1", [String(id)]);
    await verify.end();
    expect(log.time).toBe('00:00');
    expect(daily.time).toBe('00:00');
    expect(audit.user_id).toBe(t1Id);
    expect(JSON.parse(typeof audit.old_value === 'string' ? audit.old_value : JSON.stringify(audit.old_value)).checked_at_local).toMatch(/00:05:00$/);
    expect(JSON.parse(typeof audit.new_value === 'string' ? audit.new_value : JSON.stringify(audit.new_value)).checked_at_local).toMatch(/00:00:00$/);

    const roster = await request(app).get('/api/school/teacher-check?session=morning')
      .set('Authorization', `Bearer ${t1}`);
    expectSaved(roster);
    const pupil = roster.body.data.vehicles.flatMap(v => v.students).find(st => st.id === STUDENT_ID);
    expect(pupil.time_edited).toBe(true);
  });

  test('a time on the wrong side of the day for the round is refused (gt1-04)', async () => {
    const created = await post(t1, { session: 'evening', student_ids: [STUDENT_ID] });
    const id = created.body.data.results[0].log_id;
    const res = await patchTime(t1, id, '07:45');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('เวลารอบเย็นต้องตั้งแต่ 11:00 น. เป็นต้นไป');
  });

  test('other grade and other school cannot correct a pupil time; full-school can', async () => {
    const created = await post(t1, { session: 'morning', student_ids: [STUDENT_ID] });
    const id = created.body.data.results[0].log_id;
    expect((await patchTime(t2, id, '00:00')).status).toBe(404);
    expectSaved(await patchTime(schoolToken, id, '00:00'));

    const conn = await db();
    const [result] = await conn.query(
      `INSERT INTO checkin_logs (term_id, vehicle_id, student_id, session, status, check_date, source)
       SELECT '2568-2', vehicle_id, id, 'morning', 'CHECKED_IN', CURDATE(), 'web'
         FROM students WHERE id = ?`, [OTHER_STUDENT]
    );
    await conn.end();
    expect((await patchTime(t1, result.insertId, '00:00')).status).toBe(404);
    expect((await patchTime(schoolToken, result.insertId, '00:00')).status).toBe(404);
  });

  test('invalid input and historical records are refused', async () => {
    const created = await post(t1, { session: 'morning', student_ids: [STUDENT_ID] });
    const id = created.body.data.results[0].log_id;
    expect((await patchTime(t1, id, '25:99')).status).toBe(400);
    expect((await patchTime(t1, id, '00:00:00')).status).toBe(400);
    const conn = await db();
    await conn.query('UPDATE checkin_logs SET check_date = CURDATE() - INTERVAL 1 DAY WHERE id = ?', [id]);
    await conn.end();
    expect((await patchTime(t1, id, '00:00')).status).toBe(409);
    const restore = await db();
    await restore.query('UPDATE checkin_logs SET check_date = CURDATE() WHERE id = ?', [id]);
    await restore.end();
  });
});

describe('independent travel — correction of recorded time', () => {
  test('own-grade teacher corrects a morning self-travel time; another grade is refused', async () => {
    const created = await request(app).post('/api/school/self-travel')
      .set('Authorization', `Bearer ${t1}`).send({ student_id: STUDENT_ID, session: 'morning' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const conn = await db();
    await conn.query("UPDATE student_leaves SET created_at = TIMESTAMP(CURDATE(), '00:05:00') WHERE id = ?", [id]);
    await conn.end();
    const patch = (token) => request(app).patch(`/api/school/self-travel/${id}/time`)
      .set('Authorization', `Bearer ${token}`).send({ time: '00:00' });
    expect((await patch(t2)).status).toBe(404);
    const corrected = await patch(t1);
    expectSaved(corrected);
    const verify = await db();
    const [[record]] = await verify.query("SELECT DATE_FORMAT(created_at, '%H:%i') AS time FROM student_leaves WHERE id = ?", [id]);
    const [[audit]] = await verify.query("SELECT user_id, old_value, new_value FROM audit_logs WHERE entity_type = 'self_travel_time' AND entity_id = ? ORDER BY id DESC LIMIT 1", [String(id)]);
    await verify.end();
    expect(record.time).toBe('00:00');
    expect(audit.user_id).toBe(t1Id);
    expect(JSON.parse(typeof audit.old_value === 'string' ? audit.old_value : JSON.stringify(audit.old_value)).recorded_at_local).toMatch(/00:05:00$/);
    const roster = await request(app).get('/api/school/teacher-check?session=morning')
      .set('Authorization', `Bearer ${t1}`);
    expectSaved(roster);
    const pupil = roster.body.data.vehicles.flatMap(v => v.students).find(st => st.id === STUDENT_ID);
    expect(pupil.self_time_edited).toBe(true);
  });
});

beforeEach(async () => { const c = await db(); await clean(c); await c.end(); });

afterAll(async () => {
  const conn = await db();
  await clean(conn);
  await conn.query('DELETE FROM students WHERE id = ?', [OTHER_STUDENT]);
  await conn.query('DELETE FROM schools  WHERE id = ?', [OTHER_SCHOOL]);
  await conn.query('DELETE FROM users    WHERE username IN (?, ?)', [T1.username, T2.username]);
  await conn.end();
});

describe('teacher check — recording', () => {
  test('grade teacher records a morning ARRIVAL (CHECKED_OUT) with no reason', async () => {
    expect(t1).not.toBe('');
    const res = await post(t1, { session: 'morning', student_ids: [STUDENT_ID] });
    expect(res.status).toBe(201);
    expect(res.body.data.recorded).toBe(1);
    expect(res.body.data.results[0].result).toBe('ok');

    const conn = await db();
    const [[log]] = await conn.query(
      `SELECT status, checked_by FROM checkin_logs WHERE student_id = ? AND check_date = CURDATE() AND session = 'morning'`,
      [STUDENT_ID]
    );
    expect(log.status).toBe('CHECKED_OUT');
    expect(log.checked_by).toBe(t1Id);
    const [[ds]] = await conn.query(
      'SELECT morning_done FROM daily_status WHERE student_id = ? AND check_date = CURDATE()', [STUDENT_ID]
    );
    expect(!!ds.morning_done).toBe(true);
    const [[a]] = await conn.query(
      `SELECT COUNT(*) n FROM audit_logs WHERE entity_type = 'checkin_teacher' AND user_id = ?`, [t1Id]
    );
    expect(a.n).toBe(1);
    await conn.end();
  });

  test('evening records a BOARDING (CHECKED_IN)', async () => {
    const res = await post(t1, { session: 'evening', student_ids: [STUDENT_ID] });
    expect(res.status).toBe(201);
    const conn = await db();
    const [[log]] = await conn.query(
      `SELECT status FROM checkin_logs WHERE student_id = ? AND check_date = CURDATE() AND session = 'evening'`,
      [STUDENT_ID]
    );
    await conn.end();
    expect(log.status).toBe('CHECKED_IN');
  });

  test('a second tap is "already", not a second row', async () => {
    await post(t1, { session: 'morning', student_ids: [STUDENT_ID] });
    const res = await post(t1, { session: 'morning', student_ids: [STUDENT_ID] });
    expect(res.status).toBe(201);
    expect(res.body.data.results[0].result).toBe('already');
    const conn = await db();
    const [[n]] = await conn.query(
      `SELECT COUNT(*) n FROM checkin_logs WHERE student_id = ? AND check_date = CURDATE()`, [STUDENT_ID]
    );
    await conn.end();
    expect(n.n).toBe(1);
  });

  test('another grade and another school read as not_found and write nothing', async () => {
    const res = await post(t2, { session: 'morning', student_ids: [STUDENT_ID] });
    expect(res.body.data.results[0].result).toBe('not_found');
    const res2 = await post(t1, { session: 'morning', student_ids: [OTHER_STUDENT] });
    expect(res2.body.data.results[0].result).toBe('not_found');
    const conn = await db();
    const [[n]] = await conn.query(
      `SELECT COUNT(*) n FROM checkin_logs WHERE student_id IN (?, ?) AND check_date = CURDATE()`,
      [STUDENT_ID, OTHER_STUDENT]
    );
    await conn.end();
    expect(n.n).toBe(0);
  });

  test('a pupil on leave is skipped', async () => {
    const conn = await db();
    await conn.query(
      `INSERT INTO student_leaves (student_id, vehicle_id, leave_date, session, reason,
                                   reported_by, reported_role, cancelled)
       SELECT id, vehicle_id, CURDATE(), 'both', 'test', ?, 'school', FALSE FROM students WHERE id = ?`,
      [t1Id, STUDENT_ID]
    );
    await conn.end();
    const res = await post(t1, { session: 'morning', student_ids: [STUDENT_ID] });
    expect(res.body.data.results[0].result).toBe('on_leave');
  });

  test('bad input is rejected', async () => {
    expect((await post(t1, { session: 'noon', student_ids: [STUDENT_ID] })).status).toBe(400);
    expect((await post(t1, { session: 'morning', student_ids: [] })).status).toBe(400);
  });
});

describe('grade teacher marks leave from the classroom check', () => {
  const leave = (token, body) => request(app).post('/api/school/leave')
    .set('Authorization', `Bearer ${token}`).send(body);

  test('own-grade leave for this round is recorded and excluded from attendance', async () => {
    const res = await leave(t1, { student_id: STUDENT_ID, session: 'morning' });
    expect(res.status).toBe(201);
    const roster = await request(app).get('/api/school/teacher-check?session=morning')
      .set('Authorization', `Bearer ${t1}`);
    const pupil = roster.body.data.vehicles.flatMap(v => v.students).find(st => st.id === STUDENT_ID);
    expect(pupil.on_leave).toBe(true);
    const check = await post(t1, { session: 'morning', student_ids: [STUDENT_ID] });
    expect(check.body.data.results[0].result).toBe('on_leave');
  });

  test('another grade and another school cannot mark this pupil on leave', async () => {
    expect((await leave(t2, { student_id: STUDENT_ID, session: 'morning' })).status).toBe(404);
    expect((await leave(t1, { student_id: OTHER_STUDENT, session: 'morning' })).status).toBe(404);
    const conn = await db();
    const [[count]] = await conn.query('SELECT COUNT(*) n FROM student_leaves WHERE student_id IN (?, ?) AND leave_date = CURDATE()', [STUDENT_ID, OTHER_STUDENT]);
    await conn.end();
    expect(count.n).toBe(0);
  });

  test('teacher cannot backdate but can mark full-day leave', async () => {
    expect((await leave(t1, { student_id: STUDENT_ID, session: 'morning', leave_date: '2000-01-01' })).status).toBe(403);
    expect((await leave(t1, { student_id: STUDENT_ID, session: 'both' })).status).toBe(201);
  });

  test('teacher cannot mark leave after attendance was recorded', async () => {
    expect((await post(t1, { session: 'morning', student_ids: [STUDENT_ID] })).status).toBe(201);
    expect((await leave(t1, { student_id: STUDENT_ID, session: 'morning' })).status).toBe(409);
  });
});

describe('teacher check — first record wins against the driver', () => {
  test('evening: driver already boarded the child → teacher tap is "already"', async () => {
    const conn = await db();
    await driverTap(conn, 'evening', 'CHECKED_IN');
    await conn.end();
    const res = await post(t1, { session: 'evening', student_ids: [STUDENT_ID] });
    expect(res.body.data.results[0].result).toBe('already');
  });

  test('morning: driver boarded at home → teacher still records the school arrival', async () => {
    const conn = await db();
    await driverTap(conn, 'morning', 'CHECKED_IN');
    await conn.end();
    const res = await post(t1, { session: 'morning', student_ids: [STUDENT_ID] });
    expect(res.body.data.results[0].result).toBe('ok');
  });
});

describe('teacher check — roster', () => {
  test('lists the teacher\'s own grade with who recorded it and can_undo', async () => {
    await post(t1, { session: 'morning', student_ids: [STUDENT_ID] });
    const res = await request(app).get('/api/school/teacher-check?session=morning')
      .set('Authorization', `Bearer ${t1}`);
    expectSaved(res);
    const st = res.body.data.vehicles.flatMap(v => v.students).find(s => s.id === STUDENT_ID);
    expect(st).toBeDefined();
    expect(st.done).toBe(true);
    expect(st.can_undo).toBe(true);
    expect(st.status).toBe('CHECKED_OUT');

    const res2 = await request(app).get('/api/school/teacher-check?session=morning')
      .set('Authorization', `Bearer ${t2}`);
    const ids = res2.body.data.vehicles.flatMap(v => v.students).map(s => s.id);
    expect(ids).not.toContain(STUDENT_ID);
  });
});

describe('teacher check — undo', () => {
  async function tapAndGetLogId(token, session) {
    const res = await post(token, { session, student_ids: [STUDENT_ID] });
    return res.body.data.results[0].log_id;
  }

  test('own tap: undo clears the session', async () => {
    const logId = await tapAndGetLogId(t1, 'morning');
    const res = await request(app).post(`/api/school/teacher-check/${logId}/undo`)
      .set('Authorization', `Bearer ${t1}`).send({});
    expect(res.status).toBe(200);
    const conn = await db();
    const [[ds]] = await conn.query(
      'SELECT morning_done FROM daily_status WHERE student_id = ? AND check_date = CURDATE()', [STUDENT_ID]
    );
    await conn.end();
    expect(!!ds.morning_done).toBe(false);
  });

  test('undo keeps an earlier driver tap as "done"', async () => {
    const conn = await db();
    await driverTap(conn, 'morning', 'CHECKED_IN');
    await conn.end();
    const logId = await tapAndGetLogId(t1, 'morning');
    await request(app).post(`/api/school/teacher-check/${logId}/undo`).set('Authorization', `Bearer ${t1}`).send({});
    const c2 = await db();
    const [[ds]] = await c2.query(
      'SELECT morning_done FROM daily_status WHERE student_id = ? AND check_date = CURDATE()', [STUDENT_ID]
    );
    await c2.end();
    expect(!!ds.morning_done).toBe(true);
  });

  test('another teacher cannot undo it', async () => {
    const logId = await tapAndGetLogId(t1, 'morning');
    const res = await request(app).post(`/api/school/teacher-check/${logId}/undo`)
      .set('Authorization', `Bearer ${t2}`).send({});
    expect([403, 404]).toContain(res.status);
  });
});

describe('teacher check — what the parent sees', () => {
  test('morning teacher tap reads "ถึงโรงเรียนแล้ว", evening reads "ขึ้นรถกลับบ้านแล้ว"', async () => {
    await post(t1, { session: 'morning', student_ids: [STUDENT_ID] });
    await post(t1, { session: 'evening', student_ids: [STUDENT_ID] });
    const st = await lineSvc.getChildStatusToday(STUDENT_ID);
    expect(st.morning_label).toBe('ถึงโรงเรียนแล้ว');
    expect(st.evening_label).toBe('ขึ้นรถกลับบ้านแล้ว');
  });

  test('driver taps keep their wording', () => {
    expect(lineSvc.sessionDoneLabel('morning', 'CHECKED_IN')).toBe('ขึ้นรถแล้ว');
    expect(lineSvc.sessionDoneLabel('evening', 'CHECKED_OUT')).toBe('ส่งถึงจุดรับแล้ว');
  });
});


describe('full-day leave linked to return round', () => {
  const leave = (token, session) => request(app).post('/api/school/leave')
    .set('Authorization', `Bearer ${token}`).send({ student_id: STUDENT_ID, session });
  test.each(['teacher', 'school'])('%s full-day leave excludes both rounds and own teacher may undo', async role => {
    const token = role === 'teacher' ? t1 : schoolToken;
    const created = await leave(token, 'both');
    expect(created.status).toBe(201);
    for (const session of ['morning', 'evening']) {
      const roster = await request(app).get(`/api/school/teacher-check?session=${session}`).set('Authorization', `Bearer ${token}`);
      const st = roster.body.data.vehicles.flatMap(v => v.students).find(s => s.id === STUDENT_ID);
      expect(st).toMatchObject({ on_leave: true, leave_session: 'both', can_undo: true, leave_id: created.body.data.id });
      expect((await post(token, { session, student_ids: [STUDENT_ID] })).body.data.results[0].result).toBe('on_leave');
    }
    expect((await request(app).delete(`/api/school/leaves/${created.body.data.id}`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
  });
  test('morning-only leave does not mark evening absent', async () => {
    expect((await leave(t1, 'morning')).status).toBe(201);
    const roster = await request(app).get('/api/school/teacher-check?session=evening').set('Authorization', `Bearer ${t1}`);
    expect(roster.body.data.vehicles.flatMap(v => v.students).find(s => s.id === STUDENT_ID).on_leave).toBe(false);
  });
  test.each(['teacher', 'school'])('%s cannot cover existing evening attendance with full-day leave', async role => {
    await post(t1, { session: 'evening', student_ids: [STUDENT_ID] });
    expect((await leave(role === 'teacher' ? t1 : schoolToken, 'both')).status).toBe(409);
  });
});

describe('bulk time correction', () => {
  const patch = (token, entries, session = 'morning') => request(app).patch('/api/school/attendance-times')
    .set('Authorization', `Bearer ${token}`).send({ session, time: '00:00', entries });
  async function busEntry() {
    const result = await post(t1, { session: 'morning', student_ids: [STUDENT_ID] });
    const id = result.body.data.results[0].log_id;
    const c = await db();
    await c.query("UPDATE checkin_logs SET checked_at = TIMESTAMP(CURDATE(), '00:05:00') WHERE id = ?", [id]);
    const [[r]] = await c.query('SELECT checked_at FROM checkin_logs WHERE id = ?', [id]);
    await c.end();
    return { kind: 'bus', id, expected_at: r.checked_at.toISOString() };
  }
  test.each(['teacher', 'school'])('%s corrects an in-scope batch and updates the snapshot', async role => {
    const entry = await busEntry();
    const res = await patch(role === 'teacher' ? t1 : schoolToken, [entry]);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ updated: 1, unchanged: 0, total: 1 });
    const c = await db();
    const [[r]] = await c.query("SELECT DATE_FORMAT(morning_ts, '%H:%i') hm FROM daily_status WHERE student_id = ? AND check_date = CURDATE()", [STUDENT_ID]);
    await c.end(); expect(r.hm).toBe('00:00');
  });
  test('stale, wrong-round and foreign-grade entries are refused', async () => {
    const entry = await busEntry();
    expect((await patch(t2, [entry])).status).toBe(404);
    expect((await patch(t1, [{ ...entry, expected_at: '2000-01-01T00:00:00Z' }])).status).toBe(409);
    expect((await patch(t1, [entry], 'evening')).status).toBe(409);
  });
  test('a later invalid row rolls back earlier time and audit changes', async () => {
    const entry = await busEntry();
    expect((await patch(t1, [entry, { ...entry, id: 2147483647 }])).status).toBe(404);
    const c = await db();
    const [[r]] = await c.query("SELECT DATE_FORMAT(checked_at, '%H:%i') hm FROM checkin_logs WHERE id = ?", [entry.id]);
    const [[a]] = await c.query("SELECT COUNT(*) n FROM audit_logs WHERE entity_type = 'checkin_time' AND entity_id = ?", [String(entry.id)]);
    await c.end(); expect(r.hm).toBe('00:05'); expect(a.n).toBe(0);
  });
  test('SELF records are corrected without changing attendance kind', async () => {
    const created = await request(app).post('/api/school/self-travel').set('Authorization', `Bearer ${t1}`)
      .send({ student_id: STUDENT_ID, session: 'morning' });
    const id = created.body.data.id; const c = await db();
    await c.query("UPDATE student_leaves SET created_at = TIMESTAMP(CURDATE(), '00:05:00') WHERE id = ?", [id]);
    const [[r]] = await c.query('SELECT created_at FROM student_leaves WHERE id = ?', [id]); await c.end();
    const res = await patch(t1, [{ kind: 'self', id, expected_at: r.created_at.toISOString() }]);
    expect(res.status).toBe(200); expect(res.body.data.updated).toBe(1);
  });
});


describe('backdated bulk time correction (real HTTP and isolated MySQL)', () => {
  async function fixture() {
    const result = await post(t1, { session: 'morning', student_ids: [STUDENT_ID] });
    const id = result.body.data.results[0].log_id;
    const c = await db();
    const [[day]] = await c.query("SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '%Y-%m-%d') d");
    await c.query("UPDATE checkin_logs SET check_date = ?, checked_at = TIMESTAMP(?, '08:00:00') WHERE id = ?", [day.d, day.d, id]);
    await c.query("UPDATE daily_status SET check_date = ?, morning_ts = TIMESTAMP(?, '08:00:00') WHERE student_id = ? AND check_date = CURDATE()", [day.d, day.d, STUDENT_ID]);
    const [[r]] = await c.query('SELECT checked_at FROM checkin_logs WHERE id = ?', [id]);
    const [[notice]] = await c.query('SELECT COUNT(*) n FROM notifications WHERE student_id = ?', [STUDENT_ID]);
    await c.end(); return { notices: notice.n, date: day.d, entry: { kind: 'bus', id, expected_at: r.checked_at.toISOString() } };
  }
  const patch = (token, f, entries = [f.entry], checkDate = f.date) => request(app).patch('/api/school/attendance-times')
    .set('Authorization', `Bearer ${token}`).send({ check_date: checkDate, session: 'morning', time: '08:15', entries });
  test.each(['teacher','school'])('%s changes historical time and snapshot only, with audit and no notification', async role => {
    const f = await fixture();
    const token = role === 'teacher' ? t1 : schoolToken;
    const roster = await request(app).get(`/api/school/backdated-attendance?date=${f.date}`).set('Authorization', `Bearer ${token}`);
    expect(roster.status).toBe(200);
    const pupil = roster.body.data.students.find(s => s.id === STUDENT_ID);
    expect(pupil.morning.logs.at(-1)).toMatchObject({ log_id: f.entry.id, checked_at: f.entry.expected_at });
    const res = await patch(token, f); expect(res.status).toBe(200); expect(res.body.data.updated).toBe(1);
    const c = await db();
    const [[row]] = await c.query("SELECT DATE_FORMAT(check_date,'%Y-%m-%d') d, DATE_FORMAT(checked_at,'%H:%i') hm, status FROM checkin_logs WHERE id = ?", [f.entry.id]);
    const [[daily]] = await c.query("SELECT DATE_FORMAT(morning_ts,'%H:%i') hm FROM daily_status WHERE student_id = ? AND check_date = ?", [STUDENT_ID, f.date]);
    const [[audit]] = await c.query("SELECT COUNT(*) n FROM audit_logs WHERE entity_type = 'checkin_time' AND entity_id = ?", [String(f.entry.id)]);
    const [[notice]] = await c.query('SELECT COUNT(*) n FROM notifications WHERE student_id = ?', [STUDENT_ID]);
    await c.end(); expect(row).toEqual({ d: f.date, hm: '08:15', status: 'CHECKED_OUT' }); expect(daily.hm).toBe('08:15'); expect(audit.n).toBe(1); expect(notice.n).toBe(f.notices);
  });
  test('wrong grade, stale time, other date and omitted past date cannot write', async () => {
    const f = await fixture();
    expect((await patch(t2, f)).status).toBe(404);
    expect((await patch(t1, f, [{ ...f.entry, expected_at: '2000-01-01T00:00:00Z' }])).status).toBe(409);
    const older = new Date(Date.parse(f.date + 'T00:00:00Z') - 86400000).toISOString().slice(0,10);
    expect((await patch(t1, f, [f.entry], older)).status).toBe(409);
    const res = await request(app).patch('/api/school/attendance-times').set('Authorization', `Bearer ${t1}`).send({ session:'morning',time:'08:15',entries:[f.entry] });
    expect(res.status).toBe(409);
  });
  test('historical SELF remains SELF, with exact roster snapshot; LEAVE cannot be corrected', async () => {
    const created = await request(app).post('/api/school/self-travel').set('Authorization', `Bearer ${t1}`)
      .send({student_id:STUDENT_ID,session:'morning'});
    expect(created.status).toBe(201);
    const id=created.body.data.id; const c=await db();
    const [[day]]=await c.query("SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY),'%Y-%m-%d') d");
    await c.query("UPDATE student_leaves SET leave_date=?,created_at=TIMESTAMP(?,'08:00:00') WHERE id=?",[day.d,day.d,id]);
    const [[row]]=await c.query('SELECT created_at FROM student_leaves WHERE id=?',[id]); await c.end();
    const roster=await request(app).get(`/api/school/backdated-attendance?date=${day.d}`).set('Authorization',`Bearer ${t1}`);
    expect(roster.body.data.students.find(s=>s.id===STUDENT_ID).morning).toMatchObject({leave:'SELF',self_id:id,self_session:'morning',self_recorded_at:row.created_at.toISOString()});
    const f={date:day.d,entry:{kind:'self',id,expected_at:row.created_at.toISOString()}};
    expect((await patch(t1,f)).status).toBe(200);
    const verify=await db();
    const [[record]]=await verify.query("SELECT attendance_kind,cancelled,DATE_FORMAT(leave_date,'%Y-%m-%d') d,DATE_FORMAT(created_at,'%H:%i') hm FROM student_leaves WHERE id=?",[id]);
    expect(record).toMatchObject({attendance_kind:'SELF',cancelled:0,d:day.d,hm:'08:15'});
    await verify.query("UPDATE student_leaves SET attendance_kind='LEAVE' WHERE id=?",[id]);await verify.end();
    expect((await patch(t1,f)).status).toBe(409);
  });
  test('invalid second record rolls back historical time and audit', async () => {
    const f = await fixture();
    expect((await patch(t1, f, [f.entry, {...f.entry, id:2147483647}])).status).toBe(404);
    const c = await db();
    const [[row]] = await c.query("SELECT DATE_FORMAT(checked_at,'%H:%i') hm FROM checkin_logs WHERE id=?",[f.entry.id]);
    const [[audit]] = await c.query("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='checkin_time' AND entity_id=?",[String(f.entry.id)]);
    await c.end(); expect(row.hm).toBe('08:00'); expect(audit.n).toBe(0);
  });
});
