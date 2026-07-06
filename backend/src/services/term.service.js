'use strict';

// "Current term" (academic semester) DERIVED FROM THE BANGKOK CALENDAR DATE, not
// from a mutable global pointer. The old design read terms.is_current (falling back
// to an env var); that pointer went stale and mis-tagged the whole June/July 2026
// enrollment as 2568-2 when it was really 2569-1. Deriving from the date the row is
// written makes every term-stamp self-correcting with zero admin action (aligns with
// the no-admin-dependence guardrail). Single pm2 fork instance, so a module-level TTL
// cache is correct (no cross-process invalidation needed).
//
// Two layers: (1) per-year windows in terms.start_date/end_date (admin-editable,
// authoritative when today is inside one); (2) a pure, TOTAL convention that covers
// every date — including the October and April–mid-May break gaps — so resolution
// never falls back to a stale flag. Advance cross-term entry is NOT allowed (ops
// decision 2026-07-06): schools enter within the announced window, so "the date the
// data is entered" unambiguously identifies the term.

const { logAudit } = require('../utils/audit');

const TTL_MS = 60_000;
const TERM_ID_RE = /^\d{4}-[123]$/; // e.g. 2568-2

// ── Thai academic-calendar boundaries (as month*100+day) ─────────────────────
// term 1 ≈ 16 May – 11 Oct · term 2 ≈ 1 Nov – 1 Apr(next year). A date in a break
// (12–31 Oct, or 2 Apr – 15 May) maps to the UPCOMING term, so data entered just
// before a term begins lands in the term about to start. Term 2 keeps the STARTING
// academic-year number (2568-2 = Nov 2025 – Apr 2026).
const TERM1_START = 516;   // 16 May
const TERM1_END = 1011;    // 11 Oct
const TERM2_START = 1101;  // 1 Nov
const TERM2_END_NEXT_YEAR = 401; // 1 Apr of the following Gregorian year

// Today on the Asia/Bangkok calendar as 'YYYY-MM-DD' — matches every other "today"
// read in the codebase and avoids a UTC-midnight off-by-one at a term border.
function bangkokToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

// Pure, TOTAL date → 'BE-term'. Accepts 'YYYY-MM-DD' or a Date. Never touches the DB.
function computeTermIdByConvention(date) {
  const s = typeof date === 'string'
    ? date
    : new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const [y, m, d] = s.split('-').map(Number);
  const md = m * 100 + d;
  let ayYear; // Gregorian year the academic year STARTED
  let termNo;
  if (md >= TERM1_START && md <= TERM1_END) {        // 16 May – 11 Oct
    ayYear = y; termNo = 1;
  } else if (md > TERM1_END && md < TERM2_START) {   // 12–31 Oct break → upcoming term 2
    ayYear = y; termNo = 2;
  } else if (md >= TERM2_START) {                     // 1 Nov – 31 Dec
    ayYear = y; termNo = 2;
  } else if (md <= TERM2_END_NEXT_YEAR) {             // 1 Jan – 1 Apr (started prev year)
    ayYear = y - 1; termNo = 2;
  } else {                                            // 2 Apr – 15 May break → upcoming term 1
    ayYear = y; termNo = 1;
  }
  return `${ayYear + 543}-${termNo}`;
}

let _cache = { value: null, day: null, expiresAt: 0 };

function appError(message, statusCode = 400, code = 'TERM_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.errors = [{ code }];
  return err;
}

function _setCache(value, day = bangkokToday()) {
  _cache = { value, day, expiresAt: Date.now() + TTL_MS };
}

function invalidateTermCache() {
  _cache = { value: null, day: null, expiresAt: 0 };
}

// The term for an ARBITRARY date — window-first (per-year terms.start_date/end_date),
// then the pure convention. getCurrentTerm() is this applied to "today".
async function deriveTermIdFromDate(pool, date) {
  const d = typeof date === 'string'
    ? date
    : new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  try {
    const [rows] = await pool.query(
      `SELECT id FROM terms
         WHERE start_date IS NOT NULL AND end_date IS NOT NULL
           AND ? BETWEEN start_date AND end_date
         ORDER BY start_date DESC LIMIT 1`,
      [d]
    );
    if (rows.length) return rows[0].id;
  } catch { /* fall through to the total pure convention */ }
  return computeTermIdByConvention(d);
}

// Sync variant for write-sites without a pool handle (convention only).
function deriveTermIdFromDateSync(date) {
  return computeTermIdByConvention(date);
}

/**
 * Source of truth for the current term id = the term for TODAY's Bangkok date.
 * Cached for TTL_MS AND keyed on the calendar day, so the hot check-in path issues
 * at most one tiny indexed SELECT per minute and the cache self-invalidates when the
 * day (and possibly the term) rolls over. deriveTermIdFromDate never throws, so the
 * outer guard only catches an unexpected failure — resolving the term must NEVER
 * break a check-in.
 */
async function getCurrentTerm(pool) {
  const today = bangkokToday();
  if (_cache.value && _cache.day === today && Date.now() < _cache.expiresAt) {
    return _cache.value;
  }
  let val;
  try {
    val = await deriveTermIdFromDate(pool, today);
  } catch {
    val = _cache.value || computeTermIdByConvention(today);
  }
  _setCache(val, today);
  return val;
}

/**
 * Synchronous term for today — for code paths without a handy pool. Returns the
 * warm cache when it is for the current day, else derives from today's Bangkok date
 * via the pure convention (never null, no DB, no stale flag). Kept window-refined by
 * getCurrentTerm() (TTL refresh).
 */
function getCurrentTermCachedSync() {
  const today = bangkokToday();
  if (_cache.value && _cache.day === today) return _cache.value;
  return computeTermIdByConvention(today);
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
  deriveTermIdFromDate,
  deriveTermIdFromDateSync,
  computeTermIdByConvention,
  invalidateTermCache,
  listTerms,
  createTerm,
  setCurrentTerm,
  appError,
};
