'use strict';

/**
 * vehicleLocationPrivacy.unit.test.js
 *
 * Location-tracking AUTHORIZATION half of #4: every live-vehicle viewer path
 * funnels its rows through toPublicVehicle(), which is the single guarantee
 * that PII (phone / cid_hash / line_user_id / dropoff_address / password_hash)
 * never reaches a location response — even if a future JOIN accidentally
 * SELECTs one of those columns. Also pins computeStatus()'s ONLINE/STALE/
 * OFFLINE/PAUSED ladder incl. the null-received_at short-circuit the code
 * comment flags as a footgun (`null <= 60` is truthy in JS).
 *
 * Pure functions, DB-free — runs under jest.unit.config.js.
 * (The retention half of #4 is covered in locationRetention.unit.test.js.)
 */

const {
  computeStatus,
  toPublicVehicle,
  ONLINE_SECONDS_MAX,
  STALE_SECONDS_MAX,
} = require('../src/services/vehicleLocation.service');

const NOW = 1_700_000_000_000; // fixed clock; functions take nowMs so no Date.now()
const ago = (seconds) => new Date(NOW - seconds * 1000).toISOString();

describe('computeStatus — freshness ladder', () => {
  test('null row → OFFLINE, seconds_since_seen null (short-circuits the age ladder)', () => {
    expect(computeStatus(null, NOW)).toEqual({ status: 'OFFLINE', low_accuracy: false, seconds_since_seen: null });
  });

  test('row with no received_at → OFFLINE (never falsely ONLINE via null<=60)', () => {
    expect(computeStatus({ vehicle_id: 'V1', received_at: null }, NOW).status).toBe('OFFLINE');
  });

  test('fresh ping → ONLINE', () => {
    expect(computeStatus({ received_at: ago(10) }, NOW).status).toBe('ONLINE');
  });

  test('exactly at ONLINE boundary → ONLINE', () => {
    expect(computeStatus({ received_at: ago(ONLINE_SECONDS_MAX) }, NOW).status).toBe('ONLINE');
  });

  test('just past ONLINE, within STALE → STALE', () => {
    expect(computeStatus({ received_at: ago(ONLINE_SECONDS_MAX + 1) }, NOW).status).toBe('STALE');
  });

  test('past STALE window → OFFLINE', () => {
    expect(computeStatus({ received_at: ago(STALE_SECONDS_MAX + 1) }, NOW).status).toBe('OFFLINE');
  });

  test('explicit PAUSED status wins over freshness', () => {
    const r = computeStatus({ received_at: ago(5), status: 'PAUSED' }, NOW);
    expect(r.status).toBe('PAUSED');
    expect(r.seconds_since_seen).toBe(5);
  });

  test('low_accuracy overlay flips only above the accuracy threshold', () => {
    expect(computeStatus({ received_at: ago(5), accuracy_meters: 250 }, NOW).low_accuracy).toBe(true);
    expect(computeStatus({ received_at: ago(5), accuracy_meters: 50 }, NOW).low_accuracy).toBe(false);
    expect(computeStatus({ received_at: ago(5), accuracy_meters: null }, NOW).low_accuracy).toBe(false);
  });

  test('seconds_since_seen never goes negative for a future clock skew', () => {
    expect(computeStatus({ received_at: ago(-30) }, NOW).seconds_since_seen).toBe(0);
  });
});

describe('toPublicVehicle — PII-stripping guarantee', () => {
  // A deliberately over-broad row: includes every sensitive column a careless
  // JOIN might leak. The projection must drop ALL of them.
  const dirtyRow = {
    vehicle_id: 'V-abc', plate_no: 'นข 2210 ลำปาง', vehicle_type: 'รถตู้',
    driver_name: 'สมชาย ใจดี',
    latitude: '18.29', longitude: '99.49', accuracy_meters: 12,
    speed_mps: 8, heading_deg: 90, recorded_at: ago(5), received_at: ago(5),
    student_count_in_scope: 7,
    // —— must NEVER appear in output ——
    owner_phone: '0812345678', driver_phone: '0898887777',
    cid_hash: 'deadbeef', line_user_id: 'U123', dropoff_address: '99/9 บ้านเลขที่',
    password_hash: '$2b$12$xxxxx', parent_phone: '0800000000',
  };

  const LEAK_KEYS = ['owner_phone', 'driver_phone', 'parent_phone', 'cid_hash',
    'line_user_id', 'dropoff_address', 'password_hash'];

  test('output contains none of the sensitive keys', () => {
    const out = toPublicVehicle(dirtyRow, NOW);
    for (const k of LEAK_KEYS) expect(out).not.toHaveProperty(k);
  });

  test('output has an exact allow-listed key set (no accidental passthrough)', () => {
    const out = toPublicVehicle(dirtyRow, NOW);
    expect(Object.keys(out).sort()).toEqual([
      'accuracy_meters', 'driver_name', 'heading_deg', 'latitude', 'longitude',
      'low_accuracy', 'plate_no', 'received_at', 'recorded_at', 'seconds_since_seen',
      'speed_mps', 'status', 'vehicle_id', 'vehicle_type',
    ].sort());
  });

  test('driver_name is passed through (already first/last only) but no phone rides along', () => {
    expect(toPublicVehicle(dirtyRow, NOW).driver_name).toBe('สมชาย ใจดี');
  });

  test('lat/long coerced to Number; null stays null', () => {
    const out = toPublicVehicle(dirtyRow, NOW);
    expect(out.latitude).toBe(18.29);
    expect(out.longitude).toBe(99.49);
    const noGps = toPublicVehicle({ ...dirtyRow, latitude: null, longitude: null }, NOW);
    expect(noGps.latitude).toBeNull();
    expect(noGps.longitude).toBeNull();
  });

  test('student_count_in_scope only exposed when explicitly requested', () => {
    expect(toPublicVehicle(dirtyRow, NOW)).not.toHaveProperty('student_count_in_scope');
    expect(toPublicVehicle(dirtyRow, NOW, { includeStudentCountInScope: true }).student_count_in_scope).toBe(7);
  });
});
