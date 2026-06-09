'use strict';

/**
 * structuredPlate.test.js  (Phase 10.13A-22)
 *
 * PURE unit tests for buildStructuredPlate — the backend canonicalizer that
 * turns structured plate parts (หมวดอักษร / เลขทะเบียน / จังหวัด) into the
 * canonical display plate_no + normalized key. No DB / no globalSetup.
 */

const { buildStructuredPlate, normalizePlate, isProvinceVariant } = require('../src/utils/vehiclePlate');

describe('buildStructuredPlate', () => {
  test('1. valid parts build canonical display plate + normalized key', () => {
    const r = buildStructuredPlate({ prefix: 'นข', number: '4337', province: 'ลำปาง' });
    expect(r.valid).toBe(true);
    expect(r.plateNo).toBe('นข 4337 ลำปาง');
    expect(r.normalized).toBe('นข4337ลำปาง');
  });

  test('2. กรุงเทพมหานคร province', () => {
    const r = buildStructuredPlate({ prefix: 'ออ', number: '7332', province: 'กรุงเทพมหานคร' });
    expect(r.plateNo).toBe('ออ 7332 กรุงเทพมหานคร');
    expect(r.normalized).toBe('ออ7332กรุงเทพมหานคร');
  });

  test('3. matches free-text normalization (so the duplicate guard sees the same key)', () => {
    const r = buildStructuredPlate({ prefix: 'นข', number: '4337', province: 'ลำปาง' });
    expect(r.normalized).toBe(normalizePlate('นข 4337 ลำปาง'));
    expect(r.normalized).toBe(normalizePlate('นข4337ลำปาง'));
  });

  test('4. incomplete (missing province) → PLATE_FIELDS_REQUIRED', () => {
    const r = buildStructuredPlate({ prefix: 'นข', number: '4337', province: '' });
    expect(r.valid).toBe(false);
    expect(r.code).toBe('PLATE_FIELDS_REQUIRED');
    expect(r.error).toMatch(/ครบถ้วน/);
  });

  test('5. incomplete (missing prefix / number) → PLATE_FIELDS_REQUIRED', () => {
    expect(buildStructuredPlate({ prefix: '', number: '4337', province: 'ลำปาง' }).code).toBe('PLATE_FIELDS_REQUIRED');
    expect(buildStructuredPlate({ prefix: 'นข', number: '', province: 'ลำปาง' }).code).toBe('PLATE_FIELDS_REQUIRED');
    expect(buildStructuredPlate(undefined).code).toBe('PLATE_FIELDS_REQUIRED');
  });

  test('6. non-digit number / non-Thai prefix → PLATE_FORMAT_INVALID', () => {
    expect(buildStructuredPlate({ prefix: 'นข', number: '43A7', province: 'ลำปาง' }).code).toBe('PLATE_FORMAT_INVALID');
    expect(buildStructuredPlate({ prefix: '123', number: '4337', province: 'ลำปาง' }).code).toBe('PLATE_FORMAT_INVALID');
  });

  test('7. leading-digit prefix (e.g. 1นค) is accepted', () => {
    const r = buildStructuredPlate({ prefix: '1นค', number: '1589', province: 'กรุงเทพมหานคร' });
    expect(r.valid).toBe(true);
    expect(r.plateNo).toBe('1นค 1589 กรุงเทพมหานคร');
  });

  test('8. trims whitespace in each part', () => {
    const r = buildStructuredPlate({ prefix: ' นข ', number: ' 4337 ', province: ' ลำปาง ' });
    expect(r.valid).toBe(true);
    expect(r.plateNo).toBe('นข 4337 ลำปาง');
  });

  test('9. province-variant detection still works on structured output', () => {
    const withProv = buildStructuredPlate({ prefix: 'นข', number: '4337', province: 'ลำปาง' }).normalized;
    expect(isProvinceVariant(withProv, 'นข4337')).toBe(true); // vs a province-omitted dup
  });
});
