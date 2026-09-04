/**
 * Bangkok-time helpers for the browser.
 *
 * Mirrors `backend/src/utils/thaiTime.js`. The browser's own timezone is the
 * device's, so it cannot be relied on either: a device left on UTC, or a user
 * abroad, produces a different "today" than the server. Every calendar date
 * the UI sends or displays is a Bangkok calendar date, computed explicitly.
 *
 * The failure this replaces: `new Date().toISOString().slice(0, 10)` is always
 * the UTC date. Between 00:00 and 07:00 Bangkok it is YESTERDAY — so an
 * inspection form opened at 06:30 prefilled the wrong day, and a dashboard
 * "today" filter queried the wrong day, during the exact hours the morning bus
 * route runs.
 */

const BANGKOK_TZ = 'Asia/Bangkok';

/** The Bangkok calendar date of an instant, as 'YYYY-MM-DD'. */
export function toBangkokDate(value = new Date()) {
  if (value == null) return null;

  // A 'YYYY-MM-DD' string is already a calendar date; re-parsing it through
  // Date would reinterpret it as UTC midnight and can shift it a day.
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
export function todayBangkok(now = new Date()) {
  return toBangkokDate(now);
}

/** A Bangkok calendar date `days` before today (negative for the future). */
export function bangkokDateDaysAgo(days, now = new Date()) {
  return toBangkokDate(new Date(now.getTime() - days * 86400000));
}

/** Compact Bangkok date stamp 'YYYYMMDD', for download filenames. */
export function bangkokDateStamp(value = new Date()) {
  const d = toBangkokDate(value);
  return d ? d.replace(/-/g, '') : null;
}
