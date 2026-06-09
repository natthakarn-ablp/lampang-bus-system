'use strict';

/**
 * onboardingDedup.test.js  (Phase 10.13A-13)
 *
 * PURE unit tests for the onboarding de-duplication logic used by
 * POST /api/school/vehicles:
 *   - isProvinceVariant() rejects province-omitted vehicle duplicates
 *   - normalizePlate() collapses spacing/dash variants so the driver-account
 *     dedup (normalized username) reuses one account per plate.
 * No DB / no globalSetup. (Route-level transaction behavior is verified by code
 * review + these helpers; a full integration test needs a staging DB.)
 */

const { isProvinceVariant, normalizePlate } = require('../src/utils/vehiclePlate');

describe('isProvinceVariant — province-omitted vehicle duplicate detection', () => {
  test('1. province omitted vs present → duplicate (both orders)', () => {
    expect(isProvinceVariant('นข4337', 'นข4337ลำปาง')).toBe(true);
    expect(isProvinceVariant('นข4337ลำปาง', 'นข4337')).toBe(true);
  });

  test('2. different plate NUMBERS are NOT flagged (suffix is a digit)', () => {
    expect(isProvinceVariant('นข433', 'นข4337')).toBe(false);   // suffix "7"
    expect(isProvinceVariant('นข4337', 'นข43375')).toBe(false); // suffix "5"
    expect(isProvinceVariant('นข4337', 'นข4338ลำปาง')).toBe(false); // 4337 vs 4338
  });

  test('3. same number, different province → not a prefix → not flagged', () => {
    expect(isProvinceVariant('นข4337ลำปาง', 'นข4337ลำพูน')).toBe(false);
  });

  test('4. identical / empty → false (exact dedup handles identical)', () => {
    expect(isProvinceVariant('นข4337ลำปาง', 'นข4337ลำปาง')).toBe(false);
    expect(isProvinceVariant('', 'นข4337')).toBe(false);
    expect(isProvinceVariant('นข4337', '')).toBe(false);
  });
});

describe('normalizePlate — driver-account dedup key (spacing/dash variants)', () => {
  test('5. the four observed นข4337 username variants all normalize identically', () => {
    const variants = ['นข4337 ลำปาง', 'นข 4337 ลำปาง', 'นข 4337ลำปาง', 'นข4337ลำปาง'];
    const norms = variants.map(normalizePlate);
    expect(new Set(norms).size).toBe(1);          // single dedup key
    expect(norms[0]).toBe('นข4337ลำปาง');
  });

  test('6. hyphen variant normalizes to the same key', () => {
    expect(normalizePlate('นข-4337-ลำปาง')).toBe('นข4337ลำปาง');
  });

  test('7. the SQL dedup expression (LOWER + strip space/dash) matches normalizePlate for these cases', () => {
    const sqlNorm = (s) => String(s).toLowerCase().replace(/ /g, '').replace(/-/g, '');
    for (const v of ['นข4337 ลำปาง', 'นข 4337 ลำปาง', 'บน 1467', 'นข-2833-ลำปาง']) {
      expect(sqlNorm(v)).toBe(normalizePlate(v));
    }
  });

  test('8. distinct plates keep distinct dedup keys (no over-merge)', () => {
    expect(normalizePlate('นข1365ลำปาง')).not.toBe(normalizePlate('นข2833ลำปาง'));
    expect(normalizePlate('บน1467')).not.toBe(normalizePlate('นข1467ลำปาง'));
  });
});
