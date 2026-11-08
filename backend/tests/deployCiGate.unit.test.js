'use strict';

// OPS-001 (2026-11-08): scripts/deploy-ci-gate.js decides whether CI passed for
// EXACTLY the commit about to be deployed. Every case uses an injected fetch —
// no network, no GitHub.
const path = require('path');
const fs = require('fs');
const os = require('os');
const gate = require(path.resolve(__dirname, '..', '..', 'scripts', 'deploy-ci-gate.js'));

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const REPO = 'natthakarn-ablp/lampang-bus-system';
const BRANCH = 'feat/tracking-security-hardening';
const WF = 'Full Quality';

const runOf = (o = {}) => ({
  id: 100, name: WF, event: 'push', head_sha: SHA, head_branch: BRANCH,
  status: 'completed', conclusion: 'success', run_attempt: 1,
  created_at: '2026-11-08T07:00:00Z', repository: { full_name: REPO }, ...o,
});
const fetchReturning = (status, body, headers = {}) => jest.fn(async () => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
}));
const check = (fetchImpl, o = {}) => gate.checkCi({ sha: SHA, branch: BRANCH, repo: REPO, workflow: WF, fetchImpl, ...o });

describe('evaluateRuns', () => {
  const ctx = { sha: SHA, branch: BRANCH, repo: REPO, workflow: WF };

  test('target SHA push run succeeded → allow', () => {
    expect(gate.evaluateRuns([runOf()], ctx).decision).toBe('allow');
  });

  test('another SHA passed but the target has no run → refuse', () => {
    const r = gate.evaluateRuns([runOf({ head_sha: OTHER })], ctx);
    expect(r).toMatchObject({ decision: 'refuse' });
    expect(r.reason).toMatch(/no "Full Quality" push run found/);
  });

  test.each([
    ['in_progress', null], ['queued', null], ['completed', 'failure'], ['completed', 'cancelled'],
    ['completed', 'timed_out'], ['completed', null],
  ])('status %s / conclusion %s → refuse', (status, conclusion) => {
    expect(gate.evaluateRuns([runOf({ status, conclusion })], ctx).decision).toBe('refuse');
  });

  test('no runs at all → refuse', () => {
    expect(gate.evaluateRuns([], ctx).decision).toBe('refuse');
  });

  test('pull_request runs (merge ref), other branches, other workflows and forks are not evidence', () => {
    for (const o of [{ event: 'pull_request' }, { head_branch: 'main' }, { name: 'Check UI Labels' },
      { repository: { full_name: 'someone/fork' } }]) {
      expect(gate.evaluateRuns([runOf(o)], ctx).decision).toBe('refuse');
    }
  });

  test('the most recent run decides: an older success does not cover a newer run still in progress', () => {
    const r = gate.evaluateRuns([
      runOf({ id: 1, created_at: '2026-11-08T06:00:00Z' }),
      runOf({ id: 2, created_at: '2026-11-08T07:00:00Z', status: 'in_progress', conclusion: null }),
    ], ctx);
    expect(r.decision).toBe('refuse');
    expect(r.run.id).toBe(2);
  });

  test('a newer success after an older failure → allow', () => {
    expect(gate.evaluateRuns([
      runOf({ id: 1, created_at: '2026-11-08T06:00:00Z', conclusion: 'failure' }),
      runOf({ id: 2, created_at: '2026-11-08T07:00:00Z' }),
    ], ctx).decision).toBe('allow');
  });
});

describe('checkCi (API handling)', () => {
  test('queries exactly the target SHA, push event, branch — and sends no token by default', async () => {
    const f = fetchReturning(200, { workflow_runs: [runOf()] });
    expect((await check(f)).decision).toBe('allow');
    const [url, opts] = f.mock.calls[0];
    expect(url).toBe(`https://api.github.com/repos/${REPO}/actions/runs?head_sha=${SHA}&event=push&branch=${encodeURIComponent(BRANCH)}&per_page=100`);
    expect(opts.headers.Authorization).toBeUndefined();
  });

  test('a token is sent as a header only', async () => {
    const f = fetchReturning(200, { workflow_runs: [runOf()] });
    await check(f, { token: 'tkn-123' });
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer tkn-123');
    expect(f.mock.calls[0][0]).not.toContain('tkn-123');
  });

  test.each([
    [401, {}, /refused the request \(HTTP 401\)/],
    [403, { 'x-ratelimit-remaining': '0' }, /rate limit/],
    [403, {}, /HTTP 403/],
    [404, {}, /not found/],
    [500, {}, /HTTP 500/],
  ])('HTTP %i → cannot check (error), never allow', async (status, headers, re) => {
    const r = await check(fetchReturning(status, {}, headers));
    expect(r.decision).toBe('error');
    expect(r.reason).toMatch(re);
  });

  test('network failure and timeout → error', async () => {
    const down = jest.fn(async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); });
    expect(await check(down)).toMatchObject({ decision: 'error' });
    const hang = jest.fn((_u, { signal }) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    const r = await check(hang, { timeoutMs: 20 });
    expect(r).toMatchObject({ decision: 'error' });
    expect(r.reason).toMatch(/did not answer within 20 ms/);
  });

  test('malformed answers → error', async () => {
    expect((await check(fetchReturning(200, { nope: 1 }))).decision).toBe('error');
    const notJson = jest.fn(async () => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => { throw new Error('x'); } }));
    expect((await check(notJson)).decision).toBe('error');
  });

  test.each([['abc1234'], ['A'.repeat(40)], [''], [undefined]])('target %j that is not a full lowercase SHA → error before any request', async (sha) => {
    const f = fetchReturning(200, { workflow_runs: [runOf()] });
    expect((await check(f, { sha })).decision).toBe('error');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('main (exit codes the deploy script relies on)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; jest.restoreAllMocks(); });
  const quiet = () => { jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'error').mockImplementation(() => {}); };
  const args = ['--sha', SHA, '--branch', BRANCH];

  test('allow → 0, refuse → 2, cannot check → 3', async () => {
    quiet();
    globalThis.fetch = fetchReturning(200, { workflow_runs: [runOf()] });
    expect(await gate.main(args, {})).toBe(0);
    globalThis.fetch = fetchReturning(200, { workflow_runs: [runOf({ status: 'in_progress', conclusion: null })] });
    expect(await gate.main(args, {})).toBe(2);
    globalThis.fetch = fetchReturning(503, {});
    expect(await gate.main(args, {})).toBe(3);
  });

  test('an unreadable or empty token file → 3, and the token text is never printed', async () => {
    quiet();
    globalThis.fetch = fetchReturning(200, { workflow_runs: [runOf()] });
    expect(await gate.main(args, { DEPLOY_CI_TOKEN_FILE: path.join(os.tmpdir(), 'no-such-token-file') })).toBe(3);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-token-'));
    const empty = path.join(dir, 't'); fs.writeFileSync(empty, '  \n');
    expect(await gate.main(args, { DEPLOY_CI_TOKEN_FILE: empty })).toBe(3);
    const good = path.join(dir, 'g'); fs.writeFileSync(good, 'secret-token-value\n');
    expect(await gate.main(args, { DEPLOY_CI_TOKEN_FILE: good })).toBe(0);
    const printed = [...console.log.mock.calls, ...console.error.mock.calls].flat().join(' ');
    expect(printed).not.toContain('secret-token-value');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('bad arguments → 3', async () => {
    quiet();
    expect(await gate.main(['--sha'], {})).toBe(3);
  });
});
