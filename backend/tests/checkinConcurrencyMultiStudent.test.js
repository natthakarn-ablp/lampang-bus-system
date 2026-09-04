'use strict';

/**
 * checkinConcurrencyMultiStudent.test.js  (CS5-04 — regression, round 2)
 *
 * INTEGRATION — needs the disposable lampang_bus_test DB. Never run on the prod box.
 *
 * Why this file exists even though tests/checkinEmergencyConcurrency.test.js
 * already fires parallel check-ins: that file fires at most 5 requests at ONE
 * student. Every one of them wants the same students row, so they serialise
 * cleanly and no two transactions ever hold a lock the other is waiting for. The
 * failure reproduced here needs concurrency across DIFFERENT students, where the
 * per-student transactions overlap in the SAME index gap of checkin_logs.
 *
 * Two shapes, both of which have been observed to lose a boarding:
 *
 *   1. 40 simultaneous single check-ins — two taps each across 20 different
 *      students. That is one busload of children at 07:00 with a driver whose
 *      finger bounces, not a load test. Measured on a laptop against this same
 *      database: 33 of 40 requests failed with ER_LOCK_DEADLOCK and 14 of the 20
 *      children ended the run with NO checkin_logs row at all. ER_LOCK_DEADLOCK
 *      carries no `statusCode`, so middleware/errorHandler.js maps it to HTTP
 *      500 — the driver sees a red error and the boarding is silently not
 *      recorded. A duplicate is visible and correctable; a lost boarding is not.
 *
 *   2. "เช็คอินทั้งคัน" (checkin-all) racing individual taps. The batch runs every
 *      student inside ONE long transaction, so under REPEATABLE READ its read
 *      view is opened at the first student and every later duplicate check
 *      answers from that stale snapshot — a tap that committed in between is
 *      invisible, and the batch writes a second boarding for a child who already
 *      has one.
 *
 * The assertion is the same for both, and it is the thing that actually matters
 * to a parent: once the dust settles every child on the bus has EXACTLY ONE
 * CHECKED_IN row for the session — not two, and not zero — and no request failed
 * with anything other than the duplicate rejection.
 *
 * Fixtures are a vehicle of this file's own (__TEST PLATE 9998) so the shared
 * V-test000000ab roster the rest of the suite depends on is left untouched.
 */

require('dotenv').config();
const bcrypt  = require('bcrypt');
const request = require('supertest');
const { getTestConnection } = require('./dbHelper');
const app = require('../src/app');

const PLATE       = '__TEST PLATE 9998';
const NORM_PLATE  = '__testplate9998';
const VEHICLE_ID  = 'V-test000000cc';
const DRIVER_NAME = '__Test Driver CS504';
const SCHOOL_ID   = '__TSCH';
const TERM_ID     = '2568-2';

const FIRST_ID = 99900;
const N        = 20;
const LAST_ID  = FIRST_ID + N - 1;
const IDS      = Array.from({ length: N }, (_, i) => FIRST_ID + i);

let token = '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checkin = (studentId, session = 'morning') => request(app)
  .post('/api/driver/checkin')
  .set('Authorization', `Bearer ${token}`)
  .send({ student_id: studentId, session });

const checkinAll = (session = 'morning') => request(app)
  .post('/api/driver/checkin-all')
  .set('Authorization', `Bearer ${token}`)
  .send({ session });

// ─── fixtures ────────────────────────────────────────────────────────────────

