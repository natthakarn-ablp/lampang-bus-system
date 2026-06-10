'use strict';

/**
 * hardening10_13b1.test.js  (Phase 10.13B-1)
 * CSV formula-injection neutralization, phone masking, and audit-value redaction.
 */
const { neutralizeSpreadsheetCell, maskPhone, redactAuditValue } = require('../src/utils/exportSecurity');

describe('CSV formula-injection neutralization', () => {
  test.each([
    ['=SUM(1,1)', "'=SUM(1,1)"],
    ['+cmd', "'+cmd"],
    ['-cmd', "'-cmd"],
    ['@cmd', "'@cmd"],
    ['\t=x', "'\t=x"],
  ])('neutralizes %p', (input, expected) => {
    expect(neutralizeSpreadsheetCell(input)).toBe(expected);
  });
  test('leaves safe values unchanged', () => {
    expect(neutralizeSpreadsheetCell('นข 800 ลำปาง')).toBe('นข 800 ลำปาง');
    expect(neutralizeSpreadsheetCell('3307')).toBe('3307');
    expect(neutralizeSpreadsheetCell(null)).toBe('');
  });
  // The frontend ImportPreviewModal uses the same rule: /^[=+\-@\t\r]/ → prefix '.
  test('frontend regex parity', () => {
    const fe = (v) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
    for (const v of ['=SUM(1,1)', '+cmd', '-cmd', '@cmd', 'safe', '3307']) {
      expect(fe(v)).toBe(neutralizeSpreadsheetCell(v));
    }
  });
});

describe('phone masking', () => {
  test('reveals only first 3 / last 3 digits', () => {
    expect(maskPhone('0812345678')).toBe('081****678');
    expect(maskPhone('')).toBe('');
    expect(maskPhone('12345')).toBe('****');
  });
});

describe('audit value redaction (JSON endpoint)', () => {
  test('masks guardian phone, redacts secrets, keeps reviewable fields', () => {
    const redacted = JSON.parse(redactAuditValue({ parent_phone: '0812345678', parent_name: 'พ่อ', password: 'secret', is_active: false }));
    expect(redacted.parent_phone).toBe('081****678');
    expect(redacted.password).toBe('[redacted]');
    expect(redacted.parent_name).toBe('พ่อ');
    expect(redacted.is_active).toBe(false);
  });
  test('accepts a JSON string and stays PII-safe', () => {
    const out = redactAuditValue(JSON.stringify({ driver_phone: '0998887777' }));
    expect(out).toContain('099****777');
    expect(out).not.toContain('0998887777');
  });
});
