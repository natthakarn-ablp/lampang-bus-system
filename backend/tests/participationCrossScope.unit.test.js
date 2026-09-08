'use strict';

/**
 * Cross-scope reachability for participation cases — at the REQUEST level.
 *
 * WHY THIS EXISTS
 * ---------------
 * participation.unit.test.js already asserts what `scopeClause` RETURNS: the
 * shape of a SQL string and the parameters beside it. That is a test of a
 * string, not of an access control. It passes unchanged if the predicate is
 * dropped from the query, bound into the wrong slot, applied to the list and
 * forgotten on the detail read, or checked before the transaction and not
 * inside it. The property that has to hold is "a case belonging to another
 * scope is unreachable", and only a request can show that.
 *
 * So this drives the real thing: a real HS256 token per role, the real
 * `authenticate`, the real `requireRole`, the real handlers, the real service
 * and the real errorHandler. Everything except MySQL.
 *
 * HOW IT STAYS DB-FREE
 * --------------------
 * `pool` is replaced by a small in-memory engine that understands only the
 * statements this router issues, and — the part that matters — EVALUATES the
 * WHERE clause it is handed instead of recognising it. The scope predicate is
 * translated from its SQL subset into JavaScript and run against the fixture
 * rows, so the rule under test still comes from the route: change
 * `scopeClause` and these expectations move with it, exactly as they would
 * against a real database. Nothing here restates the rule.
 *
 * What the engine is not: it has no types, no collation, no isolation levels
 * and no column projection (it returns whole rows), so nothing in this file
 * may assert that a column was withheld. It refuses any statement it does not
 * recognise rather than answering `[]`, so a route that starts issuing
 * something else fails loudly here instead of quietly passing.
 *
 * `node:sqlite` would have been the honest engine and was rejected: production
 * runs Node v20.20.2 (docs/PHASE9_OWNER_OPERATOR_APPROVAL_2026-08.md), that
 * module landed in 22.5, and the deploy runs this jest config ON the server —
 * a `require` that throws there would fail the deploy, not just this file.
 */

require('./loadTestEnv');

// ─── The in-memory engine ───────────────────────────────────────────────────
// `mock`-prefixed because jest hoists jest.mock() above every declaration in
// the file and only mock* identifiers may be referenced from a module factory.
const mockDb = {
  schools: [],
  users: [],
  participation_cases: [],
  participation_case_events: [],
  audit_logs: [],
  nextId: { participation_cases: 100, participation_case_events: 500, audit_logs: 900 },
};

/**
 * Translate the SQL boolean subset these routes use into JavaScript.
 *
 * Only the operators that actually appear are handled: `=`, `IN`, `NOT IN`,
 * `AND`, `OR`, parentheses, `TRUE`/`FALSE` and the constants `1=1` / `1=0`.
 * Anything else produces a JavaScript syntax error when it is evaluated, which
 * is the outcome we want — a predicate this file cannot read must not be
 * silently treated as "matches nothing".
 */
function sqlBoolToJs(sql) {
  return sql
    // `x NOT IN (a, b)` before `x IN (...)`, or the second rule would eat the
    // tail of the first and invert the meaning.
    .replace(/([\w.]+)\s+NOT\s+IN\s+\(([^()]*)\)/gi, '!([$2].includes($1))')
    .replace(/([\w.]+)\s+IN\s+\(([^()]*)\)/gi, '[$2].includes($1)')
    // Single `=` is SQL equality. The lookarounds leave `<=`, `>=`, `!=` and an
    // already-doubled `==` alone; none appear today, and a future one must not
    // be mangled into something that still parses.
    .replace(/(?<![<>!=])=(?!=)/g, '===')
    .replace(/\bAND\b/g, '&&')
    .replace(/\bOR\b/g, '||')
    .replace(/\bTRUE\b/g, 'true')
    .replace(/\bFALSE\b/g, 'false');
}

