'use strict';

/**
 * lineNotificationResolver.test.js — Phase 10.9B
 *
 * Verifies the new phone-based LINE notification recipient resolver in
 * _buildCheckinTransaction (backend/src/services/checkin.service.js).
 *
 * Old resolver (Round 0): joined line_users.parent_id only — missed siblings
 *   from multi-child families because parents.id is per-student.
 * New resolver (Round 2): joins parents.phone → line_bindings.phone →
 *   line_users.line_user_id. line_users JOIN preserved so we (a) satisfy
 *   notifications.target_line_user_id FK, and (b) filter to verified users.
 *
 * These tests drive notifications through the real /api/driver/checkin
 * endpoint and validate notifications-table rows.
 *
 * Uses the shared __TEST* fixture (student 99999 / V-test000000ab / driver
 * '__TEST PLATE 9999'). Adds suite-local parents + line_bindings + line_users
 * rows in beforeEach and cleans up in afterEach so cases don't leak.
 */

require('dotenv').config();
const request = require('supertest');
const { getTestConnection } = require('./dbHelper');
const app     = require('../src/app');

const DRIVER          = { username: '__TEST PLATE 9999', password: 'testpass123' };
const TEST_STUDENT_ID = 99999;       // primary fixture student (on V-test000000ab)
const SIBLING_STUDENT_ID = 99997;    // suite-local sibling of TEST_STUDENT_ID
const FAMILY_PHONE   = '0900000001'; // suite-local phone shared by both siblings
const FATHER_PHONE   = '0900000002'; // suite-local second-parent phone (case 2)
const STALE_PHONE    = '0900009999'; // suite-local phone that maps to NO binding
const FAMILY_LINE_ID = '__UAT_LINE_FAMILY';   // suite-local LINE user (50-char max)
const FATHER_LINE_ID = '__UAT_LINE_FATHER';
const STALE_LINE_ID  = '__UAT_LINE_STALE';

let driverToken = '';

// Guarded connection factory (defense-in-depth, issue #8): getTestConnection()
// asserts the disposable-test-DB guard before opening the socket. Returns a
// Promise<Connection>, so existing `await db()` call sites are unchanged.
function db() {
  return getTestConnection();
}

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data?.access_token || '';
}

// ── helpers ────────────────────────────────────────────────────────────────

async function cleanAll(conn) {
  // Order respects FK constraints: notifications → line_users; line_users → parents
  await conn.query(`DELETE FROM notifications  WHERE student_id IN (?, ?)`, [TEST_STUDENT_ID, SIBLING_STUDENT_ID]);
  await conn.query(`DELETE FROM checkin_logs   WHERE student_id IN (?, ?) AND check_date = CURDATE()`, [TEST_STUDENT_ID, SIBLING_STUDENT_ID]);
  await conn.query(`DELETE FROM daily_status   WHERE student_id IN (?, ?) AND check_date = CURDATE()`, [TEST_STUDENT_ID, SIBLING_STUDENT_ID]);
  await conn.query(`DELETE FROM line_bindings  WHERE phone IN (?, ?, ?)`, [FAMILY_PHONE, FATHER_PHONE, STALE_PHONE]);
  await conn.query(`DELETE FROM line_users     WHERE line_user_id IN (?, ?, ?)`, [FAMILY_LINE_ID, FATHER_LINE_ID, STALE_LINE_ID]);
  await conn.query(`DELETE FROM parent_student WHERE student_id IN (?, ?) OR parent_id IN (
    SELECT id FROM parents WHERE phone IN (?, ?, ?) OR name LIKE '__TEST_PARENT%'
  )`, [TEST_STUDENT_ID, SIBLING_STUDENT_ID, FAMILY_PHONE, FATHER_PHONE, STALE_PHONE]);
  await conn.query(`DELETE FROM parents WHERE phone IN (?, ?, ?) OR name LIKE '__TEST_PARENT%'`, [FAMILY_PHONE, FATHER_PHONE, STALE_PHONE]);
  await conn.query(`DELETE FROM students WHERE id = ?`, [SIBLING_STUDENT_ID]);
}

