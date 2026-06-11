'use strict';

/**
 * vehicleCanonicalDb.test.js  (Phase 10.13B-3)
 * canonicalPlateForStorage — the value stored in vehicles.canonical_plate that
 * the DB unique (uq_vehicles_active_canonical) enforces. Province-alias aware;
 * NULL for ambiguous (province-less / unparseable) plates.
 */
const PI = require('../src/utils/plateIdentity');
const { canonicalPlateForStorage, buildCanonicalPlate } = PI;

describe('canonicalPlateForStorage (10.13B-3)', () => {
  test('province aliases collapse to one stored canonical', () => {
    const forms = ['ออ 7332 กทม', 'ออ 7332 กรุงเทพ', 'ออ 7332 กรุงเทพมหานคร', 'ออ 7332 Bangkok', 'ออ 7332 BKK'];
    const set = new Set(forms.map(canonicalPlateForStorage));
    expect(set.size).toBe(1);
    expect([...set][0]).toBe(buildCanonicalPlate({ plate_prefix: 'ออ', plate_number: '7332', province: 'กรุงเทพมหานคร' }));
  });

  test('spacing/dash variants store the same canonical', () => {
    expect(canonicalPlateForStorage('นข4031ลำปาง')).toBe(canonicalPlateForStorage('นข 4031 ลำปาง'));
    expect(canonicalPlateForStorage('นข-4031-ลำปาง')).toBe(canonicalPlateForStorage('นข 4031 ลำปาง'));
  });

  test('different province → different canonical (not enforced together)', () => {
    expect(canonicalPlateForStorage('นข 4031 ลำปาง')).not.toBe(canonicalPlateForStorage('นข 4031 ลำพูน'));
  });

  test('missing province → NULL (ambiguous, never uniqueness-enforced)', () => {
    expect(canonicalPlateForStorage('นข 800')).toBeNull();
    expect(canonicalPlateForStorage('นข800')).toBeNull();
  });

  test('garbage / empty → NULL', () => {
    expect(canonicalPlateForStorage('')).toBeNull();
    expect(canonicalPlateForStorage('???')).toBeNull();
  });

  test('matches the backfill/route source of truth (single helper)', () => {
    // The route INSERT, the transport INSERT, and the backfill script all call
    // the SAME exported helper, so they cannot drift.
    const p = PI.parseLegacyPlateText('ผก 1234 ลำปาง');
    expect(canonicalPlateForStorage('ผก 1234 ลำปาง')).toBe(buildCanonicalPlate(p));
  });
});
