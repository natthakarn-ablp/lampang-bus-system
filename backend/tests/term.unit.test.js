'use strict';

/**
 * Unit tests for term.service — dynamic current term (DB-driven, no restart).
 * DB-free: mock pool/conn. Focus: the TTL cache + env fallback (must never throw
 * on a check-in), the atomic single-current flip, and the create guards.
 */

require('./loadTestEnv');
const termSvc = require('../src/services/term.service');

beforeEach(() => termSvc.invalidateTermCache());

const poolQuery = (handler) => ({ query: jest.fn(async (sql, p) => handler(sql, p)) });

describe('getCurrentTerm (date-window + convention, cached per-day)', () => {
  test('derives from the terms date-window for today and caches it (2nd call = no query)', async () => {
    const pool = poolQuery((sql) => (/BETWEEN start_date AND end_date/.test(sql) ? [[{ id: '2569-1' }]] : [[]]));
    expect(await termSvc.getCurrentTerm(pool)).toBe('2569-1');
    expect(await termSvc.getCurrentTerm(pool)).toBe('2569-1');
    expect(pool.query).toHaveBeenCalledTimes(1); // cache hit on the 2nd
  });

  test('falls back to the pure convention when no date-window matches (never empty)', async () => {
    const pool = poolQuery(() => [[]]);
    const v = await termSvc.getCurrentTerm(pool);
    expect(v).toMatch(/^\d{4}-[123]$/);
  });

  test('NEVER throws on a DB error — falls back to the convention', async () => {
    const pool = { query: jest.fn().mockRejectedValue(new Error('db down')) };
    const v = await termSvc.getCurrentTerm(pool);
    expect(v).toMatch(/^\d{4}-[123]$/);
  });
});

describe('getCurrentTermCachedSync', () => {
  test('returns a valid term (today via convention) when the cache is cold', () => {
    const v = termSvc.getCurrentTermCachedSync();
    expect(v).toMatch(/^\d{4}-[123]$/);
  });
  test('returns the window-refined value after getCurrentTerm warms it', async () => {
    await termSvc.getCurrentTerm(poolQuery(() => [[{ id: '2570-2' }]]));
    expect(termSvc.getCurrentTermCachedSync()).toBe('2570-2');
  });
});

describe('computeTermIdByConvention (date → BE-term, Thai calendar with break gaps)', () => {
  // [date, expected, why] — boundaries are exactly where a mis-tag would recur.
  const cases = [
    ['2026-07-06', '2569-1', 'the mis-tag date — mid term 1'],
    ['2026-05-15', '2569-1', 'summer break tail → upcoming term 1'],
    ['2026-05-16', '2569-1', 'term 1 opens'],
    ['2026-10-11', '2569-1', 'term 1 last day'],
    ['2026-10-12', '2569-2', 'October break → upcoming term 2'],
    ['2026-10-31', '2569-2', 'October break tail → upcoming term 2'],
    ['2026-11-01', '2569-2', 'term 2 opens'],
    ['2026-12-31', '2569-2', 'term 2, end of Gregorian year'],
    ['2027-01-01', '2569-2', 'term 2 spilling into the next Gregorian year (still 2569)'],
    ['2027-04-01', '2569-2', 'term 2 last day'],
    ['2027-04-02', '2570-1', 'summer break → upcoming term 1 of next academic year'],
    ['2026-04-01', '2568-2', 'term 2 of the PREVIOUS academic year'],
    ['2026-04-02', '2569-1', 'summer break → upcoming term 1'],
    ['2025-11-15', '2568-2', 'term 2 of 2568 begins'],
    ['2025-06-01', '2568-1', 'term 1 of 2568'],
  ];
  test.each(cases)('%s → %s (%s)', (date, expected) => {
    expect(termSvc.computeTermIdByConvention(date)).toBe(expected);
  });
  test('accepts a Date object (normalized on the Bangkok calendar)', () => {
    expect(termSvc.computeTermIdByConvention(new Date('2026-07-06T00:00:00+07:00'))).toBe('2569-1');
  });
});

describe('deriveTermIdFromDate (window-first, convention fallback)', () => {
  test('uses the DB date-window when one contains the date', async () => {
    const pool = poolQuery(() => [[{ id: '2569-1' }]]);
    expect(await termSvc.deriveTermIdFromDate(pool, '2026-07-06')).toBe('2569-1');
  });
  test('falls back to the convention when no window matches (gap date)', async () => {
    const pool = poolQuery(() => [[]]);
    expect(await termSvc.deriveTermIdFromDate(pool, '2026-10-20')).toBe('2569-2');
  });
  test('falls back to the convention on a DB error (never throws)', async () => {
    const pool = { query: jest.fn().mockRejectedValue(new Error('down')) };
    expect(await termSvc.deriveTermIdFromDate(pool, '2026-07-06')).toBe('2569-1');
  });
});

function makeConn(handler) {
  const calls = [];
  return {
    calls,
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
    query: jest.fn(async (sql, p) => { calls.push([sql, p]); return handler(sql, p); }),
  };
}
const poolOf = (conn) => ({ getConnection: jest.fn().mockResolvedValue(conn) });

describe('setCurrentTerm (atomic single-current flip)', () => {
  test('clears all, sets target, audits, commits, updates cache', async () => {
    const conn = makeConn((sql) => {
      if (/FOR UPDATE/.test(sql)) return [[{ id: '2569-1' }]];
      if (/is_current = TRUE LIMIT 1/.test(sql)) return [[{ id: '2568-2' }]];
      return [{ affectedRows: 1 }];
    });
    const out = await termSvc.setCurrentTerm(poolOf(conn), '2569-1', { userId: 1 });
    expect(out).toMatchObject({ id: '2569-1', is_current: true, previous: '2568-2' });
    expect(conn.calls.some(([s]) => /UPDATE terms SET is_current = FALSE/.test(s))).toBe(true);
    expect(conn.calls.some(([s]) => /UPDATE terms SET is_current = TRUE WHERE id = \?/.test(s))).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
    expect(termSvc.getCurrentTermCachedSync()).toBe('2569-1'); // effective with no restart
  });

  test('404 + rollback when the target term does not exist', async () => {
    const conn = makeConn((sql) => (/FOR UPDATE/.test(sql) ? [[]] : [{ affectedRows: 0 }]));
    await expect(termSvc.setCurrentTerm(poolOf(conn), 'X', { userId: 1 }))
      .rejects.toMatchObject({ statusCode: 404, errors: [{ code: 'TERM_NOT_FOUND' }] });
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('createTerm (guards)', () => {
  test('rejects a malformed term id (400)', async () => {
    await expect(termSvc.createTerm({}, { id: 'bad' }, {}))
      .rejects.toMatchObject({ statusCode: 400, errors: [{ code: 'BAD_TERM_ID' }] });
  });
  test('rejects a duplicate (409)', async () => {
    const conn = makeConn((sql) => (/FOR UPDATE/.test(sql) ? [[{ id: '2569-1' }]] : [{ insertId: 1 }]));
    await expect(termSvc.createTerm(poolOf(conn), { id: '2569-1' }, { userId: 1 }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'TERM_EXISTS' }] });
  });
  test('creates a new (non-current) term', async () => {
    const conn = makeConn((sql) => (/FOR UPDATE/.test(sql) ? [[]] : [{ insertId: 1 }]));
    const out = await termSvc.createTerm(poolOf(conn), { id: '2569-1', name: 'x' }, { userId: 1 });
    expect(out).toMatchObject({ id: '2569-1', is_current: false });
    expect(conn.calls.some(([s]) => /INSERT INTO terms/.test(s))).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
  });
});
