'use strict';

/**
 * A homeroom-teacher sub-account may not open the vehicle-registration module.
 *
 * Owner decision, 28 ส.ค. 2569: a grade teacher sees only their own grade. A
 * registration application does not divide by grade — it is one driver's rider
 * list for a whole bus, plus that application's school-wide rider totals — and
 * a teacher can take no action on it. So the module is closed to them, the way
 * /school/audit-logs already is, rather than half-filtered.
 *
 * Before this, requireFullSchoolScope guarded only the five write routes; the
 * two reads were deliberately left open, so a teacher pinned to ป.4 could list
 * every application in the school and open one to read every grade's names.
 *
 * The guard is asserted at the ROUTER level, not per route, because that is what
 * makes a route added later safe by default. The per-route guards on the writes
 * are left in place as defence in depth and are checked here too.
 */

require('./loadTestEnv');

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: 7,
      role: req.headers['x-test-role'] || 'school',
      scopeId: 'SCH0001',
      // Headers are latin-1, so the Thai grade cannot travel in one; the header
      // is a flag standing for whatever grade a real teacher token carries.
      gradeScope: req.headers['x-test-grade'] ? 'ป.4' : null,
    };
    next();
  },
}));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn().mockResolvedValue([[]]) }, getConnection: jest.fn() }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));

const mockReg = {
  listSchoolRegistrations: jest.fn().mockResolvedValue([]),
  getSchoolRegistrationDetail: jest.fn().mockResolvedValue({}),
  matchRosterStudent: jest.fn().mockResolvedValue({}),
  updateRosterStudent: jest.fn().mockResolvedValue({}),
  approveSchoolRegistration: jest.fn().mockResolvedValue({}),
  rejectSchoolRegistration: jest.fn().mockResolvedValue({}),
};
jest.mock('../src/services/vehicleRegistration.service', () => mockReg);

const mockDocs = {
  listVehicleDocuments: jest.fn().mockResolvedValue([]),
  listDriverDocuments: jest.fn().mockResolvedValue([]),
  schoolOwnsVehicle: jest.fn().mockResolvedValue(true),
  schoolOwnsDriver: jest.fn().mockResolvedValue(true),
  getDocument: jest.fn().mockResolvedValue({ owner_id: 1 }),
  reviewDocument: jest.fn().mockResolvedValue({}),
};
jest.mock('../src/services/driverDocuments.service', () => mockDocs);

const express = require('express');
const request = require('supertest');
const errorHandler = require('../src/middleware/errorHandler');

function makeApp() {
  const app = express();
  app.use(express.json());
  const routes = require('../src/routes/registration.routes');
  app.use('/api/school/registrations', routes.schoolRouter || routes);
  app.use(errorHandler);
  return app;
}

const app = makeApp();
const TEACHER = { 'x-test-role': 'school', 'x-test-grade': '1' };
const FULL_SCHOOL = { 'x-test-role': 'school' };

// Both reads and one representative write. The reads are the ones that changed.
const READS = [
  ['get', '/api/school/registrations/'],
  ['get', '/api/school/registrations/4321'],
  ['get', '/api/school/registrations/documents/vehicle/V-1'],
  ['get', '/api/school/registrations/documents/driver/9'],
];

beforeEach(() => jest.clearAllMocks());

describe('registration module — closed to a grade teacher', () => {
  test.each(READS)('%s %s returns 403 for a teacher', async (method, path) => {
    const res = await request(app)[method](path).set(TEACHER);
    expect(res.status).toBe(403);
    expect(res.body.errors[0].code).toBe('FULL_SCHOOL_SCOPE_REQUIRED');
  });

  test('no service call is made — the guard runs before the handler', async () => {
    await request(app).get('/api/school/registrations/').set(TEACHER);
    await request(app).get('/api/school/registrations/4321').set(TEACHER);
    expect(mockReg.listSchoolRegistrations).not.toHaveBeenCalled();
    expect(mockReg.getSchoolRegistrationDetail).not.toHaveBeenCalled();
  });

  test('the writes stay blocked too', async () => {
    for (const [method, path] of [
      ['post', '/api/school/registrations/4321/students/5/match'],
      ['patch', '/api/school/registrations/4321/students/5'],
      ['post', '/api/school/registrations/4321/approve'],
      ['post', '/api/school/registrations/4321/reject'],
    ]) {
      const res = await request(app)[method](path).set(TEACHER).send({});
      expect(res.status).toBe(403);
    }
  });
});

describe('registration module — unchanged for everyone else', () => {
  test('a full school account still reaches the list', async () => {
    const res = await request(app).get('/api/school/registrations/').set(FULL_SCHOOL);
    expect(res.status).toBe(200);
    expect(mockReg.listSchoolRegistrations).toHaveBeenCalled();
  });

  test('a full school account still reaches an application detail', async () => {
    const res = await request(app).get('/api/school/registrations/4321').set(FULL_SCHOOL);
    expect(res.status).toBe(200);
    expect(mockReg.getSchoolRegistrationDetail).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ applicationId: 4321, schoolId: 'SCH0001' })
    );
  });

  test('an admin still reaches the module', async () => {
    // admin carries no gradeScope, so the guard is a no-op for it.
    const res = await request(app).get('/api/school/registrations/').set({ 'x-test-role': 'admin' });
    expect(res.status).not.toBe(403);
  });
});
