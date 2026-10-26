'use strict';

/**
 * emergencyConcurrencyMultiReporter.test.js  (CS5-04 — regression, round 2)
 *
 * INTEGRATION — needs the disposable lampang_bus_test DB. Never run on the prod box.
 *
 * tests/checkinEmergencyConcurrency.test.js already fires three simultaneous
 * emergency reports, but all three come from ONE driver. They all want the same
 * users row, so they serialise and no two transactions ever hold a lock the other
 * needs. The failure reproduced here needs DIFFERENT reporters at the same
 * moment — a real event on a real route (a crash, a flood, a road closed) is
 * reported by several drivers within the same few seconds, and that is exactly
 * when this service must not drop anything.
 *
 * The defect: the dedupe read was `SELECT ... FOR UPDATE`, and under REPEATABLE
 * READ a locking read that matches no row takes a gap lock. On the first tap it
 * matches nothing, so every reporter's gap lock lands in the same empty range of
 * emergency_logs, and the INSERT that follows wants an insert-intention lock
 * inside a gap someone else holds. Measured against this database before the
 * remedy: at 3 simultaneous reporters, 2 of 15 emergency reports were lost to
 * ER_LOCK_DEADLOCK; at 20 reporters, 44 of 100 were. ER_LOCK_DEADLOCK carries no
 * `statusCode`, so middleware/errorHandler.js maps it to HTTP 500 — the driver
 * sees a red error and the emergency is not recorded, not pushed to the school
 * group, and not audited.
 *
 * A duplicate emergency card is noise. A dropped one is the failure this whole
 * service exists to prevent, so the assertion below is that EVERY reporter ends
 * with exactly one row: none lost, none duplicated.
 *
 * Driven at the service layer because that is where both the guard and the
 * defect live; the route is a thin wrapper that passes the pool straight in.
 */

require('dotenv').config();
const { getTestConnection, getTestPool } = require('./dbHelper');
const { createEmergencyReport } = require('../src/services/emergency.service');

const PREFIX    = '__cs504_em_';
const REPORTERS = 8;
const TAPS      = 2;
const ROUNDS    = 3;
const DETAIL    = '__cs504 รถชนกันหน้าโรงเรียน';

let pool;
let userIds = [];

async function seedReporters() {
  const conn = await getTestConnection();
  const ids = [];
  for (let i = 0; i < REPORTERS; i++) {
    const username = `${PREFIX}${i}`;
    await conn.query(
      `INSERT INTO users (username, password_hash, role, display_name)
       VALUES (?, 'not-a-login-account', 'driver', ?)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
      [username, username]
    );
    const [[row]] = await conn.query('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
    ids.push(Number(row.id));
  }
  await conn.end();
  return ids;
}

async function clearReports() {
  const conn = await getTestConnection();
  await conn.query('DELETE FROM emergency_logs WHERE reported_by IN (?)', [userIds]);
  await conn.end();
}

async function dropReporters() {
  const conn = await getTestConnection();
  await conn.query('DELETE FROM emergency_logs WHERE reported_by IN (?)', [userIds]);
  await conn.query('DELETE FROM users WHERE username LIKE ?', [`${PREFIX}%`]);
  await conn.end();
}

/** Which reporters ended with no report, and which with more than one. */
async function reportsPerReporter() {
  const conn = await getTestConnection();
  const [rows] = await conn.query(
    'SELECT reported_by, COUNT(*) AS n FROM emergency_logs WHERE reported_by IN (?) GROUP BY reported_by',
    [userIds]
  );
  await conn.end();
  const byId = new Map(rows.map((r) => [Number(r.reported_by), Number(r.n)]));
  return {
    lost:       userIds.filter((id) => !byId.has(id)).length,
    duplicated: userIds.filter((id) => (byId.get(id) || 0) > 1).length,
  };
}

beforeAll(async () => {
  userIds = await seedReporters();
  pool = getTestPool({ connectionLimit: 10 });
}, 60000);

beforeEach(clearReports);

afterAll(async () => {
  await dropReporters();
  if (pool) await pool.end();
});

describe('CS5-04 — emergency reports from DIFFERENT drivers at the same moment', () => {
  test('every reporter ends with exactly one report, none lost to a deadlock', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await clearReports();

      const calls = [];
      for (const id of userIds) {
        for (let t = 0; t < TAPS; t++) {
          calls.push(createEmergencyReport({ reportedBy: id, detail: DETAIL }, pool));
        }
      }
      const settled = await Promise.allSettled(calls);

      // Nothing may fail. A deadlock here is an HTTP 500 and a dropped emergency.
      const failures = settled
        .filter((s) => s.status === 'rejected')
        .map((s) => `${s.reason.code || s.reason.statusCode || '?'}: ${s.reason.message}`);
      expect({ round, failures }).toEqual({ round, failures: [] });

      // The duplicate guard must still collapse the second tap into the first.
      const created    = settled.filter((s) => s.value && !s.value.isDuplicate);
      const duplicates = settled.filter((s) => s.value && s.value.isDuplicate);
      expect({ round, created: created.length, duplicates: duplicates.length })
        .toEqual({ round, created: REPORTERS, duplicates: REPORTERS * (TAPS - 1) });

      const { lost, duplicated } = await reportsPerReporter();
      expect({ round, lost, duplicated }).toEqual({ round, lost: 0, duplicated: 0 });
    }
  }, 120000);

  test('control — a duplicate returns the id of the report it collapsed into', async () => {
    const id = userIds[0];
    const first  = await createEmergencyReport({ reportedBy: id, detail: DETAIL }, pool);
    const second = await createEmergencyReport({ reportedBy: id, detail: DETAIL }, pool);
    expect(first.isDuplicate).toBe(false);
    expect(second.isDuplicate).toBe(true);
    expect(second.id).toBe(first.id);
  });

  test('control — a genuinely different report from the same driver is still recorded', async () => {
    const id = userIds[0];
    const first  = await createEmergencyReport({ reportedBy: id, detail: DETAIL }, pool);
    const other  = await createEmergencyReport({ reportedBy: id, detail: `${DETAIL} (คนละเหตุ)` }, pool);
    expect(other.isDuplicate).toBe(false);
    expect(other.id).not.toBe(first.id);
  });
});