/** Evaluate one translated predicate against one row. */
function evalRow(jsExpr, row) {
  // eslint-disable-next-line no-new-func
  return Boolean(new Function('row', `return (${jsExpr});`)(row));
}

/**
 * Compile a WHERE clause (still holding `?` placeholders) into a row predicate.
 *
 * Column references are rewritten BEFORE the parameters are substituted, so a
 * parameter value that happens to contain a dot can never be mistaken for a
 * `table.column` reference.
 */
function compileWhere(whereSql, params) {
  let index = 0;
  let expr = whereSql
    .replace(/\b[a-z]\.([a-z_]+)\b/gi, 'row.$1')
    .replace(/\?/g, () => JSON.stringify(params[index++] ?? null));

  // Correlated sub-selects (`... IN (SELECT s.id FROM schools s WHERE ...)`)
  // are resolved into a literal list by running the inner predicate over the
  // inner table's fixture rows — the same translation, one level down.
  expr = expr.replace(
    /IN \(\s*SELECT row\.(\w+) FROM (\w+) \w+ WHERE ([^()]*?)\s*\)/gi,
    (_match, column, table, innerWhere) => {
      const inner = sqlBoolToJs(innerWhere);
      const values = (mockDb[table] || [])
        .filter((row) => evalRow(inner, row))
        .map((row) => JSON.stringify(row[column]));
      // An empty list must still be a valid, never-matching expression.
      return `IN (${values.join(', ') || 'null'})`;
    }
  );

  const compiled = sqlBoolToJs(expr);
  return (row) => evalRow(compiled, row);
}

/** The leading N parameters belong to the WHERE clause; the rest are LIMIT/OFFSET. */
function whereParams(whereSql, params) {
  return params.slice(0, (whereSql.match(/\?/g) || []).length);
}

function selectCases(whereSql, params) {
  const match = compileWhere(whereSql, whereParams(whereSql, params));
  return mockDb.participation_cases.filter(match);
}

/** Generic INSERT: reads the column list and the VALUES list out of the SQL. */
function runInsert(table, sql, params) {
  const parts = sql.match(/^INSERT INTO \w+ \(([^)]+)\) VALUES \(([^)]+)\)$/i);
  if (!parts) throw new Error(`engine cannot parse INSERT: ${sql}`);
  const columns = parts[1].split(',').map((c) => c.trim());
  let index = 0;
  const values = parts[2].split(',').map((raw) => {
    const token = raw.trim();
    return token === '?' ? params[index++] : token.replace(/^'|'$/g, '');
  });

  const row = { id: (mockDb.nextId[table] += 1), created_at: new Date().toISOString() };
  columns.forEach((column, i) => { row[column] = values[i]; });
  mockDb[table].push(row);
  return [{ insertId: row.id, affectedRows: 1 }];
}

/** Generic UPDATE of one case row by id. */
function runCaseUpdate(sql, params) {
  const parts = sql.match(/^UPDATE participation_cases SET (.+) WHERE id = \?$/i);
  if (!parts) throw new Error(`engine cannot parse UPDATE: ${sql}`);
  const assignments = parts[1].split(',').map((a) => a.trim());
  let index = 0;
  const patch = {};
  for (const assignment of assignments) {
    const [column, value] = assignment.split('=').map((s) => s.trim());
    patch[column] = value === '?' ? params[index++] : new Date().toISOString(); // NOW()
  }
  const id = params[index];
  const row = mockDb.participation_cases.find((c) => String(c.id) === String(id));
  if (row) Object.assign(row, patch);
  return [{ affectedRows: row ? 1 : 0 }];
}

