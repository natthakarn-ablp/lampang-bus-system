'use strict';

/**
 * exportSecurity.test.js  (Phase 10.12G)
 *
 * PURE unit tests for the export-hardening helpers — no DB, no globalSetup.
 */

const {
  neutralizeSpreadsheetCell,
  csvCell,
  maskPhone,
  maskLineUserId,
  redactAuditValue,
} = require('../src/utils/exportSecurity');

describe('neutralizeSpreadsheetCell (formula injection)', () => {
  test.each([
    ['=1+1'],
    ['+CMD'],
    ['-2+3'],
    ['@SUM(A1:A2)'],
    ['\t=HYPERLINK("http://x")'],
    ['\r=cmd'],
  ])('neutralises %p with a leading apostrophe', (input) => {
    const out = neutralizeSpreadsheetCell(input);
    expect(out.startsWith("'")).toBe(true);
    expect(out).toBe(`'${input}`);
  });

  test('leaves ordinary Thai/English text unchanged', () => {
    expect(neutralizeSpreadsheetCell('เด็กชายธนกร ใจดี')).toBe('เด็กชายธนกร ใจดี');
    expect(neutralizeSpreadsheetCell('นข 2210 ลำปาง')).toBe('นข 2210 ลำปาง');
    expect(neutralizeSpreadsheetCell('Grade 1/2')).toBe('Grade 1/2');
  });

  test('null/undefined → empty string', () => {
    expect(neutralizeSpreadsheetCell(null)).toBe('');
    expect(neutralizeSpreadsheetCell(undefined)).toBe('');
  });
});

describe('csvCell', () => {
  test('neutralises and RFC-4180 quotes', () => {
    expect(csvCell('=1+1')).toBe(`"'=1+1"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('she said "hi"')).toBe('"she said ""hi"""');
  });
});

describe('maskPhone', () => {
  test('masks a 10-digit Thai phone', () => {
    const m = maskPhone('0901234567');
    expect(m).toBe('090****567');
    expect(m).not.toContain('1234'); // middle digits hidden
  });
  test('short/empty → safe mask', () => {
    expect(maskPhone('123')).toBe('****');
    expect(maskPhone('')).toBe('');
    expect(maskPhone(null)).toBe('');
  });
});

describe('maskLineUserId', () => {
  test('never exposes the full id', () => {
    const full = 'U1234567890abcdef1234567890abcdef';
    const m = maskLineUserId(full);
    expect(m).not.toBe(full);
    expect(m).not.toContain('abcdef1234567890abcdef');
    expect(m).toContain('[redacted]');
  });
});

describe('redactAuditValue', () => {
  test('removes secrets and masks phone/line id recursively', () => {
    const input = {
      action: 'reset_password',
      password: 'plaintext',
      password_hash: '$2b$12$abcdefghijklmnopqrstuv',
      refresh_token: 'eyJ...secret',
      parent_phone: '0901234567',
      nested: { phone: '0812345678', line_user_id: 'U' + 'a'.repeat(32), note: 'ok' },
    };
    const out = redactAuditValue(input);
    expect(out).not.toContain('plaintext');
    expect(out).not.toContain('$2b$');
    expect(out).not.toContain('eyJ');
    expect(out).not.toContain('0901234567');
    expect(out).not.toContain('0812345678');
    expect(out).not.toMatch(/U a{32}|Ua{32}/);
    const parsed = JSON.parse(out);
    expect(parsed.password).toBe('[redacted]');
    expect(parsed.parent_phone).toBe('090****567');
    expect(parsed.nested.note).toBe('ok'); // non-sensitive preserved
    expect(parsed.nested.line_user_id).toContain('[redacted]');
  });

  test('accepts a JSON string and redacts it', () => {
    const out = redactAuditValue('{"phone":"0901234567","x":1}');
    const parsed = JSON.parse(out);
    expect(parsed.phone).toBe('090****567');
    expect(parsed.x).toBe(1);
  });

  test('unparseable string → safe placeholder, never the raw value', () => {
    const out = redactAuditValue('not json with phone 0901234567');
    expect(out).toBe('[redacted: unparseable audit value]');
    expect(out).not.toContain('0901234567');
  });

  test('empty/null → empty string', () => {
    expect(redactAuditValue(null)).toBe('');
    expect(redactAuditValue('')).toBe('');
  });
});
