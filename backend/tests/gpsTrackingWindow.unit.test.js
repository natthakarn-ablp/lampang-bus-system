'use strict';

/**
 * GPS tracking windows (owner decision 2026-11-07): GPS is recorded only
 * 05:00–09:00 and 15:00–19:00 Asia/Bangkok. Boundaries are minute-resolution
 * and inclusive. The instants below are written in +07:00 so the test means
 * the same thing on a UTC CI runner and on a Bangkok laptop.
 */

const {
  parseWindows, isWithinTrackingWindow, describeWindows, DEFAULT_WINDOWS, trackingInfo,
} = require('../src/utils/gpsTrackingWindow');

const W = parseWindows(DEFAULT_WINDOWS);
const at = (hms) => new Date(`2026-11-09T${hms}+07:00`);

describe('default windows 05:00–09:00, 15:00–19:00 (Bangkok)', () => {
  test.each([
    ['04:59:00', false],
    ['04:59:59', false],
    ['05:00:00', true],
    ['07:30:00', true],
    ['09:00:00', true],
    ['09:00:59', true],
    ['09:01:00', false],
    ['12:00:00', false],
    ['14:59:00', false],
    ['15:00:00', true],
    ['19:00:00', true],
    ['19:01:00', false],
    ['23:59:00', false],
    ['00:00:00', false],
  ])('%s → %s', (hms, expected) => {
    expect(isWithinTrackingWindow(at(hms), W)).toBe(expected);
  });

  test('uses Bangkok time, not the process/UTC clock: 22:00Z = 05:00 Bangkok next day', () => {
    expect(isWithinTrackingWindow(new Date('2026-11-08T22:00:00Z'), W)).toBe(true);
    expect(isWithinTrackingWindow(new Date('2026-11-08T21:59:00Z'), W)).toBe(false);
  });

  test('describeWindows gives client-friendly HH:MM pairs', () => {
    expect(describeWindows(W)).toEqual({
      windows: [{ start: '05:00', end: '09:00' }, { start: '15:00', end: '19:00' }],
      label: '05:00–09:00, 15:00–19:00',
    });
  });

  test('trackingInfo reports in_window_now', () => {
    expect(trackingInfo(at('06:00:00'), W).in_window_now).toBe(true);
    expect(trackingInfo(at('12:00:00'), W).in_window_now).toBe(false);
  });
});

describe('GPS_TRACKING_WINDOWS parsing', () => {
  test('custom windows are honoured', () => {
    const w = parseWindows('06:30-08:00');
    expect(isWithinTrackingWindow(at('06:29:00'), w)).toBe(false);
    expect(isWithinTrackingWindow(at('06:30:00'), w)).toBe(true);
    expect(isWithinTrackingWindow(at('08:01:00'), w)).toBe(false);
  });

  test.each(['', 'garbage', '25:00-26:00', '09:00-05:00', '5:00-9:00'])(
    'invalid value %p falls back to the defaults (never 24 h, never off)', (bad) => {
      expect(parseWindows(bad)).toEqual(W);
    });

  test('an invalid instant is outside', () => {
    expect(isWithinTrackingWindow(new Date('nope'), W)).toBe(false);
  });
});
