'use strict';

/**
 * emergencyDoubleTap.test.js  (#6 — emergency idempotency, end-to-end)
 *
 * INTEGRATION — needs the disposable lampang_bus_test DB (globalSetup seeds the
 * __TEST driver + vehicle + assignment). Do NOT run on the prod box. Run in CI:
 *   npx jest tests/emergencyDoubleTap.test.js
 *
 * The unit suite proves the createEmergencyReport dedupe branch in isolation.
 * This proves the whole POST /api/driver/emergency path against a real DB: a
 * rapid double-tap of the SAME report yields exactly ONE emergency_logs row and
 * ONE audit row (the 2nd call returns 200 duplicate:true reusing the first id),
 * while a genuinely different report still creates a new row.
 */

require('dotenv').config();
const request = require('supertest');
const { getTestConnection } = require('./dbHelper');
const app = require('../src/app');

const DRIVER = { username: '__TEST PLATE 9999', password: 'testpass123' };
const DETAIL_A = '__dbltap เบรกแตก';
const DETAIL_B = '__dbltap ยางระเบิด';

let token = '';
const db = () => getTestConnection();
const login = async (creds) => (await request(app).post('/api/auth/login').send(creds)).body.data?.access_token || '';
const post = (body) => request(app).post('/api/driver/emergency').set('Authorization', `Bearer ${token}`).send(body);

async function cleanup(conn) {
  await conn.query('DELETE FROM audit_logs WHERE entity_type = ? AND JSON_EXTRACT(new_value, "$.detail") IN (?, ?)', ['emergency', DETAIL_A, DETAIL_B]);
  await conn.query('DELETE FROM emergency_logs WHERE detail IN (?, ?)', [DETAIL_A, DETAIL_B]);
}

beforeAll(async () => {
  const conn = await db();
  await cleanup(conn);
  await conn.end();
  token = await login(DRIVER);
});

afterAll(async () => {
  const conn = await db();
  await cleanup(conn);
  await conn.end();
});

describe('POST /api/driver/emergency — double-tap protection', () => {
  test('two rapid identical reports → ONE row, ONE audit; 2nd is a 200 duplicate reusing the id', async () => {
    const r1 = await post({ detail: DETAIL_A });
    expect(r1.status).toBe(201);
    expect(r1.body.data.duplicate).toBe(false);
    const firstId = r1.body.data.id;

    const r2 = await post({ detail: DETAIL_A });
    expect(r2.status).toBe(200);
    expect(r2.body.data.duplicate).toBe(true);
    expect(r2.body.data.id).toBe(firstId);

    const conn = await db();
    const [[{ n: rows }]] = await conn.query('SELECT COUNT(*) AS n FROM emergency_logs WHERE detail = ?', [DETAIL_A]);
    const [[{ n: audits }]] = await conn.query(
      'SELECT COUNT(*) AS n FROM audit_logs WHERE entity_type = ? AND entity_id = ?', ['emergency', String(firstId)]);
    await conn.end();
    expect(rows).toBe(1);   // no duplicate emergency row
    expect(audits).toBe(1); // no duplicate audit row
  });

  test('a genuinely different report is NOT deduped (control)', async () => {
    const r = await post({ detail: DETAIL_B });
    expect(r.status).toBe(201);
    expect(r.body.data.duplicate).toBe(false);

    const conn = await db();
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM emergency_logs WHERE detail = ?', [DETAIL_B]);
    await conn.end();
    expect(n).toBe(1);
  });
});
