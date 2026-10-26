'use strict';

/**
 * Bangkok-time helpers.
 *
 * The system runs on Asia/Bangkok (UTC+7) end to end: `src/index.js` pins
 * `process.env.TZ`, and every pooled connection runs `SET time_zone='+07:00'`
 * so `CURDATE()`/`NOW()` mean the Bangkok day. Two habits kept breaking that
 * guarantee, and both are fixed by using this module instead:
 *
 * 1. `new Date().toISOString().slice(0, 10)` is always the UTC date, whatever
 *    `TZ` is set to. Between 00:00 and 07:00 Bangkok it returns YESTERDAY —
 *    exactly the window in which school buses run their morning route.
 *
 * 2. mysql2 parses a DATE column against the connection timezone, so
 *    `2026-06-20` arrives as `2026-06-19T17:00:00.000Z`. Calling
 *    `.toISOString().slice(0, 10)` on that yields `2026-06-19`: every expiry
 *    date read one day early, both in eligibility checks and on screen.
 *    (Verified against the production database, 4 ก.ย. 2569.)
 *
 * The rule this module encodes: a calendar date is a Bangkok calendar date,
 * and an instant is an instant. Never derive one from the other by slicing an
 * ISO string.
 */

const BANGKOK_TZ = 'Asia/Bangkok';

/**
 * The Bangkok calendar date of an instant, as 'YYYY-MM-DD'.
 * `en-CA` formats as ISO-style year-month-day, which is why it is used here
 * rather than assembling parts by hand.
 *
 * There is deliberately NO default for `value`. It used to default to
 * `new Date()`, which meant an absent column — `toBangkokDate(row.expiry)`
 * where the SELECT did not include `expiry` — silently produced TODAY and
 * carried it into a response or an UPDATE as if it were real data. `undefined`
 * now answers `null`, the same as `null`, so a missing value stays missing.
 * Callers that genuinely want "today" have `todayBangkok()`.
 */
function toBangkokDate(value) {
  if (value == null) return null;

  // A 'YYYY-MM-DD' string is already a calendar date; re-parsing it through
  // Date would reinterpret it as UTC midnight and shift it back a day.
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString('en-CA', { timeZone: BANGKOK_TZ });
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-CA', { timeZone: BANGKOK_TZ });
}

/** Today's Bangkok calendar date as 'YYYY-MM-DD'. */
function todayBangkok(now = new Date()) {
  return toBangkokDate(now);
}

/**
 * Bangkok wall-clock parts of an instant. Used to build SQL literals and
 * compact stamps without going through an ISO string.
 */
function bangkokParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    // Intl can render midnight as "24" in some ICU versions; normalise it.
    hour: parts.hour === '24' ? '00' : parts.hour,
    minute: parts.minute,
    second: parts.second,
    millisecond: String(date.getMilliseconds()).padStart(3, '0'),
  };
}

/**
 * A DATETIME literal in Bangkok wall-clock time, for columns written through a
 * connection pinned to +07:00. Passing a UTC wall clock here is what put GPS
 * `recorded_at` seven hours behind `received_at` in production.
 *
 * @param {Date|string|number} value
 * @param {{ milliseconds?: boolean }} [options]
 */
function toBangkokSqlDateTime(value = new Date(), { milliseconds = true } = {}) {
  const p = bangkokParts(value);
  if (!p) return null;
  const base = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  return milliseconds ? `${base}.${p.millisecond}` : base;
}

/** Compact Bangkok date stamp 'YYYYMMDD', for human-facing reference numbers. */
function bangkokDateStamp(value = new Date()) {
  const d = toBangkokDate(value);
  return d ? d.replace(/-/g, '') : null;
}

/**
 * Difference in whole calendar days between two Bangkok dates.
 * Both arguments go through `toBangkokDate` first, so a DATE column read and a
 * live instant can be compared without either being shifted.
 */
function daysBetweenBangkok(from, to) {
  const a = toBangkokDate(from);
  const b = toBangkokDate(to);
  if (!a || !b) return null;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_PER_DAY);
}

module.exports = {
  BANGKOK_TZ,
  toBangkokDate,
  todayBangkok,
  bangkokParts,
  toBangkokSqlDateTime,
  bangkokDateStamp,
  daysBetweenBangkok,
};
