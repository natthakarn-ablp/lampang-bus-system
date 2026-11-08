'use strict';

// PERF-001 — DB-free checks of the LINE dispatcher's HTTP layer and outcome
// classification, against a local fake LINE endpoint.
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/config/env', () => ({ line: { channelAccessToken: '' }, features: {} }));

const http = require('http');
const { pool } = require('../src/config/database');
const d = require('../src/services/lineDispatch.service');

let server, baseUrl;
const seen = [];
let handler = (req, res) => { res.writeHead(200, { 'x-line-request-id': 'r1' }); res.end('{}'); };

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ headers: req.headers, body: JSON.parse(body) });
    handler(req, res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
beforeEach(() => { seen.length = 0; d.resetSchemaCache(); });

const push = (extra = {}) => d.pushWithRetryKey({
  to: 'U1', messages: [{ type: 'text', text: 'x' }], retryKey: '123e4567-e89b-12d3-a456-426614174000',
  token: 'tkn', timeoutMs: 300, baseUrl, ...extra,
});

test('sends the retry key, bearer token, recipient and body unchanged', async () => {
  const r = await push();
  expect(r).toMatchObject({ status: 200, requestId: 'r1' });
  expect(seen[0].headers['x-line-retry-key']).toBe('123e4567-e89b-12d3-a456-426614174000');
  expect(seen[0].headers.authorization).toBe('Bearer tkn');
  expect(seen[0].body).toEqual({ to: 'U1', messages: [{ type: 'text', text: 'x' }] });
});

test('a slow LINE is cut off by the timeout and reported as outcome unknown', async () => {
  handler = (req, res) => setTimeout(() => { if (!res.destroyed) { res.writeHead(200); res.end('{}'); } }, 1500);
  const t0 = Date.now();
  const r = await push({ timeoutMs: 200 });
  expect(Date.now() - t0).toBeLessThan(1200);
  expect(r).toMatchObject({ status: null, error: 'TIMEOUT' });
  expect(d.classify(r)).toEqual({ kind: 'retry', unknown: true, error: 'TIMEOUT_OUTCOME_UNKNOWN' });
});

test('409 with accepted id is ACCEPTED (earlier attempt already accepted)', async () => {
  handler = (req, res) => { res.writeHead(409, { 'x-line-accepted-request-id': 'orig' }); res.end('{}'); };
  const r = await push();
  expect(d.classify(r)).toEqual({ kind: 'accepted', requestId: 'orig' });
});

test('network error is outcome unknown', async () => {
  const r = await push({ baseUrl: 'http://127.0.0.1:1' });
  expect(d.classify(r)).toMatchObject({ kind: 'retry', unknown: true });
});

test('classification table', () => {
  expect(d.classify({ status: 200, requestId: 'a' })).toEqual({ kind: 'accepted', requestId: 'a' });
  expect(d.classify({ status: 409 })).toEqual({ kind: 'failed', error: 'HTTP_409' });
  expect(d.classify({ status: 429 })).toEqual({ kind: 'retry', unknown: false, error: 'HTTP_429' });
  expect(d.classify({ status: 503 })).toEqual({ kind: 'retry', unknown: true, error: 'HTTP_503' });
  expect(d.classify({ status: 400 })).toEqual({ kind: 'failed', error: 'HTTP_400' });
  expect(d.classify({ status: 401 })).toEqual({ kind: 'failed', error: 'HTTP_401' });
});

test('schema probe: missing columns or a failing probe means legacy path', async () => {
  pool.query.mockResolvedValueOnce([[{ n: 3 }]]);
  expect(await d.hasLeaseSchema()).toBe(false);
  d.resetSchemaCache();
  pool.query.mockRejectedValueOnce(new Error('denied'));
  expect(await d.hasLeaseSchema()).toBe(false);
  d.resetSchemaCache();
  pool.query.mockResolvedValueOnce([[{ n: 7 }]]);
  expect(await d.hasLeaseSchema()).toBe(true);
});
