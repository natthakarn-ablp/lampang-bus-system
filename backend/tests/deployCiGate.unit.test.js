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
const WF = { id: 333997252, path: '.github/workflows/full-quality.yml' };

const runOf = (o = {}) => ({
  id: 100, name: 'Full Quality', workflow_id: WF.id, path: WF.path, event: 'push',
  head_sha: SHA, head_branch: BRANCH, status: 'completed', conclusion: 'success', run_attempt: 1,
  created_at: '2026-11-08T07:00:00Z', repository: { full_name: REPO }, head_repository: { full_name: REPO }, ...o,
});
const page = (runs, total = runs.length) => ({ total_count: total, workflow_runs: runs });
const ctx = { sha: SHA, branch: BRANCH, repo: REPO, workflow: WF };

// fetch double: answers the workflow lookup, then the runs request.
function api({ workflow = { id: WF.id, name: 'Full Quality', path: WF.path, state: 'active' }, wfStatus = 200,
  runs = page([runOf()]), runsStatus = 200, headers = {} } = {}) {
  const res = (status, body) => ({
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  });
  return jest.fn(async (url) => (/\/actions\/workflows\/[^/]+\.yml$/.test(url) ? res(wfStatus, workflow) : res(runsStatus, runs)));
}
const check = (fetchImpl, o = {}) => gate.checkCi({ sha: SHA, branch: BRANCH, repo: REPO, fetchImpl, ...o });

describe('evaluateRuns — which run counts', () => {
  test('target SHA push run of THIS workflow succeeded → allow', () => {
    expect(gate.evaluateRuns(page([runOf()]), ctx).decision).toBe('allow');
  });

  test('another SHA passed but the target has no run → refuse', () => {
    const r = gate.evaluateRuns(page([runOf({ head_sha: OTHER })]), ctx);
    expect(r.decision).toBe('refuse');
    expect(r.reason).toMatch(/no \.github\/workflows\/full-quality\.yml push run/);
  });

  test.each([
    ['in_progress', null], ['queued', null], ['waiting', null], ['completed', 'failure'],
    ['completed', 'cancelled'], ['completed', 'timed_out'], ['completed', null],
  ])('status %s / conclusion %s → refuse', (status, conclusion) => {
    expect(gate.evaluateRuns(page([runOf({ status, conclusion })]), ctx).decision).toBe('refuse');
  });

  test('no runs → refuse; no workflow_runs list → error', () => {
    expect(gate.evaluateRuns(page([]), ctx).decision).toBe('refuse');
    expect(gate.evaluateRuns({}, ctx).decision).toBe('error');
  });

  test('identity: same display name but another workflow id or file, PR runs, other branch, forks → not evidence', () => {
    for (const o of [
      { workflow_id: 255758760 }, { path: '.github/workflows/check-labels.yml' }, { event: 'pull_request' },
      { head_branch: 'main' }, { repository: { full_name: 'someone/fork' } }, { head_repository: { full_name: 'someone/fork' } },
    ]) {
      expect(gate.evaluateRuns(page([runOf(o)]), ctx).decision).toBe('refuse');
    }
  });

  test('re-run of the SAME run (same id, attempt 2) still in progress → refuse; attempt 2 success → allow', () => {
    expect(gate.evaluateRuns(page([runOf({ run_attempt: 2, status: 'in_progress', conclusion: null })]), ctx).decision).toBe('refuse');
    const ok = gate.evaluateRuns(page([runOf({ run_attempt: 2 })]), ctx);
    expect(ok.decision).toBe('allow');
    expect(ok.reason).toContain('attempt 2');
  });

  test('the most recent run decides: an older success does not cover a newer run still in progress', () => {
    const r = gate.evaluateRuns(page([
      runOf({ id: 1, created_at: '2026-11-08T06:00:00Z' }),
      runOf({ id: 2, created_at: '2026-11-08T07:00:00Z', status: 'in_progress', conclusion: null }),
    ]), ctx);
    expect(r.decision).toBe('refuse');
    expect(r.run.id).toBe(2);
  });

  test('a newer success after an older failure → allow', () => {
    expect(gate.evaluateRuns(page([
      runOf({ id: 1, created_at: '2026-11-08T06:00:00Z', conclusion: 'failure' }),
      runOf({ id: 2, created_at: '2026-11-08T07:00:00Z' }),
    ]), ctx).decision).toBe('allow');
  });

  test('incomplete or uninterpretable data → refuse, never allow', () => {
    for (const o of [{ created_at: 'not a date' }, { created_at: undefined }, { status: 'weird' }, { id: '42' }]) {
      expect(gate.evaluateRuns(page([runOf(), runOf({ id: 101, ...o })]), ctx).decision).toBe('refuse');
    }
  });

  test('more runs exist than were returned → refuse (cannot know the newest)', () => {
    expect(gate.evaluateRuns(page([runOf()], 150), ctx).decision).toBe('refuse');
  });
});

