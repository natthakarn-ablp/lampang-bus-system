'use strict';

/**
 * lineBindGuard.js — Phase 10.13C-4A, moved to shared state by A1-9.
 *
 * Credential-level throttle/lockout for LINE account binding, which by design
 * uses (parent phone + student code) as the credential — NO OTP/SMS. The global
 * per-IP limiter can be bypassed by rotating IPs, so this locks on the
 * credential itself: per phone, per student key, per phone+student pair, and
 * per LINE sub.
 *
 * WHAT CHANGED IN A1-9
 * --------------------
 * The counters used to be a `Map` in this process, with a comment saying so:
 * "In-memory + single-instance (consistent with the login lockout and webhook
 * dedup). For a multi-instance deployment, back this with Redis/DB."
 *
 * That is the same weakness the login lockout had. With N instances every one
 * of them believes it is enforcing 5 failures per pair while an attacker who
 * can reach all of them gets 5N, and a deploy released every lockout in force.
 * The counters now live in line_bind_lockouts (migration 051).
 *
 * All keys are still HASHED (sha256) — a raw phone number is never a key, in
 * memory or in a column.
 *
 * TIME COMES FROM THE DATABASE
 * ----------------------------
 * Every window and every lock expiry is evaluated with the database's NOW().
 * The point of sharing the state is that several processes read it; if each
 * judged expiry by its own clock, two hosts a minute apart would disagree about
 * whether the same lock is still in force. Same rule as
 * utils/sharedSecurityState.js.
 *
 * That is why the old `__setClock` seam is gone: a fake clock in this process
 * can no longer influence a comparison made inside MySQL. `__advance()`
 * replaces it and does the equivalent thing honestly — it ages the rows.
 *
 * CONCURRENCY
 * -----------
 * noteFailure() is one statement per key type. Two instances failing the same
 * credential at the same moment cannot both read 4 and both write 5: the
 * increment, the window reset and the lock decision are all inside the same
 * ON DUPLICATE KEY UPDATE, evaluated left to right so `attempt_count` in the
 * lock expression is already the incremented value.
 */

const crypto = require('crypto');
const { pool } = require('../config/database');

const MIN = 60 * 1000;

// Per-key-type policy: how many failures in `windowMs` before locking for `lockMs`.
const POLICY = {
  pair:    { max: 5,  windowMs: 10 * MIN, lockMs: 30 * MIN },
  phone:   { max: 10, windowMs: 10 * MIN, lockMs: 30 * MIN },
  student: { max: 10, windowMs: 10 * MIN, lockMs: 30 * MIN },
  sub:     { max: 12, windowMs: 10 * MIN, lockMs: 30 * MIN },
};

/** Checked in this order so the most specific lock is the one reported. */
const TYPES = ['pair', 'phone', 'student', 'sub'];

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/**
 * Build the hashed lockout keys for one attempt.
 *
 * The `<type>:<hash>` shape is kept from the Map version: callers pass this
 * object straight through, and the tests assert that no raw phone or student
 * code appears anywhere in it.
 *
 * @param {object} parts
 * @param {string} parts.phone        normalized 10-digit phone
 * @param {string} parts.studentKey   student_code (optionally prefixed with school_id)
 * @param {string} [parts.sub]        verified LINE sub
 */
function keysFor({ phone, studentKey, sub }) {
  return {
    phone:   phone      ? `phone:${sha(phone)}`        : null,
    student: studentKey ? `student:${sha(studentKey)}` : null,
    pair:    (phone && studentKey) ? `pair:${sha(`${phone}:${studentKey}`)}` : null,
    sub:     sub        ? `sub:${sha(sub)}`            : null,
  };
}

/** Strip the `<type>:` prefix — the table holds the type in its own column. */
function hashOf(key) {
  return key ? key.slice(key.indexOf(':') + 1) : null;
}

/**
 * Is any of the supplied keys currently locked?
 *
 * @param {object} keys from keysFor()
 * @returns {Promise<{locked:boolean, which?:string, reason?:string, retryAfterSec?:number}>}
 */
async function checkLock(keys) {
  for (const type of TYPES) {
    const hash = hashOf(keys[type]);
    if (!hash) continue;
    const [rows] = await pool.query(
      `SELECT TIMESTAMPDIFF(SECOND, NOW(), locked_until) AS retry_after
         FROM line_bind_lockouts
        WHERE lock_type = ? AND key_hash = ? AND locked_until > NOW()`,
      [type, hash]
    );
    if (rows.length > 0) {
      return {
        locked: true,
        which: type,
        reason: `LOCKED_${type.toUpperCase()}`,
        // A lock expiring within the current second reports 0 from
        // TIMESTAMPDIFF while locked_until > NOW() still holds. Report at least
        // one second so a caller never tells the user to retry immediately.
        retryAfterSec: Math.max(1, rows[0].retry_after || 0),
      };
    }
  }
  return { locked: false };
}

/**
 * Record a failed credential attempt against every supplied key.
 *
 * @param {object} keys from keysFor()
 * @returns {Promise<void>}
 */
async function noteFailure(keys) {
  for (const type of TYPES) {
    const hash = hashOf(keys[type]);
    if (!hash) continue;
    const pol = POLICY[type];
    const windowSec = Math.round(pol.windowMs / 1000);
    const lockSec = Math.round(pol.lockMs / 1000);
    await pool.query(
      `INSERT INTO line_bind_lockouts (lock_type, key_hash, attempt_count, window_start, locked_until)
       VALUES (?, ?, 1, NOW(), NULL)
       ON DUPLICATE KEY UPDATE
         attempt_count = IF(window_start < DATE_SUB(NOW(), INTERVAL ? SECOND), 1, attempt_count + 1),
         locked_until  = IF(attempt_count >= ?, DATE_ADD(NOW(), INTERVAL ? SECOND),
                            IF(window_start < DATE_SUB(NOW(), INTERVAL ? SECOND), NULL, locked_until)),
         window_start  = IF(window_start < DATE_SUB(NOW(), INTERVAL ? SECOND), NOW(), window_start)`,
      [type, hash, windowSec, pol.max, lockSec, windowSec, windowSec]
    );
  }
}

/**
 * Clear the failure counter for the exact pair after a legitimate success.
 *
 * Only the pair, as before: a correct credential says nothing about the other
 * attempts seen against that phone or that student code.
 *
 * @param {object} keys from keysFor()
 * @returns {Promise<void>}
 */
async function noteSuccess(keys) {
  const hash = hashOf(keys.pair);
  if (!hash) return;
  await pool.query(
    'DELETE FROM line_bind_lockouts WHERE lock_type = ? AND key_hash = ?', ['pair', hash]
  );
}

// ── test seams ───────────────────────────────────────────────────────────────

/**
 * Age every row by `ms`, as if that much time had passed.
 *
 * Replaces the old `__setClock`. A fake clock in this process cannot move a
 * comparison that MySQL makes against its own NOW(), so the honest equivalent
 * is to move the rows instead. Tests only.
 *
 * @param {number} ms
 */
async function __advance(ms) {
  const sec = Math.round(ms / 1000);
  await pool.query(
    `UPDATE line_bind_lockouts
        SET window_start = DATE_SUB(window_start, INTERVAL ? SECOND),
            locked_until = IF(locked_until IS NULL, NULL, DATE_SUB(locked_until, INTERVAL ? SECOND))`,
    [sec, sec]
  );
}

/** Tests only. */
async function __reset() {
  await pool.query('DELETE FROM line_bind_lockouts');
}

module.exports = {
  keysFor, checkLock, noteFailure, noteSuccess,
  POLICY, __advance, __reset,
};
