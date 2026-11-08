'use strict';

// M2 co-guardians (parent audit 2026-11-08, owner-approved).
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));

const { pool } = require('../src/config/database');
const env = require('../src/config/env');
const svc = require('../src/services/coGuardian.service');
const claim = require('../src/services/parentClaimCode.service');
const { activeBindingsSql } = require('../src/services/lineBindingSource');

// A tiny fake DB driven by regex → rows, recording every statement.
function fakeConn(routes) {
  const calls = [];
  const conn = {
    calls,
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    query: jest.fn(async (sql, params) => {
      calls.push([sql, params]);
      for (const [re, val] of routes) if (re.test(sql)) return typeof val === 'function' ? val(sql, params) : val;
      return [{ affectedRows: 1 }];
    }),
  };
  pool.getConnection.mockResolvedValue(conn);
  pool.query.mockImplementation(conn.query);
  return conn;
}

beforeEach(() => { jest.clearAllMocks(); pool.query.mockReset(); env.features.coGuardian = false; });
afterAll(() => { env.features.coGuardian = false; });

describe('binding source', () => {
  test('flag off: plain line_bindings (old SQL unchanged, 058 table never referenced)', () => {
    expect(activeBindingsSql()).toBe('line_bindings');
  });
  test('flag on: primary + co-guardians with the same columns', () => {
    env.features.coGuardian = true;
    const sql = activeBindingsSql();
    expect(sql).toMatch(/FROM line_bindings UNION ALL SELECT phone, line_user_id, is_active, bound_at FROM line_co_guardians/);
  });
});