async function makeParent(conn, name, phone) {
  const [r] = await conn.query(
    `INSERT INTO parents (name, phone, verified) VALUES (?, ?, TRUE)`,
    [name, phone]
  );
  return r.insertId;
}
async function approveLink(conn, parentId, studentId) {
  await conn.query(
    `INSERT INTO parent_student (parent_id, student_id, approved) VALUES (?, ?, TRUE)`,
    [parentId, studentId]
  );
}
async function makeLineUser(conn, lineUserId, parentId = null, verified = true) {
  await conn.query(
    `INSERT INTO line_users (line_user_id, user_type, parent_id, verified, linked_at)
     VALUES (?, 'parent', ?, ?, NOW())`,
    [lineUserId, parentId, verified]
  );
}
async function makeBinding(conn, phone, lineUserId, active = true) {
  await conn.query(
    `INSERT INTO line_bindings (phone, line_user_id, is_active, bound_at)
     VALUES (?, ?, ?, NOW())`,
    [phone, lineUserId, active]
  );
}
async function makeSibling(conn) {
  await conn.query(
    `INSERT INTO students
       (id, cid_hash, prefix, first_name, last_name, grade, classroom,
        school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
     VALUES (?, SHA2('9999999999997', 256), 'เด็กชาย', '__TEST_SIB', 'Sibling',
             'ป.1', '1', '__TSCH', 'V-test000000ab', TRUE, TRUE, '2568-2')
     ON DUPLICATE KEY UPDATE vehicle_id='V-test000000ab', is_deleted=FALSE`,
    [SIBLING_STUDENT_ID]
  );
}

async function countNotifications(conn, studentId) {
  const [[{ n }]] = await conn.query(
    `SELECT COUNT(*) AS n FROM notifications WHERE student_id = ?`, [studentId]
  );
  return n;
}
async function notificationsFor(conn, studentId) {
  const [rows] = await conn.query(
    `SELECT target_line_user_id, notification_type FROM notifications WHERE student_id = ? ORDER BY id`,
    [studentId]
  );
  return rows;
}

// ── setup ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  driverToken = await login(DRIVER);
  const conn = await db();
  await cleanAll(conn);
  await conn.end();
});

afterEach(async () => {
  const conn = await db();
  await cleanAll(conn);
  await conn.end();
});

// ── tests ──────────────────────────────────────────────────────────────────

