'use strict';

/**
 * parentAuth.test.js  (Phase 10.12C — Parent API LIFF id_token enforcement)
 *
 * ISOLATED — no production DB, no real network. The LINE id_token verifier,
 * line.service, and the MySQL pool are all mocked, so the suite runs without
 * globalSetup. Run via an isolated jest config (no globalSetup), e.g.:
 *   npx jest -c <config-without-globalSetup> tests/parentAuth.test.js
 *
 * Proves the parent child/status/history endpoints derive identity ONLY from a
 * verified id_token and never trust a client-supplied line_user_id.
 */

jest.mock('../src/services/lineIdToken.service');
jest.mock('../src/services/line.service');
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn().mockResolvedValue([[]]) } }));

const express = require('express');
const request = require('supertest');

const idTokenSvc = require('../src/services/lineIdToken.service');
const lineSvc = require('../src/services/line.service');
const parentRoutes = require('../src/routes/parent.routes');

const VALID_TOKEN = 'valid.id.token';
const USER_A = 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // owns child 101
const USER_B = 'Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; // owns child 202

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parent', parentRoutes);
  // Minimal error handler so a thrown error becomes JSON, never a hang.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }));
  return app;
}

const app = makeApp();

beforeEach(() => {
  jest.clearAllMocks();
  // Verifier: accepts only VALID_TOKEN, resolving to USER_A.
  idTokenSvc.verifyIdToken.mockImplementation(async (t) =>
    t === VALID_TOKEN ? { valid: true, userId: USER_A } : { valid: false, error: 'invalid_token' }
  );
  // Linkage: USER_A → child 101, USER_B → child 202.
  lineSvc.getLinkedChildren.mockImplementation(async (lineUserId) => {
    if (lineUserId === USER_A) return [{ id: 101, first_name: 'A', last_name: 'Child', school_name: 'S' }];
    if (lineUserId === USER_B) return [{ id: 202, first_name: 'B', last_name: 'Child', school_name: 'S' }];
    return [];
  });
  lineSvc.getChildStatusToday.mockResolvedValue({ morning_done: true, evening_done: false });
});

describe('Parent API requires a verified LIFF id_token', () => {
  test('1. /children rejects missing Authorization → 401', async () => {
    const res = await request(app).get('/api/parent/children');
    expect(res.status).toBe(401);
    expect(lineSvc.getLinkedChildren).not.toHaveBeenCalled();
  });

  test('2. /children rejects invalid token → 401', async () => {
    const res = await request(app).get('/api/parent/children').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expect(lineSvc.getLinkedChildren).not.toHaveBeenCalled();
  });

  test('3. /children ignores query line_user_id — uses the verified token user', async () => {
    // Attacker supplies USER_B in the query, but the token belongs to USER_A.
    const res = await request(app)
      .get(`/api/parent/children?line_user_id=${USER_B}`)
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(lineSvc.getLinkedChildren).toHaveBeenCalledWith(USER_A);
    expect(lineSvc.getLinkedChildren).not.toHaveBeenCalledWith(USER_B);
    expect(res.body.data.map((c) => c.id)).toEqual([101]);
  });

  test('4. /children returns only children linked to the verified user', async () => {
    const res = await request(app).get('/api/parent/children').set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(101);
  });

  test('5. /children/:id/status rejects a child not linked to the token user → 403', async () => {
    const res = await request(app).get('/api/parent/children/202/status').set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(403);
    expect(lineSvc.getChildStatusToday).not.toHaveBeenCalled();
  });

  test('5b. /children/:id/status returns status for a linked child', async () => {
    const res = await request(app).get('/api/parent/children/101/status').set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 101, morning_done: true });
  });

  test('6. /children/:id/history rejects a child not linked to the token user → 403', async () => {
    const res = await request(app).get('/api/parent/children/202/history').set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test('6b. /children/:id/history returns { student, history } for a linked child', async () => {
    const res = await request(app).get('/api/parent/children/101/history').set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('student');
    expect(res.body.data).toHaveProperty('history');
  });

  test('7. backward-compatible success envelope is preserved', async () => {
    const res = await request(app).get('/api/parent/children').set('Authorization', `Bearer ${VALID_TOKEN}`);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
  });

  test('8. error response leaks no full LINE user id', async () => {
    const res = await request(app).get(`/api/parent/children?line_user_id=${USER_B}`); // no token
    expect(res.status).toBe(401);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(USER_A);
    expect(body).not.toContain(USER_B);
  });

  test('9. id_token may also be supplied via query (no Authorization header)', async () => {
    const res = await request(app).get(`/api/parent/children?id_token=${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(lineSvc.getLinkedChildren).toHaveBeenCalledWith(USER_A);
  });
});
