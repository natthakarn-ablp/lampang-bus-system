'use strict';

/**
 * parentConsentRoute.unit.test.js  (#3 — route wiring, isolated)
 *
 * Verifies that the /api/parent child-detail endpoints actually consult the
 * consent gate AFTER the linkage check, and translate a block into
 * 403 PARENT_CONSENT_REQUIRED without fetching any child data. Isolated in the
 * style of parentAuth.test.js — DB, LINE token verifier, line.service and the
 * consent gate are all mocked, so no real DB is needed, BUT it uses supertest
 * (a devDependency) so it runs in CI via the isolated config (no globalSetup),
 * not on the prod box where devDeps are absent. The gate's own decision logic
 * is covered by the DB-free parentConsentGate.unit.test.js (which DOES run
 * anywhere).
 */

jest.mock('../src/services/lineIdToken.service');
jest.mock('../src/services/line.service');
jest.mock('../src/services/parentConsentGate', () => ({ guardParentView: jest.fn() }));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn().mockResolvedValue([[]]) } }));

const express = require('express');
const request = require('supertest');

const idTokenSvc = require('../src/services/lineIdToken.service');
const lineSvc = require('../src/services/line.service');
const gate = require('../src/services/parentConsentGate');
const parentRoutes = require('../src/routes/parent.routes');

const VALID = 'valid.id.token';
const USER = 'Uconsent000000000000000000000000';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parent', parentRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }));
  return app;
}
const app = makeApp();

beforeEach(() => {
  jest.clearAllMocks();
  idTokenSvc.verifyIdToken.mockImplementation(async (t) =>
    t === VALID ? { valid: true, userId: USER } : { valid: false, error: 'invalid_token' });
  lineSvc.getLinkedChildren.mockResolvedValue([{ id: 101, first_name: 'A', last_name: 'C', school_name: 'S' }]);
  lineSvc.getChildStatusToday.mockResolvedValue({ morning_done: true, evening_done: false });
});

describe('GET /api/parent/children/:id/status — consent gate wiring', () => {
  test('gate allows → 200 and the gate was asked about the verified user', async () => {
    gate.guardParentView.mockResolvedValue({ allowed: true, featureEnabled: true, consentGranted: true });
    const res = await request(app).get('/api/parent/children/101/status').set('Authorization', `Bearer ${VALID}`);
    expect(res.status).toBe(200);
    expect(gate.guardParentView).toHaveBeenCalledWith(USER);
    expect(lineSvc.getChildStatusToday).toHaveBeenCalled();
  });

  test('gate blocks → 403 PARENT_CONSENT_REQUIRED and NO child data fetched', async () => {
    gate.guardParentView.mockResolvedValue({ allowed: false, featureEnabled: true, consentGranted: false });
    const res = await request(app).get('/api/parent/children/101/status').set('Authorization', `Bearer ${VALID}`);
    expect(res.status).toBe(403);
    expect(res.body.errors?.[0]?.code).toBe('PARENT_CONSENT_REQUIRED');
    expect(lineSvc.getChildStatusToday).not.toHaveBeenCalled();
  });

  test('linkage is still checked BEFORE consent — unlinked child → 403 without touching the gate', async () => {
    gate.guardParentView.mockResolvedValue({ allowed: true });
    const res = await request(app).get('/api/parent/children/999/status').set('Authorization', `Bearer ${VALID}`);
    expect(res.status).toBe(403);
    expect(gate.guardParentView).not.toHaveBeenCalled();
  });
});

describe('GET /api/parent/children/:id/history — consent gate wiring', () => {
  test('gate blocks → 403 PARENT_CONSENT_REQUIRED', async () => {
    gate.guardParentView.mockResolvedValue({ allowed: false, featureEnabled: true, consentGranted: false });
    const res = await request(app).get('/api/parent/children/101/history').set('Authorization', `Bearer ${VALID}`);
    expect(res.status).toBe(403);
    expect(res.body.errors?.[0]?.code).toBe('PARENT_CONSENT_REQUIRED');
  });
});
