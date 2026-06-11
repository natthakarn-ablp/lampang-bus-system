'use strict';

/**
 * idAllocator.test.js  (Phase 10.13B-2)
 * Unit tests for the atomic id allocator (real concurrency is proven by the
 * Part F DB smoke; here we verify the SQL shape + sequential allocation).
 */
const { allocateId, allocateStudentId } = require('../src/services/idAllocator.service');

// Stateful fake connection: one sequence row that the SELECT reads (FOR UPDATE)
// and the UPDATE increments — mirrors id_sequences behaviour single-threaded.
function makeConn(initial) {
  const seq = { students: initial };
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
      if (/SELECT next_value FROM id_sequences/.test(sql)) {
        const v = seq[params[0]];
        return [v === undefined ? [] : [{ next_value: v }]];
      }
      if (/UPDATE id_sequences SET next_value/.test(sql)) {
        seq[params[0]] += 1;
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
  };
}

describe('allocateStudentId (10.13B-2)', () => {
  test('returns the current next_value and increments (locks then updates)', async () => {
    const conn = makeConn(987694);
    const id = await allocateStudentId(conn);
    expect(id).toBe(987694);
    expect(conn.calls[0]).toBe('SELECT next_value');     // FOR UPDATE lock first
    expect(conn.calls[1]).toBe('UPDATE id_sequences');   // then increment
  });

  test('sequential allocations are unique and monotonic', async () => {
    const conn = makeConn(100);
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await allocateStudentId(conn));
    expect(ids).toEqual([100, 101, 102, 103, 104]);
    expect(new Set(ids).size).toBe(5);
  });

  test('throws a clear 500 if the sequence row is missing', async () => {
    const conn = makeConn(undefined);
    await expect(allocateStudentId(conn)).rejects.toMatchObject({ statusCode: 500 });
  });

  test('allocateId is generic over sequence name', async () => {
    const conn = makeConn(7);
    expect(await allocateId(conn, 'students')).toBe(7);
  });
});
