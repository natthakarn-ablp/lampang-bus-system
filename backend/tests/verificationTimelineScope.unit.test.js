'use strict';

/**
 * Cross-school IDOR on GET /api/verification/applications/:id/timeline.
 *
 * The handler built its access guard for drivers only:
 *
 *     const driverGuard = isDriver ? `EXISTS (... a.requested_by = ?)` : 'TRUE';
 *
 * For every other role the guard was the literal string TRUE, and
 * req.user.scopeId was never read. So a school account could read the audit
 * timeline of ANY application by id — including applications belonging to other
 * schools. Application ids are sequential, and an unlinked school got rows back
 * rather than a 404, so the table was walkable one id at a time.
 *
 * What that returned, from the audit rows' old_value/new_value: another school's
 * request number, ridership figures, status history, cancellation reason and the
 * reviewer's free-text notes, plus — through the JOIN on users — the display
 * names and roles of that school's staff and of the transport officers.
 *
 * The sibling detail route GET /applications/:id already had the right shape:
 * getApplication JOINs inspection_application_schools and answers 404 when the
 * caller's school is not linked. The timeline is the audit view of that same
 * resource with the join simply missing. This test pins the join in place.
 *
 * DB-free: auth and the pool are stubbed, and the SQL the route issues is read
 * back. Role, scope and grade are driven by request headers.
 */

require('./loadTestEnv');

const mockCalls = [];
const mockPool = {
  query: jest.fn((sql, params) => {
    mockCalls.push({ sql: String(sql), params: params || [] });
    return Promise.resolve([[]]);
  }),
  getConnection: jest.fn(),
};

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: 7,
      role: req.headers['x-test-role'] || 'school',
      scopeId: 'x-test-scope' in req.headers ? req.headers['x-test-scope'] : 'SCH0001',
      // HTTP headers are latin-1, so the Thai grade cannot travel in one. The
      // header is a flag; the value it stands for is what a real teacher token
      // carries. Which grade it is does not matter to this route — only that
      // gradeScope is set, since the school clamp keys on role, not sub-role.
      gradeScope: req.headers['x-test-grade'] ? 'ป.4' : null,
    };
    next();
  },
}));
jest.mock('../src/config/database', () => ({ pool: mockPool, getConnection: jest.fn() }));
jest.mock('../src/services/vehicleVerification.service', () => ({}));
jest.mock('../src/services/driverShift.service', () => ({}));

const express = require('express');
const request = require('supertest');
const errorHandler = require('../src/middleware/errorHandler');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/verification', require('../src/routes/verification.routes'));
  app.use(errorHandler);
  return app;
}

const app = makeApp();
const timeline = (headers = {}) =>
  request(app).get('/api/verification/applications/4321/timeline').set(headers);

const SCHOOL_GUARD = /EXISTS\s*\(\s*SELECT 1 FROM inspection_application_schools/i;
const DRIVER_GUARD = /EXISTS\s*\([^)]*vehicle_inspection_applications/i;

beforeEach(() => { mockCalls.length = 0; mockPool.query.mockClear(); });

describe('timeline — a school may only read applications its own school is linked to', () => {
  test('a school account gets the access guard, bound to its own school', async () => {
    const res = await timeline({ 'x-test-role': 'school', 'x-test-scope': 'SCH0001' });
    expect(res.status).toBe(200);
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0].sql).toMatch(SCHOOL_GUARD);
    expect(mockCalls[0].params).toEqual(['4321', 'SCH0001']);
    // The literal TRUE that let any school read any application must be gone.
    expect(mockCalls[0].sql).not.toMatch(/AND\s+TRUE\b/);
  });

  test('the guard keys on the application in the row, not on a free variable', async () => {
    // `aps.application_id = al.entity_id` is what ties the EXISTS to the row
    // being returned. Correlating on anything else makes the guard vacuous.
    await timeline({ 'x-test-role': 'school' });
    expect(mockCalls[0].sql).toMatch(/aps\.application_id\s*=\s*al\.entity_id/);
    expect(mockCalls[0].sql).toMatch(/aps\.school_id\s*=\s*\?/);
  });

  test('a grade teacher is scoped the same way — role, not sub-role, decides', async () => {
    await timeline({ 'x-test-role': 'school', 'x-test-scope': 'SCH0001', 'x-test-grade': '1' });
    expect(mockCalls[0].sql).toMatch(SCHOOL_GUARD);
    expect(mockCalls[0].params).toEqual(['4321', 'SCH0001']);
  });

  test('a school account with no scope fails closed rather than open', async () => {
    // A null school_id matches no row in inspection_application_schools, so the
    // result is empty. The dangerous outcome would be falling back to TRUE.
    const res = await timeline({ 'x-test-role': 'school', 'x-test-scope': '' });
    expect(res.status).toBe(200);
    expect(mockCalls[0].sql).toMatch(SCHOOL_GUARD);
    expect(mockCalls[0].params).toEqual(['4321', null]);
    expect(mockCalls[0].sql).not.toMatch(/AND\s+TRUE\b/);
  });
});

describe('timeline — the other roles are unchanged', () => {
  test('a driver still reads only applications they submitted', async () => {
    await timeline({ 'x-test-role': 'driver' });
    expect(mockCalls[0].sql).toMatch(DRIVER_GUARD);
    expect(mockCalls[0].sql).toMatch(/a\.requested_by\s*=\s*\?/);
    expect(mockCalls[0].params).toEqual(['4321', 7]);
    expect(mockCalls[0].sql).not.toMatch(SCHOOL_GUARD);
  });

  test.each(['transport', 'province', 'admin'])(
    'a %s account still sees every timeline — these roles are province-wide by design',
    async (role) => {
      await timeline({ 'x-test-role': role });
      expect(mockCalls[0].sql).toMatch(/AND\s+TRUE\b/);
      expect(mockCalls[0].params).toEqual(['4321']);
    }
  );

  test('a role outside the allow-list is still rejected before any query', async () => {
    const res = await timeline({ 'x-test-role': 'parent' });
    expect(res.status).toBe(403);
    expect(mockCalls).toHaveLength(0);
  });

  test('every statement binds exactly as many params as it has placeholders', async () => {
    for (const role of ['school', 'driver', 'transport', 'province', 'admin']) {
      await timeline({ 'x-test-role': role });
    }
    for (const c of mockCalls) {
      expect(c.params.length).toBe((c.sql.match(/\?/g) || []).length);
    }
  });
});
