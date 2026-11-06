'use strict';

/**
 * backdatedAttendance.test.js — เช็คชื่อย้อนหลัง
 *
 * Integration tests for GET/POST /api/school/backdated-attendance and the
 * past-date guard on POST /api/school/leave. Uses the shared __TEST* fixtures
 * from tests/setup.js plus suite-local rows cleaned up in afterAll.
 */

require('dotenv').config();
const request = require('supertest');
const bcrypt  = require('bcrypt');
const { getTestConnection } = require('./dbHelper');
const app     = require('../src/app');
const { todayBangkok } = require('../src/utils/thaiTime');

const SCHOOL = { username: '__test_school', password: 'testpass123' };
const TEST_STUDENT_ID  = 99999;
const OTHER_SCHOOL_ID  = '__TSCHB';
const OTHER_STUDENT_ID = 99997;
const P2_STUDENT_ID    = 99996;   // same school, grade ป.2 (outside the teacher's ป.1)
const TEACHER_USERNAME = '__test_school_teacher_bd';
const TEACHER_PASSWORD = 'testpass123';

function daysAgo(n) {
  const base = Date.parse(`${todayBangkok()}T00:00:00Z`);
  const d = new Date(base - n * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
const YESTERDAY = daysAgo(1);
const EDGE      = daysAgo(7);
const TOO_OLD   = daysAgo(8);
const TODAY     = todayBangkok();

let schoolToken = '';
let teacherToken = '';
let affiliationToken = '';

const db = () => getTestConnection();

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data?.access_token || '';
}

async function clean(conn) {
  const ids = [TEST_STUDENT_ID, OTHER_STUDENT_ID, P2_STUDENT_ID];
  const dates = [YESTERDAY, EDGE, TOO_OLD, TODAY];
  await conn.query('DELETE FROM checkin_logs   WHERE student_id IN (?) AND check_date IN (?)', [ids, dates]);
  await conn.query('DELETE FROM daily_status   WHERE student_id IN (?) AND check_date IN (?)', [ids, dates]);
  await conn.query('DELETE FROM student_leaves WHERE student_id IN (?) AND leave_date IN (?)', [ids, dates]);
  await conn.query('DELETE FROM notifications  WHERE student_id IN (?)', [ids]);
  await conn.query(
    `DELETE FROM audit_logs
      WHERE (entity_type = 'checkin_backdated' AND entity_id IN (?))
         OR (entity_type IN ('checkin', 'student_leave') AND user_id IN (SELECT id FROM users WHERE username = ?))`,
    [ids.map(String), SCHOOL.username]
  );
}

function post(body, token = schoolToken) {
  return request(app)
    .post('/api/school/backdated-attendance')
    .set('Authorization', `Bearer ${token}`)
    .send({
      student_id: TEST_STUDENT_ID,
      check_date: YESTERDAY,
      session: 'morning',
      status: 'CHECKED_IN',
      time: '07:15',
      reason: 'คนขับแจ้งว่าโทรศัพท์แบตหมด ไม่ได้กดเช็คชื่อ',
      ...body,
    });
}

beforeAll(async () => {
  const conn = await db();
  const hash = await bcrypt.hash(TEACHER_PASSWORD, 12);
  await conn.query(
    `INSERT INTO users (username, password_hash, role, scope_type, scope_id, grade_scope, display_name)
     VALUES (?, ?, 'school', 'SCHOOL', '__TSCH', 'ป.1', '__Test Teacher BD')
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), grade_scope = VALUES(grade_scope)`,
    [TEACHER_USERNAME, hash]
  );
  await conn.query(
    `INSERT INTO schools (id, name, affiliation_id) VALUES (?, '__Test School BD', '__TAFF')
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [OTHER_SCHOOL_ID]
  );
  await conn.query(
    `INSERT INTO students
       (id, cid_hash, prefix, first_name, last_name, grade, classroom,
        school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
     VALUES (?, SHA2('2222222222222', 256), 'เด็กหญิง', '__OtherBD', 'Student', 'ป.1', '1',
             ?, 'V-test000000ab', TRUE, TRUE, '2568-2')
     ON DUPLICATE KEY UPDATE school_id = VALUES(school_id), vehicle_id = VALUES(vehicle_id)`,
    [OTHER_STUDENT_ID, OTHER_SCHOOL_ID]
  );
  await conn.query(
    `INSERT INTO students
       (id, cid_hash, prefix, first_name, last_name, grade, classroom,
        school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
     VALUES (?, SHA2('3333333333333', 256), 'เด็กชาย', '__P2BD', 'Student', 'ป.2', '1',
             '__TSCH', 'V-test000000ab', TRUE, TRUE, '2568-2')
     ON DUPLICATE KEY UPDATE grade = VALUES(grade), school_id = VALUES(school_id)`,
    [P2_STUDENT_ID]
  );
  await clean(conn);
  await conn.end();
  schoolToken = await login(SCHOOL);
  teacherToken = await login({ username: TEACHER_USERNAME, password: TEACHER_PASSWORD });
  affiliationToken = await login({ username: '__test_affiliation', password: 'testpass123' });
});

beforeEach(async () => {
  const conn = await db();
  await clean(conn);
  await conn.end();
});

afterAll(async () => {
  const conn = await db();
  await clean(conn);
  await conn.query('DELETE FROM students WHERE id IN (?, ?)', [OTHER_STUDENT_ID, P2_STUDENT_ID]);
  await conn.query('DELETE FROM schools  WHERE id = ?', [OTHER_SCHOOL_ID]);
  await conn.query('DELETE FROM users    WHERE username = ?', [TEACHER_USERNAME]);
  await conn.end();
});

describe('POST /api/school/backdated-attendance — happy path', () => {
  test('201: writes a past-dated log at the stated time, flips daily_status, audits, no parent notification', async () => {
    const res = await post({});
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ check_date: YESTERDAY, session: 'morning', status: 'CHECKED_IN', time: '07:15', backdated: true });

    const conn = await db();
    const [[log]] = await conn.query(
      `SELECT DATE_FORMAT(check_date, '%Y-%m-%d') AS d, DATE_FORMAT(checked_at, '%H:%i') AS t, status, student_id
         FROM checkin_logs WHERE id = ?`, [res.body.data.checkin_log_id]);
    expect(log).toMatchObject({ d: YESTERDAY, t: '07:15', status: 'CHECKED_IN', student_id: TEST_STUDENT_ID });

    const [[ds]] = await conn.query(
      `SELECT morning_done, DATE_FORMAT(morning_ts, '%Y-%m-%d %H:%i') AS ts
         FROM daily_status WHERE student_id = ? AND check_date = ?`, [TEST_STUDENT_ID, YESTERDAY]);
    expect(!!ds.morning_done).toBe(true);
    expect(ds.ts).toBe(`${YESTERDAY} 07:15`);

    const [[todayDs]] = await conn.query(
      'SELECT COUNT(*) AS n FROM daily_status WHERE student_id = ? AND check_date = ?', [TEST_STUDENT_ID, TODAY]);
    expect(Number(todayDs.n)).toBe(0);

    const [audit] = await conn.query(
      `SELECT new_value FROM audit_logs WHERE entity_type = 'checkin_backdated' AND entity_id = ?`, [String(TEST_STUDENT_ID)]);
    expect(audit.length).toBe(1);
    const nv = typeof audit[0].new_value === 'string' ? JSON.parse(audit[0].new_value) : audit[0].new_value;
    expect(nv).toMatchObject({ check_date: YESTERDAY, reason: 'คนขับแจ้งว่าโทรศัพท์แบตหมด ไม่ได้กดเช็คชื่อ', school_id: '__TSCH' });

    const [notifs] = await conn.query('SELECT id FROM notifications WHERE student_id = ?', [TEST_STUDENT_ID]);
    expect(notifs.length).toBe(0);
    await conn.end();
  });

  test('7 days back (window edge) is allowed; check-out after check-in is allowed', async () => {
    expect((await post({ check_date: EDGE })).status).toBe(201);
    expect((await post({ check_date: EDGE, status: 'CHECKED_OUT', time: '08:05' })).status).toBe(201);
  });

  test('GET roster shows the recorded logs for that day', async () => {
    await post({});
    const res = await request(app)
      .get(`/api/school/backdated-attendance?date=${YESTERDAY}`)
      .set('Authorization', `Bearer ${schoolToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ check_date: YESTERDAY, max_days: 7, max_date: YESTERDAY, min_date: EDGE });
    const me = res.body.data.students.find(s => s.id === TEST_STUDENT_ID);
    expect(me.morning.done).toBe(true);
    expect(me.morning.logs).toEqual([expect.objectContaining({ status: 'CHECKED_IN', time: '07:15' })]);
    expect(res.body.data.students.find(s => s.id === OTHER_STUDENT_ID)).toBeUndefined();
  });

  test('void of a backdated row resets that day and allows recording again', async () => {
    const first = await post({});
    const v = await request(app)
      .post(`/api/school/checkin/${first.body.data.checkin_log_id}/void`)
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ reason: 'บันทึกผิดคน' });
    expect(v.status).toBe(201);

    const roster = await request(app)
      .get(`/api/school/backdated-attendance?date=${YESTERDAY}`)
      .set('Authorization', `Bearer ${schoolToken}`);
    const me = roster.body.data.students.find(s => s.id === TEST_STUDENT_ID);
    expect(me.morning.done).toBe(false);
    expect(me.morning.logs).toEqual([]);

    expect((await post({ time: '07:30' })).status).toBe(201);
  });
});

