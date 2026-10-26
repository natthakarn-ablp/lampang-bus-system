'use strict';

/**
 * CS5-02 — a vehicle's insurance_expiry must survive a save that never
 * touches the date field.
 *
 * The defect was a three-link chain, and only the round trip exposes it:
 *
 *   1. `school.service.getVehicles()` returned the raw DATE. mysql2 parses a
 *      DATE against the connection timezone (+07:00), so 2026-08-05 becomes
 *      the instant 2026-08-04T17:00:00.000Z once JSON.stringify runs.
 *   2. `VehicleList.jsx` prefills the edit form with
 *      `String(v.insurance_expiry).slice(0, 10)` — the first ten characters
 *      of that instant are the PREVIOUS day.
 *   3. `PUT /vehicles/:id` stores what it was handed.
 *
 * Each link is defensible alone; together they walk the date backwards one
 * day per save, silently, on the column `computeEligibility` uses to decide
 * whether a bus is roadworthy.
 *
 * This is why the test drives the whole loop over real HTTP and applies the
 * UI's own transformation verbatim. A test that only asserted on the service
 * response would have passed throughout the life of the bug: the service was
 * returning a correct instant, and the corruption only appeared once that
 * instant was read as a calendar date and written back.
 */

require('dotenv').config();
const request = require('supertest');
const { getTestConnection } = require('./dbHelper');
const app = require('../src/app');
const schoolSvc = require('../src/services/school.service');

const SCHOOL = { username: '__test_school', password: 'testpass123' };
const VEHICLE_ID = 'V-test000000ab';
const SCHOOL_ID = '__TSCH';

// A date whose Bangkok midnight falls on the previous UTC day — i.e. any
// date at all. Fixed rather than derived so a failure names a real value.
const STORED_DATE = '2026-08-05';

let schoolToken = '';
let originalExpiry = null;

/**
 * The exact expression `frontend/src/pages/school/VehicleList.jsx` uses to
 * prefill the edit form (openEdit, line 47). Copied verbatim on purpose: if
 * the UI's transformation changes, this test should be updated in step, and
 * until then it must keep testing what the UI actually does — not a
 * charitable paraphrase of it.
 */
function uiEditFormValue(apiValue) {
  return apiValue ? String(apiValue).slice(0, 10) : '';
}

async function readStoredExpiry(conn) {
  // Read the DATE as a string so the assertion compares calendar dates and
  // cannot itself be shifted by the driver's timezone handling.
  const [[row]] = await conn.query(
    'SELECT DATE_FORMAT(insurance_expiry, ?) AS expiry FROM vehicles WHERE id = ?',
    ['%Y-%m-%d', VEHICLE_ID]
  );
  return row ? row.expiry : null;
}

beforeAll(async () => {
  const res = await request(app).post('/api/auth/login').send(SCHOOL);
  schoolToken = res.body.data.access_token;

  const conn = await getTestConnection();
  originalExpiry = await readStoredExpiry(conn);
  await conn.query('UPDATE vehicles SET insurance_expiry = ? WHERE id = ?', [STORED_DATE, VEHICLE_ID]);
  await conn.end();
});

afterAll(async () => {
  const conn = await getTestConnection();
  await conn.query('UPDATE vehicles SET insurance_expiry = ? WHERE id = ?', [originalExpiry, VEHICLE_ID]);
  await conn.end();
});