async function runQuery(rawSql, rawParams) {
  const sql = String(rawSql).replace(/\s+/g, ' ').trim();
  const params = rawParams || [];
  let match;

  // authenticate() re-reads the account on every request.
  if (/^SELECT u\.is_active/.test(sql)) {
    const user = mockDb.users.find((u) => String(u.id) === String(params[1]));
    return [user ? [{ ...user, sessions_reset_at: null }] : []];
  }

  match = sql.match(/^SELECT COUNT\(\*\) AS total FROM participation_cases c WHERE (.+)$/i);
  if (match) return [[{ total: selectCases(match[1], params).length }]];

  match = sql.match(/^SELECT c\.id, c\.case_no.+ FROM participation_cases c WHERE (.+) ORDER BY c\.created_at DESC LIMIT \? OFFSET \?$/i);
  if (match) {
    const rows = selectCases(match[1], params);
    const [perPage, offset] = params.slice(-2);
    return [rows.slice(offset, offset + perPage)];
  }

  // The detail read (`c.*`) and the scope re-check inside the append
  // transaction (`c.id`) — two separate copies of the predicate, one engine
  // rule, so neither can be answered from a different set of rows than the other.
  match = sql.match(/^SELECT c\.(?:\*|id) FROM participation_cases c WHERE (.+)$/i);
  if (match) return [selectCases(match[1], params)];

  match = sql.match(/^SELECT c\.status, c\.case_type.+ FROM participation_cases c WHERE (.+)$/i);
  if (match) return [selectCases(match[1], params)];

  if (/^SELECT id, event_type.+ FROM participation_case_events WHERE case_id = \?/i.test(sql)) {
    return [mockDb.participation_case_events.filter((e) => String(e.case_id) === String(params[0]))];
  }

  if (/^SELECT \* FROM participation_cases WHERE id = \? FOR UPDATE$/i.test(sql)) {
    return [mockDb.participation_cases.filter((c) => String(c.id) === String(params[0]))];
  }

  match = sql.match(/^INSERT INTO (\w+) /i);
  if (match && mockDb[match[1]]) return runInsert(match[1], sql, params);

  if (/^UPDATE participation_cases SET /i.test(sql)) return runCaseUpdate(sql, params);

  // Deliberately fatal. A statement this engine does not know is a statement
  // this file is not testing, and answering [] would hide that.
  throw new Error(`engine has no rule for: ${sql}`);
}

const mockPool = {
  query: jest.fn(runQuery),
  getConnection: jest.fn(async () => {
    // A transaction is a snapshot and a restore. Crude, but enough to show
    // that a refused append leaves nothing behind — which is the reason the
    // scope re-check inside POST /cases/:id/events rolls back at all.
    let snapshot = null;
    const tables = ['participation_cases', 'participation_case_events', 'audit_logs'];
    const take = () => Object.fromEntries(tables.map((t) => [t, JSON.parse(JSON.stringify(mockDb[t]))]));
    return {
      query: runQuery,
      beginTransaction: async () => { snapshot = take(); },
      commit: async () => { snapshot = null; },
      rollback: async () => {
        if (snapshot) for (const t of tables) mockDb[t] = snapshot[t];
        snapshot = null;
      },
      release: () => {},
    };
  }),
};

