'use strict';

/**
 * lineBindGuard.js — Phase 10.13C-4A
 *
 * Credential-level throttle/lockout for LINE account binding, which by design
 * uses (parent phone + student code) as the credential — NO OTP/SMS. The global
 * per-IP limiter can be bypassed by rotating IPs, so this locks on the credential
 * itself: per phone, per student key, per phone+student pair, and per LINE sub.
 *
 * In-memory + single-instance (consistent with the login lockout and webhook
 * dedup). For a multi-instance deployment, back this with Redis/DB.
 *
 * All keys are HASHED (sha256) so raw phone numbers are never held as Map keys.
 * Time source is Date.now(); a clock injector is exposed for deterministic tests.
 */

const crypto = require('crypto');

const MIN = 60 * 1000;

// Per-key-type policy: how many failures in `windowMs` before locking for `lockMs`.
const POLICY = {
  pair:    { max: 5,  windowMs: 10 * MIN, lockMs: 30 * MIN },
  phone:   { max: 10, windowMs: 10 * MIN, lockMs: 30 * MIN },
  student: { max: 10, windowMs: 10 * MIN, lockMs: 30 * MIN },
  sub:     { max: 12, windowMs: 10 * MIN, lockMs: 30 * MIN },
};

// type+':'+hash  ->  { count, windowStart, lockedUntil }
const counters = new Map();
const MAX_ENTRIES = 50000; // backstop against unbounded growth

let nowFn = () => Date.now();

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/**
 * Build the hashed lockout keys for one attempt.
 * @param {object} parts
 * @param {string} parts.phone        normalized 10-digit phone
 * @param {string} parts.studentKey   student_code (optionally prefixed with school_id)
 * @param {string} [parts.sub]        verified LINE sub
 */
function keysFor({ phone, studentKey, sub }) {
  return {
    phone:   phone      ? `phone:${sha(phone)}`         : null,
    student: studentKey ? `student:${sha(studentKey)}` : null,
    pair:    (phone && studentKey) ? `pair:${sha(`${phone}:${studentKey}`)}` : null,
    sub:     sub        ? `sub:${sha(sub)}`             : null,
  };
}

function entryFor(mapKey) {
  let e = counters.get(mapKey);
  if (!e) {
    if (counters.size >= MAX_ENTRIES) {
      // drop the oldest ~10% (insertion order)
      let i = 0; const drop = Math.floor(MAX_ENTRIES * 0.1);
      for (const k of counters.keys()) { counters.delete(k); if (++i >= drop) break; }
    }
    e = { count: 0, windowStart: nowFn(), lockedUntil: 0 };
    counters.set(mapKey, e);
  }
  return e;
}

/**
 * Is any of the supplied keys currently locked?
 * @returns {{locked:boolean, which?:string, reason?:string, retryAfterSec?:number}}
 */
function checkLock(keys) {
  const now = nowFn();
  for (const type of ['pair', 'phone', 'student', 'sub']) {
    const mapKey = keys[type];
    if (!mapKey) continue;
    const e = counters.get(mapKey);
    if (e && e.lockedUntil > now) {
      return {
        locked: true,
        which: type,
        reason: `LOCKED_${type.toUpperCase()}`,
        retryAfterSec: Math.ceil((e.lockedUntil - now) / 1000),
      };
    }
  }
  return { locked: false };
}

/** Record a failed credential attempt against every supplied key. */
function noteFailure(keys) {
  const now = nowFn();
  for (const type of ['pair', 'phone', 'student', 'sub']) {
    const mapKey = keys[type];
    if (!mapKey) continue;
    const pol = POLICY[type];
    const e = entryFor(mapKey);
    if (now - e.windowStart > pol.windowMs) {
      e.windowStart = now; e.count = 1; e.lockedUntil = 0;
    } else {
      e.count += 1;
    }
    if (e.count >= pol.max) {
      e.lockedUntil = now + pol.lockMs;
    }
  }
}

/** Clear the failure counter for the exact pair after a legitimate success. */
function noteSuccess(keys) {
  if (keys.pair) counters.delete(keys.pair);
}

// ── test seam ────────────────────────────────────────────────────────────────
function __setClock(fn) { nowFn = typeof fn === 'function' ? fn : () => Date.now(); }
function __reset() { counters.clear(); nowFn = () => Date.now(); }

module.exports = {
  keysFor, checkLock, noteFailure, noteSuccess,
  POLICY, __setClock, __reset,
};