describe('CS5-02 — insurance_expiry survives an edit that leaves the date alone', () => {
  test('the vehicle fixture is visible to the school (guards against a vacuous pass)', async () => {
    const res = await request(app)
      .get('/api/school/vehicles')
      .set('Authorization', `Bearer ${schoolToken}`);

    expect(res.status).toBe(200);
    const vehicle = res.body.data.find((v) => v.id === VEHICLE_ID);
    // Without this the round-trip test below could pass by finding nothing
    // to corrupt.
    expect(vehicle).toBeDefined();
    expect(vehicle.insurance_expiry).toBeTruthy();
  });

  test('the API emits a calendar date, not an instant', async () => {
    const res = await request(app)
      .get('/api/school/vehicles')
      .set('Authorization', `Bearer ${schoolToken}`);

    const vehicle = res.body.data.find((v) => v.id === VEHICLE_ID);
    expect(vehicle.insurance_expiry).toBe(STORED_DATE);
    // The specific shape that caused the bug: an instant seven hours behind
    // Bangkok midnight, which slices to the previous day.
    expect(String(vehicle.insurance_expiry)).not.toMatch(/T\d{2}:\d{2}/);
  });

  test('the value the edit form prefills equals the value in the database', async () => {
    const res = await request(app)
      .get('/api/school/vehicles')
      .set('Authorization', `Bearer ${schoolToken}`);

    const vehicle = res.body.data.find((v) => v.id === VEHICLE_ID);
    expect(uiEditFormValue(vehicle.insurance_expiry)).toBe(STORED_DATE);
  });

  test('three consecutive saves that never touch the date leave it unchanged', async () => {
    const conn = await getTestConnection();
    try {
      expect(await readStoredExpiry(conn)).toBe(STORED_DATE);

      for (let round = 1; round <= 3; round += 1) {
        // 1. Read, exactly as the list page does on mount.
        const listRes = await request(app)
          .get('/api/school/vehicles')
          .set('Authorization', `Bearer ${schoolToken}`);
        expect(listRes.status).toBe(200);
        const v = listRes.body.data.find((x) => x.id === VEHICLE_ID);

        // 2. Build the edit form, exactly as openEdit() does.
        const editForm = {
          vehicle_type:     v.vehicle_type || '',
          owner_name:       v.owner_name || '',
          owner_phone:      v.owner_phone || '',
          insurance_status: v.insurance_status || '',
          insurance_type:   v.insurance_type || '',
          insurance_expiry: uiEditFormValue(v.insurance_expiry),
        };

        // 3. Save the whole form back, exactly as handleSaveEdit() does —
        //    the user changed nothing.
        const putRes = await request(app)
          .put(`/api/school/vehicles/${VEHICLE_ID}`)
          .set('Authorization', `Bearer ${schoolToken}`)
          .send(editForm);
        expect(putRes.status).toBe(200);

        // 4. The date must not have moved. Before the fix this failed on
        //    round 1 with '2026-08-04', then drifted one day per round.
        expect(await readStoredExpiry(conn)).toBe(STORED_DATE);
      }
    } finally {
      await conn.end();
    }
  });

  test('the service layer returns insurance_expiry as a calendar date string', async () => {
    const vehicles = await schoolSvc.getVehicles(SCHOOL_ID);
    const vehicle = vehicles.find((v) => v.id === VEHICLE_ID);

    expect(vehicle).toBeDefined();
    expect(typeof vehicle.insurance_expiry).toBe('string');
    expect(vehicle.insurance_expiry).toBe(STORED_DATE);
  });

  test('an instant-shaped date sent by a client is stored as its Bangkok calendar date', async () => {
    const conn = await getTestConnection();
    try {
      // A stale frontend bundle (or any other client) can still send the old
      // instant shape. The write boundary must land it on 2026-08-05, not on
      // the UTC day 2026-08-04 that its first ten characters spell.
      const putRes = await request(app)
        .put(`/api/school/vehicles/${VEHICLE_ID}`)
        .set('Authorization', `Bearer ${schoolToken}`)
        .send({ insurance_expiry: '2026-08-04T17:00:00.000Z' });
      expect(putRes.status).toBe(200);

      expect(await readStoredExpiry(conn)).toBe(STORED_DATE);
    } finally {
      await conn.end();
    }
  });

  test('the audit trail records the old date as a calendar date', async () => {
    const conn = await getTestConnection();
    try {
      await conn.query('UPDATE vehicles SET insurance_expiry = ? WHERE id = ?', [STORED_DATE, VEHICLE_ID]);

      const putRes = await request(app)
        .put(`/api/school/vehicles/${VEHICLE_ID}`)
        .set('Authorization', `Bearer ${schoolToken}`)
        .send({ insurance_expiry: '2026-12-31' });
      expect(putRes.status).toBe(200);

      const [[row]] = await conn.query(
        `SELECT old_value, new_value FROM audit_logs
          WHERE entity_type = 'vehicle' AND entity_id = ? AND action = 'UPDATE'
          ORDER BY id DESC LIMIT 1`,
        [VEHICLE_ID]
      );
      const oldValue = typeof row.old_value === 'string' ? JSON.parse(row.old_value) : row.old_value;
      const newValue = typeof row.new_value === 'string' ? JSON.parse(row.new_value) : row.new_value;

      // An audit row that says the old value was 2026-08-04T17:00:00.000Z
      // cannot be used to prove what the value had been.
      expect(oldValue.insurance_expiry).toBe(STORED_DATE);
      expect(newValue.insurance_expiry).toBe('2026-12-31');

      await conn.query('UPDATE vehicles SET insurance_expiry = ? WHERE id = ?', [STORED_DATE, VEHICLE_ID]);
    } finally {
      await conn.end();
    }
  });
});