async function seedFixtures() {
  const conn = await getTestConnection();
  const hash = await bcrypt.hash('testpass123', 12);

  await conn.query(
    `INSERT INTO vehicles (id, plate_no, normalized_plate, vehicle_type)
     VALUES (?, ?, ?, 'รถตู้')
     ON DUPLICATE KEY UPDATE plate_no = VALUES(plate_no), normalized_plate = VALUES(normalized_plate)`,
    [VEHICLE_ID, PLATE, NORM_PLATE]
  );

  await conn.query(
    `INSERT INTO drivers (name, phone) VALUES (?, '0000000002')
     ON DUPLICATE KEY UPDATE phone = VALUES(phone)`,
    [DRIVER_NAME]
  );
  const [[driver]] = await conn.query('SELECT id FROM drivers WHERE name = ? LIMIT 1', [DRIVER_NAME]);

  await conn.query(
    `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name)
     VALUES (?, ?, 'driver', NULL, NULL, ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    [PLATE, hash, PLATE]
  );

  await conn.query(
    `INSERT INTO driver_vehicle_assignments (driver_id, vehicle_id, term_id, start_date, is_active)
     VALUES (?, ?, ?, CURDATE(), TRUE)
     ON DUPLICATE KEY UPDATE is_active = TRUE`,
    [driver.id, VEHICLE_ID, TERM_ID]
  );

  for (const id of IDS) {
    await conn.query(
      `INSERT INTO students
         (id, cid_hash, prefix, first_name, last_name, grade, classroom,
          school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
       VALUES (?, SHA2(?, 256), 'เด็กชาย', ?, '__Concurrency', 'ป.1', '1', ?, ?, TRUE, TRUE, ?)
       ON DUPLICATE KEY UPDATE vehicle_id = VALUES(vehicle_id), is_deleted = FALSE`,
      [id, `__cs504-cid-${id}`, `__C${id}`, SCHOOL_ID, VEHICLE_ID, TERM_ID]
    );
  }

  await conn.end();
}

async function resetToday() {
  const conn = await getTestConnection();
  await conn.query(
    `DELETE FROM audit_logs
      WHERE entity_type = 'checkin'
        AND CAST(JSON_EXTRACT(new_value, '$.studentId') AS UNSIGNED) BETWEEN ? AND ?`,
    [FIRST_ID, LAST_ID]
  );
  await conn.query('DELETE FROM notifications WHERE student_id BETWEEN ? AND ?', [FIRST_ID, LAST_ID]);
  await conn.query('DELETE FROM checkin_logs  WHERE student_id BETWEEN ? AND ?', [FIRST_ID, LAST_ID]);
  await conn.query('DELETE FROM daily_status  WHERE student_id BETWEEN ? AND ?', [FIRST_ID, LAST_ID]);
  await conn.end();
}

async function dropFixtures() {
  const conn = await getTestConnection();
  await conn.query('DELETE FROM students WHERE id BETWEEN ? AND ?', [FIRST_ID, LAST_ID]);
  await conn.query('DELETE FROM driver_vehicle_assignments WHERE vehicle_id = ?', [VEHICLE_ID]);
  await conn.query('DELETE FROM users    WHERE username = ?', [PLATE]);
  await conn.query('DELETE FROM drivers  WHERE name = ?',     [DRIVER_NAME]);
  await conn.query('DELETE FROM vehicles WHERE id = ?',       [VEHICLE_ID]);
  await conn.end();
}

/** Which of the 20 children ended the run with no boarding, and which with two. */
async function boardingsBySession(session) {
  const conn = await getTestConnection();
  const [rows] = await conn.query(
    `SELECT student_id, COUNT(*) AS n
       FROM checkin_logs
      WHERE student_id BETWEEN ? AND ?
        AND check_date = CURDATE() AND session = ? AND status = 'CHECKED_IN'
      GROUP BY student_id`,
    [FIRST_ID, LAST_ID, session]
  );
  await conn.end();
  const byId = new Map(rows.map((r) => [Number(r.student_id), Number(r.n)]));
  return {
    missing:    IDS.filter((id) => !byId.has(id)),
    duplicated: IDS.filter((id) => (byId.get(id) || 0) > 1)
                   .map((id) => `${id} has ${byId.get(id)} rows`),
  };
}

/**
 * Anything that is not 201 (recorded) or 409 (duplicate rejected) is an error the
 * driver sees. Report the bodies so a failure names its cause, not just a count.
 */
function unexpectedResponses(responses) {
  return responses
    .filter((r) => r.status !== 201 && r.status !== 409)
    .map((r) => `${r.status} ${JSON.stringify(r.body && r.body.message)}`);
}

beforeAll(async () => {
  await seedFixtures();
  const res = await request(app).post('/api/auth/login')
    .send({ username: PLATE, password: 'testpass123' });
  token = res.body.data?.access_token || '';
  expect(token).toBeTruthy();
}, 60000);

beforeEach(resetToday);

afterAll(async () => {
  await resetToday();
  await dropFixtures();
});

describe('CS5-04 — check-in under concurrency across DIFFERENT students', () => {
  test('40 simultaneous check-ins (2 taps x 20 students) record exactly one boarding each', async () => {
    const calls = [];
    for (const id of IDS) { calls.push(checkin(id)); calls.push(checkin(id)); }
    const responses = await Promise.all(calls);

    // A deadlock surfaces here as HTTP 500 and the boarding is simply not written.
    expect(unexpectedResponses(responses)).toEqual([]);
    expect(responses.filter((r) => r.status === 201)).toHaveLength(N);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(N);

    // ...and the duplicate guard must still have rejected every second tap.
    const { missing, duplicated } = await boardingsBySession('morning');
    expect({ missing, duplicated }).toEqual({ missing: [], duplicated: [] });
  }, 60000);

  test('checkin-all racing individual taps records exactly one boarding each', async () => {
    // Three rounds: the batch opens its read view at its first student, so
    // whether a single tap lands inside the stale window is timing-dependent.
    for (let round = 0; round < 3; round++) {
      await resetToday();

      const responses = [];
      const batch = checkinAll('evening').then((r) => { responses.push(r); return r; });
      const taps  = IDS.slice(4).map((id, i) =>
        sleep(3 + i * 2).then(() => checkin(id, 'evening')).then((r) => { responses.push(r); })
      );
      const [batchRes] = await Promise.all([batch, ...taps]);

      // A per-student deadlock inside the batch is swallowed into `failed` by the
      // SAVEPOINT wrapper, so it never reaches the HTTP status — look for it there.
      const deadlocked = (batchRes.body.data?.failed || [])
        .filter((f) => /deadlock/i.test(f.error || ''));

      expect({ round, unexpected: unexpectedResponses(responses), deadlocked })
        .toEqual({ round, unexpected: [], deadlocked: [] });

      const { missing, duplicated } = await boardingsBySession('evening');
      expect({ round, missing, duplicated }).toEqual({ round, missing: [], duplicated: [] });
    }
  }, 120000);

  test('control — 5 simultaneous taps at ONE student still collapse to one row', async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => checkin(FIRST_ID)));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(4);
  });

  test('control — a sequential double-tap still answers 201 then 409', async () => {
    expect((await checkin(FIRST_ID)).status).toBe(201);
    const second = await checkin(FIRST_ID);
    expect(second.status).toBe(409);
    expect(second.body.message).toBe('รายการนี้ถูกบันทึกไปแล้ว');
  });
});
