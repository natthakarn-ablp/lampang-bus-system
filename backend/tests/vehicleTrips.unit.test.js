'use strict';

/**
 * Several trips per round (migration 062, FEATURE_MULTI_TRIP) — DB-free.
 * Service rules with a fake connection; route wiring with mocks.
 */

const env = require('../src/config/env');
const svc = require('../src/services/vehicleTrip.service');

afterEach(() => { env.features.multiTrip = false; });

function fakeDb({ lastTrip = 1, boarded = 3, onBoard = 0, trips = [], thisTrip = null } = {}) {
  const calls = [];
  const conn = {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FOR UPDATE/.test(sql)) return [[{ id: 'V-1' }]];
      if (/MAX\(trip_no\)/.test(sql)) return [[{ trip_no: lastTrip }]];
      if (/COUNT\(\*\) AS boarded/.test(sql)) return [[{ boarded, on_board: onBoard }]];
      if (/COUNT\(DISTINCT cl.student_id\)/.test(sql)) return [[{ n: thisTrip ?? boarded }]];
      if (/INSERT INTO vehicle_trips/.test(sql)) return [{ insertId: 1 }];
      if (/INSERT INTO audit_logs/.test(sql)) return [{}];
      if (/FROM vehicle_trips/.test(sql)) return [trips];
      throw new Error(`unexpected SQL ${sql.slice(0, 60)}`);
    },
    beginTransaction: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    release: jest.fn(),
  };
  return { ...conn, getConnection: async () => conn, conn };
}

