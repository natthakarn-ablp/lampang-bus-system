'use strict';

/**
 * schoolOverride.test.js — Phase 10.8B
 *
 * Integration tests for POST /api/school/checkin-override.
 * Verifies: full-school happy path (with both audit rows), grade-scoped
 * teacher 403, cross-school 404, active-leave 409, already-done 409,
 * missing reason 400, invalid session 400, and the persisted
 * checkin_logs / daily_status / audit_logs row contents.
 *
 * Uses the shared __TEST* fixtures from tests/setup.js and adds two
 * suite-local rows that are cleaned up in afterAll.
 */

require('dotenv').config();
const request = require('supertest');
const bcrypt  = require('bcrypt');
const { getTestConnection } = require('./dbHelper');
const app     = require('../src/app');

const SCHOOL = { username: '__test_school', password: 'testpass123' };
const TEST_STUDENT_ID    = 99999;
const OTHER_SCHOOL_ID    = '__TSCH2';
const OTHER_STUDENT_ID   = 99998;
const TEACHER_USERNAME   = '__test_school_teacher';
const TEACHER_PASSWORD   = 'testpass123';

let schoolToken  = '';
let teacherToken = '';

// Guarded connection factory: getTestConnection() asserts the disposable-test-DB
// guard before opening the socket (defense-in-depth, issue #8). Returns a
// Promise<Connection>, so existing `await db()` call sites are unchanged.
function db() {
  return getTestConnection();
}

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data?.access_token || '';
}

