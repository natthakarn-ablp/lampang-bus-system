'use strict';

/**
 * plateIdentity.test.js  (Phase 10.13A-25)
 *
 * PURE unit tests for the permanent plate-identity module: deterministic
 * normalization, province-alias resolution, and conflict classification.
 */

const PI = require('../src/utils/plateIdentity');

describe('plate normalization is deterministic', () => {
  test('spacing/dash variants → same canonical when province matches', () => {
    const a = PI.buildCanonicalPlate({ plate_prefix: 'นข', plate_number: '4031', province: 'ลำปาง' });
    expect(PI.comparePlateIdentity('นข4031ลำปาง', 'นข 4031 ลำปาง')).toBe(true);
    expect(PI.comparePlateIdentity('นข-4031-ลำปาง', 'นข 4031 ลำปาง')).toBe(true);
    expect(PI.buildCanonicalPlate({ plate_prefix: 'นข', plate_number: '4031', province: 'ลำปาง' })).toBe(a);
  });
  test('display plate resolves province alias', () => {
    expect(PI.buildDisplayPlate({ plate_prefix: 'ออ', plate_number: '7332', province: 'กทม' })).toBe('ออ 7332 กรุงเทพมหานคร');
    expect(PI.buildDisplayPlate({ plate_prefix: 'นข', plate_number: '4031', province: 'ลำปาง' })).toBe('นข 4031 ลำปาง');
  });
});

describe('province alias normalization', () => {
  test('กทม / กรุงเทพ / กรุงเทพมหานคร / Bangkok / BKK → same canonical province', () => {
    const forms = ['กทม', 'กรุงเทพ', 'กรุงเทพฯ', 'กรุงเทพมหานคร', 'Bangkok', 'BKK', ' bkk '];
    const set = new Set(forms.map((f) => PI.normalizeProvince(f)));
    expect(set.size).toBe(1);
    expect([...set][0]).toBe('กรุงเทพมหานคร');
  });
  test('plate identity is alias-insensitive: ออ7332กทม == ออ7332กรุงเทพมหานคร', () => {
    expect(PI.comparePlateIdentity(
      { plate_prefix: 'ออ', plate_number: '7332', province: 'กทม' },
      'ออ 7332 กรุงเทพมหานคร'
    )).toBe(true);
  });
  test('non-alias province kept as-is (ลำปาง ≠ ลำพูน)', () => {
    expect(PI.normalizeProvince('ลำปาง')).toBe('ลำปาง');
    expect(PI.comparePlateIdentity('นข4031ลำปาง', 'นข4031ลำพูน')).toBe(false);
  });
});

describe('classifyVehiclePlateConflict (A–F codes)', () => {
  const active = (id, plate, school) => ({ id, plate_no: plate, is_deleted: 0, school_id: school });
  const deleted = (id, plate) => ({ id, plate_no: plate, is_deleted: 1 });

  test('SAME_ACTIVE_VEHICLE_SAME_SCHOOL', () => {
    const r = PI.classifyVehiclePlateConflict(
      { plate_prefix: 'นข', plate_number: '4031', province: 'ลำปาง' },
      [active('V-1', 'นข 4031 ลำปาง', 'S1')], { schoolId: 'S1' });
    expect(r.code).toBe('SAME_ACTIVE_VEHICLE_SAME_SCHOOL');
    expect(r.vehicle_id).toBe('V-1');
  });
  test('SAME_ACTIVE_VEHICLE_OTHER_SCHOOL', () => {
    const r = PI.classifyVehiclePlateConflict(
      { plate_prefix: 'นข', plate_number: '4031', province: 'ลำปาง' },
      [active('V-1', 'นข 4031 ลำปาง', 'S2')], { schoolId: 'S1' });
    expect(r.code).toBe('SAME_ACTIVE_VEHICLE_OTHER_SCHOOL');
  });
  test('SOFT_DELETED_VEHICLE_EXISTS', () => {
    const r = PI.classifyVehiclePlateConflict(
      { plate_prefix: 'นข', plate_number: '4031', province: 'ลำปาง' },
      [deleted('V-d', 'นข 4031 ลำปาง')]);
    expect(r.code).toBe('SOFT_DELETED_VEHICLE_EXISTS');
    expect(r.is_deleted).toBe(true);
  });
  test('PROVINCE_ALIAS_DUPLICATE (กทม vs กรุงเทพมหานคร)', () => {
    const r = PI.classifyVehiclePlateConflict(
      { plate_prefix: 'ออ', plate_number: '7332', province: 'กรุงเทพมหานคร' },
      [active('V-bkk', 'ออ 7332 กทม', 'S1')]);
    expect(r.code).toBe('PROVINCE_ALIAS_DUPLICATE');
    expect(r.vehicle_id).toBe('V-bkk');
  });
  test('AMBIGUOUS_PLATE_NEEDS_PROVINCE (province omitted, base collides)', () => {
    const r = PI.classifyVehiclePlateConflict(
      { plate_prefix: 'นข', plate_number: '4031', province: '' },
      [active('V-1', 'นข 4031 ลำปาง', 'S1')]);
    expect(r.code).toBe('AMBIGUOUS_PLATE_NEEDS_PROVINCE');
  });
  test('VALID_NEW_VEHICLE', () => {
    const r = PI.classifyVehiclePlateConflict(
      { plate_prefix: 'ผก', plate_number: '9999', province: 'ลำปาง' },
      [active('V-1', 'นข 4031 ลำปาง', 'S1')]);
    expect(r.code).toBe('VALID_NEW_VEHICLE');
  });
  test('PLATE_FORMAT_INVALID', () => {
    expect(PI.classifyVehiclePlateConflict({ plate_prefix: '', plate_number: '', province: '' }, []).code).toBe('PLATE_FORMAT_INVALID');
  });
  test('different number is not a conflict', () => {
    const r = PI.classifyVehiclePlateConflict(
      { plate_prefix: 'นข', plate_number: '4032', province: 'ลำปาง' },
      [active('V-1', 'นข 4031 ลำปาง', 'S1')]);
    expect(r.code).toBe('VALID_NEW_VEHICLE');
  });
});