describe('getTripState', () => {
  test('trip 1, bus empty after a group → can start the next trip', async () => {
    const db = fakeDb({ boarded: 4, onBoard: 0 });
    const st = await svc.getTripState(db, 'V-1', 'morning');
    expect(st).toMatchObject({ current_trip: 1, boarded: 4, on_board: 0, can_start_next: true });
    expect(st.reasons.map((r) => r.code)).toEqual(['SEATS', 'MULTI_SCHOOL', 'LONG_ROUTE', 'OTHER']);
  });

  test('children still on board → cannot start', async () => {
    const st = await svc.getTripState(fakeDb({ boarded: 4, onBoard: 2 }), 'V-1', 'evening');
    expect(st.can_start_next).toBe(false);
  });

  test('nobody boarded yet → cannot start (trip 1 starts by itself)', async () => {
    const st = await svc.getTripState(fakeDb({ boarded: 0, onBoard: 0 }), 'V-1', 'morning');
    expect(st.can_start_next).toBe(false);
  });

  test('current trip follows the recorded trips; OTHER shows the typed reason', async () => {
    const st = await svc.getTripState(fakeDb({ trips: [
      { trip_no: 2, reason_code: 'SEATS', reason_text: null, started_at: null },
      { trip_no: 3, reason_code: 'OTHER', reason_text: 'ถนนปิด', started_at: null },
    ] }), 'V-1', 'morning');
    expect(st.current_trip).toBe(3);
    expect(st.trips.map((t) => t.reason_label)).toEqual(['ที่นั่งไม่พอ', 'ถนนปิด']);
  });

  test('trip just started, nobody boarded in it yet → cannot stack another trip', async () => {
    const st = await svc.getTripState(fakeDb({ boarded: 4, onBoard: 0, thisTrip: 0,
      trips: [{ trip_no: 2, reason_code: 'SEATS', reason_text: null, started_at: null }] }), 'V-1', 'morning');
    expect(st).toMatchObject({ current_trip: 2, boarded_this_trip: 0, can_start_next: false });
  });

  test('bad session is 400', async () => {
    await expect(svc.getTripState(fakeDb(), 'V-1', 'noon')).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('startNextTrip', () => {
  const start = (db, extra = {}) => svc.startNextTrip(db, {
    vehicleId: 'V-1', session: 'morning', reasonCode: 'SEATS', actorId: 7, ...extra,
  });

  test('creates trip 2 under a vehicle lock, audited, committed', async () => {
    const db = fakeDb({ lastTrip: 1, boarded: 5, onBoard: 0 });
    const out = await start(db);
    expect(out).toMatchObject({ trip_no: 2, reason_code: 'SEATS', reason_label: 'ที่นั่งไม่พอ' });
    expect(db.conn.calls[0].sql).toMatch(/FOR UPDATE/);
    const ins = db.conn.calls.find((c) => /INSERT INTO vehicle_trips/.test(c.sql));
    expect(ins.params).toEqual(['V-1', 'morning', 2, 'SEATS', null, 7]);
    expect(db.conn.calls.some((c) => /INSERT INTO audit_logs/.test(c.sql))).toBe(true);
    expect(db.conn.commit).toHaveBeenCalled();
  });

  test.each([
    [{ onBoard: 2 }, 'STILL_ON_BOARD'],
    [{ boarded: 0 }, 'NO_TRIP_YET'],
    [{ lastTrip: 9 }, 'TRIP_LIMIT'],
  ])('refuses %j with 409 %s and rolls back', async (state, code) => {
    const db = fakeDb({ boarded: 5, onBoard: 0, lastTrip: 1, ...state });
    await expect(start(db)).rejects.toMatchObject({ statusCode: 409, code });
    expect(db.conn.rollback).toHaveBeenCalled();
    expect(db.conn.calls.some((c) => /INSERT INTO vehicle_trips/.test(c.sql))).toBe(false);
  });

  test.each([
    [{ reasonCode: 'NOPE' }],
    [{ reasonCode: 'OTHER', reasonText: '   ' }],
    [{ reasonCode: 'OTHER', reasonText: 'x'.repeat(201) }],
  ])('bad reason %j is 400 before any database work', async (extra) => {
    const db = fakeDb();
    await expect(start(db, extra)).rejects.toMatchObject({ statusCode: 400 });
    expect(db.conn.calls).toHaveLength(0);
  });

  test('a duplicate tap (unique key) becomes a friendly 409', async () => {
    const db = fakeDb();
    const orig = db.conn.query;
    db.conn.query = async (sql, p) => {
      if (/INSERT INTO vehicle_trips/.test(sql)) { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e; }
      return orig(sql, p);
    };
    await expect(start(db)).rejects.toMatchObject({ statusCode: 409, code: 'TRIP_EXISTS' });
  });
});

describe('parseRange + summary', () => {
  test('defaults to today; rejects bad / reversed / > 31 days', () => {
    const r = svc.parseRange({});
    expect(r.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.dateTo).toBe(r.dateFrom);
    expect(() => svc.parseRange({ date_from: '2026-13-01' })).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => svc.parseRange({ date_from: '2026-11-10', date_to: '2026-11-01' })).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => svc.parseRange({ date_from: '2026-10-01', date_to: '2026-11-12' })).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  test('summary groups by bus + day + round, total trips and distinct reasons', async () => {
    const db = { query: async () => [[
      { check_date: '2026-11-12', session: 'morning', vehicle_id: 'V-1', plate_no: 'นข 1', trip_no: 2, reason_code: 'SEATS', reason_text: null },
      { check_date: '2026-11-12', session: 'morning', vehicle_id: 'V-1', plate_no: 'นข 1', trip_no: 3, reason_code: 'SEATS', reason_text: null },
      { check_date: '2026-11-12', session: 'evening', vehicle_id: 'V-1', plate_no: 'นข 1', trip_no: 2, reason_code: 'OTHER', reason_text: 'ฝนตก' },
    ]] };
    const rows = await svc.tripSummary(db, { dateFrom: '2026-11-12', dateTo: '2026-11-12', vehicleScopeSql: 'SELECT 1', vehicleScopeParams: [] });
    expect(rows).toEqual([
      { check_date: '2026-11-12', session: 'morning', vehicle_id: 'V-1', plate_no: 'นข 1', trips: 3, reasons: ['ที่นั่งไม่พอ'] },
      { check_date: '2026-11-12', session: 'evening', vehicle_id: 'V-1', plate_no: 'นข 1', trips: 2, reasons: ['ฝนตก'] },
    ]);
  });
});

describe('flag', () => {
  test('enabled() follows env.features.multiTrip', () => {
    expect(svc.enabled()).toBe(false);
    env.features.multiTrip = true;
    expect(svc.enabled()).toBe(true);
  });
});
