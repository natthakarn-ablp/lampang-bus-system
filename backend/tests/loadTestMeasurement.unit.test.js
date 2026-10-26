'use strict';

/**
 * A load test may only report a latency for work that was actually done.
 *
 * THE DEFECT
 * ----------
 * load-test.js graded every response like this:
 *
 *     ok = res.status < 500 && res.status !== 429;
 *
 * and then reported p50/p95/p99 over all of them. A 404 is fast, cheap and
 * "ok" by that rule, so a scenario pointing at a route that does not exist
 * produced excellent numbers and a clean error rate.
 *
 * That was not hypothetical. `school_dashboard` — the heaviest read in the
 * mix at weight 0.20 — pointed at `/api/school/daily-status`. The route is
 * `/api/school/status-today` (school.routes.js:243); every other role uses
 * status-today, and so does the frontend. Probed against the local staging
 * stack with a minted school token: daily-status 404, status-today 200. A
 * fifth of the workload was measuring a 404 handler, and `supports_1000_user_
 * claim` could still come out true.
 *
 * This is the third appearance of one shape in this pipeline — npm audit
 * reporting clean from an unparsable report, git returning '' on failure, and
 * now a 404 counted as a served request. Same rule each time: did-the-work is
 * a pass, could-not-do-the-work is NOT MEASURED, and the two may never share
 * a value.
 *
 * WHY A UNIT TEST
 * ---------------
 * A ramp to 1,000 users takes four stages of 60 seconds plus a seeded
 * database. The grading is the part that was wrong, so the grading is what is
 * asserted here, in milliseconds, with no server.
 */

const {
  classify, summarise, evaluateThresholds, SCENARIOS,
} = require('../scripts/load-test');

/** One sample, as runStage records it. */
const sample = (status, ms = 10, scenario = 'school_dashboard') => ({ scenario, ms, status, ok: status < 500 && status !== 429 });

describe('classify separates doing the work from answering', () => {
  it('calls 2xx and 3xx served', () => {
    expect([200, 201, 204, 302].map(classify))
      .toEqual(['served', 'served', 'served', 'served']);
  });

  it('calls 429 rate_limited, not an error and not a success', () => {
    expect(classify(429)).toBe('rate_limited');
  });

  it('calls other 4xx rejected — the case that used to read as success', () => {
    expect([400, 401, 403, 404, 422].map(classify))
      .toEqual(['rejected', 'rejected', 'rejected', 'rejected', 'rejected']);
  });

  it('calls 5xx and a transport failure failed', () => {
    expect([500, 502, 0].map(classify)).toEqual(['failed', 'failed', 'failed']);
  });
});

describe('summarise', () => {
  it('reports measured=false when nothing was served', () => {
    // The exact defect: 200 requests, all 404, all fast.
    const s = summarise(Array.from({ length: 200 }, () => sample(404, 3)));
    expect(`measured=${s.measured} served=${s.served} rejected=${s.rejected}`)
      .toBe('measured=false served=0 rejected=200');
  });

  it('does not let those 404s produce a flattering p95', () => {
    const s = summarise(Array.from({ length: 200 }, () => sample(404, 3)));
    // Before the fix this was 3ms and read as an excellent result.
    expect(s.p95_ms).toBeNull();
  });

  it('does not count rejections in the error rate either', () => {
    // They are not server failures. The error budget stays about 5xx; it is
    // `measured` that stops a rejected-only scenario from passing.
    const s = summarise(Array.from({ length: 100 }, () => sample(403)));
    expect(`error_rate=${s.error_rate} measured=${s.measured}`)
      .toBe('error_rate=0 measured=false');
  });

  it('measures latency over served requests only', () => {
    // Nine 404s at 1ms and one 200 at 500ms. Averaging them in would report
    // the speed of the rejection.
    const samples = [...Array.from({ length: 9 }, () => sample(404, 1)), sample(200, 500)];
    const s = summarise(samples);
    expect(`served=${s.served} p95=${s.p95_ms} requests=${s.requests}`)
      .toBe('served=1 p95=500 requests=10');
  });

  it('counts 5xx as errors', () => {
    const s = summarise([sample(200), sample(200), sample(500), sample(0)]);
    expect(`errors=${s.errors} rate=${s.error_rate} measured=${s.measured}`)
      .toBe('errors=2 rate=0.5 measured=true');
  });

  it('keeps rate limiting out of both the error rate and the served count', () => {
    const s = summarise([sample(200), sample(429), sample(429)]);
    expect(`served=${s.served} limited=${s.rate_limited} errors=${s.errors}`)
      .toBe('served=1 limited=2 errors=0');
  });

  it('records the statuses it saw, so a report says why', () => {
    const s = summarise([sample(200), sample(404), sample(404), sample(429)]);
    expect(s.status_counts).toEqual({ 200: 1, 404: 2, 429: 1 });
  });

  it('reports measured=false for an empty sample set', () => {
    const s = summarise([]);
    expect(`measured=${s.measured} rate=${s.error_rate}`).toBe('measured=false rate=null');
  });
});