async function cleanStudentDailyState(conn) {
  await conn.query(`DELETE FROM checkin_logs   WHERE student_id IN (?, ?) AND check_date = CURDATE()`, [TEST_STUDENT_ID, OTHER_STUDENT_ID]);
  await conn.query(`DELETE FROM daily_status   WHERE student_id IN (?, ?) AND check_date = CURDATE()`, [TEST_STUDENT_ID, OTHER_STUDENT_ID]);
  await conn.query(`DELETE FROM student_leaves WHERE student_id IN (?, ?) AND leave_date = CURDATE()`, [TEST_STUDENT_ID, OTHER_STUDENT_ID]);
  await conn.query(`DELETE FROM notifications  WHERE student_id IN (?, ?)`, [TEST_STUDENT_ID, OTHER_STUDENT_ID]);
  await conn.query(
    `DELETE FROM audit_logs
     WHERE (entity_type = 'checkin_override' AND entity_id IN (?, ?))
        OR (entity_type = 'checkin' AND user_id IN (
              SELECT id FROM users WHERE username IN (?, ?)
            ))`,
    [String(TEST_STUDENT_ID), String(OTHER_STUDENT_ID), SCHOOL.username, TEACHER_USERNAME]
  );
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const conn = await db();
  const hash = await bcrypt.hash(TEACHER_PASSWORD, 12);

  // Grade-scoped teacher under the same school (must be blocked on writes)
  await conn.query(
    `INSERT INTO users (username, password_hash, role, scope_type, scope_id, grade_scope, display_name)
     VALUES (?, ?, 'school', 'SCHOOL', '__TSCH', 'ป.1', '__Test Teacher (ป.1)')
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), grade_scope = VALUES(grade_scope)`,
    [TEACHER_USERNAME, hash]
  );

  // Second school + a student belonging to it (cross-school 404 case)
  await conn.query(
    `INSERT INTO schools (id, name, affiliation_id) VALUES (?, '__Test School 2', '__TAFF')
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [OTHER_SCHOOL_ID]
  );
  await conn.query(
    `INSERT INTO students
       (id, cid_hash, prefix, first_name, last_name, grade, classroom,
        school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
     VALUES
       (?, SHA2('1111111111111', 256), 'เด็กชาย', '__Other', 'Student', 'ป.1', '1',
        ?, 'V-test000000ab', TRUE, TRUE, '2568-2')
     ON DUPLICATE KEY UPDATE school_id = VALUES(school_id), vehicle_id = VALUES(vehicle_id)`,
    [OTHER_STUDENT_ID, OTHER_SCHOOL_ID]
  );

  await cleanStudentDailyState(conn);
  await conn.end();

  schoolToken  = await login(SCHOOL);
  teacherToken = await login({ username: TEACHER_USERNAME, password: TEACHER_PASSWORD });
});

beforeEach(async () => {
  const conn = await db();
  await cleanStudentDailyState(conn);
  await conn.end();
});

afterAll(async () => {
  const conn = await db();
  await cleanStudentDailyState(conn);
  await conn.query(`DELETE FROM students WHERE id = ?`, [OTHER_STUDENT_ID]);
  await conn.query(`DELETE FROM schools  WHERE id = ?`, [OTHER_SCHOOL_ID]);
  await conn.query(`DELETE FROM users    WHERE username = ?`, [TEACHER_USERNAME]);
  await conn.end();
});

// ─── 1. Happy path ───────────────────────────────────────────────────────────

describe('POST /api/school/checkin-override — happy path', () => {
  test('201 + writes checkin_logs + flips daily_status + writes two audit rows', async () => {
    const res = await request(app)
      .post('/api/school/checkin-override')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({
        student_id: TEST_STUDENT_ID,
        session:    'morning',
        status:     'CHECKED_IN',
        reason:     'นักเรียนมาถึงแล้ว แต่คนขับยังไม่ได้กดยืนยัน',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.override).toBe(true);
    expect(res.body.data.checkin_log_id).toBeDefined();
    expect(res.body.data.session).toBe('morning');
    expect(res.body.data.status).toBe('CHECKED_IN');

    const conn = await db();
    const [cl] = await conn.query(
      `SELECT * FROM checkin_logs WHERE id = ?`, [res.body.data.checkin_log_id]
    );
    expect(cl.length).toBe(1);
    expect(cl[0].student_id).toBe(TEST_STUDENT_ID);
    expect(cl[0].session).toBe('morning');
    expect(cl[0].status).toBe('CHECKED_IN');
    expect(cl[0].source).toBe('web');

    const [ds] = await conn.query(
      `SELECT morning_done, morning_ts FROM daily_status
       WHERE student_id = ? AND check_date = CURDATE()`,
      [TEST_STUDENT_ID]
    );
    expect(ds.length).toBe(1);
    expect(!!ds[0].morning_done).toBe(true);
    expect(ds[0].morning_ts).not.toBeNull();

    const [checkinAudit] = await conn.query(
      `SELECT id FROM audit_logs
       WHERE entity_type = 'checkin' AND entity_id = ?
       ORDER BY id DESC LIMIT 1`,
      [String(res.body.data.checkin_log_id)]
    );
    expect(checkinAudit.length).toBe(1);

    const [overrideAudit] = await conn.query(
      `SELECT id, action, new_value FROM audit_logs
       WHERE entity_type = 'checkin_override' AND entity_id = ?
       ORDER BY id DESC LIMIT 1`,
      [String(TEST_STUDENT_ID)]
    );
    expect(overrideAudit.length).toBe(1);
    expect(overrideAudit[0].action).toBe('UPDATE');
    await conn.end();
  });
});

// ─── 2. Grade-scoped teacher forbidden ───────────────────────────────────────

describe('POST /api/school/checkin-override — grade teacher forbidden', () => {
  test('403 and no DB writes', async () => {
    const res = await request(app)
      .post('/api/school/checkin-override')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        student_id: TEST_STUDENT_ID,
        session:    'morning',
        reason:     'should be blocked',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);

    const conn = await db();
    const [[{ cnt: clCnt }]] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM checkin_logs WHERE student_id = ? AND check_date = CURDATE()`,
      [TEST_STUDENT_ID]
    );
    const [[{ cnt: dsCnt }]] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM daily_status WHERE student_id = ? AND check_date = CURDATE()`,
      [TEST_STUDENT_ID]
    );
    expect(clCnt).toBe(0);
    expect(dsCnt).toBe(0);
    await conn.end();
  });
});

// ─── 3. Cross-school student ─────────────────────────────────────────────────

describe('POST /api/school/checkin-override — cross-school', () => {
  test('404 when student belongs to a different school', async () => {
    const res = await request(app)
      .post('/api/school/checkin-override')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({
        student_id: OTHER_STUDENT_ID,
        session:    'morning',
        reason:     'attempting to override another school',
      });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);

    const conn = await db();
    const [[{ cnt }]] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM checkin_logs WHERE student_id = ? AND check_date = CURDATE()`,
      [OTHER_STUDENT_ID]
    );
    expect(cnt).toBe(0);
    await conn.end();
  });
});

// ─── 4. Active leave conflict ────────────────────────────────────────────────

