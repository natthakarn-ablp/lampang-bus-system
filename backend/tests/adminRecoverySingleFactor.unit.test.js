'use strict';

/**
 * The recovery code is now optional, by configuration, and the default is
 * still to require it.
 *
 * Decision of 2026-09-07 by the system owner. The reasoning, both ways, is in
 * docs/project-closure/decision-2026-09-07-admin-recovery-single-factor.md:
 * a code sheet that was never saved makes recovery impossible, which is the
 * failure the feature exists to prevent; against that, the LINE link becomes
 * the only thing standing between someone holding that phone and the account
 * that can read every pupil record in the province.
 *
 * What this suite pins down:
 *  - the repository default stays "require a code" — only a deliberate
 *    ADMIN_RECOVERY_REQUIRE_CODE=false in the server's .env relaxes it, and it
 *    can be put back without a code change;
 *  - a code that IS supplied is still verified even when not required, so a
 *    stale page cannot skip verification by sending a wrong one;
 *  - the audit entry records which way the reset actually happened;
 *  - the controls that carry the weight when the code is gone are untouched:
 *    single-use link, 15-minute expiry, delivery only to the bound LINE, rate
 *    limits, and a push to that LINE the moment the password changes.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const envSrc = read('backend/src/config/env.js');
const route = read('backend/src/routes/adminPasswordRecovery.routes.js');
const page = read('frontend/src/pages/ResetPassword.jsx');

describe('the default is unchanged', () => {
  it('requires a code unless the setting says the string false', () => {
    expect(envSrc).toMatch(/adminRecoveryRequireCode: process\.env\.ADMIN_RECOVERY_REQUIRE_CODE !== 'false'/);
  });

  it('reads the same way with the variable absent', () => {
    const read1 = (v) => (v !== 'false');
    expect(read1(undefined)).toBe(true);
    expect(read1('')).toBe(true);
    expect(read1('true')).toBe(true);
    expect(read1('False')).toBe(true);   // only the exact string relaxes it
    expect(read1('false')).toBe(false);
  });
});

describe('completing a reset', () => {
  it('asks for the code only when it is required', () => {
    expect(route).toMatch(/const requireCode = env\.features\.adminRecoveryRequireCode/);
    expect(route).toMatch(/if \(requireCode && !codeSupplied\)/);
  });

  it('still verifies a code that was supplied when it was not required', () => {
    expect(route).toMatch(/if \(codeSupplied\) \{/);
    expect(route).toMatch(/if \(codeSupplied && !code\)/);
  });

  it('only burns a code when one was actually used', () => {
    expect(route).toMatch(/if \(code\) \{\s*await conn\.query\('UPDATE user_recovery_codes SET used_at = NOW\(\)/);
  });

  it('records in the audit trail which way it happened', () => {
    expect(route).toMatch(/method: code \? 'LINE_AND_RECOVERY_CODE' : 'LINE_LINK_ONLY'/);
    expect(route).toMatch(/recovery_code_required: requireCode/);
  });
});

describe('the controls that carry the weight without a code', () => {
  it('the link is single use and short lived', () => {
    expect(route).toMatch(/RESET_TTL_MINUTES = 15/);
    expect(route).toMatch(/UPDATE password_reset_requests SET used_at = NOW\(\) WHERE id = \?/);
  });

  it('a wrong code still burns the request after five tries', () => {
    expect(route).toMatch(/failed_attempts \+ 1 >= 5/);
  });

  it('the password change is pushed to the bound LINE', () => {
    expect(route).toMatch(/sendTextMessage\(/);
    expect(route).toContain('เปลี่ยนรหัสผ่านผู้ดูแลระบบ');
  });

  it('requests and completions stay rate limited', () => {
    expect(route).toMatch(/router\.post\('\/request', requestLimiter/);
    expect(route).toMatch(/router\.post\('\/complete', completeLimiter/);
  });
});

describe('the reset page asks only for what will be checked', () => {
  it('learns the requirement from the server', () => {
    expect(route).toMatch(/requires_recovery_code: env\.features\.adminRecoveryRequireCode/);
    expect(page).toMatch(/requires_recovery_code/);
  });

  it('defaults to showing the field if that lookup fails', () => {
    expect(page).toMatch(/useState\(true\)/);
  });

  it('omits the field and the value when no code is required', () => {
    expect(page).toMatch(/\{requiresCode && \(/);
    expect(page).toMatch(/\.\.\.\(requiresCode \? \{ recovery_code: form\.recovery_code \} : \{\}\)/);
  });
});

describe('no codes are dangled when the server will not check them', () => {
  it('binding issues codes only when they are required', () => {
    expect(route).toMatch(/const codes = env\.features\.adminRecoveryRequireCode\s*\?\s*await replaceRecoveryCodes\(conn, user\.id\)\s*:\s*\[\]/);
  });

  it('records how many were issued', () => {
    expect(route).toMatch(/recovery_codes_issued: codes\.length/);
  });

  it('status tells the page which flow is in force', () => {
    expect(route).toMatch(/requires_recovery_code: env\.features\.adminRecoveryRequireCode/);
  });

  const security = read('frontend/src/pages/admin/AdminAccountSecurity.jsx');

  it('the security page drops the code count, the regenerate button and the code instruction', () => {
    expect(security).toMatch(/status\.requires_recovery_code === false/);
    expect(security).toMatch(/status\?\.requires_recovery_code !== false && \(/);
    expect(security).toContain('ไม่ต้องใช้รหัสกู้คืน');
  });
});