describe('evaluateThresholds', () => {
  const scenarioSummary = (over) => summarise(over);

  it('fails a scenario that sent requests but was never served', () => {
    const v = evaluateThresholds({
      school_dashboard: scenarioSummary(Array.from({ length: 50 }, () => sample(404, 2))),
    });
    expect(v.passed).toBe(false);
    expect(v.failures[0]).toContain('NOT MEASURED');
    expect(v.failures[0]).toContain('status 404');
  });

  it('passes a scenario that was served inside its budget', () => {
    const v = evaluateThresholds({
      school_dashboard: scenarioSummary(Array.from({ length: 50 }, () => sample(200, 40))),
    });
    expect(`${v.passed} / ${v.failures.join(';')}`).toBe('true / ');
  });

  it('still fails a served scenario that is too slow', () => {
    // read_p95_ms_max is 1000. The NOT MEASURED gate must not have replaced
    // the latency gate.
    const v = evaluateThresholds({
      school_dashboard: scenarioSummary(Array.from({ length: 50 }, () => sample(200, 4000))),
    });
    expect(v.passed).toBe(false);
    expect(v.failures.join(' ')).toMatch(/p95/i);
  });

  it('ignores a scenario that sent no requests at all', () => {
    // Filtered out of the run (read-only or smoke profile) — absent, not failed.
    const v = evaluateThresholds({ school_dashboard: scenarioSummary([]) });
    expect(`${v.passed} / ${v.failures.length}`).toBe('true / 0');
  });
});

describe('the scenario paths point at routes that exist', () => {
  const fs = require('fs');
  const path = require('path');

  /** Read a router file once. */
  const router = (name) => fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', `${name}.routes.js`), 'utf8');

  it('school_dashboard uses status-today, the name the code defines', () => {
    const s = SCENARIOS.find((x) => x.key === 'school_dashboard');
    expect(s.path).toBe('/api/school/status-today');
    // and that name is actually declared, so a rename breaks this test rather
    // than quietly returning the load test to measuring a 404
    expect(`declared: ${/router\.get\('\/status-today'/.test(router('school'))}`)
      .toBe('declared: true');
    expect(`daily-status still absent: ${!/'\/daily-status'/.test(router('school'))}`)
      .toBe('daily-status still absent: true');
  });

  it('the other single-segment scenario paths are declared too', () => {
    // Only the ones whose router file is unambiguous from the prefix; the
    // parameterised paths are covered by the NOT MEASURED gate at run time.
    const cases = [
      ['/api/school/checkin-override', 'school', "router.post('/checkin-override'"],
      ['/api/driver/roster', 'driver', "router.get('/roster'"],
      ['/api/driver/vehicle-location', 'driver', "router.post('/vehicle-location'"],
      ['/api/auth/login', 'auth', "router.post('/login'"],
    ];
    const missing = cases
      .filter(([, file, decl]) => !router(file).includes(decl))
      .map(([p]) => p);
    expect(`missing: ${missing.join(', ')}`).toBe('missing: ');
    // floor: the paths asserted above are really in SCENARIOS, so this cannot
    // pass by checking an empty list
    const paths = SCENARIOS.map((s) => (typeof s.path === 'function' ? '' : s.path));
    for (const [p] of cases) expect(paths).toContain(p);
  });
});