describe('POST /api/school/checkin-override — active leave', () => {
  test('409 when a non-cancelled leave exists for the session', async () => {
    const conn = await db();
    await conn.query(
      `INSERT INTO student_leaves
         (student_id, vehicle_id, leave_date, session, reason, reported_by, reported_role)
       VALUES (?, 'V-test000000ab', CURDATE(), 'morning', 'fixture leave', 1, 'school')`,
      [TEST_STUDENT_ID]
    );
    await conn.end();

    const res = await request(app)
      .post('/api/school/checkin-override')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({
        student_id: TEST_STUDENT_ID,
        session:    'morning',
        reason:     'leave conflict expected',
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);

    const conn2 = await db();
    const [[{ cnt }]] = await conn2.query(
      `SELECT COUNT(*) AS cnt FROM checkin_logs WHERE student_id = ? AND check_date = CURDATE()`,
      [TEST_STUDENT_ID]
    );
    expect(cnt).toBe(0);
    await conn2.end();
  });
});

// ─── 5. Already done conflict ────────────────────────────────────────────────

describe('POST /api/school/checkin-override — already done', () => {
  test('409 when daily_status.morning_done is already TRUE', async () => {
    const conn = await db();
    await conn.query(
      `INSERT INTO daily_status
         (check_date, vehicle_id, student_id, cid_hash, student_name, morning_done, morning_ts)
       VALUES (CURDATE(), 'V-test000000ab', ?, SHA2('1234567890123', 256), '__Test Student', TRUE, NOW())
       ON DUPLICATE KEY UPDATE morning_done = TRUE, morning_ts = NOW()`,
      [TEST_STUDENT_ID]
    );
    await conn.end();

    const res = await request(app)
      .post('/api/school/checkin-override')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({
        student_id: TEST_STUDENT_ID,
        session:    'morning',
        reason:     'should hit already-done branch',
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);

    const conn2 = await db();
    const [[{ cnt }]] = await conn2.query(
      `SELECT COUNT(*) AS cnt FROM checkin_logs WHERE student_id = ? AND check_date = CURDATE()`,
      [TEST_STUDENT_ID]
    );
    expect(cnt).toBe(0);
    await conn2.end();
  });
});

// ─── 6. Missing reason ───────────────────────────────────────────────────────

describe('POST /api/school/checkin-override — missing reason', () => {
  test('400 when reason is missing', async () => {
    const res = await request(app)
      .post('/api/school/checkin-override')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('400 when reason is whitespace only', async () => {
    const res = await request(app)
      .post('/api/school/checkin-override')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning', reason: '   ' });

    expect(res.status).toBe(400);
  });
});

// ─── 7. Invalid session ──────────────────────────────────────────────────────

describe('POST /api/school/checkin-override — invalid session', () => {
  test('400 when session is not morning/evening', async () => {
    const res = await request(app)
      .post('/api/school/checkin-override')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'afternoon', reason: 'bad session' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ─── 8. Audit row content ────────────────────────────────────────────────────

describe('POST /api/school/checkin-override — audit metadata', () => {
  test('checkin_override audit row carries reason + actor + override_checkin_log_id', async () => {
    const reasonText = 'audit-metadata test reason';
    const res = await request(app)
      .post('/api/school/checkin-override')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({
        student_id: TEST_STUDENT_ID,
        session:    'evening',
        status:     'CHECKED_OUT',
        reason:     reasonText,
      });
    expect(res.status).toBe(201);
    const checkinLogId = res.body.data.checkin_log_id;

    const conn = await db();
    const [rows] = await conn.query(
      `SELECT new_value, old_value FROM audit_logs
       WHERE entity_type = 'checkin_override' AND entity_id = ?
       ORDER BY id DESC LIMIT 1`,
      [String(TEST_STUDENT_ID)]
    );
    await conn.end();

    expect(rows.length).toBe(1);
    const nv = rows[0].new_value; // mysql2 parses JSON columns automatically
    expect(nv.reason).toBe(reasonText);
    expect(nv.school_id).toBe('__TSCH');
    expect(nv.student_id).toBe(TEST_STUDENT_ID);
    expect(nv.session).toBe('evening');
    expect(nv.status).toBe('CHECKED_OUT');
    expect(nv.override_checkin_log_id).toBe(checkinLogId);
    expect(nv.confirmed_by_role).toBe('school');
    expect(typeof nv.confirmed_by_user_id).toBe('number');
    expect(nv.confirmed_by_user_id).toBeGreaterThan(0);
    expect(rows[0].old_value).toHaveProperty('morning_done');
    expect(rows[0].old_value).toHaveProperty('evening_done');
  });
});

// ─── 9 & 10. checkin_logs / daily_status content (composite) ────────────────

describe('POST /api/school/checkin-override — persistence', () => {
  test('checkin_logs row has checked_by=schoolUser, source=web, status=CHECKED_IN, today', async () => {
    const res = await request(app)
      .post('/api/school/checkin-override')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({
        student_id: TEST_STUDENT_ID,
        session:    'morning',
        reason:     'persistence assertion',
      });
    expect(res.status).toBe(201);

    const conn = await db();
    const [[schoolUser]] = await conn.query(
      `SELECT id FROM users WHERE username = ? LIMIT 1`, [SCHOOL.username]
    );
    const [cl] = await conn.query(
      `SELECT student_id, session, status, source, checked_by,
              (check_date = CURDATE()) AS is_today
       FROM checkin_logs WHERE id = ?`, [res.body.data.checkin_log_id]
    );
    expect(cl.length).toBe(1);
    expect(cl[0].source).toBe('web');
    expect(cl[0].status).toBe('CHECKED_IN');
    expect(cl[0].checked_by).toBe(schoolUser.id);
    expect(Number(cl[0].is_today)).toBe(1);

    const [ds] = await conn.query(
      `SELECT morning_done, morning_ts FROM daily_status
       WHERE student_id = ? AND check_date = CURDATE()`,
      [TEST_STUDENT_ID]
    );
    expect(ds.length).toBe(1);
    expect(!!ds[0].morning_done).toBe(true);
    expect(ds[0].morning_ts).not.toBeNull();
    await conn.end();
  });
});
