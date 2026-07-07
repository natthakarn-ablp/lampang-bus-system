'use strict';

/**
 * Regression — bulk school-account import must enforce the shared password
 * policy on initial_password and reject blank passwords instead of using
 * school_code as a default.
 *
 * Security audit 2026-06-27 (MEDIUM#4 follow-up, found by adversarial review):
 * validateImportRow checked only `length < 4`, so an operator could bulk-create
 * accounts with passwords like "password" / "12345678". The single-account reset
 * path was already policy-checked — this closes the bulk-import inconsistency.
 * Blank passwords used to default to school_code, which is predictable.
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

  test('REGRESSION: blank password is rejected instead of defaulting to school_code', () => {
    const r = validate({ ...base });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('MISSING_PASSWORD');
  });

  test('operator-typed too-short value still trips the minimal length check (WEAK_PASSWORD)', () => {
    const r = validate({ ...base, initial_password: 'ab' });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('WEAK_PASSWORD');
    expect(r.errors).not.toContain('POLICY_PASSWORD');
  });
});
