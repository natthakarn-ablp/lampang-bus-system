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
let t1Id = 0;

const db = () => getTestConnection();

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data?.access_token || '';
}

async function clean(conn) {
  const ids = [STUDENT_ID, OTHER_STUDENT];
  await conn.query('DELETE FROM checkin_logs   WHERE student_id IN (?) AND check_date = CURDATE()', [ids]);
  await conn.query('DELETE FROM daily_status   WHERE student_id IN (?) AND check_date = CURDATE()', [ids]);
  await conn.query('DELETE FROM student_leaves WHERE student_id IN (?) AND leave_date = CURDATE()', [ids]);
  await conn.query('DELETE FROM notifications  WHERE student_id IN (?)', [ids]);
  await conn.query(
    `DELETE FROM audit_logs WHERE entity_type IN ('checkin_teacher','checkin')
       AND user_id IN (SELECT id FROM users WHERE username IN (?, ?))`,
    [T1.username, T2.username]
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
    expect(res.status).toBe(200);
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
