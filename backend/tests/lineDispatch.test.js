'use strict';

// PERF-001 — dispatcher against the real test MySQL and a fake LINE push API.
// The fake de-duplicates by X-Line-Retry-Key the way LINE documents it
// (409 + x-line-accepted-request-id for a key it already accepted), so
// "delivered" below means "the fake LINE accepted it" — one per row is the goal.
//
// Migration 059 is applied to the disposable test database for this file and
// rolled back afterwards (the shared test schema.sql does not contain it yet).
require('./loadTestEnv');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { getTestConnection } = require('./dbHelper');
const { pool } = require('../src/config/database');
const dispatch = require('../src/services/lineDispatch.service');

const MIG = path.join(__dirname, '../migrations/059_notification_dispatch_lease.sql');
const ROLLBACK = path.join(__dirname, '../migrations/rollback/059_notification_dispatch_lease_rollback.sql');
const LINE_IDS = ['U__pd_a', 'U__pd_b'];
let applied = false;
let server, baseUrl;

const fake = {
  accepted: new Map(),      // retryKey → { to, body }
  deliveries: [],           // every accepted (non-duplicate) request
  requests: 0,
  mode: 'ok',               // ok | slow | lost-response | 500 | 400
  delayMs: 0,
  gate: null,               // promise to await before answering
};

