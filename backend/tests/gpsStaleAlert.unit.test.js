'use strict';

/**
 * gpsStaleAlert.service — "GPS stuck / silent for 20 minutes" LINE alert.
 * DB-free: the decision is a pure function and runOnce() takes a fake pool.
 */

const svc = require('../src/services/gpsStaleAlert.service');

const BASE = { lat: 18.2888, lng: 99.4908 };
// ~1 m of latitude ≈ 0.000009°
const north = (m) => ({ lat: BASE.lat + m * 0.000009, lng: BASE.lng });
const fix = (ageMin, where = BASE) => ({ ...where, ageS: Math.round(ageMin * 60), hhmm: '07:10' });
// a fix every 30 s from `fromMin` down to `toMin` minutes ago, all at `where`
const steady = (fromMin, toMin, where = BASE) => {
  const out = [];
  for (let m = toMin; m <= fromMin; m += 0.5) out.push(fix(m, where));
  return out;
};
const CFG = { thresholdMin: 20, radiusM: 75 };

describe('evaluate()', () => {
  test('no GPS during the round → no alert (driver never started tracking)', () => {
    expect(svc.evaluate({ fixes: [], firstBoardAgeS: 1800, session: 'morning', ...CFG }))
      .toEqual({ kind: null, reason: 'NO_GPS_THIS_ROUND' });
  });

  test('same spot for 25 minutes while fixes keep arriving → STUCK', () => {
    const fixes = steady(25, 0).map((f, i) => (i % 2 ? { ...f, ...north(20) } : f)); // 20 m jitter
    const d = svc.evaluate({ fixes, firstBoardAgeS: 40 * 60, session: 'morning', ...CFG });
    expect(d.kind).toBe('STUCK');
  });

  test('only 15 minutes of history → not enough to judge', () => {
    const d = svc.evaluate({ fixes: steady(15, 0), firstBoardAgeS: 15 * 60, session: 'morning', ...CFG });
    expect(d).toEqual({ kind: null, reason: 'NOT_ENOUGH_HISTORY' });
  });

  test('moved more than the radius inside the window → no alert', () => {
    const fixes = [...steady(10, 0), ...steady(25, 10.5, north(300))];
    const d = svc.evaluate({ fixes, firstBoardAgeS: 40 * 60, session: 'morning', ...CFG });
    expect(d).toEqual({ kind: null, reason: 'MOVING' });
  });

  test('stopped 19 minutes after driving → not yet', () => {
    const fixes = [...steady(19, 0), ...steady(30, 19.5, north(500))];
    expect(svc.evaluate({ fixes, firstBoardAgeS: 40 * 60, session: 'morning', ...CFG }).kind).toBeNull();
  });

  test('last fix 21 minutes ago → NO_SIGNAL', () => {
    const d = svc.evaluate({ fixes: steady(40, 21, north(800)), firstBoardAgeS: 45 * 60, session: 'evening', ...CFG });
    expect(d.kind).toBe('NO_SIGNAL');
    expect(d.newest.ageS).toBe(21 * 60);
  });

  test('evening: still where the children boarded (waiting at school) → no STUCK', () => {
    const d = svc.evaluate({ fixes: steady(40, 0), firstBoardAgeS: 30 * 60, session: 'evening', ...CFG });
    expect(d).toEqual({ kind: null, reason: 'WAITING_WHERE_CHILDREN_BOARDED' });
  });

  test('evening: drove away from school, then stuck → STUCK', () => {
    const fixes = [...steady(22, 0, north(2000)), ...steady(40, 22.5)];
    expect(svc.evaluate({ fixes, firstBoardAgeS: 40 * 60, session: 'evening', ...CFG }).kind).toBe('STUCK');
  });

  test('morning has no boarding-spot exception', () => {
    expect(svc.evaluate({ fixes: steady(40, 0), firstBoardAgeS: 30 * 60, session: 'morning', ...CFG }).kind)
      .toBe('STUCK');
  });
});

describe('buildMessage()', () => {
  test('carries plate, round, schools, count and a map link — no student names', () => {
    const text = svc.buildMessage({
      kind: 'STUCK', plateNo: 'นข 1234 ลำปาง', schools: ['โรงเรียนตัวอย่าง'], onBoard: 3,
      session: 'morning', thresholdMin: 20, newest: { ...BASE, hhmm: '07:10' },
    });
    expect(text).toContain('นข 1234 ลำปาง (รอบเช้า)');
    expect(text).toContain('ตำแหน่งรถไม่เปลี่ยนเกิน 20 นาที');
    expect(text).toContain('3 คน');
    expect(text).toContain('โรงเรียนตัวอย่าง');
    expect(text).toContain('https://www.google.com/maps?q=18.288800,99.490800');
  });

  test('NO_SIGNAL wording', () => {
    const text = svc.buildMessage({
      kind: 'NO_SIGNAL', plateNo: 'X', schools: [], onBoard: 1, session: 'evening', thresholdMin: 20, newest: null,
    });
    expect(text).toContain('ไม่ได้รับตำแหน่งจากรถเกิน 20 นาที');
    expect(text).toContain('(รอบเย็น)');
  });
});

