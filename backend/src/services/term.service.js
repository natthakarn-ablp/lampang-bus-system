'use strict';

// Dynamic "current term" (academic semester) resolved from the DB (terms.is_current)
// instead of a restart-frozen env var, so an admin can roll the term over from the
// UI without editing .env + restarting every semester. Single pm2 fork instance, so
// a module-level TTL cache is correct (no cross-process invalidation needed). Falls
// back to env.app.currentTerm when no is_current row exists, so deploying this code
// BEFORE migration 046 runs changes nothing. See plan: dynamic current term.

const env = require('../config/env');
const { logAudit } = require('../utils/audit');

const TTL_MS = 60_000;
const TERM_ID_RE = /^\d{4}-[123]$/; // e.g. 2568-2

let _cache = { value: null, expiresAt: 0 };

function appError(message, statusCode = 400, code = 'TERM_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.errors = [{ code }];
  return err;
}

function _envFallback() {
  return env.app.currentTerm;
}

function _setCache(value) {
  _cache = { value, expiresAt: Date.now() + TTL_MS };
}

function invalidateTermCache() {
  _cache = { value: null, expiresAt: 0 };
}

/**
 * Async source of truth for the current term id. Cached for TTL_MS so the hot
 * check-in path issues at most one tiny indexed SELECT per minute. Any DB error
 * falls back to the last-known value / env — resolving the term must NEVER break
 * a check-in.
 */
async function getCurrentTerm(pool) {
  if (_cache.value && Date.now() < _cache.expiresAt) return _cache.value;
  try {
    const [[row]] = await pool.query(
      'SELECT id FROM terms WHERE is_current = TRUE ORDER BY id DESC LIMIT 1'
    );
    const val = row ? row.id : _envFallback();
    _setCache(val);
    return val;
  } catch {
    return _cache.value || _envFallback();
  }
}

/**
 * Synchronous last-known-good — for code paths without a handy pool. Returns the
 * cached value, else the env fallback (never null). Kept fresh by getCurrentTerm()
 * (TTL refresh) and setCurrentTerm() (immediate update).
 */
function getCurrentTermCachedSync() {
  return _cache.value || _envFallback();
}

async function listTerms(pool) {
  const [rows] = await pool.query(
    'SELECT id, name, start_date, end_date, is_current FROM terms ORDER BY id DESC'
  );
  return rows;
}

async function createTerm(pool, { id, name = null, startDate = null, endDate = null }, actor = {}) {
  const termId = String(id == null ? '' : id).trim();
  if (!TERM_ID_RE.test(termId)) {
    throw appError('รหัสภาคเรียนไม่ถูกต้อง (รูปแบบ เช่น 2568-2)', 400, 'BAD_TERM_ID');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[exists]] = await conn.query('SELECT id FROM terms WHERE id = ? FOR UPDATE', [termId]);
    if (exists) throw appError('ภาคเรียนนี้มีอยู่แล้ว', 409, 'TERM_EXISTS');
    await conn.query(
      'INSERT INTO terms (id, name, start_date, end_date, is_current) VALUES (?, ?, ?, ?, FALSE)',
      [termId, name || null, startDate || null, endDate || null]
    );
    await logAudit({
      userId: actor.userId, action: 'CREATE', entityType: 'term', entityId: termId,
      newValue: { id: termId, name: name || null }, ipAddress: actor.ip, userAgent: actor.ua, conn,
    });
    await conn.commit();
    return { id: termId, name: name || null, start_date: startDate || null, end_date: endDate || null, is_current: false };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Atomically make `id` the single current term: clear all is_current, set the
 * target, audit, commit, then refresh the cache so the change is effective with
 * NO restart. FOR UPDATE on the target + the clear-then-set inside one txn makes
 * a double-current state unreachable through the app.
 */
async function setCurrentTerm(pool, id, actor = {}) {
  const termId = String(id == null ? '' : id).trim();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[target]] = await conn.query('SELECT id FROM terms WHERE id = ? FOR UPDATE', [termId]);
    if (!target) throw appError('ไม่พบภาคเรียนนี้', 404, 'TERM_NOT_FOUND');
    const [[prev]] = await conn.query('SELECT id FROM terms WHERE is_current = TRUE LIMIT 1');
    await conn.query('UPDATE terms SET is_current = FALSE WHERE is_current = TRUE');
    await conn.query('UPDATE terms SET is_current = TRUE WHERE id = ?', [termId]);
    await logAudit({
      userId: actor.userId, action: 'UPDATE', entityType: 'term', entityId: termId,
      oldValue: { current: prev ? prev.id : null }, newValue: { current: termId },
      ipAddress: actor.ip, userAgent: actor.ua, conn,
    });
    await conn.commit();
    _setCache(termId); // reflect immediately for both sync + async readers
    return { id: termId, is_current: true, previous: prev ? prev.id : null };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  getCurrentTerm,
  getCurrentTermCachedSync,
  invalidateTermCache,
  listTerms,
  createTerm,
  setCurrentTerm,
  appError,
};
