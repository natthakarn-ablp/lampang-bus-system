'use strict';

/**
 * sessionReset.js — invalidate every token a user holds, at once.
 *
 * WHY THIS EXISTS
 * ---------------
 * /refresh-token already rotates: the old refresh token is revoked and a new one
 * issued, so a stolen token is good for one use instead of seven days. What
 * rotation alone does not do is notice that the theft happened.
 *
 * After a token is stolen, both parties hold the same refresh token R1. One of
 * them refreshes first and gets R2; R1 goes on the revocation list. When the
 * other presents R1, the old code answered 401 and stopped there — correct for
 * that one request, and useless overall, because whoever won the race is still
 * holding a valid R2 and keeps rotating it indefinitely. The victim just sees
 * one logout.
 *
 * A refresh token presented after it has been revoked is not an ordinary
 * expiry: a well-behaved client never re-sends a token it has already exchanged.
 * It means two parties held the same token, and the only safe response is to
 * end every session for that user, whichever side is the attacker.
 *
 * WHY A SENTINEL ROW AND NOT A COLUMN
 * -----------------------------------
 * The natural design is a column, and that is the better long-term shape. It
 * needs a migration, which is an owner decision (CLAUDE.md rule 11), so this
 * uses the table that already exists: revoked_tokens keyed by a sentinel jti.
 * The key is 'session-reset:<user_id>', which cannot collide with a real jti
 * because those are uuidv4. revoked_at is the cutoff, and expires_at lets the
 * existing daily cleanup drop the row once no live token could predate it.
 *
 * PROPOSED DDL, for whoever owns the schema decision:
 *
 *   ALTER TABLE users
 *     ADD COLUMN sessions_reset_at TIMESTAMP NULL DEFAULT NULL
 *     COMMENT 'tokens issued at or before this moment are rejected';
 *
 *   ALTER TABLE revoked_tokens
 *     ADD COLUMN reason ENUM('LOGOUT','ROTATION','PASSWORD_CHANGE') NOT NULL
 *     DEFAULT 'ROTATION';
 *
 * The first replaces the sentinel with a column the middleware already joins to.
 * The second is worth more: without it, logout and rotation are indistinguishable
 * here, so a client that re-presents a token it logged out with — more than
 * REPLAY_GRACE_MS ago — is read as a replay and every other session for that
 * account ends too. The user re-authenticates and loses nothing, but it is a
 * false positive that a reason column would remove outright.
 *
 * The check itself mirrors one the codebase already relies on: the auth
 * middleware rejects any access token whose iat predates password_changed_at.
 * This is the same rule against a different timestamp.
 */

const SENTINEL_PREFIX = 'session-reset:';

/** The revoked_tokens key holding a user's cutoff. */
function sessionResetJti(userId) {
  return `${SENTINEL_PREFIX}${userId}`;
}

/**
 * Parse the JWT lifetime strings used in config ('7d', '24h', '30m', '45s') or a
 * raw number of seconds. Returns milliseconds.
 *
 * Falls back to 7 days rather than throwing: this value only decides when the
 * cleanup job may drop the sentinel, and a sentinel that lives too long is
 * harmless (it rejects tokens that were already expired), while one that is
 * dropped too early would silently reopen the session it closed.
 */
function durationMs(value, fallbackMs = 7 * 24 * 60 * 60 * 1000) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value * 1000;
  const m = /^(\d+)\s*([smhd])$/.exec(String(value || '').trim());
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2]];
  return n * unit;
}

/**
 * Record that every token issued for this user up to now is no longer valid.
 * Idempotent: a second replay pushes the cutoff forward rather than failing on
 * the primary key.
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} userId
 * @param {number} ttlMs how long the sentinel must outlive the longest token
 */
async function recordSessionReset(pool, userId, ttlMs) {
  const expiresAt = new Date(Date.now() + ttlMs);
  await pool.query(
    `INSERT INTO revoked_tokens (jti, user_id, expires_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE revoked_at = CURRENT_TIMESTAMP, expires_at = VALUES(expires_at)`,
    [sessionResetJti(userId), userId, expiresAt]
  );
}

/**
 * True when a token was issued at or before the cutoff.
 *
 * `<=`, not `<`. revoked_at has one-second resolution and so does iat, so a
 * token minted in the same second as the reset is indistinguishable from one
 * minted just before it — and this is a theft response, so the ambiguous case
 * has to fall on the side of rejecting. The cost is that a user who logs back in
 * within the same second is asked to log in once more.
 *
 * @param {number|undefined} iat JWT issued-at, in seconds
 * @param {Date|string|null|undefined} resetAt
 */
function issuedBeforeReset(iat, resetAt) {
  if (!resetAt || !iat) return false;
  const cutoff = Math.floor(new Date(resetAt).getTime() / 1000);
  if (!Number.isFinite(cutoff)) return false;
  return iat <= cutoff;
}

module.exports = {
  SENTINEL_PREFIX,
  sessionResetJti,
  durationMs,
  recordSessionReset,
  issuedBeforeReset,
};
