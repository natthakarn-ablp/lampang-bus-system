'use strict';

/**
 * Shared password-strength policy used by every password-set path
 * (auth change-password, driver change-password, admin reset, school teacher reset).
 *
 * Audit 2026-06-18 (auth-crypto): password minimums were inconsistent (4 chars on
 * the driver path, 6 elsewhere) with no complexity or blocklist check, and the
 * migrated legacy default was a trivial PIN. Centralising the rule in one helper
 * means a new route can never silently ship a weaker minimum.
 *
 * @param {string} password
 * @param {object} [opts]
 * @param {string} [opts.username] - reject password equal to the username
 * @returns {{ ok: boolean, message: string }}
 */
const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

// Trivial passwords seen in the legacy migration / common defaults.
const BLOCKLIST = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1',
  '00000000', '11111111', 'qwertyui', 'abc12345', 'iloveyou',
]);

function validatePassword(password, opts = {}) {
  const pw = password == null ? '' : String(password);

  if (pw.length < MIN_LENGTH) {
    return { ok: false, message: `รหัสผ่านต้องมีอย่างน้อย ${MIN_LENGTH} ตัวอักษร` };
  }
  if (pw.length > MAX_LENGTH) {
    return { ok: false, message: `รหัสผ่านต้องไม่เกิน ${MAX_LENGTH} ตัวอักษร` };
  }
  if (BLOCKLIST.has(pw.toLowerCase())) {
    return { ok: false, message: 'รหัสผ่านนี้คาดเดาง่ายเกินไป กรุณาใช้รหัสผ่านอื่น' };
  }
  if (opts.username && pw.toLowerCase() === String(opts.username).toLowerCase()) {
    return { ok: false, message: 'รหัสผ่านต้องไม่ตรงกับชื่อผู้ใช้' };
  }
  // Reject a single repeated character (e.g. "aaaaaaaa").
  if (/^(.)\1+$/.test(pw)) {
    return { ok: false, message: 'รหัสผ่านนี้คาดเดาง่ายเกินไป กรุณาใช้รหัสผ่านอื่น' };
  }

  return { ok: true, message: '' };
}

module.exports = { validatePassword, PASSWORD_MIN_LENGTH: MIN_LENGTH };
