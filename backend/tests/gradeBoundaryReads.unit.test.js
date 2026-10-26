'use strict';

/**
 * AUD-004 (widened) — the grade boundary must hold on every school read, and it
 * must match grades the way the rest of the codebase does.
 *
 * Two distinct defects are covered here, both found while implementing the
 * product-owner decision that a homeroom teacher sees only their own grade:
 *
 * 1. GET /api/school/no-show consulted NEITHER resolveGradeScope nor
 *    requireFullSchoolScope — the only read on the school router that did
 *    neither. It names the children who did not board, with classroom and bus
 *    plate, for any date the caller passes.
 *
 * 2. Four grade filters that DID respect the boundary matched with exact
 *    equality (`s.grade = ?`). students.grade is a bare VARCHAR written from
 *    imports and free-text forms, so 'ป.4' and 'ประถมศึกษาปีที่ 4' both occur.
 *    An exact match there does not leak — it hides a teacher's OWN pupils, and
 *    an empty list reads as "nobody", not as "your filter matched nothing".
 *    gradeScopeCounts.test.js exists because that divergence already bit once.
 *
 * DB-free: the pool is stubbed and the statements the services actually issue
 * are read back. Run with `npm run test:unit`.
 */

require('./loadTestEnv');

// Named with the `mock` prefix because jest hoists jest.mock() above every
// declaration in the file; only `mock*` identifiers may be referenced from a
// module factory.
const mockCalls = [];
const mockPool = {
  query: jest.fn((sql, params) => {
    mockCalls.push({ sql: String(sql), params: params || [] });
    return Promise.resolve([[{ total: 0 }]]);
  }),
};
jest.mock('../src/config/database', () => ({ pool: mockPool, getConnection: jest.fn() }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));

const checkinSvc = require('../src/services/checkin.service');
const leaveSvc = require('../src/services/leave.service');
const vehicleLocationSvc = require('../src/services/vehicleLocation.service');
const rosterRequestSvc = require('../src/services/rosterRequest.service');
const { gradeEquivalents } = require('../src/utils/gradeScope');

const GRADE = 'ป.4';
const EQ = gradeEquivalents(GRADE);

beforeEach(() => { mockCalls.length = 0; mockPool.query.mockClear(); });

