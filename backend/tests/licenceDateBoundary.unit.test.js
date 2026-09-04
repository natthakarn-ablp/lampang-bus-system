'use strict';

/**
 * The licence-expiry comparison, now that dateOnly() has no default.
 *
 * driverShift.service.js and safetyPolicy.service.js each defined
 *
 *     function dateOnly(value = new Date()) { return toBangkokDate(value); }
 *
 * which reinstated locally the default that had just been removed from
 * toBangkokDate: an absent value — a column a SELECT did not include — became
 * TODAY and was then compared as though it were a real licence date. A missing
 * expiry would have read as "expires today", i.e. still valid.
 *
 * It was a trap rather than a live bug. Static reading of every call site showed
 * each one either passes a value it has already null-checked, or receives it
 * through a parameter with its own `= new Date()` default; exactly one call
 * relied on the dateOnly default, and it meant today on purpose
 * (effectiveQualificationStatus's `today`), which now says todayBangkok().
 *
 * These tests pin the behaviour the guards provide, so removing the default is
 * verifiable rather than merely plausible — and they cover the boundary the
 * dateOnly comment was written about in the first place: a licence that expires
 * TODAY must not block the driver on the last day it is valid.
 */

const {
  effectiveQualificationStatus,
} = require('../src/services/safetyPolicy.service');
const { todayBangkok, toBangkokDate } = require('../src/utils/thaiTime');

const dayOffset = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return toBangkokDate(d);
};

describe('effectiveQualificationStatus and the licence date', () => {
  test('a licence that expires today is still valid today', () => {
    // The reason dateOnly exists: comparing a UTC instant against a Bangkok
    // calendar date made this read as yesterday and blocked the driver.
    expect(`today (${todayBangkok()}): ${effectiveQualificationStatus('VERIFIED', todayBangkok())}`)
      .toBe(`today (${todayBangkok()}): VERIFIED`);
  });

  test('yesterday is expired, tomorrow is valid', () => {
    expect(effectiveQualificationStatus('VERIFIED', dayOffset(-1))).toBe('EXPIRED');
    expect(effectiveQualificationStatus('VERIFIED', dayOffset(1))).toBe('VERIFIED');
  });

  test('a missing expiry is EXPIRED, not "expires today"', () => {
    // The trap: with dateOnly defaulting to now, an absent value became today's
    // date. The `!licenseExpiry` guard is what prevents that, and it has to stay.
    for (const absent of [undefined, null, '']) {
      expect(`${JSON.stringify(absent)} -> ${effectiveQualificationStatus('VERIFIED', absent)}`)
        .toBe(`${JSON.stringify(absent)} -> EXPIRED`);
    }
  });

  test('a non-VERIFIED qualification keeps its own status whatever the date', () => {
    expect(effectiveQualificationStatus('PENDING', dayOffset(1))).toBe('PENDING');
    expect(effectiveQualificationStatus('SUSPENDED', dayOffset(1))).toBe('SUSPENDED');
  });

  test('an explicit `today` is respected, so the comparison is testable', () => {
    // The one call that used the dateOnly default now says todayBangkok(). This
    // asserts the parameter still overrides it, which is what makes the boundary
    // above checkable without waiting for midnight.
    expect(effectiveQualificationStatus('VERIFIED', '2026-06-15', '2026-06-15')).toBe('VERIFIED');
    expect(effectiveQualificationStatus('VERIFIED', '2026-06-14', '2026-06-15')).toBe('EXPIRED');
    expect(effectiveQualificationStatus('VERIFIED', '2026-06-16', '2026-06-15')).toBe('VERIFIED');
  });

  test('a DATE column arriving as a mysql2 Date compares as its Bangkok day', () => {
    // mysql2 hands back 2026-06-15 as 2026-06-14T17:00:00.000Z. Comparing that
    // string against a calendar date is the original defect; dateOnly converts
    // it first, so the licence is read as the day it was stored.
    const stored = new Date('2026-06-14T17:00:00.000Z');
    expect(effectiveQualificationStatus('VERIFIED', stored, '2026-06-15')).toBe('VERIFIED');
    expect(effectiveQualificationStatus('VERIFIED', stored, '2026-06-16')).toBe('EXPIRED');
  });
});
