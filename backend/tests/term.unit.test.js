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

describe('getCurrentTerm (cache + fallback)', () => {
  test('reads terms.is_current and caches it (2nd call = no query)', async () => {
    const pool = poolQuery((sql) => (/is_current = TRUE/.test(sql) ? [[{ id: '2569-1' }]] : [[]]));
    expect(await termSvc.getCurrentTerm(pool)).toBe('2569-1');
    expect(await termSvc.getCurrentTerm(pool)).toBe('2569-1');
    expect(pool.query).toHaveBeenCalledTimes(1); // cache hit on the 2nd
  });

  test('falls back to a non-empty env value when no is_current row', async () => {
    const pool = poolQuery(() => [[]]);
    const v = await termSvc.getCurrentTerm(pool);
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });

  test('NEVER throws on a DB error — falls back', async () => {
    const pool = { query: jest.fn().mockRejectedValue(new Error('db down')) };
    const v = await termSvc.getCurrentTerm(pool);
    expect(typeof v).toBe('string');
  });
});

describe('getCurrentTermCachedSync', () => {
  test('returns env fallback when the cache is cold', () => {
    const v = termSvc.getCurrentTermCachedSync();
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });
  test('returns the warmed value after getCurrentTerm', async () => {
    await termSvc.getCurrentTerm(poolQuery(() => [[{ id: '2570-2' }]]));
    expect(termSvc.getCurrentTermCachedSync()).toBe('2570-2');
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
