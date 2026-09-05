'use strict';

/**
 * lineBindCredential.test.js — Phase 10.13C-4A
 *
 * ISOLATED — mocks the id_token verifier, line.service, and the MySQL pool, so it
 * runs WITHOUT globalSetup (no production DB). Run with an isolated jest config:
 *   npx jest --config '{"testEnvironment":"node"}' --testPathPattern lineBind --runInBand
 *
 * A1-9 NOTE. The pool mock used to answer [[]] to every statement, which was
 * harmless while lineBindGuard counted failures in a Map. The counters now live
 * in line_bind_lockouts, so the guard asks the pool — and a pool that always
 * says "no rows" can never report a lock, which turned test 8/10's 429 into a
 * 404. The mock below models the three statements the guard sends, so this file
 * keeps testing the ROUTE (does a locked credential get 429 and an audit row)
 * while lineBindGuard.test.js tests the counting itself against real MySQL.
 *
 * Proves the LINE bind endpoints treat (phone + student credential) as a credential:
 * generic failure, no studentId-only path, duplicate handling, credential lockout,
 * and that every outcome is audited.
 */

jest.mock('../src/services/lineIdToken.service');
jest.mock('../src/services/line.service');
jest.mock('../src/services/lineFlexTemplates.service', () => ({
  maskPhone: (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length < 7 ? '****' : `${d.slice(0, 3)}****${d.slice(-3)}`; },
  buildParentBindSuccessCard: () => ({}), fallbackBindSuccess: () => 'ok',
}));
// A minimal stand-in for line_bind_lockouts. Only three shapes ever reach it
// from lineBindGuard — the SELECT that reads a live lock, the upsert that
// counts a failure, and the DELETE that clears a pair — and every other
// statement keeps the old empty answer.
jest.mock('../src/config/database', () => {
  const rows = new Map(); // `${lock_type}:${key_hash}` -> {count, lockedUntilMs}
  const POLICY_MAX = { pair: 5, phone: 10, student: 10, sub: 12 };
  const LOCK_MS = 30 * 60 * 1000;

  const query = jest.fn(async (sql, params = []) => {
    const text = String(sql);
    // DELETE is matched first: its text also contains "FROM line_bind_lockouts",
    // so testing the SELECT shape first would swallow every delete and leak
    // counters from one test into the next.
    if (text.includes('DELETE FROM line_bind_lockouts')) {
      if (params.length === 2) rows.delete(`${params[0]}:${params[1]}`);
      else rows.clear();
      return [{ affectedRows: 1 }];
    }
    if (text.includes('SELECT') && text.includes('FROM line_bind_lockouts')) {
      const [type, hash] = params;
      const e = rows.get(`${type}:${hash}`);
      if (!e || !e.lockedUntilMs || e.lockedUntilMs <= Date.now()) return [[]];
      return [[{ retry_after: Math.ceil((e.lockedUntilMs - Date.now()) / 1000) }]];
    }
    if (text.includes('INSERT INTO line_bind_lockouts')) {
      const [type, hash] = params;
      const k = `${type}:${hash}`;
      const e = rows.get(k) || { count: 0, lockedUntilMs: 0 };
      e.count += 1;
      if (e.count >= (POLICY_MAX[type] || 5)) e.lockedUntilMs = Date.now() + LOCK_MS;
      rows.set(k, e);
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  return { pool: { query } };
});

const express = require('express');
const request = require('supertest');

const idTokenSvc = require('../src/services/lineIdToken.service');
const lineSvc = require('../src/services/line.service');
const bindGuard = require('../src/services/lineBindGuard');
const parentRoutes = require('../src/routes/parent.routes');

const VALID = 'valid.id.token';
const SUB = 'Uparentparentparentparentparen01';
const PHONE = '0811112222';
const CODE = '21199';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parent', parentRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }));
  return app;
}
const app = makeApp();

beforeEach(async () => {
  jest.clearAllMocks();
  // __reset is async now — the counters are a store, not a Map. Awaited so a
  // later test cannot start against rows the previous one left behind.
  await bindGuard.__reset();
  idTokenSvc.verifyIdToken.mockImplementation(async (t) => (t === VALID ? { valid: true, userId: SUB } : { valid: false, error: 'invalid_token' }));
  lineSvc.getLinkedParentId.mockResolvedValue(null);
  lineSvc.auditBind.mockResolvedValue();
  lineSvc.logMessage.mockResolvedValue();
  lineSvc.getLinkedChildren.mockResolvedValue([{ id: 101, first_name: 'A', last_name: 'B', school_name: 'S' }]);
  lineSvc.commitLineLink.mockResolvedValue({ success: true, parentId: 5 });
  lineSvc.pushParentFlex.mockResolvedValue();
  lineSvc.findLinkableParent.mockImplementation(async (phone, cred) => (
    phone === PHONE && cred === CODE
      ? { found: true, parentId: 5, studentCode: CODE, student: { first_name: 'A', last_name: 'B', grade: 'ป.1', classroom: '1', school_name: 'S' } }
      : { found: false }
  ));
});

const preview = (body) => request(app).post('/api/parent/line/bind-preview').send(body);
const confirm = (body) => request(app).post('/api/parent/line/bind-confirm').send(body);

test('1. correct phone + correct student_code + approved → preview 200', async () => {
  const res = await preview({ idToken: VALID, phone: PHONE, studentId: CODE });
  expect(res.status).toBe(200);
  expect(res.body.data.masked_phone).toBe('081****222');
  expect(res.body.data.student).toBeDefined();
});

test('1b. confirm with correct credential → 201 and audits SUCCESS', async () => {
  const res = await confirm({ idToken: VALID, phone: PHONE, studentId: CODE });
  expect(res.status).toBe(201);
  expect(lineSvc.commitLineLink).toHaveBeenCalledWith(SUB, 5);
  expect(lineSvc.auditBind).toHaveBeenCalledWith(expect.objectContaining({ action: 'LINE_BIND_SUCCESS', reason: 'SUCCESS' }));
});

test('2. correct phone + WRONG code → 404 generic + CONFIRM/PREVIEW_FAILED audit', async () => {
  const res = await preview({ idToken: VALID, phone: PHONE, studentId: '99999' });
  expect(res.status).toBe(404);
  expect(res.body.message).toContain('ไม่พบข้อมูลที่ตรงกัน');
  expect(lineSvc.auditBind).toHaveBeenCalledWith(expect.objectContaining({ action: 'LINE_BIND_PREVIEW_FAILED', reason: 'CREDENTIAL_MISMATCH' }));
});

test('3. correct code + WRONG phone → 404 generic', async () => {
  const res = await preview({ idToken: VALID, phone: '0890000000', studentId: CODE });
  expect(res.status).toBe(404);
  expect(res.body.message).toContain('ไม่พบข้อมูลที่ตรงกัน');
});

test('4. studentId only (no phone) → 400; no findLinkableParent call', async () => {
  const res = await preview({ idToken: VALID, studentId: CODE });
  expect(res.status).toBe(400);
  expect(lineSvc.findLinkableParent).not.toHaveBeenCalled();
});

test('4b. phone only (no student credential) → 400', async () => {
  const res = await preview({ idToken: VALID, phone: PHONE });
  expect(res.status).toBe(400);
});

test('5. not-approved is indistinguishable from mismatch → 404 generic', async () => {
  // approval lives inside the query; service returns not-found → no leak.
  lineSvc.findLinkableParent.mockResolvedValue({ found: false });
  const res = await preview({ idToken: VALID, phone: PHONE, studentId: CODE });
  expect(res.status).toBe(404);
  expect(res.body.message).toContain('ไม่พบข้อมูลที่ตรงกัน');
});

test('6. LINE already bound → 409 + DUPLICATE audit', async () => {
  lineSvc.getLinkedParentId.mockResolvedValue(7);
  const res = await confirm({ idToken: VALID, phone: PHONE, studentId: CODE });
  expect(res.status).toBe(409);
  expect(lineSvc.auditBind).toHaveBeenCalledWith(expect.objectContaining({ action: 'LINE_BIND_DUPLICATE_OR_ALREADY_BOUND', reason: 'ALREADY_BOUND' }));
  expect(lineSvc.commitLineLink).not.toHaveBeenCalled();
});

test('7. invalid id_token → 401', async () => {
  const res = await preview({ idToken: 'bad', phone: PHONE, studentId: CODE });
  expect(res.status).toBe(401);
});

test('8/10. 5 failed guesses on the same pair lock the 6th attempt → 429 + LOCKED audit', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await preview({ idToken: VALID, phone: PHONE, studentId: '99999' });
    expect(r.status).toBe(404);
  }
  const locked = await preview({ idToken: VALID, phone: PHONE, studentId: '99999' });
  expect(locked.status).toBe(429);
  expect(lineSvc.auditBind).toHaveBeenCalledWith(expect.objectContaining({ action: 'LINE_BIND_LOCKED' }));
  // The locked (phone, code) pair stays locked on the very next attempt — the lock
  // is keyed on the credential, so it does not matter that the IP/request differs.
  // (Cross-IP resilience of the hashed keys is proven in lineBindGuard.test.js.)
  const retrySamePair = await preview({ idToken: VALID, phone: PHONE, studentId: '99999' });
  expect(retrySamePair.status).toBe(429);
});

test('12/13. audit is invoked with the raw phone arg (masking happens inside auditBind)', async () => {
  await preview({ idToken: VALID, phone: PHONE, studentId: '99999' });
  expect(lineSvc.auditBind).toHaveBeenCalledWith(expect.objectContaining({ phone: PHONE, studentCode: '99999' }));
});
