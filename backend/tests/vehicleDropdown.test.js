'use strict';

/**
 * vehicleDropdown.test.js  (Phase 10.13A-22A)
 *
 * PURE unit tests for the student vehicle-dropdown helpers:
 *   - formatPlateDisplay (canonical spaced display)
 *   - annotateVehicleList (mark province-variant duplicates to hide)
 * No DB / no globalSetup.
 */

const { formatPlateDisplay } = require('../src/utils/vehiclePlate');
const { annotateVehicleList } = require('../src/services/vehicleDedup.service');

describe('formatPlateDisplay', () => {
  test('compact plate gets spaced', () => {
    expect(formatPlateDisplay('นข4337ลำปาง')).toBe('นข 4337 ลำปาง');
    expect(formatPlateDisplay('นข4337')).toBe('นข 4337');
  });
  test('already-spaced plate is normalized to single spaces', () => {
    expect(formatPlateDisplay('นข 4337 ลำปาง')).toBe('นข 4337 ลำปาง');
    expect(formatPlateDisplay('ออ 7332 กรุงเทพมหานคร')).toBe('ออ 7332 กรุงเทพมหานคร');
  });
  test('never invents a missing province; unparseable returns original', () => {
    expect(formatPlateDisplay('นข4337')).not.toMatch(/ลำปาง/);
    expect(formatPlateDisplay('__TEST 9999')).toBe('__TEST 9999');
    expect(formatPlateDisplay('')).toBe('');
  });
});

describe('annotateVehicleList — duplicate suppression', () => {
  const VEHS = [
    { id: 'V-6753', plate_no: 'นข4337 ลำปาง', vehicle_type: 'รถตู้', active_students: 0 },
    { id: 'V-db7d', plate_no: 'นข4337', vehicle_type: 'รถตู้', active_students: 0 },
  ];

  test('1. each row gets display_plate + compact_plate', () => {
    const out = annotateVehicleList(VEHS);
    expect(out.find(v => v.id === 'V-6753').display_plate).toBe('นข 4337 ลำปาง');
    expect(out.find(v => v.id === 'V-db7d').compact_plate).toBe('นข4337');
  });

  test('2. province-omitted 0-student duplicate is marked; canonical is not', () => {
    const out = annotateVehicleList(VEHS);
    const db7d = out.find(v => v.id === 'V-db7d');
    const v6753 = out.find(v => v.id === 'V-6753');
    expect(db7d.duplicate_candidate).toBe(true);
    expect(db7d.canonical_vehicle_id).toBe('V-6753');
    expect(v6753.duplicate_candidate).toBe(false);
  });

  test('3. a vehicle WITH students is never marked (even if province-omitted)', () => {
    const out = annotateVehicleList([
      { id: 'A', plate_no: 'นข4337', active_students: 5 },
      { id: 'B', plate_no: 'นข4337 ลำปาง', active_students: 0 },
    ]);
    expect(out.find(v => v.id === 'A').duplicate_candidate).toBe(false);
    // B is province-present but 0 students and A (its variant) has students → B is the dup
    expect(out.find(v => v.id === 'B').duplicate_candidate).toBe(true);
    expect(out.find(v => v.id === 'B').canonical_vehicle_id).toBe('A');
  });

  test('4. different plate numbers are NOT marked', () => {
    const out = annotateVehicleList([
      { id: 'X', plate_no: 'นข4337', active_students: 0 },
      { id: 'Y', plate_no: 'นข4338 ลำปาง', active_students: 0 },
    ]);
    expect(out.every(v => !v.duplicate_candidate)).toBe(true);
  });

  test('5. a lone vehicle (no sibling) is never marked', () => {
    const out = annotateVehicleList([{ id: 'Z', plate_no: 'บน1467', active_students: 0 }]);
    expect(out[0].duplicate_candidate).toBe(false);
  });

  test('6. นข4337 cluster → only the canonical survives the dropdown filter', () => {
    const out = annotateVehicleList(VEHS);
    const visible = out.filter(v => !v.duplicate_candidate);
    expect(visible.map(v => v.id)).toEqual(['V-6753']);
  });

  test('7. no sensitive fields are introduced', () => {
    const out = annotateVehicleList(VEHS);
    expect(JSON.stringify(out)).not.toMatch(/phone|cid|hash|password|token|line_user/i);
  });
});
