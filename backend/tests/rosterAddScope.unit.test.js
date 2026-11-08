'use strict';

// SCH-STU-8 (school audit 2026-11-08): a driver's "add new pupil" request is
// limited to a school the bus serves, its fields are whitelisted, and approval
// never auto-links a guardian phone that already has a LINE account.
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));
jest.mock('../src/services/term.service', () => ({ getCurrentTermCachedSync: () => '2569-2', getCurrentTerm: async () => '2569-2' }));

const { pool } = require('../src/config/database');
const svc = require('../src/services/rosterRequest.service');

beforeEach(() => { jest.clearAllMocks(); pool.query.mockReset(); });

function createRoutes({ total = 3, mine = 0 } = {}) {
  pool.query.mockImplementation(async (sql) => {
    if (/FROM schools WHERE id = \?/.test(sql)) return [[{ id: 'SCH2' }]];
    if (/COUNT\(\*\) AS total/.test(sql)) return [[{ total, mine }]];
    if (/INSERT INTO roster_change_requests/.test(sql)) return [{ insertId: 77 }];
    return [[]];
  });
}
const NEW = { first_name: 'ก', last_name: 'ข', school_id: 'SCH2', parent_phone: '0811111111' };

test('a bus that carries other schools only cannot request a pupil for SCH2 (403)', async () => {
  createRoutes({ total: 3, mine: 0 });
  await expect(svc.createRequest({ vehicleId: 'V1', requestType: 'add', userId: 1, newStudentData: NEW }))
    .rejects.toMatchObject({ statusCode: 403 });
  expect(pool.query.mock.calls.some(([sql]) => /INSERT INTO roster_change_requests/.test(sql))).toBe(false);
});

test('a bus already serving SCH2 (or an empty bus) can; unknown fields are dropped and lengths clipped', async () => {
  for (const counts of [{ total: 3, mine: 1 }, { total: 0, mine: 0 }]) {
    createRoutes(counts);
    await expect(svc.createRequest({
      vehicleId: 'V1', requestType: 'add', userId: 1,
      newStudentData: { ...NEW, first_name: 'ก'.repeat(150), is_admin: true, school_id_override: 'X' },
    })).resolves.toMatchObject({ id: 77 });
    const ins = pool.query.mock.calls.find(([sql]) => /INSERT INTO roster_change_requests/.test(sql));
    const stored = JSON.parse(ins[1][4]);
    expect(Object.keys(stored).sort()).toEqual(['first_name', 'last_name', 'parent_phone', 'school_id']);
    expect(stored.first_name).toHaveLength(100);
    pool.query.mockReset();
  }
});

describe('approval', () => {
  function approveConn({ bound }) {
    const calls = [];
    const conn = {
      beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
      query: jest.fn(async (sql, params) => {
        calls.push([sql, params]);
        if (/FROM roster_change_requests WHERE id = \?/.test(sql)) {
          return [[{ id: 5, request_type: 'add', school_id: 'SCH2', vehicle_id: 'V1', student_id: null, new_student_data: JSON.stringify(NEW) }]];
        }
        if (/FROM line_bindings WHERE phone = \?/.test(sql)) return [bound ? [{ ok: 1 }] : []];
        if (/FROM id_sequences/.test(sql)) return [[{ next_value: 5000 }]];
        if (/INSERT INTO parents/.test(sql)) return [{ insertId: 9 }];
        if (/^\s*SELECT/i.test(sql)) return [[]];
        return [{ affectedRows: 1, insertId: 1 }];
      }),
    };
    pool.getConnection.mockResolvedValue(conn);
    return calls;
  }
  const linked = (calls) => calls.some(([sql]) => /INSERT INTO parent_student/.test(sql));

  test('guardian phone already bound to LINE: pupil created, guardian NOT linked, school told', async () => {
    const calls = approveConn({ bound: true });
    const out = await svc.reviewRequest({ requestId: 5, schoolId: 'SCH2', status: 'approved', userId: 3 });
    expect(out.parent_link_skipped).toBe('PHONE_ALREADY_BOUND');
    expect(linked(calls)).toBe(false);
    expect(calls.some(([sql]) => /INSERT INTO students/.test(sql))).toBe(true);
  });

  test('unbound phone links as before', async () => {
    const calls = approveConn({ bound: false });
    const out = await svc.reviewRequest({ requestId: 5, schoolId: 'SCH2', status: 'approved', userId: 3 });
    expect(out.parent_link_skipped).toBeUndefined();
    expect(linked(calls)).toBe(true);
  });
});
