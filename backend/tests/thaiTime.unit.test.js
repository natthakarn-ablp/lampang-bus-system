'use strict';

/**
 * Bangkok-time correctness.
 *
 * Two failures this pins down were live in production on 2026-09-04:
 *
 *   - A DATE column arrives from mysql2 as an instant at 17:00Z the previous
 *     day, so `.toISOString().slice(0, 10)` read every expiry one day early —
 *     in the eligibility decision and in what the UI displayed.
 *   - GPS `recorded_at` was written as a UTC wall clock into a DATETIME column
 *     on a +07:00 connection, storing every fix seven hours behind the instant
 *     it happened. `vehicle_latest_locations` showed a 420-minute gap between
 *     recorded_at and received_at.
 *
 * Fixed instants are used throughout so the assertions do not depend on when
 * the suite runs. Thailand has had no DST since 1976, so +07:00 is constant.
 */

const {
  toBangkokDate,
  todayBangkok,
  toBangkokSqlDateTime,
  bangkokDateStamp,
  daysBetweenBangkok,
} = require('../src/utils/thaiTime');

/** How mysql2 hands back the DATE column `2026-06-20` on a +07:00 connection. */
const DATE_COLUMN_2026_06_20 = new Date('2026-06-19T17:00:00.000Z');

/** 06:30 Bangkok on 4 Sep — inside the window where a UTC date is still the 3rd. */
const EARLY_MORNING_BKK = new Date('2026-09-03T23:30:00.000Z');

/** 23:30 Bangkok on 3 Sep — same UTC day as the previous constant's UTC day. */
const LATE_EVENING_BKK = new Date('2026-09-03T16:30:00.000Z');

