'use strict';

/**
 * Province-level account administration.
 *
 * WHY THIS EXISTS
 *   The hierarchy was one level short. An affiliation can already reset the
 *   password of a school in its own area (affiliationAdmin.service.js
 *   resetSchoolPassword) and a school can reset its own teacher sub-accounts,
 *   but nobody except the single admin could reset an affiliation or a
 *   transport account — backend/src/routes/province.routes.js had no write
 *   endpoint at all. So every forgotten password at that level became the
 *   admin's problem, which is exactly what the owner asked to stop
 *   (2026-09-07).
 *
 * WHAT IT DELIBERATELY CANNOT DO
 *   Only `affiliation` and `transport` accounts are reachable. A province may
 *   not reset an admin (that would be a privilege climb), another province
 *   (side-ways, no supervision relationship), a school (that belongs to the
 *   school's own affiliation, one level down) or a driver (belongs to the
 *   school). The role filter below is the whole of that rule, so it is stated
 *   once, in SQL, rather than assembled from conditionals.
 *
 * WHAT A RESET MUST NOT TOUCH
 *   role, scope_type, scope_id, grade_scope, driver_id, is_active — the
 *   columns listed as SCOPE_PRESERVED_COLUMNS in
 *   backend/src/config/accountRecoveryPolicy.js. A reset that widened a scope
 *   would be a privilege escalation dressed as a convenience. The UPDATE below
 *   writes only the password columns.
 */

const bcrypt = require('bcrypt');
const { pool } = require('../config/database');
const { validatePassword } = require('../utils/passwordPolicy');
const { logAudit } = require('../utils/audit');

const BCRYPT_COST = 12;

/** The only roles a province may administer. */
const MANAGED_ROLES = Object.freeze(['affiliation', 'transport']);

/**
 * Accounts a province may reset, with enough context to identify the holder.
 * No password material of any kind is selected.
 */
async function listManagedAccounts() {
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.role, u.display_name, u.scope_id, u.is_active,
            u.must_change_password, u.last_login,
            a.name AS affiliation_name
       FROM users u
       LEFT JOIN affiliations a
              ON a.id = u.scope_id AND u.role = 'affiliation' AND a.is_deleted = FALSE
      WHERE u.role IN (?) AND u.is_deleted = FALSE
      ORDER BY u.role, u.username`,
    [MANAGED_ROLES]
  );
  return rows;
}

/**
 * Set a new password on one affiliation or transport account.
 *
 * Mirrors affiliationAdmin.resetSchoolPassword: the same password policy, the
 * same forced change at next login, and password_changed_at set so that every
 * access and refresh token issued before the reset stops working immediately
 * rather than lingering for the rest of its lifetime.
 */
async function resetUnitAccountPassword({ accountId, newPassword, userId, ip = null, userAgent = null }) {
  const [[account]] = await pool.query(
    `SELECT id, username, role FROM users
      WHERE id = ? AND role IN (?) AND is_deleted = FALSE`,
    [accountId, MANAGED_ROLES]
  );
  if (!account) {
    const err = new Error('ไม่พบบัญชีนี้ หรือเป็นบัญชีที่จังหวัดไม่มีสิทธิ์รีเซ็ต (รีเซ็ตได้เฉพาะบัญชีสังกัดและขนส่ง)');
    err.statusCode = 404;
    throw err;
  }

  const pwCheck = validatePassword(newPassword, { username: account.username });
  if (!pwCheck.ok) {
    const err = new Error(pwCheck.message);
    err.statusCode = 400;
    throw err;
  }

  const hash = await bcrypt.hash(String(newPassword), BCRYPT_COST);
  await pool.query(
    `UPDATE users
        SET password_hash = ?, must_change_password = TRUE, password_changed_at = NOW()
      WHERE id = ?`,
    [hash, accountId]
  );

  // `username` is the key the other audit writers already use for the account
  // acted on (admin's create path and the school teacher reset both write it),
  // so a search for "what happened to this account" finds this row too. The
  // four reset paths still disagree on the action key itself — admin writes
  // action: 'reset_password', the school path writes action_detail — and that
  // is not resolved here, because changing a value already in production
  // rewrites the meaning of historical rows and is a decision of its own.
  await logAudit({
    userId, action: 'UPDATE', entityType: 'user', entityId: accountId,
    newValue: {
      action: 'password_reset',
      username: account.username,
      by_role: 'province',
      target_role: account.role,
    },
    ipAddress: ip, userAgent,
  });

  return { id: account.id, username: account.username, role: account.role };
}

module.exports = {
  MANAGED_ROLES,
  listManagedAccounts,
  resetUnitAccountPassword,
};