jest.mock('../src/config/database', () => ({ pool: mockPool, getConnection: jest.fn() }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const env = require('../src/config/env');
const errorHandler = require('../src/middleware/errorHandler');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/participation', require('../src/routes/participation.routes'));
  app.use(errorHandler);
  return app;
}
const app = makeApp();

// ─── Who is asking ──────────────────────────────────────────────────────────
// One holder per role, plus a second school, a second affiliation and a second
// driver — a scope boundary can only be tested against another scope.
const HOLDERS = {
  schoolA:      { id: 11, role: 'school',      scopeType: 'SCHOOL',      scopeId: 'SCH0001' },
  schoolB:      { id: 12, role: 'school',      scopeType: 'SCHOOL',      scopeId: 'SCH0002' },
  affiliationA: { id: 21, role: 'affiliation', scopeType: 'AFFILIATION', scopeId: 'AFF001' },
  affiliationB: { id: 22, role: 'affiliation', scopeType: 'AFFILIATION', scopeId: 'AFF002' },
  province:     { id: 31, role: 'province',    scopeType: 'PROVINCE',    scopeId: 'LPG' },
  transport:    { id: 41, role: 'transport',   scopeType: null,          scopeId: null },
  driverA:      { id: 51, role: 'driver',      scopeType: null,          scopeId: null },
  driverB:      { id: 52, role: 'driver',      scopeType: null,          scopeId: null },
  admin:        { id: 61, role: 'admin',       scopeType: null,          scopeId: null },
};

function tokenFor(holder) {
  return jwt.sign(
    {
      sub: holder.id,
      username: `u${holder.id}`,
      role: holder.role,
      scopeType: holder.scopeType,
      scopeId: holder.scopeId,
    },
    env.jwt.secret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

const as = (holder) => `Bearer ${tokenFor(HOLDERS[holder])}`;

// ─── What there is to reach ─────────────────────────────────────────────────
// Case ids are stable and referred to by number below, so the expected-set
// tables stay readable.
const CASES = [
  { id: 1, scope_type: 'SCHOOL',      scope_id: 'SCH0001', initiated_by: 11, initiated_role: 'school' },
  { id: 2, scope_type: 'SCHOOL',      scope_id: 'SCH0002', initiated_by: 12, initiated_role: 'school' },
  { id: 3, scope_type: 'AFFILIATION', scope_id: 'AFF001',  initiated_by: 21, initiated_role: 'affiliation' },
  { id: 4, scope_type: 'PROVINCE',    scope_id: null,      initiated_by: 31, initiated_role: 'province' },
  { id: 5, scope_type: 'TRANSPORT',   scope_id: null,      initiated_by: 41, initiated_role: 'transport' },
  { id: 6, scope_type: 'SCHOOL',      scope_id: 'SCH0003', initiated_by: 11, initiated_role: 'school' },
  { id: 7, scope_type: 'SCHOOL',      scope_id: 'SCH0001', initiated_by: 51, initiated_role: 'driver' },
  { id: 8, scope_type: 'SCHOOL',      scope_id: 'SCH0001', initiated_by: 52, initiated_role: 'driver' },
  // SCH0009 is soft-deleted, so it is in no affiliation's list any more.
  { id: 9, scope_type: 'SCHOOL',      scope_id: 'SCH0009', initiated_by: 11, initiated_role: 'school' },
];

const ALL_IDS = CASES.map((c) => c.id);

/**
 * The rows each role may reach. Derived by hand from CLAUDE.md §8 and the
 * router's own doc comment, NOT from scopeClause — a expectation computed from
 * the code under test would agree with any bug it contains.
 */
const VISIBLE = {
  schoolA:      [1, 7, 8],           // its own scope, whoever raised the case
  schoolB:      [2],
  affiliationA: [1, 3, 6, 7, 8],     // AFF001 itself + SCH0001 + SCH0003
  affiliationB: [2],                 // SCH0002 only
  province:     ALL_IDS,
  admin:        ALL_IDS,
  transport:    [5],
  driverA:      [7],                 // what this driver raised, nothing else
  driverB:      [8],
};

beforeEach(() => {
  mockDb.schools = [
    { id: 'SCH0001', affiliation_id: 'AFF001', is_deleted: false },
    { id: 'SCH0002', affiliation_id: 'AFF002', is_deleted: false },
    { id: 'SCH0003', affiliation_id: 'AFF001', is_deleted: false },
    { id: 'SCH0009', affiliation_id: 'AFF001', is_deleted: true },
  ];
  mockDb.users = [
    ...Object.values(HOLDERS).map((h) => h.id),
    71, // the parent account used by the role-guard test below
  ].map((id) => ({
    id, is_active: 1, must_change_password: 0, driver_id: null, password_changed_at: null,
  }));
  mockDb.participation_cases = CASES.map((c) => ({
    case_no: `PC-20260901-00000${c.id}`,
    case_type: 'SERVICE_ISSUE',
    subject: 'เรื่องทดสอบขอบเขต',
    body: null,
    status: 'SUBMITTED',
    decision: null,
    decision_rationale: null,
    decided_at: null,
    assigned_to: null,
    due_at: null,
    completed_at: null,
    feedback_sent_at: null,
    linked_entity_type: null,
    linked_entity_id: null,
    created_at: `2026-09-0${c.id} 08:00:00`,
    updated_at: `2026-09-0${c.id} 08:00:00`,
    ...c,
  }));
  mockDb.participation_case_events = [];
  mockDb.audit_logs = [];
  mockPool.query.mockClear();
});

/** Every case id the caller can see through the list endpoint. */
async function listIds(holder) {
  const res = await request(app)
    .get('/api/participation/cases?per_page=100')
    .set('Authorization', as(holder));
  expect(res.status).toBe(200);
  return res.body.data.map((row) => row.id).sort((a, b) => a - b);
}

describe('reading a case that belongs to another scope', () => {
  for (const holder of Object.keys(VISIBLE)) {
    it(`the list shows ${holder} exactly its own scope`, async () => {
      expect(await listIds(holder)).toEqual(VISIBLE[holder]);
    });
  }

  it('the detail read agrees with the list, case by case, for every role', async () => {
    // The list and the detail read are two separate queries with two separate
    // copies of the predicate. Asserting them together is the point: a scope
    // enforced on one and not the other is the shape this bug usually takes.
    const disagreements = [];
    for (const holder of Object.keys(VISIBLE)) {
      for (const id of ALL_IDS) {
        const res = await request(app)
          .get(`/api/participation/cases/${id}`)
          .set('Authorization', as(holder));
        const expected = VISIBLE[holder].includes(id) ? 200 : 404;
        if (res.status !== expected) {
          disagreements.push(`${holder} → case ${id}: got ${res.status}, expected ${expected}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('answers 404, not 403, so an id outside the scope is not confirmed to exist', async () => {
    // 403 on a real id and 404 on an absent one is an oracle: it lets an
    // outsider enumerate which case numbers exist. Both must read the same.
    const outOfScope = await request(app)
      .get('/api/participation/cases/2')
      .set('Authorization', as('schoolA'));
    const neverExisted = await request(app)
      .get('/api/participation/cases/98765')
      .set('Authorization', as('schoolA'));
    expect(outOfScope.status).toBe(404);
    expect(neverExisted.status).toBe(404);
    expect(outOfScope.body.message).toBe(neverExisted.body.message);
  });

  it('a driver cannot read another driver\'s case', async () => {
    // Called out on its own because it is the boundary with no organisational
    // unit behind it: two drivers share every scope column, and only
    // `initiated_by` separates them.
    const own = await request(app).get('/api/participation/cases/7').set('Authorization', as('driverA'));
    const other = await request(app).get('/api/participation/cases/8').set('Authorization', as('driverA'));
    expect(own.status).toBe(200);
    expect(other.status).toBe(404);
  });

  it('an affiliation loses sight of a soft-deleted school\'s cases', async () => {
    // Case 9 sits in SCH0009, which is is_deleted. The sub-select filters it
    // out, so the case is reachable by province and admin only.
    expect(await listIds('affiliationA')).not.toContain(9);
    const res = await request(app).get('/api/participation/cases/9').set('Authorization', as('affiliationA'));
    expect(res.status).toBe(404);
  });

  it('the summary counts only the caller\'s own scope', async () => {
    // The aggregate runs the same predicate. If it did not, a school could
    // read the province's totals off a page that shows no case rows at all.
    const res = await request(app).get('/api/participation/summary').set('Authorization', as('schoolA'));
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(VISIBLE.schoolA.length);
  });

  it('a role the router does not admit is refused outright', async () => {
    // parent is a real value of participation_cases.initiated_role but not a
    // JWT role the router accepts; the guard, not the scope clause, stops it.
    const res = await request(app)
      .get('/api/participation/cases')
      .set('Authorization', `Bearer ${jwt.sign({ sub: 71, role: 'parent' }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' })}`);
    expect(res.status).toBe(403);
  });
});

describe('the expectations above are a floor, not a vacuous pass', () => {
  it('the engine narrows on the predicate it is given', () => {
    // Everything above rests on one claim: that a weaker scope predicate would
    // select more rows and break the tables. Shown here rather than assumed —
    // if `scopeClause` ever regressed to a constant, this is the row set the
    // routes would have returned.
    expect(selectCases('1=1', []).map((c) => c.id)).toEqual(ALL_IDS);
    expect(selectCases('1=0', []).map((c) => c.id)).toEqual([]);
    expect(selectCases('c.initiated_by = ?', [51]).map((c) => c.id)).toEqual([7]);
    expect(selectCases("c.scope_type = 'SCHOOL' AND c.scope_id = ?", ['SCH0001']).map((c) => c.id))
      .toEqual([1, 7, 8]);
  });

  it('refuses a statement it does not understand rather than answering nothing', async () => {
    // A route that starts issuing a different query must fail here loudly. An
    // engine that answered [] would turn every scope test into a tautology.
    await expect(runQuery('SELECT something FROM elsewhere WHERE 1=1', [])).rejects.toThrow(/no rule/);
  });
});

describe('appending to a case that belongs to another scope', () => {
  const comment = { event_type: 'COMMENTED', note: 'ขอเพิ่มข้อมูล' };

  it('append is reachable exactly where reading is, for every role', async () => {
    // Read scope and write scope are enforced by two separate copies of the
    // predicate — the write one inside the transaction. They must not drift:
    // a case you can see but not comment on is a usability bug, and a case you
    // can comment on but not see is a data breach.
    const disagreements = [];
    for (const holder of Object.keys(VISIBLE)) {
      for (const id of ALL_IDS) {
        const res = await request(app)
          .post(`/api/participation/cases/${id}/events`)
          .set('Authorization', as(holder))
          .send(comment);
        const expected = VISIBLE[holder].includes(id) ? 201 : 404;
        if (res.status !== expected) {
          disagreements.push(`${holder} → case ${id}: got ${res.status}, expected ${expected}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('a driver cannot append to another driver\'s case', async () => {
    const res = await request(app)
      .post('/api/participation/cases/8/events')
      .set('Authorization', as('driverA'))
      .send(comment);
    expect(res.status).toBe(404);
  });

  it('a refused append writes no event and no audit row', async () => {
    // The refusal happens inside the transaction, so "refused" has to mean the
    // evidence log is untouched — not merely that the response said 404.
    await request(app)
      .post('/api/participation/cases/2/events')
      .set('Authorization', as('schoolA'))
      .send(comment);
    expect(mockDb.participation_case_events).toEqual([]);
    expect(mockDb.audit_logs).toEqual([]);
  });

  it('an accepted append records the event under the caller\'s own role', async () => {
    const res = await request(app)
      .post('/api/participation/cases/1/events')
      .set('Authorization', as('schoolA'))
      // actor_role in the body is ignored: the route overwrites it from the token.
      .send({ ...comment, actor_role: 'province' });
    expect(res.status).toBe(201);
    expect(mockDb.participation_case_events).toHaveLength(1);
    expect(mockDb.participation_case_events[0].actor_role).toBe('school');
    expect(mockDb.participation_case_events[0].actor_user_id).toBe(11);
    expect(mockDb.audit_logs).toHaveLength(1);
  });
});

describe('filing a case', () => {
  const draft = {
    case_type: 'SAFETY_CONCERN',
    subject: 'จุดจอดหน้าโรงเรียนไม่ปลอดภัย',
    body: 'รถจอดซ้อนคัน',
  };

  it('files under the scope in the token, not the one in the body', async () => {
    // The body names another school. If that were honoured, a school could
    // plant a case in another school's inbox — and, because the case is then
    // out of its own scope, could not see what it had written.
    const res = await request(app)
      .post('/api/participation/cases')
      .set('Authorization', as('schoolA'))
      .send({ ...draft, scope_type: 'SCHOOL', scope_id: 'SCH0002', initiated_role: 'admin' });
    expect(res.status).toBe(201);

    const created = mockDb.participation_cases.find((c) => c.id === res.body.data.id);
    expect(created.scope_id).toBe('SCH0001');
    expect(created.initiated_role).toBe('school');
    expect(created.initiated_by).toBe(11);
    expect(await listIds('schoolB')).toEqual([2]);
  });
});

/**
 * ─── KNOWN GAP, NOT A DESIGN ───────────────────────────────────────────────
 *
 * THIS BLOCK RECORDS A DEFECT. Every expectation in it describes behaviour
 * that is WRONG and is expected to change. It is written down rather than
 * fixed because the fix is an owner decision — which roles may record a
 * decision, and which may assign work — and that decision is open as C0-2.
 *
 * What is missing: `appendEvent` validates the state transition
 * (ALLOWED_EVENTS) and the fields each event needs (a decision plus its
 * rationale, an assignee, a note). It never asks whether the ACTOR'S ROLE is
 * entitled to record that event. The route supplies `actor_role` from the
 * token, so the role recorded is honest — but nothing checks it against the
 * event.
 *
 * The consequence, exercised below: any role that can reach a case can record
 * DECIDED on it. A driver can enter the province's decision on their own
 * case, with a rationale, and the case then reports as "decided with a stated
 * reason" in the participation summary — the precise metric this feature
 * exists to make trustworthy.
 *
 * WHEN C0-2 IS ANSWERED: delete this block and replace it with the tests for
 * the agreed mapping. If one of these expectations starts failing before then,
 * the mapping has been implemented without the decision being recorded — find
 * out who decided it, do not "fix" this file to match.
 */
describe('KNOWN GAP (C0-2): appendEvent does not check the actor role against the event', () => {
  it('lets a driver record DECIDED on their own case — no role check exists', async () => {
    const res = await request(app)
      .post('/api/participation/cases/7/events')
      .set('Authorization', as('driverA'))
      .send({ event_type: 'DECIDED', decision: 'APPROVED', note: 'อนุมัติตามที่เสนอ' });

    // Documented, not endorsed: this should very probably be a 403.
    expect(res.status).toBe(201);
    const row = mockDb.participation_cases.find((c) => c.id === 7);
    expect(row.status).toBe('DECIDED');
    expect(row.decision).toBe('APPROVED');
    expect(row.decided_by).toBe(51);
    expect(mockDb.participation_case_events.at(-1).actor_role).toBe('driver');
  });

  it('lets a school record ASSIGNED, so work can be assigned by whoever raised it', async () => {
    await request(app)
      .post('/api/participation/cases/1/events')
      .set('Authorization', as('schoolA'))
      .send({ event_type: 'DECIDED', decision: 'APPROVED', note: 'เห็นชอบ' });
    const res = await request(app)
      .post('/api/participation/cases/1/events')
      .set('Authorization', as('schoolA'))
      .send({ event_type: 'ASSIGNED', assigned_to: 41, note: 'มอบหมายให้ขนส่ง' });

    expect(res.status).toBe(201);
    expect(mockDb.participation_cases.find((c) => c.id === 1).assigned_to).toBe(41);
  });

  it('the gap is bounded by scope: it is only ever the caller\'s OWN case', async () => {
    // The one reassurance worth pinning while C0-2 is open. The missing check
    // is "may this role decide", not "may this role reach this case" — the
    // scope predicate above still holds, so the blast radius of the gap is a
    // case the actor could already see.
    const res = await request(app)
      .post('/api/participation/cases/8/events')
      .set('Authorization', as('driverA'))
      .send({ event_type: 'DECIDED', decision: 'APPROVED', note: 'อนุมัติ' });
    expect(res.status).toBe(404);
  });
});
