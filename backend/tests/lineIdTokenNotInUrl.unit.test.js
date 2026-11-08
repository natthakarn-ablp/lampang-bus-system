'use strict';

// P-10 (parent audit 2026-11-08): a LIFF id_token must not be accepted from
// the URL query string — URLs are written to nginx/proxy access logs. The
// LIFF pages already send it in the Authorization header.
jest.mock('../src/services/lineIdToken.service');
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn().mockResolvedValue([[]]) } }));
jest.mock('../src/services/consent.service', () => ({
  getParentConsentStatus: jest.fn().mockResolvedValue({}),
}));

const express = require('express');
const request = require('supertest');
const idTokenSvc = require('../src/services/lineIdToken.service');
const consentRoutes = require('../src/routes/consent.routes');
const { optionalAuth } = require('../src/middleware/optionalAuth');

const TOKEN = 'liff-token-ok';

beforeEach(() => {
  idTokenSvc.verifyIdToken.mockReset();
  idTokenSvc.verifyIdToken.mockImplementation(async (t) =>
    (t === TOKEN ? { valid: true, userId: 'U_parent' } : { valid: false, error: 'invalid_token' }));
});

test('consent parent API refuses ?id_token= (401, token never verified)', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/consent', consentRoutes);
  const res = await request(app).get(`/api/consent/me/parent?id_token=${TOKEN}`);
  expect(res.status).toBe(401);
  expect(idTokenSvc.verifyIdToken).not.toHaveBeenCalled();
});

test('optionalAuth ignores ?id_token= (stays anonymous)', async () => {
  const req = { headers: {}, query: { id_token: TOKEN }, body: {} };
  await optionalAuth(req, {}, () => {});
  expect(req.lineUserId).toBeUndefined();
});

test('optionalAuth still accepts the id_token from the Authorization header', async () => {
  const req = { headers: { authorization: `Bearer ${TOKEN}` }, query: {}, body: {} };
  await optionalAuth(req, {}, () => {});
  expect(req.lineUserId).toBe('U_parent');
});
