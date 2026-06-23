'use strict';

const { evaluateSafetyPolicy, assessDriverOperation } = require('../src/services/safetyPolicy.service');

const ready = {
  vehicleStatus: 'ELIGIBLE',
  vehicleReasons: [],
  qualificationStatus: 'VERIFIED',
  authorizationStatus: 'AUTHORIZED',
  requireActiveShift: false,
  hasActiveShift: false,
};

describe('evaluateSafetyPolicy', () => {
  test('allows ready data in both modes', () => {
    expect(evaluateSafetyPolicy({ ...ready, mode: 'OBSERVE' }).decision).toBe('ALLOW');
    expect(evaluateSafetyPolicy({ ...ready, mode: 'ENFORCE' }).decision).toBe('ALLOW');
  });

  test('warns for missing data in observe and blocks it in enforce', () => {
    const input = { ...ready, vehicleStatus: 'UNVERIFIED', qualificationStatus: null };
    expect(evaluateSafetyPolicy({ ...input, mode: 'OBSERVE' })).toMatchObject({
      decision: 'ALLOW_WITH_WARNING', audit_required: true,
    });
    expect(evaluateSafetyPolicy({ ...input, mode: 'ENFORCE' }).decision).toBe('BLOCK');
  });

  test('treats missing-data ineligible reasons as observe warnings', () => {
    expect(evaluateSafetyPolicy({
      ...ready,
      mode: 'OBSERVE',
      vehicleStatus: 'INELIGIBLE',
      vehicleReasons: ['INSPECTION_MISSING', 'CAPACITY_UNKNOWN', 'NO_VALID_DRIVER'],
      qualificationStatus: null,
    })).toMatchObject({ decision: 'ALLOW_WITH_WARNING' });
  });

  test.each([
    ['VEHICLE_SUSPENDED'], ['INSPECTION_FAILED'], ['INSPECTION_EXPIRED'],
    ['CAPACITY_EXCEEDED'], ['INSURANCE_EXPIRED'],
  ])('blocks explicit vehicle failure in observe: %s', (reason) => {
    expect(evaluateSafetyPolicy({
      ...ready, mode: 'OBSERVE', vehicleStatus: 'INELIGIBLE', vehicleReasons: [reason],
    }).decision).toBe('BLOCK');
  });

  test.each(['EXPIRED', 'SUSPENDED', 'REVOKED'])('blocks explicit qualification status in observe: %s', (status) => {
    expect(evaluateSafetyPolicy({ ...ready, mode: 'OBSERVE', qualificationStatus: status }).decision).toBe('BLOCK');
  });

  test('blocks a SUSPENDED vehicle by status even with empty reasons (OBSERVE)', () => {
    const result = evaluateSafetyPolicy({
      ...ready, mode: 'OBSERVE', vehicleStatus: 'SUSPENDED', vehicleReasons: [],
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reasons).toContain('VEHICLE_SUSPENDED');
    expect(result.audit_required).toBe(true);
  });

  test('blocks a SUSPENDED vehicle by status even with empty reasons (ENFORCE)', () => {
    expect(evaluateSafetyPolicy({
      ...ready, mode: 'ENFORCE', vehicleStatus: 'SUSPENDED', vehicleReasons: [],
    }).decision).toBe('BLOCK');
  });

  test('requires a shift only when the feature is active', () => {
    expect(evaluateSafetyPolicy({
      ...ready, mode: 'ENFORCE', requireActiveShift: true, hasActiveShift: false,
    })).toMatchObject({ decision: 'BLOCK', reasons: ['ACTIVE_SHIFT_MISSING'] });
  });

  test('rejects invalid policy mode', () => {
    expect(() => evaluateSafetyPolicy({ ...ready, mode: 'OPEN' })).toThrow(/Invalid safety policy mode/);
  });
});

// A license_expiry far in the future keeps a VERIFIED qualification effective by
// default; tests that exercise expiry pass an explicit licenseExpiry.
const FUTURE_EXPIRY = '2999-12-31';

function fakeSafetyPool({
  vehicleStatus = 'UNVERIFIED', vehicleReasons = [], qualificationStatus = null,
  licenseExpiry = FUTURE_EXPIRY, authorizationStatus = 'AUTHORIZED', hasActiveShift = false,
} = {}) {
  return {
    query: jest.fn(async (sql) => {
      if (/FROM vehicles/.test(sql)) return [[{
        verification_status: vehicleStatus,
        verification_reasons_json: JSON.stringify(vehicleReasons),
      }]];
      if (/FROM driver_qualifications/.test(sql)) {
        return [[qualificationStatus
          ? { qualification_status: qualificationStatus, license_expiry: licenseExpiry }
          : null]];
      }
      if (/FROM driver_vehicle_assignments/.test(sql)) {
        return [[authorizationStatus ? { authorization_status: authorizationStatus } : null]];
      }
      if (/FROM vehicle_operating_shifts/.test(sql)) {
        return [[hasActiveShift ? { id: 44 } : null]];
      }
      return [[null]];
    }),
  };
}

describe('assessDriverOperation', () => {
  test('OBSERVE returns a warning for unverified legacy data', async () => {
    const result = await assessDriverOperation(fakeSafetyPool({
      vehicleStatus: 'UNVERIFIED', qualificationStatus: null, authorizationStatus: 'AUTHORIZED',
    }), { vehicleId: 'V-1', driverId: 7, requireActiveShift: false, mode: 'OBSERVE' });
    expect(result).toMatchObject({ decision: 'ALLOW_WITH_WARNING', reasons: expect.any(Array) });
  });

  test('ENFORCE blocks the same operation', async () => {
    const result = await assessDriverOperation(fakeSafetyPool({
      vehicleStatus: 'UNVERIFIED', qualificationStatus: null, authorizationStatus: 'AUTHORIZED',
    }), { vehicleId: 'V-1', driverId: 7, requireActiveShift: false, mode: 'ENFORCE' });
    expect(result.decision).toBe('BLOCK');
  });

  test('checks active shift only when requested', async () => {
    const pool = fakeSafetyPool({ vehicleStatus: 'ELIGIBLE', qualificationStatus: 'VERIFIED', authorizationStatus: 'AUTHORIZED' });
    const result = await assessDriverOperation(pool, {
      vehicleId: 'V-1', driverId: 7, requireActiveShift: true, mode: 'ENFORCE',
    });
    expect(result).toMatchObject({ decision: 'BLOCK', reasons: ['ACTIVE_SHIFT_MISSING'] });
    expect(pool.query.mock.calls.some(([sql]) => /FROM vehicle_operating_shifts/.test(sql))).toBe(true);
  });

  test('blocks a VERIFIED qualification with a past license_expiry in both modes', async () => {
    const opts = {
      vehicleStatus: 'ELIGIBLE', qualificationStatus: 'VERIFIED',
      licenseExpiry: '2000-01-01', authorizationStatus: 'AUTHORIZED',
    };
    const observe = await assessDriverOperation(fakeSafetyPool(opts), {
      vehicleId: 'V-1', driverId: 7, requireActiveShift: false, mode: 'OBSERVE',
    });
    const enforce = await assessDriverOperation(fakeSafetyPool(opts), {
      vehicleId: 'V-1', driverId: 7, requireActiveShift: false, mode: 'ENFORCE',
    });
    expect(observe.decision).toBe('BLOCK');
    expect(observe.reasons).toContain('DRIVER_EXPIRED');
    expect(enforce.decision).toBe('BLOCK');
  });

  test('allows a VERIFIED qualification with a future license_expiry', async () => {
    const result = await assessDriverOperation(fakeSafetyPool({
      vehicleStatus: 'ELIGIBLE', qualificationStatus: 'VERIFIED',
      licenseExpiry: '2999-12-31', authorizationStatus: 'AUTHORIZED',
    }), { vehicleId: 'V-1', driverId: 7, requireActiveShift: false, mode: 'ENFORCE' });
    expect(result.decision).toBe('ALLOW');
  });

  test('blocks a SUSPENDED vehicle with empty reasons (OBSERVE)', async () => {
    const result = await assessDriverOperation(fakeSafetyPool({
      vehicleStatus: 'SUSPENDED', vehicleReasons: [],
      qualificationStatus: 'VERIFIED', authorizationStatus: 'AUTHORIZED',
    }), { vehicleId: 'V-1', driverId: 7, requireActiveShift: false, mode: 'OBSERVE' });
    expect(result.decision).toBe('BLOCK');
    expect(result.reasons).toContain('VEHICLE_SUSPENDED');
  });

  test('resolves the current qualification using verified_at then id ordering', async () => {
    const pool = fakeSafetyPool({
      vehicleStatus: 'ELIGIBLE', qualificationStatus: 'VERIFIED', authorizationStatus: 'AUTHORIZED',
    });
    await assessDriverOperation(pool, {
      vehicleId: 'V-1', driverId: 7, requireActiveShift: false, mode: 'ENFORCE',
    });
    const qualSql = pool.query.mock.calls
      .map(([sql]) => sql)
      .find((sql) => /FROM driver_qualifications/.test(sql));
    expect(qualSql).toMatch(/ORDER BY verified_at DESC, id DESC/);
    expect(qualSql).toMatch(/license_expiry/);
  });
});
