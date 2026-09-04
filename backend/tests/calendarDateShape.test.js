'use strict';

/**
 * A DATE column must never leave the API as an instant.
 *
 * THE SIGNATURE
 * -------------
 * mysql2 parses a DATE against the connection timezone, which is +07:00 here.
 * A row stored as 2026-08-05 therefore arrives as a JS Date at
 * 2026-08-04T17:00:00.000Z, and JSON.stringify ships exactly that string. Any
 * client that prints it, slices the first ten characters, or feeds it to a date
 * picker reads THE DAY BEFORE. Verified directly against the sandbox: a leave
 * inserted as '2026-08-05' came back as "2026-08-04T17:00:00.000Z".
 *
 * That exact shape — midnight Bangkok expressed in UTC — is what these tests
 * look for. `T17:00:00.000Z` in a response is never a real instant anyone meant
 * to send; it is always a DATE column that escaped conversion.
 *
 * WHY A WALK OF THE WHOLE RESPONSE
 * --------------------------------
 * This bug has now been found three times in three places (school vehicles as
 * CS5-02, the transport endpoints, and student_leaves here), each time by
 * someone noticing one field. Asserting the invariant over every value of the
 * response catches the fourth one in whatever field it appears in, including
 * fields added later.
 */

require('dotenv').config();
const request = require('supertest');

const app = require('../src/app');
const { pool } = require('../src/config/database');

const SCHOOL = { username: '__test_school', password: 'testpass123' };
const DRIVER = { username: '__TEST PLATE 9999', password: 'testpass123' };
const PROVINCE = { username: '__test_province', password: 'testpass123' };
const AFFILIATION = { username: '__test_affiliation', password: 'testpass123' };
const TEST_STUDENT_ID = 99999;
const TEST_VEHICLE = 'V-test000000ab';
const LEAVE_DATE = '2026-08-05';
// The vehicle's expiry columns get a FUTURE date. A past one makes the vehicle
// ineligible, and deleteInspection below recomputes and WRITES
// vehicles.verification_status — which every check-in suite in this repository
// reads from the same fixture vehicle. Seeding an expired date here failed four
// unrelated suites, but only in the orderings where this file ran first.
const VEHICLE_EXPIRY = '2027-08-05';

/** Midnight Bangkok rendered as UTC — the fingerprint of an unconverted DATE. */
const SHIFTED_DATE = /^\d{4}-\d{2}-\d{2}T17:00:00\.000Z$/;

let schoolToken = '';
let driverToken = '';
// Restored in afterAll: this file must hand the fixture vehicle back exactly as
// it found it, verification columns included.
let vehicleBefore = null;
let provinceToken = '';
let affiliationToken = '';

/** A well-formed calendar date. Counted so the probe cannot pass vacuously. */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

function calendarValues(value) {
  if (typeof value === 'string') return CALENDAR_DATE.test(value) ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((n, v) => n + calendarValues(v), 0);
  if (value && typeof value === 'object') {
    return Object.values(value).reduce((n, v) => n + calendarValues(v), 0);
  }
  return 0;
}

function shiftedValues(value, path = '$') {
  if (typeof value === 'string') return SHIFTED_DATE.test(value) ? [`${path} = ${value}`] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => shiftedValues(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => shiftedValues(v, `${path}.${k}`));
  }
  return [];
}

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  expect(`login ${creds.username} -> ${res.status}`).toBe(`login ${creds.username} -> 200`);
  return res.body.data.access_token;
}