function resetFake() {
  fake.accepted.clear(); fake.deliveries = []; fake.requests = 0;
  fake.mode = 'ok'; fake.delayMs = 0; fake.gate = null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

beforeAll(async () => {
  const c = await getTestConnection();
  try {
    const [[{ n }]] = await c.query(
      "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='notifications' AND column_name='claim_token'");
    if (!Number(n)) { await c.query(fs.readFileSync(MIG, 'utf8')); applied = true; }
    for (const id of LINE_IDS) {
      await c.query("INSERT IGNORE INTO line_users(line_user_id,user_type,verified) VALUES (?, 'parent', FALSE)", [id]);
    }
  } finally { await c.end(); }
  dispatch.resetSchemaCache();

  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    fake.requests++;
    const key = req.headers['x-line-retry-key'];
    if (fake.gate) await fake.gate;
    if (fake.mode === '500') { res.writeHead(500); return res.end('{}'); }
    if (fake.mode === '400') { res.writeHead(400); return res.end('{}'); }
    if (key && fake.accepted.has(key)) {
      res.writeHead(409, { 'x-line-accepted-request-id': `req-${key.slice(0, 8)}` });
      return res.end('{}');
    }
    // accept (record) before possibly losing the response
    if (key) fake.accepted.set(key, { to: JSON.parse(body).to, body });
    fake.deliveries.push({ key, body: JSON.parse(body) });
    if (fake.mode === 'slow' || fake.mode === 'lost-response') await sleep(fake.delayMs);
    if (res.writableEnded || res.destroyed) return undefined;
    res.writeHead(200, { 'x-line-request-id': `req-${(key || '').slice(0, 8)}` });
    return res.end('{}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise(r => server.close(r));
  const c = await getTestConnection();
  try {
    await c.query('DELETE FROM notifications WHERE target_line_user_id IN (?)', [LINE_IDS]);
    await c.query('DELETE FROM line_users WHERE line_user_id IN (?)', [LINE_IDS]);
    if (applied) await c.query(fs.readFileSync(ROLLBACK, 'utf8'));
  } finally { await c.end(); }
  await pool.end();
});

beforeEach(async () => {
  resetFake();
  await pool.query('DELETE FROM notifications WHERE target_line_user_id IN (?)', [LINE_IDS]);
});

async function queue(n, type = 'emergency') {
  for (let i = 0; i < n; i++) {
    await pool.query(
      "INSERT INTO notifications(target_line_user_id,notification_type,student_id,message_json) VALUES (?,?,NULL,?)",
      [LINE_IDS[i % 2], type, JSON.stringify({ plateNo: '__PD', detail: `case ${i}` })]);
  }
}
const rows = async () => (await pool.query(
  'SELECT id, sent, retry_count, retry_key, attempt_count, delivery_state, claim_token, line_request_id, error_message FROM notifications WHERE target_line_user_id IN (?) ORDER BY id', [LINE_IDS]))[0];
const run = (extra = {}) => dispatch.dispatchBatch({ baseUrl, token: 'test-token-not-real', timeoutMs: 300, ...extra });

test('normal send: accepted once, retry key persisted, claim released', async () => {
  await queue(3);
  const r = await run();
  expect(r).toMatchObject({ processed: 3, sent: 3, lost: 0 });
  const after = await rows();
  expect(after.every(x => x.sent === 1 && x.delivery_state === 'ACCEPTED' && x.claim_token === null)).toBe(true);
  expect(new Set(after.map(x => x.retry_key)).size).toBe(3);
  expect(fake.deliveries.map(d => d.key).sort()).toEqual(after.map(x => x.retry_key).sort());
  expect(after.every(x => /^req-/.test(x.line_request_id))).toBe(true);
});

test('no transaction or row lock is held while LINE is slow', async () => {
  await queue(1);
  let release;
  fake.gate = new Promise(r => { release = r; });
  const pending = run({ timeoutMs: 5000 });
  while (fake.requests === 0) await sleep(10);
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    // NOWAIT fails immediately if another transaction still locks the row.
    const [locked] = await c.query(
      'SELECT id FROM notifications WHERE target_line_user_id IN (?) FOR UPDATE NOWAIT', [LINE_IDS]);
    expect(locked).toHaveLength(1);
    await c.rollback();
  } finally { c.release(); }
  release();
  await expect(pending).resolves.toMatchObject({ sent: 1 });
});

test('timeout with the request accepted but the response lost: re-sent with the SAME key, delivered once', async () => {
  await queue(1);
  fake.mode = 'lost-response'; fake.delayMs = 1000;
  const first = await run({ timeoutMs: 200 });
  expect(first).toMatchObject({ unknown: 1, sent: 0 });
  const [mid] = await rows();
  expect(mid).toMatchObject({ sent: 0, retry_count: 1, delivery_state: 'UNKNOWN', claim_token: null });
  fake.mode = 'ok';
  const second = await run();
  expect(second).toMatchObject({ sent: 1 });
  const [done] = await rows();
  expect(done).toMatchObject({ sent: 1, delivery_state: 'ACCEPTED', retry_key: mid.retry_key });
  expect(fake.deliveries).toHaveLength(1);       // LINE answered the retry with 409
  expect(fake.requests).toBe(2);
});

test('worker stops after claiming: lease expires, next run reuses the key, no duplicate', async () => {
  await queue(1);
  const { rows: claimed } = await dispatch.claimBatch({ limit: 10, maxAgeMinutes: 180, types: null, leaseSeconds: 300 });
  expect(claimed).toHaveLength(1);
  // simulate: the dead worker had already pushed before dying
  fake.accepted.set(claimed[0].retry_key, { to: claimed[0].target_line_user_id });
  expect((await run()).processed).toBe(0);       // lease still valid → not taken
  await pool.query('UPDATE notifications SET claimed_until = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id = ?', [claimed[0].id]);
  const r = await run();
  expect(r).toMatchObject({ processed: 1, sent: 1 });
  const [done] = await rows();
  expect(done).toMatchObject({ sent: 1, delivery_state: 'ACCEPTED', attempt_count: 2, retry_key: claimed[0].retry_key });
  expect(fake.deliveries).toHaveLength(0);       // only the 409 path — nothing new delivered
});

test('a stale worker cannot overwrite a row re-claimed by a newer worker', async () => {
  await queue(1);
  let release;
  fake.gate = new Promise(r => { release = r; });
  fake.mode = '500';
  const stale = run({ timeoutMs: 5000 });         // will get a 500 → wants to write "retry"
  while (fake.requests === 0) await sleep(10);
  await pool.query('UPDATE notifications SET claimed_until = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE target_line_user_id IN (?)', [LINE_IDS]);
  const gate = fake.gate;
  fake.gate = null; fake.mode = 'ok';
  const fresh = await run();                      // newer worker claims and sends
  expect(fresh).toMatchObject({ sent: 1 });
  fake.mode = '500';
  release(); await gate;
  const staleResult = await stale;
  expect(staleResult).toMatchObject({ lost: 1, retry: 0, unknown: 0 });
  const [done] = await rows();
  expect(done).toMatchObject({ sent: 1, delivery_state: 'ACCEPTED', retry_count: 0 });
});

test('overlapping workers: every row delivered exactly once', async () => {
  await queue(12);
  fake.mode = 'slow'; fake.delayMs = 50;
  const results = await Promise.all([run({ limit: 8 }), run({ limit: 8 }), run({ limit: 8 })]);
  // FOR UPDATE ... ORDER BY ... LIMIT may lock more rows than it returns, so a
  // concurrent run can skip rows it could have taken; they stay queued (never
  // lost, never doubled) and the next run drains them.
  const drain = await run({ limit: 50 });
  const total = results.reduce((s, r) => s + r.sent, 0) + drain.sent;
  expect(total).toBe(12);
  expect(results.reduce((s, r) => s + r.lost, 0) + drain.lost).toBe(0);
  expect(fake.deliveries).toHaveLength(12);
  expect(new Set(fake.deliveries.map(d => d.key)).size).toBe(12);
  expect((await rows()).every(x => x.sent === 1)).toBe(true);
});

test('5xx is retried later with the same key; other 4xx stops', async () => {
  await queue(2);
  fake.mode = '500';
  expect(await run()).toMatchObject({ unknown: 2 });
  const keys = (await rows()).map(x => x.retry_key);
  fake.mode = '400';
  expect(await run()).toMatchObject({ failed: 2 });
  const after = await rows();
  expect(after.map(x => x.retry_key)).toEqual(keys);
  expect(after.every(x => x.retry_count === 3 && x.delivery_state === 'FAILED' && x.sent === 0)).toBe(true);
  fake.mode = 'ok';
  expect((await run()).processed).toBe(0);
});

test('retry key older than the safe window: parked as UNKNOWN, never re-sent with a new key', async () => {
  await queue(1);
  await pool.query(
    "UPDATE notifications SET retry_key = UUID(), attempt_count = 1, retry_count = 1, first_attempt_at = DATE_SUB(NOW(), INTERVAL 24 HOUR) WHERE target_line_user_id IN (?)", [LINE_IDS]);
  const r = await run({ maxAgeMinutes: null });
  expect(r).toMatchObject({ unknown: 1, sent: 0 });
  expect(fake.requests).toBe(0);
  const [done] = await rows();
  expect(done).toMatchObject({ retry_count: 3, delivery_state: 'UNKNOWN', error_message: 'RETRY_KEY_EXPIRED_OUTCOME_UNKNOWN' });
});

test('line.service.processUnsentNotifications uses the lease dispatcher once 059 exists', async () => {
  const line = require('../src/services/line.service');
  await queue(1);
  const spy = jest.spyOn(dispatch, 'dispatchBatch').mockResolvedValue({ processed: 0 });
  await line.processUnsentNotifications(5, 60, ['emergency']);
  expect(spy).toHaveBeenCalledWith({ limit: 5, maxAgeMinutes: 60, types: ['emergency'] });
  spy.mockRestore();
});
