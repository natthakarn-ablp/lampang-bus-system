'use strict';

/**
 * Release an account's LINE password-recovery binding.
 *
 * Owner decision 2026-11-13 (backend/src/config/accountRecoveryPolicy.js):
 * when a school or driver account changes hands, revocation is "the school
 * (or the affiliation / admin, whoever may reset that account) resets the
 * password". A reset on its own would NOT revoke anything: the previous
 * holder's LINE would stay bound and could request a fresh reset link the
 * same afternoon. So every password reset performed by someone other than the
 * account holder also releases the binding, the same cleanup the holder's own
 * unlink and the account-delete paths already do.
 *
 * Callers run this inside their own transaction, after locking the user row.
 * Only the three migration-049 tables are touched; no column of `users` is,
 * so SCOPE_PRESERVED_COLUMNS are untouched by construction.
 *
 * @param {{ query: Function }} executor  pool or transaction connection
 * @param {number} userId
 * @returns {Promise<number>} binding rows released (0 or 1)
 */
async function releaseRecoveryBinding(executor, userId) {
  await executor.query(
    'DELETE FROM password_reset_requests WHERE user_id = ? AND used_at IS NULL',
    [userId]
  );
  await executor.query('DELETE FROM user_recovery_codes WHERE user_id = ?', [userId]);
  const result = await executor.query('DELETE FROM user_recovery_channels WHERE user_id = ?', [userId]);
  const head = Array.isArray(result) ? result[0] : result;
  return (head && head.affectedRows) || 0;
}

module.exports = { releaseRecoveryBinding };