beforeAll(async () => {
  schoolToken = await login(SCHOOL);
  driverToken = await login(DRIVER);
  provinceToken = await login(PROVINCE);
  affiliationToken = await login(AFFILIATION);

  await pool.query('DELETE FROM student_leaves WHERE student_id = ?', [TEST_STUDENT_ID]);
  await pool.query(
    `INSERT INTO student_leaves (student_id, vehicle_id, leave_date, session, reason, reported_by, reported_role)
     VALUES (?, ?, ?, 'morning', 'date-shape probe', 1, 'school')`,
    [TEST_STUDENT_ID, TEST_VEHICLE, LEAVE_DATE]
  );

  // setup.js creates the fixture vehicle with every DATE column NULL, so the
  // vehicle probes below would read nothing and pass without checking anything —
  // the same vacuous pass that /api/school/daily-status produced by 404ing.
  const [[snapshot]] = await pool.query(
    `SELECT insurance_expiry, registration_expiry, compulsory_insurance_expiry,
            tax_expiry, verification_status, verification_reasons_json
       FROM vehicles WHERE id = ?`,
    [TEST_VEHICLE]
  );
  vehicleBefore = snapshot;
  await pool.query(
    `UPDATE vehicles
        SET insurance_expiry = ?, registration_expiry = ?,
            compulsory_insurance_expiry = ?, tax_expiry = ?
      WHERE id = ?`,
    [VEHICLE_EXPIRY, VEHICLE_EXPIRY, VEHICLE_EXPIRY, VEHICLE_EXPIRY, TEST_VEHICLE]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM student_leaves WHERE student_id = ?', [TEST_STUDENT_ID]);
  // Every column this file touched, directly or through
  // refreshVehicleEligibility, which deleteInspection calls and which rewrites
  // verification_status from whatever the expiry columns say at that moment.
  if (vehicleBefore) {
    await pool.query(
      `UPDATE vehicles
          SET insurance_expiry = ?, registration_expiry = ?,
              compulsory_insurance_expiry = ?, tax_expiry = ?,
              verification_status = ?, verification_reasons_json = ?
        WHERE id = ?`,
      [
        vehicleBefore.insurance_expiry, vehicleBefore.registration_expiry,
        vehicleBefore.compulsory_insurance_expiry, vehicleBefore.tax_expiry,
        vehicleBefore.verification_status, vehicleBefore.verification_reasons_json,
        TEST_VEHICLE,
      ]
    );
  }
});

const TOKENS = () => ({
  school: schoolToken, driver: driverToken, province: provinceToken, affiliation: affiliationToken,
});
const get = (path, token) => request(app).get(path).set('Authorization', `Bearer ${token}`);

describe('DATE columns leave the API as calendar dates', () => {
  it('stores and returns the same day for a student leave (school view)', async () => {
    const res = await get(`/api/school/leaves?date=${LEAVE_DATE}`, schoolToken);
    expect(`school leaves -> ${res.status}`).toBe('school leaves -> 200');

    const rows = res.body.data.leaves || res.body.data;
    const mine = (Array.isArray(rows) ? rows : []).find((r) => r.student_id === TEST_STUDENT_ID);
    expect(`found the seeded leave: ${!!mine}`).toBe('found the seeded leave: true');
    expect(`leave_date: ${mine.leave_date}`).toBe(`leave_date: ${LEAVE_DATE}`);
  });

  it('stores and returns the same day for a student leave (driver view)', async () => {
    const res = await get(`/api/driver/leaves?date=${LEAVE_DATE}`, driverToken);
    expect(`driver leaves -> ${res.status}`).toBe('driver leaves -> 200');

    const rows = res.body.data.leaves || res.body.data;
    const mine = (Array.isArray(rows) ? rows : []).find((r) => r.student_id === TEST_STUDENT_ID);
    expect(`found the seeded leave: ${!!mine}`).toBe('found the seeded leave: true');
    expect(`leave_date: ${mine.leave_date}`).toBe(`leave_date: ${LEAVE_DATE}`);
  });

  it('emits no shifted date anywhere in these responses', async () => {
    const probes = [
      ['school', `/api/school/leaves?date=${LEAVE_DATE}`],
      ['school', '/api/school/vehicles'],
      ['school', '/api/school/status-today'],
      ['school', '/api/school/students?per_page=20'],
      ['school', '/api/school/dashboard'],
      ['school', '/api/school/vehicles/all'],
      ['school', '/api/school/roster-requests'],
      ['driver', `/api/driver/leaves?date=${LEAVE_DATE}`],
      ['driver', '/api/driver/roster'],
      ['driver', '/api/driver/status-today'],
      ['driver', '/api/driver/profile'],
      ['driver', '/api/driver/pretrip-status'],
      // The wider surface. This bug has appeared in school, transport and leave
      // code; the roles that read across schools see the same columns through
      // different queries, so each one is its own chance to miss a conversion.
      ['province', '/api/province/dashboard'],
      ['province', '/api/province/schools?per_page=20'],
      ['province', '/api/province/students?per_page=20'],
      ['province', '/api/province/vehicles?per_page=20'],
      ['province', '/api/province/vehicles-at-risk?limit=10'],
      ['province', '/api/province/status-today'],
      ['province', '/api/province/trend?days=7'],
      ['province', '/api/province/emergencies'],
      ['province', '/api/province/audit-logs'],
      ['affiliation', '/api/affiliation/dashboard'],
      ['affiliation', '/api/affiliation/schools'],
      ['affiliation', '/api/affiliation/students?per_page=20'],
      ['affiliation', '/api/affiliation/vehicles?per_page=20'],
      ['affiliation', '/api/affiliation/vehicles-at-risk?limit=10'],
      ['affiliation', '/api/affiliation/status-today'],
      ['affiliation', '/api/affiliation/missing?session=morning'],
      ['affiliation', '/api/affiliation/emergencies'],
      ['affiliation', '/api/affiliation/audit-logs'],
      ['affiliation', '/api/affiliation/school-accounts'],
      ['affiliation', '/api/affiliation/transfer-requests'],
      ['affiliation', '/api/affiliation/vehicle-requests'],
    ];

    const offenders = [];
    let datesSeen = 0;
    for (const [who, path] of probes) {
      const res = await get(path, TOKENS()[who]);
      // A 403/404 here would make the probe vacuous, so the status is asserted.
      expect(`${path} -> ${res.status}`).toBe(`${path} -> 200`);
      offenders.push(...shiftedValues(res.body, path));
      datesSeen += calendarValues(res.body);
    }

    expect(offenders).toEqual([]);
    // An asserted invariant over responses that contain no dates is not an
    // assertion. The fixture seeds four vehicle expiry columns and a leave date,
    // each of which several of these endpoints return.
    expect(`calendar dates observed: ${datesSeen >= 5}`).toBe('calendar dates observed: true');
  });

  it('records the deleted inspection in audit_logs with the day it was stored', async () => {
    // The audit row is the record of what was removed, so a date recorded a day
    // early there is worse than one rendered a day early on screen.
    const [[insp]] = await pool.query(
      `INSERT INTO vehicle_inspections (vehicle_id, inspected_by, inspection_date, expiry_date, result, notes)
       VALUES (?, NULL, ?, ?, 'PASSED', 'date-shape probe')
       RETURNING id, inspection_date`,
      [TEST_VEHICLE, VEHICLE_EXPIRY, VEHICLE_EXPIRY]
    ).catch(async () => {
      // MySQL 8.0 has no RETURNING; fall back to insertId.
      const [r] = await pool.query(
        `INSERT INTO vehicle_inspections (vehicle_id, inspected_by, inspection_date, expiry_date, result, notes)
         VALUES (?, NULL, ?, ?, 'PASSED', 'date-shape probe')`,
        [TEST_VEHICLE, VEHICLE_EXPIRY, VEHICLE_EXPIRY]
      );
      return [[{ id: r.insertId }]];
    });

    const transportSvc = require('../src/services/transport.service');
    try {
      const removed = await transportSvc.deleteInspection({
        inspectionId: insp.id, userId: 1, isAdmin: true,
      });
      expect(`inspection_date: ${removed.inspection_date}`).toBe(`inspection_date: ${VEHICLE_EXPIRY}`);
      expect(`expiry_date: ${removed.expiry_date}`).toBe(`expiry_date: ${VEHICLE_EXPIRY}`);
      expect(shiftedValues(removed, 'deletedRow')).toEqual([]);
    } finally {
      await pool.query('DELETE FROM vehicle_inspections WHERE notes = ?', ['date-shape probe']);
    }
  });
});
