'use strict';

/**
 * vehicleTrack.service — pure parts of the GPS route replay: day validation
 * (incl. 7-day retention), gap segmentation, distance, downsampling.
 * DB-free.
 */

const svc = require('../src/services/vehicleTrack.service');

const T0 = Date.parse('2026-11-09T06:00:00+07:00');
// A straight line north: ~0.001° lat ≈ 111 m per fix, one fix every 15 s (~26.7 km/h).
const row = (i, extra = {}) => ({
  latitude: 18.28 + i * 0.001,
  longitude: 99.49,
  accuracy_meters: 10,
  speed_mps: 7,
  recorded_at: new Date(T0 + i * 15_000),
  ...extra,
});

describe('validateDay', () => {
  const today = '2026-11-09';
  test('accepts today and the 6 days before it with 7-day retention', () => {
    expect(svc.validateDay('2026-11-09', today, 7).ok).toBe(true);
    expect(svc.validateDay('2026-11-03', today, 7).ok).toBe(true);
  });
  test('rejects the 8th day back with a Thai retention message', () => {
    const r = svc.validateDay('2026-11-02', today, 7);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('7 วัน');
  });
  test('rejects future, malformed and impossible dates', () => {
    expect(svc.validateDay('2026-11-10', today, 7).ok).toBe(false);
    expect(svc.validateDay('2026-11-9', today, 7).ok).toBe(false);
    expect(svc.validateDay('09-11-2026', today, 7).ok).toBe(false);
    expect(svc.validateDay('2026-02-30', '2026-03-01', 7).ok).toBe(false);
    expect(svc.validateDay(undefined, today, 7).ok).toBe(false);
    expect(svc.validateDay("2026-11-09' OR 1=1", today, 7).ok).toBe(false);
  });
  test('calendar helpers cross month/year boundaries without TZ drift', () => {
    expect(svc.nextDay('2026-12-31')).toBe('2027-01-01');
    expect(svc.addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(svc.oldestRetainedDay(7, '2026-11-02')).toBe('2026-10-27');
  });
});

describe('buildTrack — segments, gaps, distance', () => {
  test('a gap > 3 min splits the day into two segments and is reported', () => {
    const rows = [0, 1, 2, 3].map(i => row(i));
    // 10 minutes of silence, then 3 more fixes
    const later = T0 + 3 * 15_000 + 10 * 60_000;
    for (let k = 0; k < 3; k++) rows.push(row(4 + k, { recorded_at: new Date(later + k * 15_000) }));
    const t = svc.buildTrack(rows);
    expect(t.segments).toHaveLength(2);
    expect(t.gaps).toHaveLength(1);
    expect(t.gaps[0].seconds).toBe(600);
    expect(t.summary.gap_count).toBe(1);
    expect(t.summary.offline_seconds).toBe(600);
    // Distance never bridges the gap: 3 hops + 2 hops of ~111 m.
    expect(t.summary.distance_km).toBeGreaterThan(0.5);
    expect(t.summary.distance_km).toBeLessThan(0.6);
    expect(t.summary.first_at).toBe(new Date(T0).toISOString());
    expect(t.summary.max_speed_kmh).toBeCloseTo(26.7, 0);
  });

  test('the break between the morning and evening windows is not a signal gap', () => {
    const am = Date.parse('2026-11-09T08:58:00+07:00');
    const pm = Date.parse('2026-11-09T15:05:00+07:00');
    const rows = [
      row(0, { recorded_at: new Date(am) }), row(1, { recorded_at: new Date(am + 15_000) }),
      row(2, { recorded_at: new Date(pm) }), row(3, { recorded_at: new Date(pm + 15_000) }),
    ];
    const t = svc.buildTrack(rows);
    expect(t.segments).toHaveLength(2);
    expect(t.gaps).toHaveLength(1);
    expect(t.gaps[0].kind).toBe('break');
    expect(t.summary).toMatchObject({ gap_count: 0, break_count: 1, offline_seconds: 0 });
    expect(t.gaps.length).toBe(t.segments.length - 1);
  });

  test('a gap of exactly 3 min does not split', () => {
    const rows = [row(0), row(1, { recorded_at: new Date(T0 + 180_000) })];
    expect(svc.buildTrack(rows).segments).toHaveLength(1);
  });

  test('drops low-accuracy fixes, Null Island, duplicates; ignores GPS spikes in distance', () => {
    const rows = [
      row(0), row(0), // duplicate timestamp
      row(1, { accuracy_meters: 900 }),
      row(2, { latitude: 0, longitude: 0 }),
      row(3, { latitude: 19.5 }), // 135 km jump in 15 s
      row(4),
    ];
    const t = svc.buildTrack(rows);
    expect(t.summary.point_count).toBe(3);
    expect(t.summary.dropped_points).toBe(3);
    expect(t.summary.distance_km).toBeLessThan(0.5);
  });

  test('empty day', () => {
    const t = svc.buildTrack([]);
    expect(t.points).toEqual([]);
    expect(t.summary).toMatchObject({ point_count: 0, distance_km: 0, first_at: null, gap_count: 0 });
  });

  test('response carries coordinates/time/speed only — no PII fields', () => {
    const t = svc.buildTrack([row(0, { driver_phone: '0812345678', first_name: 'x' })]);
    expect(Object.keys(t.points[0]).sort()).toEqual(['accuracy_m', 'lat', 'lng', 'speed_kmh', 't']);
  });
});

describe('downsampling', () => {
  test('≤ max points pass through untouched', () => {
    const t = svc.buildTrack(Array.from({ length: 50 }, (_, i) => row(i)), { maxPoints: 100 });
    expect(t.points).toHaveLength(50);
    expect(t.summary.downsampled).toBe(false);
  });

  test('5,000 fixes come back ≤ 2,000, ordered, keeping every segment endpoint', () => {
    const rows = [];
    for (let i = 0; i < 2500; i++) rows.push(row(i));
    const resume = T0 + 2500 * 15_000 + 30 * 60_000; // 30-min gap
    for (let i = 0; i < 2500; i++) rows.push(row(2500 + i, { recorded_at: new Date(resume + i * 15_000) }));
    const t = svc.buildTrack(rows);
    expect(t.summary.point_count).toBe(5000);
    expect(t.points.length).toBeLessThanOrEqual(svc.MAX_POINTS);
    expect(t.points.length).toBeGreaterThan(1900);
    expect(t.summary.downsampled).toBe(true);
    const times = t.points.map(p => Date.parse(p.t));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    // the gap is preserved exactly
    expect(t.segments).toHaveLength(2);
    expect(t.points[t.segments[0].end_index].t).toBe(new Date(T0 + 2499 * 15_000).toISOString());
    expect(t.points[t.segments[1].start_index].t).toBe(new Date(resume).toISOString());
    expect(t.points[t.points.length - 1].t).toBe(new Date(resume + 2499 * 15_000).toISOString());
    // distance is measured on the full data, not the sample
    expect(t.summary.distance_km).toBeGreaterThan(540);
  });
});

describe('buildDays', () => {
  test('groups by Bangkok day', () => {
    const late = Date.parse('2026-11-09T18:59:00+07:00');
    const early = Date.parse('2026-11-10T05:01:00+07:00');
    const days = svc.buildDays([
      { day: '2026-11-09', ...row(0, { recorded_at: new Date(late) }) },
      { day: '2026-11-10', ...row(1, { recorded_at: new Date(early) }) },
      { day: '2026-11-10', ...row(2, { recorded_at: new Date(early + 15_000) }) },
    ]);
    expect(days.map(d => [d.date, d.point_count])).toEqual([['2026-11-09', 1], ['2026-11-10', 2]]);
  });
});
