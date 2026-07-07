'use strict';

/**
 * vehiclePlateWiring.test.js  (Phase 10.13A-25B)
 *
 * ISOLATED — mocked db. Verifies classifyPlateAgainstDb (the service wrapper that
 * the check-plate + add-vehicle + transport paths use) fetches vehicles and
 * applies the alias-aware classifier, covering the COMMAND 6 acceptance cases.
 */

const { classifyPlateAgainstDb } = require('../src/services/vehicleDedup.service');

// db.query returns [rows]; the only query in the helper is the vehicle fetch.
function makeDb(rows) {
  return { query: async () => [rows] };
}

describe('classifyPlateAgainstDb — live wiring (10.13A-25B)', () => {
  const VEHS = [
    { id: 'V-bkk', plate_no: 'ออ 7332 กทม', is_deleted: 0, school_id: '52020082' },
    { id: 'V-800', plate_no: 'นข 800 ลำปาง', is_deleted: 0, school_id: '52020039' },
  ];

  test('ออ 7332 กรุงเทพมหานคร → PROVINCE_ALIAS_DUPLICATE of ออ 7332 กทม', async () => {
    const r = await classifyPlateAgainstDb(makeDb(VEHS), { plate_prefix: 'ออ', plate_number: '7332', province: 'กรุงเทพมหานคร' });
    expect(r.code).toBe('PROVINCE_ALIAS_DUPLICATE');
    expect(r.vehicle_id).toBe('V-bkk');
    expect(r.display_plate).toBe('ออ 7332 กรุงเทพมหานคร');
  });

  test('นข 800 ลำปาง @ไหล่หิน → SAME_ACTIVE_VEHICLE_SAME_SCHOOL', async () => {
    const r = await classifyPlateAgainstDb(makeDb(VEHS), { plate_prefix: 'นข', plate_number: '800', province: 'ลำปาง' }, { schoolId: '52020039' });
    expect(r.code).toBe('SAME_ACTIVE_VEHICLE_SAME_SCHOOL');
    expect(r.vehicle_id).toBe('V-800');
  });

  test('นข 800 ลำปาง from a DIFFERENT school → SAME_ACTIVE_VEHICLE_OTHER_SCHOOL', async () => {
    const r = await classifyPlateAgainstDb(makeDb(VEHS), { plate_prefix: 'นข', plate_number: '800', province: 'ลำปาง' }, { schoolId: '52020147' });
    expect(r.code).toBe('SAME_ACTIVE_VEHICLE_OTHER_SCHOOL');
  });

  test('ผก 1234 ลำปาง → VALID_NEW_VEHICLE', async () => {
    const r = await classifyPlateAgainstDb(makeDb(VEHS), { plate_prefix: 'ผก', plate_number: '1234', province: 'ลำปาง' }, { schoolId: '52020039' });
    expect(r.code).toBe('VALID_NEW_VEHICLE');
  });

  test('นข 800 without province → AMBIGUOUS_PLATE_NEEDS_PROVINCE', async () => {
    const r = await classifyPlateAgainstDb(makeDb(VEHS), { plate_prefix: 'นข', plate_number: '800', province: '' }, { schoolId: '52020039' });
    expect(r.code).toBe('AMBIGUOUS_PLATE_NEEDS_PROVINCE');
  });

  test('soft-deleted match → SOFT_DELETED_VEHICLE_EXISTS', async () => {
    const r = await classifyPlateAgainstDb(makeDb([{ id: 'V-d', plate_no: 'นข 4337 ลำปาง', is_deleted: 1 }]),
      { plate_prefix: 'นข', plate_number: '4337', province: 'ลำปาง' });
    expect(r.code).toBe('SOFT_DELETED_VEHICLE_EXISTS');
    expect(r.is_deleted).toBe(true);
  });
});
