'use strict';

/**
 * sharedSecurityState.js — the counters that decide whether a request is
 * refused, kept where every instance can see them (task A1-9).
 *
 * WHAT WAS WRONG
 * --------------
 * Two of them lived in a `Map` inside one Node process:
 *
 *   auth.routes.js:36   LOGIN_FAILS  — failed logins per (username + IP);
 *                       10 in 15 minutes locks that pair out
 *   line.routes.js:50   SEEN_EVENTS  — a 5,000-entry ring of LINE webhook
 *                       event ids already handled
 *
 * The comment above LOGIN_FAILS stated the condition out loud: single instance
 * (pm2 fork), move to a shared store before running more than one. Until then
 * the lockout ceiling is multiplied by the instance count — an attacker able to
 * reach N instances gets 10xN attempts against one account while every instance
 * believes it is enforcing 10.
 *
 * SEEN_EVENTS has a second failure mode that does not need a second instance:
 * the ring holds 5,000 ids, LINE redelivers on timeout, and a redelivery of an
 * event that has since fallen out of the ring is processed again — a duplicate
 * notification and a duplicate row.
 *
 * WHY THE TIME COMES FROM THE DATABASE
 * ------------------------------------
 * Every window here is evaluated with the database's NOW(), not the app host's
 * clock. The whole point of moving the state is that several app processes
 * share it; if each one judged the window by its own clock, two instances with
 * a minute of skew would disagree about whether the same row is still in force.
 * There is exactly one clock in this design and it is the one next to the data.
 *
 * WHAT IS NOT HERE
 * ----------------
 * The LINE account-linking session (line.service.js:40) stays in memory. The
 * table for it would hold a phone number in readable form — the next step of
 * the flow matches against the value the user typed — and
 * docs/security/shared-state-ddl-proposal-2026-09-05.md §3 says a DPO has to
 * decide under D0-8 whether that may be stored unencrypted. That decision has
 * not been made. The cost of leaving it is that on a multi-instance deployment
 * a user's next message can land somewhere that does not hold their
 * half-finished session and they start again — an interruption, not a weakened
 * control.
 */

const crypto = require('crypto');
const { pool } = require('../config/database');

/** 10 failures in 15 minutes locks the (username + IP) pair. */
const LOGIN_LOCK = Object.freeze({ THRESHOLD: 10, WINDOW_SEC: 15 * 60 });

/**
 * The lookup key for a login attempt.
 *
 * Hashed rather than stored: the check only ever needs equality, never the
 * original value, and username and IP are both personal data. Same normalising
 * as the Map version — trimmed and lower-cased — so an attacker cannot get a
 * fresh budget by changing the case of the username.
 *
 * The two parts are JSON-encoded rather than joined with a separator. The Map
 * version used `${username}|${ip}`, under which ('a|b', 'c') and ('a', 'b|c')
 * are the same key. Not reachable today — req.ip cannot contain a pipe — so
 * this is not a regression being fixed, but an ambiguity not worth carrying
 * into a table that other things will key on later.
 *
 * @param {string} username
 * @param {string} ip
 * @returns {string} 64 hex characters
 */
function loginLockKey(username, ip) {
  const normalised = JSON.stringify([String(username || '').trim().toLowerCase(), String(ip || '')]);
  return crypto.createHash('sha256').update(normalised).digest('hex');
}

/**
 * Is this (username + IP) currently locked out?
 *
 * The window is applied in the WHERE clause rather than by reading the row and
 * comparing in JS, so a row whose window has expired is simply not found and
 * needs no cleanup pass to stop counting.
 *
 * @param {string} keyHash from loginLockKey()
 * @returns {Promise<boolean>}
 */
async function isLoginLocked(keyHash) {
  const [rows] = await pool.query(
    `SELECT fail_count FROM login_lockouts
      WHERE key_hash = ? AND window_start >= DATE_SUB(NOW(), INTERVAL ? SECOND)`,
    [keyHash, LOGIN_LOCK.WINDOW_SEC]
  );
  return rows.length > 0 && rows[0].fail_count >= LOGIN_LOCK.THRESHOLD;
}

/**
 * Record one failed login.
 *
 * One statement, so two instances failing the same account at the same moment
 * cannot both read 9 and both write 10. The window reset is inside the same
 * statement for the same reason: reading the row, deciding it has expired and
 * then writing 1 would let a concurrent failure be lost.
 *
 * @param {string} keyHash
 * @returns {Promise<void>}
 */
async function noteLoginFail(keyHash) {
  await pool.query(
    `INSERT INTO login_lockouts (key_hash, fail_count, window_start)
     VALUES (?, 1, NOW())
     ON DUPLICATE KEY UPDATE
       fail_count   = IF(window_start < DATE_SUB(NOW(), INTERVAL ? SECOND), 1, fail_count + 1),
       window_start = IF(window_start < DATE_SUB(NOW(), INTERVAL ? SECOND), NOW(), window_start)`,
    [keyHash, LOGIN_LOCK.WINDOW_SEC, LOGIN_LOCK.WINDOW_SEC]
  );
}

/**
 * Forget the failures for this key after a successful login.
 *
 * @param {string} keyHash
 * @returns {Promise<void>}
 */
async function clearLoginFails(keyHash) {
  await pool.query('DELETE FROM login_lockouts WHERE key_hash = ?', [keyHash]);
}

/**
 * Claim a LINE webhook event, returning whether someone already had it.
 *
 * INSERT IGNORE plus affectedRows is the whole mechanism: exactly one caller
 * gets the insert, everyone else gets 0 rows and knows to skip. That is atomic
 * across instances, which a Map could never be.
 *
 * It is NOT a fix for a same-process race — the Map version was already safe
 * there, because alreadyProcessed() was synchronous with no await between the
 * has and the set, so no interleaving was possible. What it fixes is two
 * processes, and a redelivery arriving after the ring had forgotten the event.
 *
 * An event with no id is treated as never seen. LINE always sends one; a
 * missing id means a malformed body, and processing it once is better than
 * letting every such event collide on the same empty key.
 *
 * @param {string} eventId  LINE webhookEventId
 * @returns {Promise<boolean>} true if this event was already handled
 */
async function alreadyProcessed(eventId) {
  if (!eventId) return false;
  const [result] = await pool.query(
    'INSERT IGNORE INTO line_webhook_events_seen (event_id, seen_at) VALUES (?, NOW())',
    [String(eventId).slice(0, 64)]
  );
  return result.affectedRows === 0;
}

module.exports = {
  LOGIN_LOCK,
  loginLockKey,
  isLoginLocked,
  noteLoginFail,
  clearLoginFails,
  alreadyProcessed,
};
