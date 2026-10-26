'use strict';

/**
 * The runner in backend/scripts/load-test.js, against a local HTTP server.
 *
 * The 2026-09-06 review of 2fc67d1 found that the runner ignored the
 * declared weights (virtual user i always ran scenario i % length), that a
 * request had no deadline, that a stop-condition abort moved the deadline
 * but let every in-flight request run on, and that the outer loop started
 * the next (larger) stage after a safety abort. Those are runner behaviours,
 * so they are asserted here against a server this test starts on 127.0.0.1
 * with synthetic scenarios (role: null, so no token is involved). No
 * external target, and the server is closed in afterAll.
 *
 * Timing assertions are generous (an abort must land within 3 s of a 0.3 s
 * watch interval) so they hold on a loaded machine; they are still an order
 * of magnitude tighter than the failure they guard against (a 10 s stage
 * running to completion).
 */

const http = require('http');

const {
  MEASUREMENT_RULES,
  buildSchedule,
  scheduleCounts,
  runStage,
  runPlan,
  startSampler,
  evaluateThresholds,
  summarise,
} = require('../scripts/load-test');

let server;
let base;
const hanging = new Set();
const slowTimers = new Set();
const seenUrls = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seenUrls.push(req.url);
    if (req.url.startsWith('/instant')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"success":true}');
      return;
    }
    if (req.url.startsWith('/slow')) {
      const t = setTimeout(() => { slowTimers.delete(t); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"success":true}'); }, 800);
      slowTimers.add(t);
      req.on('close', () => { clearTimeout(t); slowTimers.delete(t); });
      return;
    }
    if (req.url.startsWith('/never')) {
      hanging.add(res);
      req.on('close', () => hanging.delete(res));
      return;
    }
    if (req.url.startsWith('/limited')) {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end('{"success":false}');
      return;
    }
    if (req.url.startsWith('/api/admin/operations/capacity-sample')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { sampled_at: new Date().toISOString(), process: { rss_mb: 123 }, db_pool: { limit: 10, in_use: 1, queued: 0, utilisation: 0.1 } } }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  for (const t of slowTimers) clearTimeout(t);
  for (const res of hanging) res.destroy();
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const scenario = (key, weight, pathOrFn, extra = {}) => ({ key, role: null, weight, writes: false, method: 'GET', path: pathOrFn, ...extra });
const quiet = () => {};

describe('buildSchedule apportions the declared weights', () => {
  it('gives two scenarios weighted 0.8 / 0.2 exactly 80 and 20 of 100 slots', () => {
    const scs = [scenario('a', 0.8, '/instant'), scenario('b', 0.2, '/instant')];
    const schedule = buildSchedule(scs, 100);
    expect(schedule).toHaveLength(100);
    expect(scheduleCounts(scs, schedule)).toEqual({ a: 80, b: 20 });
  });

  it('re-normalises over the runnable subset and gives every positive weight at least one slot', () => {
    // A read-only run drops the writers; the remaining weights no longer sum
    // to one. Tiny weights still get a slot, so a short stage cannot skip
    // a scenario silently.
    const scs = [scenario('big', 0.98, '/instant'), scenario('tiny1', 0.01, '/instant'), scenario('tiny2', 0.01, '/instant')];
    const counts = scheduleCounts(scs, buildSchedule(scs, 10));
    expect(counts.tiny1).toBeGreaterThanOrEqual(1);
    expect(counts.tiny2).toBeGreaterThanOrEqual(1);
    expect(counts.big + counts.tiny1 + counts.tiny2).toBe(10);
  });

  it('interleaves rather than blocks, so the first requests already cover every scenario', () => {
    const scs = [scenario('a', 0.5, '/instant'), scenario('b', 0.3, '/instant'), scenario('c', 0.2, '/instant')];
    const first = buildSchedule(scs, 100).slice(0, 6).map((i) => scs[i].key);
    expect(new Set(first)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('is empty for no scenarios or no positive weight', () => {
    expect(buildSchedule([], 100)).toEqual([]);
    expect(buildSchedule([scenario('z', 0, '/instant')], 100)).toEqual([]);
  });
});

describe('runStage', () => {
  jest.setTimeout(30000);

  it('sends requests in the declared mix, not one scenario per virtual user', async () => {
    const scs = [scenario('heavy', 0.8, '/instant?s=heavy'), scenario('light', 0.2, '/instant?s=light')];
    const stage = await runStage({ target: base, scenarios: scs, users: 4, durationSec: 1, log: quiet });
    const total = stage.overall.requests;
    expect(total).toBeGreaterThan(20);
    const heavyShare = stage.by_scenario.heavy.requests / total;
    // Within ±10 percentage points of the 80/20 split. The old runner gave
    // 2 of 4 users to each scenario: a 50/50 split, outside this band.
    expect(heavyShare).toBeGreaterThan(0.7);
    expect(heavyShare).toBeLessThan(0.9);
    expect(stage.schedule_counts).toEqual({ heavy: 80, light: 20 });
    expect(stage.scenarios_absent).toEqual([]);
    expect(stage.aborted).toBeNull();
    expect(stage.cancelled_in_flight).toBe(0);
    expect(stage.request_timeouts).toBe(0);
  });

  it('bounds every request with --request-timeout-ms: a route that never answers is a failed request, not a hung stage', async () => {
    const t0 = Date.now();
    const stage = await runStage({ target: base, scenarios: [scenario('hang', 1, '/never')], users: 2, durationSec: 1, requestTimeoutMs: 300, log: quiet });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(stage.overall.requests).toBeGreaterThan(0);
    expect(stage.by_scenario.hang.status_counts).toEqual({ 0: stage.overall.requests });
    expect(stage.request_timeouts).toBeGreaterThan(0);
    expect(stage.overall.errors).toBe(stage.overall.requests);
    expect(stage.overall.measured).toBe(false);
  });

  it('a stop-condition abort cancels the requests in flight and ends the stage now, not at the deadline', async () => {
    const t0 = Date.now();
    const stage = await runStage({
      target: base,
      scenarios: [scenario('slow', 1, '/slow')],
      users: 4,
      durationSec: 10,
      stop: { abortP95Ms: 100, abortConsecutive: 1, watchIntervalSec: 0.3 },
      log: quiet,
    });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(stage.aborted).not.toBeNull();
    expect(stage.aborted.reason).toMatch(/p95 \d+ms > 100ms/);
    expect(stage.cancelled_in_flight).toBeGreaterThan(0);
    // A cancelled request is not a sample: it would read as a transport
    // failure of the server, which it is not.
    expect(stage.overall.errors).toBe(0);
    expect(stage.duration_sec).toBeLessThan(3);
  });

  it('never invents a scope id: a scenario that needs one it was not given sends null, not 1..100', async () => {
    const before = seenUrls.length;
    const scs = [scenario('needs_id', 1, (vu) => `/instant?sid=${vu.studentId}&cid=${vu.caseId}`)];
    await runStage({ target: base, scenarios: scs, users: 2, durationSec: 0.3, log: quiet });
    const urls = seenUrls.slice(before).filter((u) => u.includes('sid='));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.includes('sid=null&cid=null'))).toBe(true);
  });

  it('reports rate-limited and served populations separately, and the verdict calls the served minority UNDER-MEASURED', async () => {
    const scs = [scenario('login', 1, '/limited')];
    const stage = await runStage({ target: base, scenarios: scs, users: 2, durationSec: 0.5, log: quiet });
    expect(stage.by_scenario.login.rate_limited).toBe(stage.by_scenario.login.requests);
    expect(stage.by_scenario.login.served).toBe(0);
    expect(stage.by_scenario.login.served_ratio).toBe(0);
    const verdict = evaluateThresholds(stage.by_scenario, stage);
    expect(verdict.passed).toBe(false);
    expect(verdict.failures[0]).toMatch(/login: NOT MEASURED/);
  });
});

describe('runPlan', () => {
  const plan = ['s1', 's2', 's3', 's4'].map((label, i) => ({ label, users: (i + 1) * 10, durationSec: 1 }));
  const fakeStage = (aborted) => ({
    users: 1,
    aborted,
    by_scenario: { school_dashboard: summarise(Array.from({ length: 50 }, () => ({ status: 200, ms: 20 }))) },
    overall: summarise([]),
    scenarios_not_measured: [],
    scenarios_absent: [],
    server: null,
  });

  it('stops after an aborted stage and names the stages it skipped', async () => {
    const calls = [];
    const { results, stopped } = await runPlan(plan, async (st) => { calls.push(st.label); return fakeStage(st.label === 's2' ? { at_sec: 3, reason: 'p95 9000ms > 5000ms' } : null); }, quiet);
    expect(calls).toEqual(['s1', 's2']);
    expect(results).toHaveLength(2);
    expect(stopped).toEqual({ after_stage: 's2', reason: 'p95 9000ms > 5000ms', skipped_stages: ['s3', 's4'] });
    expect(results[1].threshold_result.passed).toBe(false);
    expect(results[1].threshold_result.failures[0]).toMatch(/stage aborted by stop condition/);
  });

  it('runs every stage when nothing aborts', async () => {
    const { results, stopped } = await runPlan(plan, async () => fakeStage(null), quiet);
    expect(results.map((r) => r.label)).toEqual(['s1', 's2', 's3', 's4']);
    expect(stopped).toBeNull();
    expect(results.every((r) => r.threshold_result.passed)).toBe(true);
  });

  it('a scenario in the mix that sent nothing fails the stage as ABSENT rather than passing by silence', async () => {
    const { results } = await runPlan(plan.slice(0, 1), async () => ({ ...fakeStage(null), scenarios_absent: ['driver_gps'] }), quiet);
    expect(results[0].threshold_result.passed).toBe(false);
    expect(results[0].threshold_result.failures).toEqual(['driver_gps: ABSENT — in the mix but sent 0 requests in this stage']);
  });
});

describe('startSampler', () => {
  jest.setTimeout(15000);

  it('reports the latest sample while it is fresh and null once it is stale', async () => {
    const sampler = startSampler({ target: base, adminToken: 'not-a-real-token', intervalSec: 1 });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !sampler.latest()) await new Promise((r) => setTimeout(r, 50));
    const fresh = sampler.latest();
    expect(fresh && fresh.process.rss_mb).toBe(123);
    expect(sampler.stale_after_ms).toBe(30000); // max(3 × 1 s, 30 s)
    expect(sampler.latest(Date.now() + 31000)).toBeNull();
    const samples = await sampler.stop();
    expect(samples.length).toBeGreaterThanOrEqual(2);
    expect(samples.every((s) => typeof s.at === 'number')).toBe(true);
  });
});

describe('measurement rules are separate from the plan thresholds', () => {
  it('are the documented heuristics', () => {
    expect(MEASUREMENT_RULES).toEqual({ min_served: 30, served_ratio_min: 0.5 });
  });
});