describe('createInvite', () => {
  test('primary only', async () => {
    fakeConn([[/FROM line_bindings/, [[]]]]);
    await expect(svc.createInvite('U_x')).rejects.toMatchObject({ statusCode: 403 });
  });

  test('refused at the limit of 2', async () => {
    fakeConn([[/FROM line_bindings/, [[{ phone: '0811' }]]], [/COUNT\(\*\) AS n FROM line_co_guardians/, [[{ n: 2 }]]]]);
    await expect(svc.createInvite('U_p')).rejects.toMatchObject({ statusCode: 409, code: 'CO_GUARDIAN_LIMIT' });
  });

  test('revokes the previous invite and stores only the hash', async () => {
    const conn = fakeConn([[/FROM line_bindings/, [[{ phone: '0811' }]]], [/COUNT\(\*\) AS n FROM line_co_guardians/, [[{ n: 0 }]]]]);
    const out = await svc.createInvite('U_p');
    expect(out.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(conn.calls.some(([s]) => /UPDATE line_guardian_invites SET revoked_at = NOW\(\)/.test(s))).toBe(true);
    const ins = conn.calls.find(([s]) => /INSERT INTO line_guardian_invites/.test(s));
    expect(ins[1]).toEqual(['0811', claim.hashCode(out.code.replace('-', '')), 'U_p']);
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('acceptInvite', () => {
  const ok = [
    [/FROM line_bindings WHERE line_user_id = \?/, [[]]],
    [/FROM line_co_guardians WHERE line_user_id = \?/, [[]]],
    [/FROM line_guardian_invites/, [[{ id: 4, phone: '0811', invited_by: 'U_p' }]]],
    [/FROM line_bindings WHERE phone = \?/, [[{ line_user_id: 'U_p' }]]],
    [/FROM parents WHERE phone = \?/, [[{ id: 9 }]]],
    [/COUNT\(\*\) AS n FROM line_co_guardians/, [[{ n: 1 }]]],
  ];

  test('joins: co-guardian row, verified line_users mirror, invite used', async () => {
    const conn = fakeConn(ok);
    await expect(svc.acceptInvite('U_c', 'abcd-2345')).resolves.toEqual({ ok: true, invited_by: 'U_p' });
    const lookup = conn.calls.find(([s]) => /FROM line_guardian_invites/.test(s));
    expect(lookup[1]).toEqual([claim.hashCode('ABCD2345')]);
    expect(lookup[0]).toMatch(/used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW\(\)/);
    expect(conn.calls.find(([s]) => /INSERT INTO line_co_guardians/.test(s))[1]).toEqual(['U_c', '0811', 'U_p']);
    expect(conn.calls.find(([s]) => /INSERT INTO line_users/.test(s))[1].slice(0, 2)).toEqual(['U_c', 9]);
    expect(conn.calls.some(([s, p]) => /UPDATE line_guardian_invites SET used_at = NOW\(\), used_by = \?/.test(s) && p[0] === 'U_c')).toBe(true);
  });

  test('an already-bound LINE account cannot join', async () => {
    fakeConn([[/FROM line_bindings WHERE line_user_id = \?/, [[{ phone: '0899' }]]], ...ok]);
    await expect(svc.acceptInvite('U_c', 'ABCD2345')).rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_BOUND' });
  });

  test('unknown/expired code is 404; malformed is 400 without a query', async () => {
    fakeConn([[/FROM line_guardian_invites/, [[]]], ...ok]);
    await expect(svc.acceptInvite('U_c', 'ABCD2345')).rejects.toMatchObject({ statusCode: 404 });
    pool.getConnection.mockClear();
    await expect(svc.acceptInvite('U_c', 'bad')).rejects.toMatchObject({ statusCode: 400 });
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  test('the primary left the phone after inviting: 404', async () => {
    fakeConn([[/FROM line_bindings WHERE phone = \?/, [[]]], ...ok]);
    await expect(svc.acceptInvite('U_c', 'ABCD2345')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('limit reached meanwhile: 409', async () => {
    fakeConn([[/COUNT\(\*\) AS n FROM line_co_guardians/, [[{ n: 2 }]]], ...ok]);
    await expect(svc.acceptInvite('U_c', 'ABCD2345')).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('removal', () => {
  test('primary removes only a co-guardian of its own phone, and unverifies the mirror', async () => {
    const conn = fakeConn([
      [/FROM line_bindings WHERE line_user_id = \?/, [[{ phone: '0811' }]]],
      [/SELECT id, line_user_id FROM line_co_guardians/, [[{ id: 3, line_user_id: 'U_c' }]]],
    ]);
    await expect(svc.removeByPrimary('U_p', 3)).resolves.toEqual(['U_c']);
    const sel = conn.calls.find(([s]) => /SELECT id, line_user_id FROM line_co_guardians/.test(s));
    expect(sel[0]).toMatch(/id = \? AND phone = \?/);
    expect(sel[1]).toEqual([3, '0811']);
    expect(conn.calls.some(([s, p]) => /UPDATE line_users SET parent_id = NULL, verified = FALSE/.test(s) && p[0] === 'U_c')).toBe(true);
  });

  test('removeAllForPhone revokes pending invites too', async () => {
    const conn = fakeConn([[/SELECT id, line_user_id FROM line_co_guardians/, [[{ id: 1, line_user_id: 'U_a' }, { id: 2, line_user_id: 'U_b' }]]]]);
    await expect(svc.removeAllForPhone('0811')).resolves.toEqual(['U_a', 'U_b']);
    expect(conn.calls.some(([s]) => /UPDATE line_guardian_invites SET revoked_at = NOW\(\) WHERE phone = \?/.test(s))).toBe(true);
  });
});

describe('getGuardianInfo never returns LINE ids', () => {
  test('primary view', async () => {
    fakeConn([
      [/FROM line_bindings WHERE line_user_id = \?/, [[{ phone: '0811' }]]],
      [/FROM line_co_guardians cg/, [[{ id: 3, bound_at: null, display_name: 'แม่' }]]],
      [/COUNT\(\*\) AS n FROM line_guardian_invites/, [[{ n: 1 }]]],
    ]);
    const out = await svc.getGuardianInfo('U_p');
    expect(out).toEqual({ role: 'primary', max: 2, co_guardians: [{ id: 3, display_name: 'แม่', bound_at: null }], pending_invite: true });
  });
});
