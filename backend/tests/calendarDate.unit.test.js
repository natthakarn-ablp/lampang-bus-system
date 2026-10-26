'use strict';

/**
 * One calendar-aware date check, where there used to be five.
 *
 * A1-11 finding S6. Five routers each declared their own `isValidDate`:
 *
 *   report.routes.js       checked the calendar and answered 400
 *   admin.routes.js        /^\d{4}-\d{2}-\d{2}$/ only
 *   affiliation.routes.js  the same shape-only regex
 *   province.routes.js     the same shape-only regex
 *   school.routes.js       the same shape-only regex
 *
 * and a sixth caller, the research export, had no check at all. The
 * shape-only version accepts 2026-13-45 and 2026-02-31.
 *
 * The predicate is now in utils/calendarDate.js and all six use it. This pins
 * the behaviour that the four weaker copies are adopting, so a future edit
 * cannot quietly relax it back to a regex.
 */

const { isCalendarDate, isCalendarMonth } = require('../src/utils/calendarDate');

describe('isCalendarDate', () => {
  it('accepts a real date', () => {
    expect([isCalendarDate('2026-09-05'), isCalendarDate('2026-01-01'), isCalendarDate('2026-12-31')])
      .toEqual([true, true, true]);
  });

  it('rejects a month that does not exist — what the old regex accepted', () => {
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-00-10')).toBe(false);
  });

  it('rejects a day that does not exist in that month', () => {
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-04-31')).toBe(false);
    expect(isCalendarDate('2026-11-31')).toBe(false);
    expect(isCalendarDate('2026-01-00')).toBe(false);
  });

  it('gets February right in both directions', () => {
    // 2024 is a leap year, 2026 is not, 2000 is (÷400), 1900 is not (÷100).
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2000-02-29')).toBe(true);
    expect(isCalendarDate('1900-02-29')).toBe(false);
  });

  it('rejects the wrong shape', () => {
    for (const bad of ['2026-9-5', '05/09/2026', '2026-09-05T00:00:00Z', '2026-09', '', 'yesterday']) {
      expect(`${bad} -> ${isCalendarDate(bad)}`).toBe(`${bad} -> false`);
    }
  });

  it('rejects a non-string rather than coercing it', () => {
    // A repeated query parameter (?date=a&date=b) arrives as an array. Express
    // gives it to the handler as-is, and String(['2026-09-05']) is
    // '2026-09-05' — so a coercing check would accept an array of one.
    expect(isCalendarDate(['2026-09-05'])).toBe(false);
    expect(isCalendarDate(20260905)).toBe(false);
    expect(isCalendarDate(null)).toBe(false);
    expect(isCalendarDate(undefined)).toBe(false);
    expect(isCalendarDate({ toString: () => '2026-09-05' })).toBe(false);
  });
});

describe('isCalendarMonth', () => {
  it('accepts a real month and rejects month 13 or 00', () => {
    expect([isCalendarMonth('2026-09'), isCalendarMonth('2026-13'), isCalendarMonth('2026-00')])
      .toEqual([true, false, false]);
  });

  it('rejects a full date and a non-string', () => {
    expect(isCalendarMonth('2026-09-05')).toBe(false);
    expect(isCalendarMonth(['2026-09'])).toBe(false);
  });
});

describe('every router uses the shared predicate', () => {
  const fs = require('fs');
  const path = require('path');
  const routes = (name) => fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', `${name}.routes.js`), 'utf8');

  it('no router still declares the shape-only regex', () => {
    // The exact line that was copied five times.
    const offenders = ['admin', 'affiliation', 'province', 'school', 'report']
      .filter((n) => /isValidDate\s*=\s*\(d\)\s*=>/.test(routes(n)));
    expect(`offenders: ${offenders.join(', ')}`).toBe('offenders: ');
  });

  it('each of the five requires utils/calendarDate', () => {
    const missing = ['admin', 'affiliation', 'province', 'school', 'report']
      .filter((n) => !/require\('\.\.\/utils\/calendarDate'\)/.test(routes(n)));
    expect(`missing: ${missing.join(', ')}`).toBe('missing: ');
  });

  it('the research export validates before using from/to', () => {
    // Floor: the assertion above only proves the module is imported. This one
    // proves the export route actually calls it, which is the finding.
    const src = routes('admin');
    const start = src.indexOf("router.get('/research-export'");
    expect(`route found: ${start !== -1}`).toBe('route found: true');
    const block = src.slice(start, start + 2500);
    expect(`calls isCalendarDate: ${/isCalendarDate\(value\)/.test(block)}`)
      .toBe('calls isCalendarDate: true');
    expect(`answers 400: ${/sendError\([\s\S]*?400\)/.test(block)}`)
      .toBe('answers 400: true');
  });
});