describe('checkCi — workflow resolved by file in this repository, then its runs', () => {
  test('looks the workflow up by file, then asks for that workflow id only, push, exact SHA and branch; no token by default', async () => {
    const f = api();
    expect((await check(f)).decision).toBe('allow');
    expect(f.mock.calls[0][0]).toBe(`https://api.github.com/repos/${REPO}/actions/workflows/full-quality.yml`);
    expect(f.mock.calls[1][0]).toBe(`https://api.github.com/repos/${REPO}/actions/workflows/${WF.id}/runs?head_sha=${SHA}&event=push&branch=${encodeURIComponent(BRANCH)}&per_page=100`);
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  test('a workflow lookup with the wrong path or no numeric id → error', async () => {
    expect((await check(api({ workflow: { id: WF.id, path: '.github/workflows/other.yml' } }))).decision).toBe('error');
    expect((await check(api({ workflow: { id: 'x', path: WF.path } }))).decision).toBe('error');
    expect((await check(api({ wfStatus: 404 }))).reason).toMatch(/workflow full-quality\.yml not found/);
  });

  test('a token is sent as a header only', async () => {
    const f = api();
    await check(f, { token: 'tkn-123' });
    for (const [url, opts] of f.mock.calls) {
      expect(opts.headers.Authorization).toBe('Bearer tkn-123');
      expect(url).not.toContain('tkn-123');
    }
  });

  test.each([
    [401, {}, /refused the request \(HTTP 401\)/],
    [403, { 'x-ratelimit-remaining': '0' }, /rate limit/],
    [403, {}, /HTTP 403/],
    [404, {}, /HTTP 404/],
    [500, {}, /HTTP 500/],
  ])('runs request HTTP %i → error, never allow', async (status, headers, re) => {
    const r = await check(api({ runsStatus: status, headers }));
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
    expect((await check(api({ runs: { nope: 1 } }))).decision).toBe('error');
    const notJson = jest.fn(async () => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => { throw new Error('x'); } }));
    expect((await check(notJson)).decision).toBe('error');
  });

  test.each([['abc1234'], ['A'.repeat(40)], [''], [undefined]])('target %j that is not a full lowercase SHA → error before any request', async (sha) => {
    const f = api();
    expect((await check(f, { sha })).decision).toBe('error');
    expect(f).not.toHaveBeenCalled();
  });

  test('a workflow file name that is not a .yml file → error before any request', async () => {
    const f = api();
    expect((await check(f, { workflowFile: '../../etc' })).decision).toBe('error');
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
    globalThis.fetch = api();
    expect(await gate.main(args, {})).toBe(0);
    globalThis.fetch = api({ runs: page([runOf({ status: 'in_progress', conclusion: null })]) });
    expect(await gate.main(args, {})).toBe(2);
    globalThis.fetch = api({ runsStatus: 503 });
    expect(await gate.main(args, {})).toBe(3);
  });

  test('an unreadable or empty token file → 3, and the token text is never printed', async () => {
    quiet();
    globalThis.fetch = api();
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
