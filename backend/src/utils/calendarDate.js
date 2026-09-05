'use strict';

/**
 * calendarDate.js — one calendar-aware YYYY-MM-DD check.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * There were four copies of "isValidDate" in the routers and they did not
 * agree:
 *
 *   report.routes.js:34        checked the calendar (leap years, days per
 *                              month) and answered 400 on a bad value
 *   admin.routes.js:621        /^\d{4}-\d{2}-\d{2}$/ only
 *   affiliation.routes.js:577  the same shape-only regex
 *   province.routes.js:195     the same shape-only regex
 *
 * The three shape-only copies accept 2026-13-45 and 2026-02-31, which then go
 * into a query as '2026-13-45 00:00:00'. A fifth caller — the research export
 * at admin.routes.js:997-998 — had no check at all, which is finding S6 of
 * docs/security/threat-rbac-idor-review-2026-09-04.md: the unchecked from/to
 * reach the exported dataset's own meta.date_range, the entity_id of the
 * EXPORT audit row that the dataset later cites as its evidence, and the
 * Content-Disposition filename. That is an evidence-integrity problem — the
 * dataset and its audit trail cannot be reconciled — not an injection one,
 * since every query is parameterised.
 *
 * Four implementations of one predicate is how the weakest of them ends up
 * guarding something that matters. There is now one.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year) {
  return (year % 400 === 0) || (year % 4 === 0 && year % 100 !== 0);
}

/**
 * A YYYY-MM date whose month exists.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isCalendarMonth(value) {
  if (typeof value !== 'string' || !MONTH_RE.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

/**
 * A YYYY-MM-DD date that exists on the calendar.
 *
 * Rejects 2026-02-30 and 2026-13-01, not merely values of the wrong shape.
 * Non-strings return false rather than being coerced, so an array from a
 * repeated query parameter (`?date=a&date=b`) cannot slip through.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isCalendarDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) return false;
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return day >= 1 && day <= maxDay;
}

module.exports = { isCalendarDate, isCalendarMonth, DATE_RE, MONTH_RE };
