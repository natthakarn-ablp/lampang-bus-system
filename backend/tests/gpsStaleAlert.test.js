'use strict';

/**
 * gpsStaleAlert.test.js — INTEGRATION (needs the disposable lampang_bus_test DB;
 * globalSetup seeds the __TEST vehicle + student 99999). Never run on prod.
 *
 * Proves the SQL in gpsStaleAlert.service against real MySQL: the on-board
 * query (latest log per student), the age arithmetic on vehicle_location_history,
 * the audit_logs dedupe row (action ROUTE_DEVIATION), and that a voided boarding
 * ends the round. The LINE push is a jest mock — nothing leaves the machine.
 */

require('dotenv').config();
const { getTestConnection } = require('./dbHelper');
const svc = require('../src/services/gpsStaleAlert.service');

const VEHICLE_ID = 'V-test000000ab';
const STUDENT_ID = 99999;
const NOW = new Date();
const SESSION = svc.currentSession(NOW);
const OVERRIDES = { thresholdMin: 20, radiusM: 75 };

async function q(sql, params = []) {
  const conn = await getTestConnection();
  try { return (await conn.query(sql, params))[0]; } finally { await conn.end(); }
}

async function cleanup() {
  await q('DELETE FROM checkin_logs WHERE vehicle_id = ? AND check_date = CURDATE()', [VEHICLE_ID]);
  await q('DELETE FROM vehicle_location_history WHERE vehicle_id = ?', [VEHICLE_ID]);
  await q('DELETE FROM audit_logs WHERE entity_type = ? AND entity_id LIKE ?', [svc.ENTITY_TYPE, `${VEHICLE_ID}:%`]);
}

async function board({ minutesAgo = 40, status = 'CHECKED_IN' } = {}) {
  await q(
    `INSERT INTO checkin_logs (vehicle_id, plate_no, student_id, student_name, session, status, check_date, checked_at, source)
     VALUES (?, '__TEST', ?, '__TEST', ?, ?, CURDATE(), DATE_SUB(NOW(), INTERVAL ? MINUTE), 'web')`,
    [VEHICLE_ID, STUDENT_ID, SESSION, status, minutesAgo],
  );
}

async function fixesAt(lat, lng, fromMin, toMin) {
  for (let m = fromMin; m >= toMin; m -= 1) {
    await q(
      `INSERT INTO vehicle_location_history (vehicle_id, latitude, longitude, recorded_at)
       VALUES (?, ?, ?, DATE_SUB(NOW(3), INTERVAL ? SECOND))`,
      [VEHICLE_ID, lat, lng, m * 60],
    );
  }
}

const onlyTestVehicle = (r) => ({
  alerts: r.alerts.filter((a) => a.vehicleId === VEHICLE_ID),
  skipped: r.skipped.filter((s) => s.vehicleId === VEHICLE_ID),
});

beforeEach(cleanup);
afterAll(cleanup);

test('child on board + same spot for 30 min → one STUCK alert, recorded once', async () => {
  await board();
  // 30 min ago → 5 min ago the bus drove; from 25 min ago it sits still
  await fixesAt(18.2800, 99.4800, 35, 26);
  await fixesAt(18.2888, 99.4908, 25, 0);

  const push = jest.fn().mockResolvedValue({ sent: true });
  const first = onlyTestVehicle(await svc.runOnce({ apply: true, now: NOW, push, overrides: OVERRIDES }));
  expect(first.alerts).toHaveLength(1);
  expect(first.alerts[0]).toMatchObject({ kind: 'STUCK', delivery: 'sent' });
  expect(push).toHaveBeenCalledTimes(1);
  expect(push.mock.calls[0][0]).toContain('ตำแหน่งรถไม่เปลี่ยนเกิน 20 นาที');

  const rows = await q('SELECT action, entity_id, new_value FROM audit_logs WHERE entity_type = ?', [svc.ENTITY_TYPE]);
  const mine = rows.filter((r) => r.entity_id.startsWith(VEHICLE_ID));
  expect(mine).toHaveLength(1);
  expect(mine[0].action).toBe('ROUTE_DEVIATION');

  const second = onlyTestVehicle(await svc.runOnce({ apply: true, now: NOW, push, overrides: OVERRIDES }));
  expect(second.alerts).toHaveLength(0);
  expect(second.skipped[0]).toMatchObject({ reason: 'ALREADY_ALERTED' });
  expect(push).toHaveBeenCalledTimes(1);
});

test('GPS stopped 25 minutes ago → NO_SIGNAL', async () => {
  await board();
  await fixesAt(18.2800, 99.4800, 40, 25);
  const push = jest.fn().mockResolvedValue({ sent: true });
  const r = onlyTestVehicle(await svc.runOnce({ apply: true, now: NOW, push, overrides: OVERRIDES }));
  expect(r.alerts[0]).toMatchObject({ kind: 'NO_SIGNAL', delivery: 'sent' });
});

test('voided boarding (latest row CANCELLED) ends the round → not checked at all', async () => {
  await board({ minutesAgo: 40 });
  await board({ minutesAgo: 30, status: 'CANCELLED' });
  await fixesAt(18.2888, 99.4908, 30, 0);
  const push = jest.fn();
  const r = onlyTestVehicle(await svc.runOnce({ apply: true, now: NOW, push, overrides: OVERRIDES }));
  expect(r.alerts).toHaveLength(0);
  expect(r.skipped).toHaveLength(0);
  expect(push).not.toHaveBeenCalled();
});

test('round ended (CHECKED_OUT is the latest) → not checked', async () => {
  await board({ minutesAgo: 40 });
  await board({ minutesAgo: 10, status: 'CHECKED_OUT' });
  await fixesAt(18.2888, 99.4908, 30, 0);
  const push = jest.fn();
  const r = onlyTestVehicle(await svc.runOnce({ apply: true, now: NOW, push, overrides: OVERRIDES }));
  expect(r.alerts).toHaveLength(0);
  expect(push).not.toHaveBeenCalled();
});

test('child on board but the driver never started GPS → no alert', async () => {
  await board();
  const push = jest.fn();
  const r = onlyTestVehicle(await svc.runOnce({ apply: true, now: NOW, push, overrides: OVERRIDES }));
  expect(r.skipped[0]).toMatchObject({ reason: 'NO_GPS_THIS_ROUND' });
  expect(push).not.toHaveBeenCalled();
});
