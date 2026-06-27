'use strict';

/**
 * Regression — bulk school-account import must enforce the shared password
 * policy on an OPERATOR-TYPED initial_password, while leaving the school_code
 * default exempt.
 *
 * Security audit 2026-06-27 (MEDIUM#4 follow-up, found by adversarial review):
 * validateImportRow checked only `length < 4`, so an operator could bulk-create
 * accounts with passwords like "password" / "12345678". The single-account reset
 * path was already policy-checked — this closes the bulk-import inconsistency.
 * The school_code default (file omits the column) must stay exempt or every
 * 6-digit OBEC code would be rejected and bulk import would break.
 *
 * DB-free: _validateImportRow / _normalizeRow are pure and exported.
 */

require('./loadTestEnv');
const svc = require('../src/services/affiliationAdmin.service');

const EMPTY = () => new Set();
// Mirror resolveRowPassword(): typed initial_password wins, else school_code.
const rawPasswordOf = (raw, norm) => String(raw.initial_password || '').trim() || norm.school_code;

function validate(raw) {
  const norm = svc._normalizeRow(raw);
  const rawPassword = rawPasswordOf(raw, norm);
  return svc._validateImportRow(norm, rawPassword, EMPTY(), EMPTY(), EMPTY(), EMPTY());
}

const base = { rowNum: 2, school_code: '123456', school_name: 'โรงเรียนทดสอบ', username: '123456' };

describe('school-account import password policy (MEDIUM#4 follow-up)', () => {
  test('operator-typed blocklisted password is rejected (POLICY_PASSWORD)', () => {
    const r = validate({ ...base, initial_password: '12345678' });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('POLICY_PASSWORD');
  });

  test('operator-typed weak word "password" is rejected (POLICY_PASSWORD)', () => {
    const r = validate({ ...base, initial_password: 'password' });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('POLICY_PASSWORD');
  });

  test('operator-typed policy-compliant password is accepted', () => {
    const r = validate({ ...base, initial_password: 'Goodpass1' });
    expect(r.valid).toBe(true);
    expect(r.errors).not.toContain('POLICY_PASSWORD');
    expect(r.errors).not.toContain('WEAK_PASSWORD');
  });

  test('REGRESSION: school_code default (no typed password) stays policy-exempt and valid', () => {
    const r = validate({ ...base }); // no initial_password column → defaults to school_code "123456"
    expect(r.valid).toBe(true);
    expect(r.errors).not.toContain('POLICY_PASSWORD');
    expect(r.errors).not.toContain('WEAK_PASSWORD');
  });

  test('operator-typed too-short value still trips the minimal length check (WEAK_PASSWORD)', () => {
    const r = validate({ ...base, initial_password: 'ab' });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('WEAK_PASSWORD');
    expect(r.errors).not.toContain('POLICY_PASSWORD');
  });
});
