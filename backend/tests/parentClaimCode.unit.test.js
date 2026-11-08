'use strict';

// M3 one-time LINE bind codes issued by the school (parent audit 2026-11-08).
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));

const { pool } = require('../src/config/database');
const { logAudit } = require('../src/utils/audit');
const svc = require('../src/services/parentClaimCode.service');

beforeEach(() => { jest.clearAllMocks(); pool.query.mockReset(); });

describe('codes', () => {
  test('8 characters from an alphabet without look-alikes', () => {
    for (let i = 0; i < 200; i++) {
      const c = svc.generateCode();
      expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    }
  });

  test('normalizeCode accepts the printed form and rejects junk', () => {
    expect(svc.normalizeCode('abcd-2345')).toBe('ABCD2345');
    expect(svc.normalizeCode(' AB CD 23 45 ')).toBe('ABCD2345');
    expect(svc.normalizeCode('ABCD234')).toBeNull();
    expect(svc.normalizeCode('ABCD2340')).toBeNull(); // 0 is not in the alphabet
    expect(svc.normalizeCode(12345678)).toBeNull();
  });
});

describe('issueForStudents', () => {
  function makeConn(students) {
    const conn = {
      beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
      query: jest.fn(async (sql) => {
        if (/FROM students/.test(sql)) return [students];
        return [{ affectedRows: 1 }];
      }),
    };
    pool.getConnection.mockResolvedValue(conn);
    return conn;
  }

  test('scopes to the school, revokes old codes, stores only hashes, audits without codes', async () => {
    const conn = makeConn([{ id: 7, first_name: 'ก' }, { id: 8, first_name: 'ข' }]);
    const out = await svc.issueForStudents({ schoolId: 'SCH1', studentIds: [7, 8, 8], userId: 5 });
    expect(out).toHaveLength(2);
    const sel = conn.query.mock.calls.find(c => /FROM students/.test(c[0]));
    expect(sel[0]).toMatch(/WHERE school_id = \? AND is_deleted = FALSE AND id IN \(\?,\?\)/);
    expect(sel[1]).toEqual(['SCH1', 7, 8]);
    const revokes = conn.query.mock.calls.filter(c => /SET revoked_at = NOW\(\)/.test(c[0]));
    expect(revokes.map(c => c[1][0])).toEqual([7, 8]);
    const inserts = conn.query.mock.calls.filter(c => /INSERT INTO parent_claim_codes/.test(c[0]));
    for (const [i, row] of out.entries()) {
      expect(row.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      const plain = row.code.replace('-', '');
      expect(inserts[i][1][1]).toBe(svc.hashCode(plain));
      expect(JSON.stringify(inserts[i][1])).not.toContain(plain);
    }
    const audit = logAudit.mock.calls[0][0];
    expect(audit).toMatchObject({ entityType: 'parent_claim_code', required: true });
    expect(JSON.stringify(audit)).not.toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}/);
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('findLinkableParentByClaim', () => {
  test('matches only an unused, unrevoked, unexpired code whose pupil has this parent phone', async () => {
    pool.query.mockResolvedValue([[{ claim_id: 3, parent_id: 9, student_code: '101', first_name: 'ก' }]]);
    const r = await svc.findLinkableParentByClaim('0811112222', 'abcd-2345');
    expect(r).toMatchObject({ found: true, claimId: 3, parentId: 9, studentCode: '101' });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/pcc\.used_at IS NULL AND pcc\.revoked_at IS NULL/);
    expect(sql).toMatch(/pcc\.expires_at > NOW\(\)/);
    expect(sql).toMatch(/p\.phone = \?/);
    expect(params).toEqual(['0811112222', svc.hashCode('ABCD2345')]);
  });

  test('a malformed code never reaches the database', async () => {
    expect(await svc.findLinkableParentByClaim('0811112222', 'nope')).toEqual({ found: false });
    expect(pool.query).not.toHaveBeenCalled();
  });
});
