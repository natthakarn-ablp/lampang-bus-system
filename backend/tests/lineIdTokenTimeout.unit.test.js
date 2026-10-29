'use strict';

jest.mock('../src/config/env', () => ({
  line: {
    liffId: '2000000000-synthetic-liff',
    idTokenVerifyTimeoutMs: 25,
    idTokenVerifyMaxConcurrent: 1,
  },
}));

const env = require('../src/config/env');
const { verifyIdToken, isVerificationUnavailable } = require('../src/services/lineIdToken.service');
const nativeFetch = global.fetch;

const jsonResponse = (status, payload) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
let warn;
let error;

beforeEach(() => {
  jest.restoreAllMocks();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  error = jest.spyOn(console, 'error').mockImplementation(() => {});
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = nativeFetch;
});

test('successful verification posts to LINE with an abort signal and returns the verified subject', async () => {
  global.fetch.mockResolvedValueOnce(jsonResponse(200, { sub: 'synthetic-line-subject', aud: '2000000000' }));

  const result = await verifyIdToken('synthetic-token');

  expect(result).toMatchObject({ valid: true, userId: 'synthetic-line-subject' });
  expect(global.fetch).toHaveBeenCalledWith(
    'https://api.line.me/oauth2/v2.1/verify',
    expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) })
  );
});

test('a hung LINE request is aborted at the configured timeout and never authenticates', async () => {
  global.fetch.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));

  await expect(verifyIdToken('synthetic-token')).resolves.toEqual({ valid: false, error: 'timeout' });
  expect(warn).toHaveBeenCalledWith('[LINE_ID_TOKEN_VERIFY] timeout', { timeoutMs: env.line.idTokenVerifyTimeoutMs });
});

test('network failures and upstream 5xx are unavailable, not valid identities', async () => {
  global.fetch.mockRejectedValueOnce(new Error('synthetic network failure'));
  await expect(verifyIdToken('synthetic-token')).resolves.toEqual({ valid: false, error: 'network_error' });

  global.fetch.mockResolvedValueOnce(jsonResponse(503, { error: 'maintenance' }));
  await expect(verifyIdToken('synthetic-token')).resolves.toEqual({ valid: false, error: 'upstream_unavailable' });
  expect(error).toHaveBeenCalled();
});

test('a body stalled after response headers is aborted and classified as unavailable', async () => {
  const readBody = jest.fn();
  global.fetch.mockImplementationOnce(async (_url, { signal }) => ({
    ok: true,
    status: 200,
    json: () => new Promise((_resolve, reject) => {
      readBody();
      signal.addEventListener('abort', () => reject(new Error('synthetic body abort')), { once: true });
    }),
  }));

  const result = await verifyIdToken('synthetic-token');

  expect(readBody).toHaveBeenCalledTimes(1);
  expect(result).toEqual({ valid: false, error: 'timeout' });
  expect(isVerificationUnavailable(result)).toBe(true);
  expect(warn).toHaveBeenCalledWith('[LINE_ID_TOKEN_VERIFY] timeout', { timeoutMs: env.line.idTokenVerifyTimeoutMs });
});

test('a body network failure is unavailable and releases its verification slot', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => { throw new TypeError('synthetic body network failure'); },
  });

  const result = await verifyIdToken('synthetic-token');

  expect(result).toEqual({ valid: false, error: 'network_error' });
  expect(isVerificationUnavailable(result)).toBe(true);
  global.fetch.mockResolvedValueOnce(jsonResponse(200, { sub: 'synthetic-line-subject', aud: '2000000000' }));
  await expect(verifyIdToken('synthetic-next-token')).resolves.toMatchObject({ valid: true });
});

test.each([
  [200, 'no_sub_in_payload', false],
  [400, 'http_400', false],
  [503, 'upstream_unavailable', true],
])('malformed JSON at HTTP %s preserves its existing classification', async (status, expectedError, unavailable) => {
  global.fetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => { throw new SyntaxError('synthetic malformed JSON'); },
  });

  const result = await verifyIdToken('synthetic-token');

  expect(result).toEqual({ valid: false, error: expectedError });
  expect(isVerificationUnavailable(result)).toBe(unavailable);
});

test('LINE 4xx rejection remains an invalid token and is not logged with the token', async () => {
  global.fetch.mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_request' }));
  await expect(verifyIdToken('synthetic-token')).resolves.toEqual({ valid: false, error: 'invalid_request' });
  expect(warn).toHaveBeenCalledWith('[LINE_ID_TOKEN_VERIFY] rejected', { status: 400, code: 'invalid_request' });
  expect(JSON.stringify(warn.mock.calls)).not.toContain('synthetic-token');
});

test('concurrent verification is capped while one upstream request is pending', async () => {
  let finish;
  global.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const first = verifyIdToken('synthetic-token-one');
  await Promise.resolve();

  await expect(verifyIdToken('synthetic-token-two')).resolves.toEqual({ valid: false, error: 'verification_busy' });
  finish(jsonResponse(200, { sub: 'synthetic-line-subject', aud: '2000000000' }));
  await expect(first).resolves.toMatchObject({ valid: true, userId: 'synthetic-line-subject' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
