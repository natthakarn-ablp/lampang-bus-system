'use strict';

/**
 * CS5-05, owner decision B1 (2 ต.ค. 2569): a pupil assigned to a vehicle is its
 * rider every term, until moved, withdrawn or graduated.
 *
 * students.term_id is stamped at insert and never re-stamped. The inspection
 * service used to count riders with `(term_id = <current> OR term_id IS NULL)`,
 * so on 12 Oct 2569 (2569-1 → 2569-2) production would have dropped 4,328 riders
 * from the count, and a school whose pupils were all stamped 2569-1 got a 403
 * "โรงเรียนนี้ไม่มีนักเรียนที่ใช้รถคันดังกล่าว" for a bus eight of them ride.
 *
 * The fake database below holds that exact state — 8 pupils on V-1, all stamped
 * 2569-1 — and answers the rider queries the way MySQL would, INCLUDING a
 * term_id filter if the service still sends one. The current term is pinned to
 * 2569-2. Against the old code every test here fails.
 */

require('./loadTestEnv');

jest.mock('../src/services/term.service', () => ({
  ...jest.requireActual('../src/services/term.service'),
  getCurrentTerm: jest.fn(async () => '2569-2'),
}));

const svc = require('../src/services/vehicleVerification.service');

const PUPILS = Array.from({ length: 8 }, (_, i) => ({
  id: 100 + i, vehicle_id: 'V-1', school_id: 'SCH1', term_id: '2569-1',
  morning_enabled: true, evening_enabled: i < 6,
}));

/** Pupils that a rider query would return, honouring a term filter if present. */
function ridersFor(sql, params) {
  let rows = PUPILS.filter((p) => p.vehicle_id === params[0]);
  let i = 1;
  if (/school_id = \?/.test(sql)) rows = rows.filter((p) => p.school_id === params[i++]);
  if (/term_id = \?/.test(sql)) {
    const term = params[i++];
    rows = rows.filter((p) => p.term_id === term || p.term_id == null);
  }
  return rows;
}

const seen = [];
function fakeQuery(sql, params = []) {
  sql = String(sql);
  seen.push({ sql, params });
  if (/FROM vehicles\b/.test(sql) && /certified_capacity/.test(sql)) {
    return [[{ id: 'V-1', plate_no: 'กข 1 ลำปาง', vehicle_type: 'van', certified_capacity: 12,
      verification_status: 'UNVERIFIED' }]];
  }
  if (/COUNT\(\*\) AS related/.test(sql)) return [[{ related: ridersFor(sql, params).length }]];
  if (/AS morning_rider_count/.test(sql)) {
    const rows = ridersFor(sql, params);
    const m = rows.filter((p) => p.morning_enabled).length;
    const e = rows.filter((p) => p.evening_enabled).length;
    if (/GROUP BY s\.school_id/.test(sql)) {
      return [rows.length ? [{ school_id: 'SCH1', school_name: 'ร.ร.หนึ่ง', morning_rider_count: m,
        evening_rider_count: e, source_updated_at: null }] : []];
    }
    return [[{ morning_rider_count: m, evening_rider_count: e }]];
  }
  if (/dva\.driver_id = \(/.test(sql)) return [[{ id: 1, assignment_role: 'PRIMARY', authorization_status: 'AUTHORIZED' }]];
  if (/^\s*(INSERT|UPDATE)/i.test(sql)) return [{ insertId: 1, affectedRows: 1 }];
  return [[]];
}

const conn = {
  query: jest.fn(async (sql, params) => fakeQuery(sql, params)),
  beginTransaction: jest.fn(async () => {}),
  commit: jest.fn(async () => {}),
  rollback: jest.fn(async () => {}),
  release: jest.fn(),
};
const pool = { query: conn.query, getConnection: jest.fn(async () => conn) };

beforeEach(() => { seen.length = 0; });

/** Run a service call; only the rider-related refusals count as a failure here. */
async function runPastRiderCheck(fn) {
  try { await fn(); } catch (e) {
    if (['SCHOOL_NOT_RELATED_TO_VEHICLE', 'NO_CURRENT_RIDERS'].includes(e.code)) throw e;
  }
}

const groupedRiders = () => seen
  .filter((c) => /GROUP BY s\.school_id/.test(c.sql))
  .map((c) => fakeQuery(c.sql, c.params)[0][0]);

describe('B1 — riders stamped last term still ride after the rollover', () => {
  test('a school can still submit its bus, and all 8 riders are counted', async () => {
    await runPastRiderCheck(() => svc.createApplication(pool, {
      vehicleId: 'V-1', issuingSchoolId: 'SCH1', userId: 9,
    }));
    const [row] = groupedRiders();
    expect(row.morning_rider_count).toBe(8);
    expect(row.evening_rider_count).toBe(6);
  });

  test('a driver-initiated application counts the same 8', async () => {
    await runPastRiderCheck(() => svc.createDriverApplication(pool, {
      vehicleId: 'V-1', driverUserId: 5,
    }));
    const [row] = groupedRiders();
    expect(row.morning_rider_count).toBe(8);
  });

  test('eligibility recomputation counts the same 8, whatever term the caller names', async () => {
    await svc.refreshVehicleEligibility(conn, 'V-1', { today: '2026-10-12', currentTerm: '2569-2' })
      .catch(() => {});
    const q = seen.find((c) => /AS morning_rider_count/.test(c.sql) && !/GROUP BY/.test(c.sql));
    const [[r]] = fakeQuery(q.sql, q.params);
    expect(r.morning_rider_count).toBe(8);
  });

  test('the application is still keyed and labelled by the current term', async () => {
    await runPastRiderCheck(() => svc.createApplication(pool, {
      vehicleId: 'V-1', issuingSchoolId: 'SCH1', userId: 9,
    }));
    const keyed = seen.find((c) => /active_request_key = \?/.test(c.sql));
    expect(keyed.params).toContain('V-1|2569-2');
  });

  test('no rider query in the service filters on students.term_id', () => {
    const src = require('fs').readFileSync(
      require.resolve('../src/services/vehicleVerification.service'), 'utf8');
    expect(src).not.toMatch(/\bterm_id\s*=\s*\?/);
  });
});