describe('POST /api/school/backdated-attendance — refusals', () => {
  test.each([
    ['today', { check_date: TODAY }, 400],
    ['8 days back', { check_date: TOO_OLD }, 400],
    ['future', { check_date: daysAgo(-1) }, 400],
    ['bad date', { check_date: '2026-02-31' }, 400],
    ['missing reason', { reason: '  ' }, 400],
    ['bad time', { time: '7:15' }, 400],
    ['bad session', { session: 'noon' }, 400],
    ['other school pupil', { student_id: OTHER_STUDENT_ID }, 404],
  ])('%s → %i', async (_label, body, code) => {
    const res = await post(body);
    expect(res.status).toBe(code);
    expect(res.body.success).toBe(false);
  });

  test('duplicate → 409', async () => {
    await post({});
    expect((await post({ time: '07:20' })).status).toBe(409);
  });

  test('check-in after check-out → 409; check-out earlier than boarding → 400', async () => {
    await post({ status: 'CHECKED_IN', time: '07:15' });
    expect((await post({ status: 'CHECKED_OUT', time: '07:00' })).status).toBe(400);
    await post({ status: 'CHECKED_OUT', time: '08:00' });
    expect((await post({ status: 'CHECKED_IN', time: '08:10' })).status).toBe(409);
  });

  test('pupil on leave that day → 409', async () => {
    const conn = await db();
    await conn.query(
      `INSERT INTO student_leaves (student_id, vehicle_id, leave_date, session, reason, reported_by, reported_role)
       SELECT ?, 'V-test000000ab', ?, 'morning', 'ป่วย', id, 'school' FROM users WHERE username = ?`, [TEST_STUDENT_ID, YESTERDAY, SCHOOL.username]);
    await conn.end();
    const res = await post({});
    expect(res.status).toBe(409);
  });

  test('grade teacher: own grade 201 (teacher model: morning arrival 07:00), other grade 404, void 403', async () => {
    const ok = await post({ status: 'CHECKED_OUT', time: '07:00' }, teacherToken);
    expect(ok.status).toBe(201);
    expect((await post({ student_id: P2_STUDENT_ID }, teacherToken)).status).toBe(404);
    const v = await request(app)
      .post(`/api/school/checkin/${ok.body.data.checkin_log_id}/void`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ reason: 'x' });
    expect(v.status).toBe(403);
  });

  test('grade teacher GET sees only their grade and the default times', async () => {
    const g = await request(app)
      .get(`/api/school/backdated-attendance?date=${YESTERDAY}`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(g.status).toBe(200);
    expect(g.body.data.default_times).toEqual({ morning: '07:00', evening: '16:00' });
    const ids = g.body.data.students.map(s => s.id);
    expect(ids).toContain(TEST_STUDENT_ID);
    expect(ids).not.toContain(P2_STUDENT_ID);
  });

  test('affiliation account → 403', async () => {
    expect((await post({}, affiliationToken)).status).toBe(403);
  });

  test('GET outside the window → 400', async () => {
    const res = await request(app)
      .get(`/api/school/backdated-attendance?date=${TOO_OLD}`)
      .set('Authorization', `Bearer ${schoolToken}`);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/school/leave — past date guard', () => {
  test('a past leave_date is refused', async () => {
    const res = await request(app)
      .post('/api/school/leave')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ student_id: TEST_STUDENT_ID, leave_date: YESTERDAY, session: 'morning', reason: 'x' });
    expect(res.status).toBe(400);
  });

  test('today is still accepted', async () => {
    const res = await request(app)
      .post('/api/school/leave')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning', reason: 'x' });
    expect(res.status).toBe(201);
  });
});

describe('recordBackdatedCheck allowToday (ops backfill only)', () => {
  const svc = require('../src/services/backdatedAttendance.service');
  const { pool } = require('../src/config/database');

  test('today with a past time is accepted only when allowToday is set; a future time never is', async () => {
    const at = new Date(`${TODAY}T12:00:00+07:00`);
    const base = { userId: null, schoolId: '__TSCH', studentId: TEST_STUDENT_ID, checkDate: TODAY,
      session: 'morning', status: 'CHECKED_OUT', reason: 'backfill test', now: at };
    await expect(svc.recordBackdatedCheck(pool, { ...base, time: '07:00' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.recordBackdatedCheck(pool, { ...base, time: '16:00', session: 'evening', status: 'CHECKED_IN', allowToday: true }))
      .rejects.toMatchObject({ code: 'TIME_IN_FUTURE' });
    const ok = await svc.recordBackdatedCheck(pool, { ...base, time: '07:00', allowToday: true });
    expect(ok.check_date).toBe(TODAY);
  });
});
