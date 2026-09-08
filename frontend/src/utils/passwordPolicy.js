/**
 * Password rules, mirrored from the server so a form cannot promise something
 * the server will refuse.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The minimum length was written out by hand on every page that sets a
 * password, and the copies drifted. On 8 Sep 2026 the pages said three
 * different things while the server enforced one:
 *
 *   backend/src/utils/passwordPolicy.js   8   ← the only rule that is real
 *   ChangePassword, AffSchoolAccounts,
 *   ProvUnitAccounts                      8   correct, by coincidence
 *   UserManagement, SchoolTeacherAccounts 6   admins were told 6 and rejected
 *   DriverProfile                         4   drivers were told 4 and rejected
 *
 * A driver reading "อย่างน้อย 4 ตัวอักษร", typing four characters and being
 * refused has no way to discover the real rule; the field lied to them. The
 * training manual had already given up and told readers to ignore the screen
 * and remember 8 instead, which is a manual apologising for a bug.
 *
 * So the number lives here once, and backend/tests/frontendPasswordPolicyContract
 * .unit.test.js fails if this file and the server ever disagree again, or if a
 * page writes its own number instead of importing this one.
 */

/** Must equal MIN_LENGTH in backend/src/utils/passwordPolicy.js. */
export const PASSWORD_MIN_LENGTH = 8;

/** Must equal MAX_LENGTH in backend/src/utils/passwordPolicy.js. */
export const PASSWORD_MAX_LENGTH = 128;

/** Helper text for a password field, e.g. "อย่างน้อย 8 ตัวอักษร". */
export const PASSWORD_HELPER = `อย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`;

/** The message the server itself returns when the password is too short. */
export const PASSWORD_TOO_SHORT = `รหัสผ่านต้องมีอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`;

/**
 * True when the length rule is satisfied. This is a convenience for disabling a
 * submit button, NOT a validation: the server also rejects passwords equal to
 * the username, a single repeated character, and a blocklist of common choices.
 * Reproducing those here would create a second rule to drift, so the form should
 * let the server answer and show the message it returns.
 */
export function isLongEnough(password) {
  const pw = password == null ? '' : String(password);
  return pw.length >= PASSWORD_MIN_LENGTH && pw.length <= PASSWORD_MAX_LENGTH;
}