/** Every statement issued during the call, as one array. */
const sqlIssued = () => mockCalls.map((c) => c.sql);
const hasTolerantGrade = (sql) => /\bs?x?\.?grade\s+IN\s*\(/.test(sql);
const hasExactGrade = (sql) => /\bgrade\s*=\s*\?/.test(sql);

describe('AUD-004 — GET /api/school/no-show respects the grade boundary', () => {
  test('a grade filter narrows the query and binds every spelling of the grade', async () => {
    await checkinSvc.getNoShowStudents(mockPool, {
      schoolId: 'SCH0001', session: 'morning', date: '2026-08-28', gradeFilter: GRADE,
    });
    expect(mockCalls).toHaveLength(1);
    expect(hasTolerantGrade(mockCalls[0].sql)).toBe(true);
    for (const variant of EQ) expect(mockCalls[0].params).toContain(variant);
  });

  test('the grade values are bound in the slot the clause occupies', async () => {
    // The clause sits immediately after `s.school_id = ?`, so the grade values
    // must follow the school id and precede the session/date parameters. A
    // params array that drifts here silently swaps a date for a session.
    await checkinSvc.getNoShowStudents(mockPool, {
      schoolId: 'SCH0001', session: 'evening', date: '2026-08-28', gradeFilter: GRADE,
    });
    const { sql, params } = mockCalls[0];
    expect(params.length).toBe((sql.match(/\?/g) || []).length);
    expect(params[0]).toBe('SCH0001');
    expect(params.slice(1, 1 + EQ.length).sort()).toEqual([...EQ].sort());
    expect(params.slice(1 + EQ.length)).toEqual(['evening', '2026-08-28', '2026-08-28', 'evening']);
  });

  test('a full school account is unaffected — no grade clause, original params', async () => {
    await checkinSvc.getNoShowStudents(mockPool, {
      schoolId: 'SCH0001', session: 'morning', date: null,
    });
    expect(hasTolerantGrade(mockCalls[0].sql)).toBe(false);
    expect(hasExactGrade(mockCalls[0].sql)).toBe(false);
    expect(mockCalls[0].params).toEqual(['SCH0001', 'morning', null, null, 'morning']);
  });

  test('an unknown grade string still narrows rather than matching everything', async () => {
    // Fails closed: gradeEquivalents returns the input as-is for a value it does
    // not recognise, so the clause matches that literal and nothing wider.
    await checkinSvc.getNoShowStudents(mockPool, {
      schoolId: 'SCH0001', session: 'morning', date: null, gradeFilter: 'ไม่มีชั้นนี้',
    });
    expect(hasTolerantGrade(mockCalls[0].sql)).toBe(true);
    expect(mockCalls[0].params).toContain('ไม่มีชั้นนี้');
  });
});

describe('AUD-004 — grade filters match tolerantly, not by exact equality', () => {
  test('the school leave list matches every spelling', async () => {
    await leaveSvc.getLeavesForSchool('SCH0001', '2026-08-28', { gradeFilter: GRADE });
    expect(sqlIssued().some(hasTolerantGrade)).toBe(true);
    expect(sqlIssued().some(hasExactGrade)).toBe(false);
    for (const variant of EQ) expect(mockCalls[0].params).toContain(variant);
  });

  test('the live-vehicle list matches every spelling', async () => {
    await vehicleLocationSvc.listForSchool('SCH0001', GRADE);
    expect(sqlIssued().some(hasTolerantGrade)).toBe(true);
    expect(sqlIssued().some(hasExactGrade)).toBe(false);
    for (const variant of EQ) expect(mockCalls[0].params).toContain(variant);
  });

  test('the roster-request queue matches every spelling on BOTH arms', async () => {
    // One arm reads students.grade, the other reads the grade typed into a
    // pending request's JSON. Either can hold a variant spelling, and a request
    // dropped from this queue appears nowhere else.
    await rosterRequestSvc.getRequestsForSchool('SCH0001', { status: null, gradeFilter: GRADE });
    const withGrade = mockCalls.filter((c) => hasTolerantGrade(c.sql) || /JSON_UNQUOTE/.test(c.sql));
    expect(withGrade.length).toBeGreaterThan(0);
    for (const c of withGrade) {
      expect(hasExactGrade(c.sql)).toBe(false);
      // Both arms are bound, so each spelling appears twice.
      for (const variant of EQ) {
        expect(c.params.filter((p) => p === variant).length).toBe(2);
      }
    }
  });

  test('no grade filter leaves each of these queries exactly as it was', async () => {
    await leaveSvc.getLeavesForSchool('SCH0001', '2026-08-28', {});
    await vehicleLocationSvc.listForSchool('SCH0001');
    await rosterRequestSvc.getRequestsForSchool('SCH0001', { status: null });
    for (const sql of sqlIssued()) {
      expect(hasTolerantGrade(sql)).toBe(false);
      expect(hasExactGrade(sql)).toBe(false);
    }
  });

  test('placeholders and params stay in step wherever a grade filter is applied', async () => {
    await leaveSvc.getLeavesForSchool('SCH0001', '2026-08-28', { gradeFilter: GRADE });
    await vehicleLocationSvc.listForSchool('SCH0001', GRADE);
    await rosterRequestSvc.getRequestsForSchool('SCH0001', { status: 'PENDING', gradeFilter: GRADE });
    for (const c of mockCalls) {
      expect(c.params.length).toBe((c.sql.match(/\?/g) || []).length);
    }
  });
});
