'use strict';

/**
 * studentImportClassifier.test.js  (Phase 10.13A-26A)
 * Pure tests for the per-row import classifier.
 */
const { classifyImportRow, maskPhone } = require('../src/utils/studentImportClassifier');

const row = (o) => ({ rowNum: 1, student_code: '100', first_name: 'ก', last_name: 'ข', ...o });

describe('classifyImportRow', () => {
  test('INSERT_NEW (new code, no existing) → can_apply', () => {
    const r = classifyImportRow({ row: row({}), schoolId: 'S1' });
    expect(r.classification).toBe('INSERT_NEW');
    expect(r.can_apply).toBe(true);
    expect(r.message_th).toBe('พร้อมนำเข้า');
  });

  test('CROSS_SCHOOL_SAME_CODE_ALLOWED → can_apply', () => {
    const r = classifyImportRow({ row: row({}), schoolId: 'S1', existing: null, crossSchool: true });
    expect(r.classification).toBe('CROSS_SCHOOL_SAME_CODE_ALLOWED');
    expect(r.can_apply).toBe(true);
  });

  test('SKIP_DUPLICATE_SAME_SCHOOL (active existing, same guardian) → not applied', () => {
    const r = classifyImportRow({ row: row({ parent_name: 'พ่อ' }), schoolId: 'S1', existing: { id: 5, is_deleted: 0, parent_name: 'พ่อ' } });
    expect(r.classification).toBe('SKIP_DUPLICATE_SAME_SCHOOL');
    expect(r.can_apply).toBe(false);
  });

  test('GUARDIAN_MISMATCH (active existing, different guardian) → warning, not applied', () => {
    const r = classifyImportRow({ row: row({ parent_name: 'แม่ใหม่' }), schoolId: 'S1', existing: { id: 5, is_deleted: 0, parent_name: 'พ่อเก่า' } });
    expect(r.classification).toBe('GUARDIAN_MISMATCH');
    expect(r.guardian_mismatch).toBe(true);
    expect(r.can_apply).toBe(false);
  });

  test('SOFT_DELETED_SAME_SCHOOL_REACTIVATE → warning, not applied in preview', () => {
    const r = classifyImportRow({ row: row({}), schoolId: 'S1', existing: { id: 5, is_deleted: 1 } });
    expect(r.classification).toBe('SOFT_DELETED_SAME_SCHOOL_REACTIVATE');
    expect(r.can_apply).toBe(false);
  });

  test('VEHICLE_NOT_FOUND blocks the row', () => {
    const r = classifyImportRow({ row: row({ plate_no: 'ขข 9 ลำปาง' }), schoolId: 'S1', vehicle: { matched: false, code: 'VALID_NEW_VEHICLE' } });
    expect(r.classification).toBe('VEHICLE_NOT_FOUND');
    expect(r.can_apply).toBe(false);
  });

  test('VEHICLE_MISSING_PROVINCE blocks the row', () => {
    const r = classifyImportRow({ row: row({ plate_no: 'นข 800' }), schoolId: 'S1', vehicle: { matched: false, code: 'AMBIGUOUS_PLATE_NEEDS_PROVINCE' } });
    expect(r.classification).toBe('VEHICLE_MISSING_PROVINCE');
  });

  test('VEHICLE_SOFT_DELETED blocks the row', () => {
    const r = classifyImportRow({ row: row({ plate_no: 'นข 4337 ลำปาง' }), schoolId: 'S1', vehicle: { matched: false, code: 'SOFT_DELETED_VEHICLE_EXISTS', display_plate: 'นข 4337 ลำปาง' } });
    expect(r.classification).toBe('VEHICLE_SOFT_DELETED');
  });

  test('matched vehicle (alias) does not block; INSERT_NEW with matched id', () => {
    const r = classifyImportRow({ row: row({ plate_no: 'ออ 7332 กรุงเทพมหานคร' }), schoolId: 'S1', vehicle: { matched: true, code: 'VEHICLE_PROVINCE_ALIAS_MATCH', vehicle_id: 'V-bkk', display_plate: 'ออ 7332 กทม' } });
    expect(r.classification).toBe('INSERT_NEW');
    expect(r.matched_vehicle_id).toBe('V-bkk');
    expect(r.can_apply).toBe(true);
  });

  test('INVALID_STUDENT_CODE / INVALID_REQUIRED_FIELD / INVALID_GUARDIAN_PHONE', () => {
    expect(classifyImportRow({ row: row({ student_code: '' }), schoolId: 'S1' }).classification).toBe('INVALID_STUDENT_CODE');
    expect(classifyImportRow({ row: row({ last_name: '' }), schoolId: 'S1' }).classification).toBe('INVALID_REQUIRED_FIELD');
    expect(classifyImportRow({ row: row({ parent_phone: '123' }), schoolId: 'S1' }).classification).toBe('INVALID_GUARDIAN_PHONE');
  });

  test('maskPhone hides the middle digits', () => {
    expect(maskPhone('0812345678')).toBe('081****78');
  });
});
