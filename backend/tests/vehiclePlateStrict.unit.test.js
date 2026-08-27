'use strict';

const {
  buildStructuredPlate,
  formatPlateDisplay,
  validatePlateNo,
} = require('../src/utils/vehiclePlate');

describe('strict vehicle plate validation', () => {
  test('rejects a plate that omits province', () => {
    const r = validatePlateNo('นข1178');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('จังหวัด');
  });

  test('canonicalizes compact but complete plate text to prefix number province', () => {
    const r = validatePlateNo('นข1178ลำปาง');
    expect(r).toMatchObject({
      valid: true,
      trimmed: 'นข 1178 ลำปาง',
      normalized: 'นข1178ลำปาง',
    });
  });

  test('canonicalizes province abbreviations to full province names', () => {
    const r = validatePlateNo('นข 8276 ลป.');
    expect(r).toMatchObject({
      valid: true,
      trimmed: 'นข 8276 ลำปาง',
      normalized: 'นข8276ลำปาง',
    });
  });

  test('structured plate builder rejects incomplete province and normalizes aliases', () => {
    expect(buildStructuredPlate({ prefix: 'นข', number: '1178', province: '' }).valid).toBe(false);
    expect(buildStructuredPlate({ prefix: 'นข', number: '8276', province: 'ลป.' })).toMatchObject({
      valid: true,
      plateNo: 'นข 8276 ลำปาง',
      normalized: 'นข8276ลำปาง',
    });
  });

  test('display formatter returns canonical spaced display with full province', () => {
    expect(formatPlateDisplay('ออ7332กทม')).toBe('ออ 7332 กรุงเทพมหานคร');
  });
});