describe('LINE notification resolver — Phase 10.9B (phone-based)', () => {

  test('1. one child, one parent phone, one active binding → 1 notification', async () => {
    const conn = await db();
    const pid = await makeParent(conn, '__TEST_PARENT_A', FAMILY_PHONE);
    await approveLink(conn, pid, TEST_STUDENT_ID);
    await makeLineUser(conn, FAMILY_LINE_ID, pid, true);
    await makeBinding(conn, FAMILY_PHONE, FAMILY_LINE_ID, true);
    await conn.end();

    const res = await request(app)
      .post('/api/driver/checkin')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });
    expect(res.status).toBe(201);

    const conn2 = await db();
    const rows = await notificationsFor(conn2, TEST_STUDENT_ID);
    await conn2.end();
    expect(rows.length).toBe(1);
    expect(rows[0].target_line_user_id).toBe(FAMILY_LINE_ID);
    expect(rows[0].notification_type).toBe('checkin');
  });

  test('2. one child, two approved parents, two bindings → 2 notifications', async () => {
    const conn = await db();
    const mom = await makeParent(conn, '__TEST_PARENT_MOM', FAMILY_PHONE);
    const dad = await makeParent(conn, '__TEST_PARENT_DAD', FATHER_PHONE);
    await approveLink(conn, mom, TEST_STUDENT_ID);
    await approveLink(conn, dad, TEST_STUDENT_ID);
    await makeLineUser(conn, FAMILY_LINE_ID, mom, true);
    await makeLineUser(conn, FATHER_LINE_ID, dad, true);
    await makeBinding(conn, FAMILY_PHONE, FAMILY_LINE_ID, true);
    await makeBinding(conn, FATHER_PHONE, FATHER_LINE_ID, true);
    await conn.end();

    const res = await request(app)
      .post('/api/driver/checkin')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });
    expect(res.status).toBe(201);

    const conn2 = await db();
    const rows = await notificationsFor(conn2, TEST_STUDENT_ID);
    await conn2.end();
    expect(rows.length).toBe(2);
    const targets = rows.map(r => r.target_line_user_id).sort();
    expect(targets).toEqual([FAMILY_LINE_ID, FATHER_LINE_ID].sort());
  });

  test('3. siblings under same phone → each sibling gets the same LINE user (fix for sibling bug)', async () => {
    const conn = await db();
    await makeSibling(conn);
    // Two parents rows under same phone — one per child (matches refactor baf2cea)
    const pidA = await makeParent(conn, '__TEST_PARENT_A_SIB', FAMILY_PHONE);
    const pidB = await makeParent(conn, '__TEST_PARENT_B_SIB', FAMILY_PHONE);
    await approveLink(conn, pidA, TEST_STUDENT_ID);
    await approveLink(conn, pidB, SIBLING_STUDENT_ID);
    // Single LINE user, dual-write line_users.parent_id to ONLY one of them
    await makeLineUser(conn, FAMILY_LINE_ID, pidA, true);
    await makeBinding(conn, FAMILY_PHONE, FAMILY_LINE_ID, true);
    await conn.end();

    const r1 = await request(app)
      .post('/api/driver/checkin')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });
    expect(r1.status).toBe(201);
    const r2 = await request(app)
      .post('/api/driver/checkin')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: SIBLING_STUDENT_ID, session: 'morning' });
    expect(r2.status).toBe(201);

    const conn2 = await db();
    const n1 = await notificationsFor(conn2, TEST_STUDENT_ID);
    const n2 = await notificationsFor(conn2, SIBLING_STUDENT_ID);
    await conn2.end();

    // CRITICAL: the sibling whose parent_id is NOT in line_users would have
    // received 0 notifications under the Round 0 resolver. Phase 10.9B must
    // deliver 1 notification per child to the same family LINE user.
    expect(n1.length).toBe(1);
    expect(n2.length).toBe(1);
    expect(n1[0].target_line_user_id).toBe(FAMILY_LINE_ID);
    expect(n2[0].target_line_user_id).toBe(FAMILY_LINE_ID);
  });

  test('4. line_users.parent_id NULL but line_bindings.phone matches → notification sent', async () => {
    const conn = await db();
    const pid = await makeParent(conn, '__TEST_PARENT_C', FAMILY_PHONE);
    await approveLink(conn, pid, TEST_STUDENT_ID);
    await makeLineUser(conn, FAMILY_LINE_ID, null, true);    // parent_id null
    // Note: line_users CHECK constraint allows parent_id=null + driver_id=null
    await makeBinding(conn, FAMILY_PHONE, FAMILY_LINE_ID, true);
    await conn.end();

    const res = await request(app)
      .post('/api/driver/checkin')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });
    expect(res.status).toBe(201);

    const conn2 = await db();
    const rows = await notificationsFor(conn2, TEST_STUDENT_ID);
    await conn2.end();
    expect(rows.length).toBe(1);
    expect(rows[0].target_line_user_id).toBe(FAMILY_LINE_ID);
  });

  test('5. stale line_users.parent_id pointing to a different parent → phone binding still wins', async () => {
    const conn = await db();
    const realParent  = await makeParent(conn, '__TEST_PARENT_REAL',  FAMILY_PHONE);
    const stalePID    = await makeParent(conn, '__TEST_PARENT_STALE', STALE_PHONE);
    await approveLink(conn, realParent, TEST_STUDENT_ID);
    // line_users says parent_id = stale (not associated with TEST_STUDENT_ID)
    await makeLineUser(conn, FAMILY_LINE_ID, stalePID, true);
    // Binding correctly maps phone → LINE user
    await makeBinding(conn, FAMILY_PHONE, FAMILY_LINE_ID, true);
    await conn.end();

    const res = await request(app)
      .post('/api/driver/checkin')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });
    expect(res.status).toBe(201);

    const conn2 = await db();
    const rows = await notificationsFor(conn2, TEST_STUDENT_ID);
    await conn2.end();
    // Under Round 0 resolver this returns 0 rows. Phase 10.9B should return 1.
    expect(rows.length).toBe(1);
    expect(rows[0].target_line_user_id).toBe(FAMILY_LINE_ID);
  });

  test('6. inactive line_bindings row → no notification', async () => {
    const conn = await db();
    const pid = await makeParent(conn, '__TEST_PARENT_INACTIVE', FAMILY_PHONE);
    await approveLink(conn, pid, TEST_STUDENT_ID);
    await makeLineUser(conn, FAMILY_LINE_ID, pid, true);
    await makeBinding(conn, FAMILY_PHONE, FAMILY_LINE_ID, false); // inactive
    await conn.end();

    const res = await request(app)
      .post('/api/driver/checkin')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });
    expect(res.status).toBe(201);

    const conn2 = await db();
    expect(await countNotifications(conn2, TEST_STUDENT_ID)).toBe(0);
    await conn2.end();
  });

  test('7. unverified line_users row → no notification', async () => {
    const conn = await db();
    const pid = await makeParent(conn, '__TEST_PARENT_UNVERIFIED', FAMILY_PHONE);
    await approveLink(conn, pid, TEST_STUDENT_ID);
    await makeLineUser(conn, FAMILY_LINE_ID, pid, false);  // verified=false
    await makeBinding(conn, FAMILY_PHONE, FAMILY_LINE_ID, true);
    await conn.end();

    const res = await request(app)
      .post('/api/driver/checkin')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });
    expect(res.status).toBe(201);

    const conn2 = await db();
    expect(await countNotifications(conn2, TEST_STUDENT_ID)).toBe(0);
    await conn2.end();
  });

  test('8. duplicate parent_student rows (two parents under same phone) → DISTINCT dedupes to 1', async () => {
    const conn = await db();
    // Two parents.id rows, same phone, both approved for the SAME student
    const pidA = await makeParent(conn, '__TEST_PARENT_DUP_A', FAMILY_PHONE);
    const pidB = await makeParent(conn, '__TEST_PARENT_DUP_B', FAMILY_PHONE);
    await approveLink(conn, pidA, TEST_STUDENT_ID);
    await approveLink(conn, pidB, TEST_STUDENT_ID);
    await makeLineUser(conn, FAMILY_LINE_ID, pidA, true);
    await makeBinding(conn, FAMILY_PHONE, FAMILY_LINE_ID, true);
    await conn.end();

    const res = await request(app)
      .post('/api/driver/checkin')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });
    expect(res.status).toBe(201);

    const conn2 = await db();
    const rows = await notificationsFor(conn2, TEST_STUDENT_ID);
    await conn2.end();
    expect(rows.length).toBe(1);   // DISTINCT prevents duplicate
    expect(rows[0].target_line_user_id).toBe(FAMILY_LINE_ID);
  });

  test('9. no matching line binding → 0 notifications, no crash', async () => {
    const conn = await db();
    const pid = await makeParent(conn, '__TEST_PARENT_UNBOUND', FAMILY_PHONE);
    await approveLink(conn, pid, TEST_STUDENT_ID);
    // No line_users, no line_bindings
    await conn.end();

    const res = await request(app)
      .post('/api/driver/checkin')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });
    expect(res.status).toBe(201);

    const conn2 = await db();
    expect(await countNotifications(conn2, TEST_STUDENT_ID)).toBe(0);
    await conn2.end();
  });

  test('10. school override uses same resolver — sibling under same phone still notified', async () => {
    // School override reuses _buildCheckinTransaction, so the new resolver
    // applies. We seed sibling + family binding, then trigger an override
    // for the sibling (not the verifying child). Expect the family LINE
    // user to receive a notification — under Round 0 this was 0.
    const conn = await db();
    await makeSibling(conn);
    const pidA = await makeParent(conn, '__TEST_PARENT_OVR_A', FAMILY_PHONE);
    const pidB = await makeParent(conn, '__TEST_PARENT_OVR_B', FAMILY_PHONE);
    await approveLink(conn, pidA, TEST_STUDENT_ID);
    await approveLink(conn, pidB, SIBLING_STUDENT_ID);
    await makeLineUser(conn, FAMILY_LINE_ID, pidA, true);   // dual-write to A only
    await makeBinding(conn, FAMILY_PHONE, FAMILY_LINE_ID, true);
    await conn.end();

    // Use the school override endpoint as the schoolOverride.test.js does
    const schoolLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: '__test_school', password: 'testpass123' });
    const schoolToken = schoolLogin.body.data.access_token;

    const res = await request(app)
      .post('/api/school/checkin-override')
      .set('Authorization', `Bearer ${schoolToken}`)
      .send({
        student_id: SIBLING_STUDENT_ID,
        session: 'morning',
        status: 'CHECKED_IN',
        reason: 'Phase 10.9B sibling-notification test',
      });
    expect(res.status).toBe(201);

    const conn2 = await db();
    const rows = await notificationsFor(conn2, SIBLING_STUDENT_ID);
    await conn2.end();
    expect(rows.length).toBe(1);
    expect(rows[0].target_line_user_id).toBe(FAMILY_LINE_ID);
  });
});