describe('runOnce()', () => {
  // 07:30 Bangkok on a weekday → morning session
  const NOW = new Date('2026-11-12T07:30:00+07:00');

  function fakeDb({ rounds, fixes, audited = new Set() }) {
    const calls = [];
    const db = {
      calls,
      audited,
      async query(sql, params = []) {
        calls.push({ sql, params });
        if (/GROUP BY cl\.vehicle_id/.test(sql)) return [rounds];
        if (/MIN\(checked_at\)/.test(sql)) return [[{ first_board_age_s: 3600 }]];
        if (/FROM vehicle_location_history/.test(sql)) {
          return [(fixes[params[0]] || []).map((f) => ({ latitude: f.lat, longitude: f.lng, age_s: f.ageS, hhmm: f.hhmm }))];
        }
        if (/FROM audit_logs/.test(sql)) return [audited.has(params[1]) ? [{ 1: 1 }] : []];
        if (/INSERT INTO audit_logs/.test(sql)) { audited.add(params[3]); return [{ insertId: 1 }]; }
        if (/FROM vehicles/.test(sql)) return [[{ plate_no: `plate-${params[0]}` }]];
        if (/DISTINCT sc\.name/.test(sql)) return [[{ name: 'โรงเรียนตัวอย่าง' }]];
        throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
      },
    };
    return db;
  }

  const ROUNDS = [
    { vehicle_id: 'V-stuck', on_board: 4 },
    { vehicle_id: 'V-moving', on_board: 2 },
    { vehicle_id: 'V-silent', on_board: 1 },
    { vehicle_id: 'V-nogps', on_board: 5 },
  ];
  const FIXES = {
    'V-stuck': steady(30, 0),
    'V-moving': [...steady(10, 0, north(900)), ...steady(30, 10.5)],
    'V-silent': steady(50, 25),
  };

  test('dry-run reports alerts but sends and writes nothing', async () => {
    const db = fakeDb({ rounds: ROUNDS, fixes: FIXES });
    const push = jest.fn();
    const r = await svc.runOnce({ db, apply: false, now: NOW, push, overrides: { thresholdMin: 20, radiusM: 75 } });
    expect(r.session).toBe('morning');
    expect(r.alerts.map((a) => [a.vehicleId, a.kind])).toEqual([['V-stuck', 'STUCK'], ['V-silent', 'NO_SIGNAL']]);
    expect(push).not.toHaveBeenCalled();
    expect(db.calls.some((c) => /INSERT INTO audit_logs/.test(c.sql))).toBe(false);
    expect(r.skipped).toEqual(expect.arrayContaining([
      { vehicleId: 'V-moving', reason: 'MOVING' },
      { vehicleId: 'V-nogps', reason: 'NO_GPS_THIS_ROUND' },
    ]));
  });

  test('apply sends once per vehicle/day/session/kind, then dedupes', async () => {
    const db = fakeDb({ rounds: ROUNDS, fixes: FIXES });
    const push = jest.fn().mockResolvedValue({ sent: true });
    const first = await svc.runOnce({ db, apply: true, now: NOW, push, overrides: { thresholdMin: 20, radiusM: 75 } });
    expect(push).toHaveBeenCalledTimes(2);
    expect(first.alerts.every((a) => a.delivery === 'sent')).toBe(true);
    expect([...db.audited]).toEqual([
      svc.dedupeKey('V-stuck', '2026-11-12', 'morning', 'STUCK'),
      svc.dedupeKey('V-silent', '2026-11-12', 'morning', 'NO_SIGNAL'),
    ]);

    const second = await svc.runOnce({ db, apply: true, now: NOW, push, overrides: { thresholdMin: 20, radiusM: 75 } });
    expect(push).toHaveBeenCalledTimes(2);
    expect(second.alerts).toEqual([]);
    expect(second.skipped.filter((s) => s.reason === 'ALREADY_ALERTED')).toHaveLength(2);
  });

  test('a failed push is not recorded, so the next run retries', async () => {
    const db = fakeDb({ rounds: [ROUNDS[0]], fixes: FIXES });
    const push = jest.fn()
      .mockResolvedValueOnce({ sent: false, error: 'LINE 500' })
      .mockResolvedValueOnce({ sent: true });
    const a = await svc.runOnce({ db, apply: true, now: NOW, push, overrides: { thresholdMin: 20, radiusM: 75 } });
    expect(a.alerts[0].delivery).toBe('failed');
    expect(db.audited.size).toBe(0);
    const b = await svc.runOnce({ db, apply: true, now: NOW, push, overrides: { thresholdMin: 20, radiusM: 75 } });
    expect(b.alerts[0].delivery).toBe('sent');
    expect(db.audited.size).toBe(1);
  });

  test('missing LINE_GROUP_ID (skipped) is not recorded as sent', async () => {
    const db = fakeDb({ rounds: [ROUNDS[0]], fixes: FIXES });
    const push = jest.fn().mockResolvedValue({ sent: false, skipped: 'missing-config' });
    const r = await svc.runOnce({ db, apply: true, now: NOW, push, overrides: { thresholdMin: 20, radiusM: 75 } });
    expect(r.alerts[0].delivery).toBe('failed');
    expect(db.audited.size).toBe(0);
  });

  test('evening session is chosen after the switch hour', () => {
    expect(svc.currentSession(new Date('2026-11-12T16:00:00+07:00'))).toBe('evening');
    expect(svc.currentSession(new Date('2026-11-12T06:00:00+07:00'))).toBe('morning');
  });

  test('on-board query counts only the latest log per student', async () => {
    const db = fakeDb({ rounds: [], fixes: {} });
    await svc.runOnce({ db, apply: false, now: NOW, push: jest.fn() });
    const q = db.calls[0].sql;
    expect(q).toMatch(/MAX\(id\) AS last_id/);
    expect(q).toMatch(/cl\.status = 'CHECKED_IN'/);
    expect(db.calls[0].params).toEqual(['morning']);
  });
});
