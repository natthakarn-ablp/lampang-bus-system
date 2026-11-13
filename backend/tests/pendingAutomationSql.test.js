'use strict';

/**
 * pendingAutomationSql.test.js — INTEGRATION (disposable lampang_bus_test DB).
 * Runs every new query against real MySQL so a column/collation mistake fails
 * here instead of on the server's first cron run. Read-only: dry-run paths only.
 */

require('dotenv').config();
const { getTestConnection } = require('./dbHelper');
const env = require('../src/config/env');
const pending = require('../src/services/pendingQueue.service');
const ops = require('../src/services/opsWatch.service');
const snap = require('../src/services/dailySnapshot.service');
const verification = require('../src/services/vehicleVerification.service');

let conn;
let savedFlag;
beforeAll(async () => {
  conn = await getTestConnection();
  savedFlag = env.features.driverRegistration;
  // tests/schema.sql predates migrations 044/045 (registration roster,
  // documents), so the two flag-gated queues are left out here; their SQL
  // follows the same columns the registration service already queries.
  env.features.driverRegistration = false;
});
afterAll(async () => {
  env.features.driverRegistration = savedFlag;
  if (conn) await conn.end();
});

describe('pending queues SQL', () => {
  test.each([
    ['school', 'SCH0001'],
    ['affiliation', '1'],
    ['province', null],
    ['transport', null],
    ['admin', null],
  ])('getSummary(%s) runs every queue query', async (role, scopeId) => {
    const out = await pending.getSummary(conn, { role, scopeId }, { detail: true });
    expect(out.role).toBe(role);
    expect(Number.isInteger(out.total)).toBe(true);
  });

  test('cron dry-run computes alerts without writing', async () => {
    const [[before]] = await conn.query("SELECT COUNT(*) n FROM audit_logs WHERE entity_type = 'pending_alert'");
    const r = await pending.runOnce({ db: conn, dryRun: true });
    expect(r.considered).toBeGreaterThanOrEqual(r.created.length);
    const [[after]] = await conn.query("SELECT COUNT(*) n FROM audit_logs WHERE entity_type = 'pending_alert'");
    expect(after.n).toBe(before.n);
  });
});

describe('other automation SQL', () => {
  test('stuck applications list (transport + affiliation scope)', async () => {
    expect(Array.isArray(await verification.listStuckApplications(conn, { role: 'transport' }))).toBe(true);
    expect(Array.isArray(await verification.listStuckApplications(conn, { role: 'affiliation', affiliationId: '1' }))).toBe(true);
  });

  test('ops alerts listing', async () => {
    expect(Array.isArray(await ops.listRecentAlerts(conn))).toBe(true);
  });

  test('daily snapshot dry-run computes metrics', async () => {
    const r = await snap.runDailySnapshot(conn, { date: '2001-01-01', dryRun: true });
    expect(r.status).toBe('DRY_RUN');
    expect(r.metrics).toHaveProperty('total_students');
  });
});
