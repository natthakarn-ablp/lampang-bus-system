'use strict';

/**
 * The password rule the screen shows must be the rule the server enforces.
 *
 * WHAT WENT WRONG
 * ---------------
 * The minimum length was typed by hand into every form that sets a password, and
 * the copies drifted apart. On 8 Sep 2026 three different numbers were live at
 * once while the server enforced one:
 *
 *   server                                     8
 *   ChangePassword / AffSchoolAccounts /
 *   ProvUnitAccounts / ResetPassword           8   correct
 *   UserManagement / SchoolTeacherAccounts     6   rejected on submit
 *   DriverProfile                              4   rejected on submit
 *
 * A driver — the least technical user of this system — read "อย่างน้อย 4
 * ตัวอักษร", typed four characters, and was refused by the server with no way to
 * discover the real rule. The training manual had already noticed and told
 * readers to disbelieve the screen, which is a manual apologising for a bug
 * rather than a bug being fixed.
 *
 * This test makes the drift impossible to repeat: one number on each side, and
 * no page may write its own.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { PASSWORD_MIN_LENGTH } = require('../src/utils/passwordPolicy');
const FRONTEND_POLICY = fs.readFileSync(
  path.join(ROOT, 'frontend', 'src', 'utils', 'passwordPolicy.js'), 'utf8'
);

/** Every .jsx page in the frontend, so a new page cannot be forgotten. */
function pageFiles() {
  const base = path.join(ROOT, 'frontend', 'src', 'pages');
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsx')) out.push(full);
    }
  })(base);
  return out;
}

function readNumber(name) {
  const m = FRONTEND_POLICY.match(new RegExp(`export const ${name} = (\\d+);`));
  return m ? Number(m[1]) : null;
}

describe('the frontend states the same password rule the server enforces', () => {
  it('the shared frontend constant equals the server minimum', () => {
    // The server module is the single source of truth; the frontend cannot
    // import it (different bundle), so it mirrors the value and this asserts it.
    expect(readNumber('PASSWORD_MIN_LENGTH')).toBe(PASSWORD_MIN_LENGTH);
  });

  it('the frontend maximum equals the server maximum', () => {
    const server = fs.readFileSync(
      path.join(ROOT, 'backend', 'src', 'utils', 'passwordPolicy.js'), 'utf8'
    );
    const max = Number(server.match(/const MAX_LENGTH = (\d+);/)[1]);
    expect(readNumber('PASSWORD_MAX_LENGTH')).toBe(max);
  });

  it('the helper text is built from the constant, not typed out', () => {
    expect(FRONTEND_POLICY).toMatch(/PASSWORD_HELPER = `อย่างน้อย \$\{PASSWORD_MIN_LENGTH\} ตัวอักษร`/);
  });
});

describe('no page writes its own password length', () => {
  /**
   * The pattern that caused the bug: a bare number inside a password rule.
   * Matching is deliberately narrow — a digit near the word รหัสผ่าน, a
   * minLength on a password field, or a length comparison on a password
   * variable — so ordinary numbers elsewhere on a page do not trip it.
   */
  const OFFENDERS = [
    { re: /อย่างน้อย\s*\d+\s*ตัว/, why: 'ข้อความบอกความยาวขั้นต่ำที่เขียนตัวเลขเอง' },
    { re: /รหัสผ่าน[^\n]{0,40}?\(\s*อย่างน้อย\s*\d/, why: 'ป้ายช่องรหัสผ่านที่เขียนตัวเลขเอง' },
    { re: /(?:password|pwd)\w*\.length\s*[<>]=?\s*\d+/i, why: 'เงื่อนไขความยาวรหัสผ่านที่เขียนตัวเลขเอง' },
  ];

  it.each(pageFiles().map((f) => [path.relative(ROOT, f), f]))('%s', (rel, file) => {
    const src = fs.readFileSync(file, 'utf8');
    for (const { re, why } of OFFENDERS) {
      const hit = src.match(re);
      if (hit) {
        throw new Error(
          `${rel} — ${why}: ${JSON.stringify(hit[0])}\n` +
          "ให้ import จาก utils/passwordPolicy แทน (PASSWORD_MIN_LENGTH / PASSWORD_HELPER / PASSWORD_TOO_SHORT)"
        );
      }
    }
  });

  it('a minLength on a password input comes from the constant', () => {
    for (const file of pageFiles()) {
      const src = fs.readFileSync(file, 'utf8');
      // Only look at files that actually handle a password.
      if (!/type="password"/.test(src)) continue;
      const numeric = src.match(/minLength=\{\s*\d+\s*\}/g);
      expect(numeric).toBeNull();
    }
  });
});

describe('the pages that set a password import the shared rule', () => {
  it('every page with a password field pulls in the policy module', () => {
    const missing = [];
    for (const file of pageFiles()) {
      const src = fs.readFileSync(file, 'utf8');
      if (!/type="password"/.test(src)) continue;
      // A page may render a password field purely to collect it — the login
      // form, or the account-security page asking for the CURRENT password to
      // prove who you are — without stating any rule about its shape. Those
      // must not state one either, which the block above already enforces.
      // Only a page that constrains a NEW password has to use the constant, so
      // the test looks for a password-specific constraint and not for any
      // `.length`, which would also match an unrelated array on the page.
      const constrains = /PASSWORD_MIN_LENGTH/.test(src)
        || /minLength=/.test(src)
        || /(?:password|pwd)\w*\.length\s*[<>]=?/i.test(src);
      if (constrains && !/utils\/passwordPolicy/.test(src)) missing.push(path.relative(ROOT, file));
    }
    expect(missing).toEqual([]);
  });
});