describe('toBangkokDate', () => {
  it('reads a DATE column as the day MySQL stored, not the day before', () => {
    expect(toBangkokDate(DATE_COLUMN_2026_06_20)).toBe('2026-06-20');
    // The bug this replaces, stated so the difference is unmissable:
    expect(DATE_COLUMN_2026_06_20.toISOString().slice(0, 10)).toBe('2026-06-19');
  });

  it('passes a YYYY-MM-DD string through without reinterpreting it as UTC', () => {
    expect(toBangkokDate('2026-06-20')).toBe('2026-06-20');
    expect(toBangkokDate('2026-01-01')).toBe('2026-01-01');
    // A bare date string parsed by Date() is UTC midnight, which in Bangkok is
    // already 07:00 the same day — but the string is authoritative regardless.
    expect(toBangkokDate('2026-06-20T00:00:00.000Z')).toBe('2026-06-20');
  });

  it('converts an instant to its Bangkok calendar day across the UTC midnight seam', () => {
    expect(toBangkokDate(EARLY_MORNING_BKK)).toBe('2026-09-04');
    expect(toBangkokDate(LATE_EVENING_BKK)).toBe('2026-09-03');
  });

  it('handles the year boundary', () => {
    // 31 Dec 18:00Z is 1 Jan 01:00 Bangkok.
    expect(toBangkokDate(new Date('2026-12-31T18:00:00.000Z'))).toBe('2027-01-01');
    expect(toBangkokDate(new Date('2026-12-31T16:59:59.000Z'))).toBe('2026-12-31');
  });

  it('returns null rather than a wrong date for absent or unparseable input', () => {
    expect(toBangkokDate(null)).toBeNull();
    expect(toBangkokDate('not a date')).toBeNull();
    expect(toBangkokDate(new Date('nope'))).toBeNull();
  });

  /**
   * `toBangkokDate` used to declare `(value = new Date())`, so an absent value
   * silently became TODAY. Every call site that passes a possibly-absent
   * column — `toBangkokDate(row.insurance_expiry)` where the SELECT omitted
   * the column, or a row that simply is not there — was one missing value away
   * from displaying or storing today's date as if it were real data. The
   * default is gone: `undefined` now answers exactly what `null` answers.
   */
  describe('an absent value must not become today', () => {
    it('undefined returns null, like null', () => {
      expect(toBangkokDate(undefined)).toBeNull();
      expect(toBangkokDate()).toBeNull();
    });

    it('a column missing from the row returns null, not today', () => {
      const rowWithoutTheColumn = { id: 'V-1' };
      expect(toBangkokDate(rowWithoutTheColumn.insurance_expiry)).toBeNull();
      // Stated as the failure it replaces: this is what used to come back.
      expect(toBangkokDate(rowWithoutTheColumn.insurance_expiry))
        .not.toBe(todayBangkok());
    });

    it('todayBangkok still answers today — the deliberate way to ask', () => {
      expect(todayBangkok()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(todayBangkok(EARLY_MORNING_BKK)).toBe('2026-09-04');
    });

    it('bangkokDateStamp keeps its own default and is unaffected', () => {
      expect(bangkokDateStamp()).toMatch(/^\d{8}$/);
      expect(bangkokDateStamp(undefined)).toMatch(/^\d{8}$/);
    });

    it('daysBetweenBangkok treats an absent endpoint as unknown, not as today', () => {
      expect(daysBetweenBangkok(undefined, '2026-06-20')).toBeNull();
      expect(daysBetweenBangkok('2026-06-20', undefined)).toBeNull();
    });
  });
});

describe('todayBangkok', () => {
  it('returns the Bangkok day during the 00:00-07:00 window, not yesterday', () => {
    // This window is when the morning bus route runs, which is exactly when
    // the UTC-derived date was wrong.
    expect(todayBangkok(EARLY_MORNING_BKK)).toBe('2026-09-04');
    expect(EARLY_MORNING_BKK.toISOString().slice(0, 10)).toBe('2026-09-03');
  });

  it('produces a YYYY-MM-DD shape that sorts and compares as a date', () => {
    const d = todayBangkok(EARLY_MORNING_BKK);
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Expiry logic compares these as strings; lexical order must be date order.
    expect(todayBangkok(LATE_EVENING_BKK) < d).toBe(true);
  });
});

describe('toBangkokSqlDateTime', () => {
  it('writes Bangkok wall-clock time for a +07:00 connection', () => {
    expect(toBangkokSqlDateTime(EARLY_MORNING_BKK)).toBe('2026-09-04 06:30:00.000');
    expect(toBangkokSqlDateTime(LATE_EVENING_BKK)).toBe('2026-09-03 23:30:00.000');
  });

  it('is exactly 7 hours ahead of the UTC wall clock that caused the GPS bug', () => {
    const bangkok = toBangkokSqlDateTime(EARLY_MORNING_BKK, { milliseconds: false });
    const utcWallClock = EARLY_MORNING_BKK.toISOString().slice(0, 19).replace('T', ' ');
    const diffMinutes = (Date.parse(`${bangkok}Z`) - Date.parse(`${utcWallClock}Z`)) / 60000;
    expect(diffMinutes).toBe(420);
  });

  it('renders midnight as 00, never 24', () => {
    // 17:00Z is exactly 00:00 Bangkok the next day; some ICU builds format the
    // hour as "24", which MySQL rejects.
    expect(toBangkokSqlDateTime(new Date('2026-09-03T17:00:00.000Z')))
      .toBe('2026-09-04 00:00:00.000');
  });

  it('can omit milliseconds for plain DATETIME columns', () => {
    expect(toBangkokSqlDateTime(EARLY_MORNING_BKK, { milliseconds: false }))
      .toBe('2026-09-04 06:30:00');
  });
});

describe('bangkokDateStamp', () => {
  it('stamps reference numbers with the Bangkok day', () => {
    expect(bangkokDateStamp(EARLY_MORNING_BKK)).toBe('20260904');
    expect(bangkokDateStamp(LATE_EVENING_BKK)).toBe('20260903');
  });
});

describe('daysBetweenBangkok', () => {
  it('counts whole calendar days', () => {
    expect(daysBetweenBangkok('2026-04-11', '2026-06-20')).toBe(70);
    expect(daysBetweenBangkok('2026-06-20', '2026-06-20')).toBe(0);
    expect(daysBetweenBangkok('2026-06-21', '2026-06-20')).toBe(-1);
  });

  it('normalises DATE-column instants before subtracting', () => {
    expect(daysBetweenBangkok(DATE_COLUMN_2026_06_20, '2026-06-21')).toBe(1);
  });

  it('returns null when either side is unusable', () => {
    expect(daysBetweenBangkok(null, '2026-06-20')).toBeNull();
    expect(daysBetweenBangkok('2026-06-20', 'garbage')).toBeNull();
  });
});
