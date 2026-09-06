'use strict';

/**
 * The capacity harness itself.
 *
 * A load test that reports the wrong percentile, or that can be pointed at
 * production by a tired operator at 2am, is worse than none: it produces a
 * number people then quote. The maths and the refusals are pinned here.
 */

const {
  SCENARIOS,
  THRESHOLDS,
  MEASUREMENT_RULES,
  PRODUCTION_HOSTS,
  percentile,
  summarise,
  evaluateThresholds,
  checkTarget,
  selectScenarios,
} = require('../scripts/load-test');

describe('percentiles', () => {
  const sample = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100

  it('uses nearest rank, so p95 is a value that actually occurred', () => {
    expect(percentile(sample, 50)).toBe(50);
    expect(percentile(sample, 95)).toBe(95);
    expect(percentile(sample, 99)).toBe(99);
    expect(percentile(sample, 100)).toBe(100);
  });

  it('does not hide a tail behind an average', () => {
    // 99 fast requests and one very slow one: the mean says 109ms, p99 says
    // the truth. A capacity claim turns on the latter.
    const skewed = [...Array.from({ length: 99 }, () => 100), 1000].sort((a, b) => a - b);
    const mean = skewed.reduce((a, b) => a + b, 0) / skewed.length;
    expect(Math.round(mean)).toBe(109);
    expect(percentile(skewed, 99)).toBe(100);
    expect(percentile(skewed, 100)).toBe(1000);
  });

  it('returns null for an empty sample rather than zero', () => {
    // Zero latency would read as a perfect result; null reads as no data.
    expect(percentile([], 95)).toBeNull();
    expect(summarise([]).p95_ms).toBeNull();
    expect(summarise([]).error_rate).toBeNull();
  });

  it('handles a single sample', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });
});

describe('summary', () => {
  it('counts errors and computes a rate', () => {
    // Samples carry a status now. summarise() used to grade on the `ok`
    // boolean, which folded 401/403/404 in with 200 — a scenario pointed at a
    // route that does not exist reported a clean, fast result. classify()
    // splits served / rejected / rate_limited / failed instead, so a fixture
    // has to say what the server actually answered.
    // See tests/loadTestMeasurement.unit.test.js for that rule on its own.
    const s = summarise([
      { ms: 10, ok: true, status: 200 }, { ms: 20, ok: true, status: 200 },
      { ms: 30, ok: false, status: 500 }, { ms: 40, ok: true, status: 200 },
    ]);
    expect(s.requests).toBe(4);
    expect(s.errors).toBe(1);
    expect(s.error_rate).toBe(0.25);
    expect(s.max_ms).toBe(40);
  });
});

describe('thresholds', () => {
  // Hand-built summaries must say how many requests were SERVED: the
  // measurement gate (MEASUREMENT_RULES) treats a missing `served` as 0, so
  // a fixture that only says `measured: true` is UNDER-MEASURED and would
  // fail for that reason instead of the one the case is about.
  it('applies the read limit to reads and the write limit to writes', () => {
    // 1,500ms is a failure for a read and a pass for a write, per the plan.
    const readFail = evaluateThresholds({
      school_dashboard: { requests: 100, served: 100, served_ratio: 1, errors: 0, error_rate: 0, p95_ms: 1500, measured: true },
    });
    expect(readFail.passed).toBe(false);
    expect(readFail.failures[0]).toMatch(/read/);

    const writeOk = evaluateThresholds({
      driver_gps: { requests: 100, served: 100, served_ratio: 1, errors: 0, error_rate: 0, p95_ms: 1500, measured: true },
    });
    expect(writeOk.passed).toBe(true);
  });

  it('fails a run whose error rate exceeds one percent', () => {
    const r = evaluateThresholds({
      login: { requests: 1000, served: 980, served_ratio: 0.98, errors: 20, error_rate: 0.02, p95_ms: 100, measured: true },
    });
    expect(r.passed).toBe(false);
    expect(r.failures[0]).toMatch(/error rate/);
  });

  it('ignores a scenario that never ran instead of passing it', () => {
    const r = evaluateThresholds({
      login: { requests: 0, errors: 0, error_rate: null, p95_ms: null },
    });
    expect(r.passed).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('calls a scenario served once in a million UNDER-MEASURED, however good the p95 of the few', () => {
    // The 2026-09-05 soak: login served 80 times and rate-limited 6.3 million
    // times. `measured = served > 0` let the 80 stand for the scenario.
    const r = evaluateThresholds({
      login: { requests: 6300080, served: 80, served_ratio: 80 / 6300080, rate_limited: 6300000, rejected: 0, errors: 0, error_rate: 0, p95_ms: 120, measured: true, status_counts: { 200: 80, 429: 6300000 } },
    });
    expect(r.passed).toBe(false);
    // 80 clears the minimum-served floor, so it is the served-ratio rule
    // that names it: the p95 covers 0.0% of what was sent.
    expect(r.failures[0]).toBe('login: UNDER-MEASURED — 0.0% served (rate_limited 6300000, rejected 0 of 6300080); the p95 covers the served minority only');
  });

  it('calls ten served of ten UNDER-MEASURED by the minimum-served rule', () => {
    const r = evaluateThresholds({
      school_dashboard: { requests: 10, served: 10, served_ratio: 1, errors: 0, error_rate: 0, p95_ms: 50, measured: true },
    });
    expect(r.passed).toBe(false);
    expect(r.failures[0]).toMatch(/UNDER-MEASURED — 10 served of 10 \(need >= 30 served/);
  });

  it('calls a served minority UNDER-MEASURED by the served-ratio rule, naming the rate-limited and rejected populations', () => {
    const r = evaluateThresholds({
      login: { requests: 100, served: 40, served_ratio: 0.4, rate_limited: 55, rejected: 5, errors: 0, error_rate: 0, p95_ms: 50, measured: true },
    });
    expect(r.passed).toBe(false);
    expect(r.failures[0]).toBe('login: UNDER-MEASURED — 40.0% served (rate_limited 55, rejected 5 of 100); the p95 covers the served minority only');
  });

  it('treats a summary without a served count as unmeasured rather than trusting `measured`', () => {
    const r = evaluateThresholds({
      school_dashboard: { requests: 100, errors: 0, error_rate: 0, p95_ms: 50, measured: true },
    });
    expect(r.passed).toBe(false);
    expect(r.failures[0]).toMatch(/UNDER-MEASURED — 0 served of 100/);
  });

  it('keeps the plan thresholds, and keeps the measurement rules apart from them', () => {
    expect(THRESHOLDS).toEqual({ error_rate_max: 0.01, read_p95_ms_max: 1000, write_p95_ms_max: 2000, duplicate_or_lost_writes: 0 });
    expect(MEASUREMENT_RULES).toEqual({ min_served: 30, served_ratio_min: 0.5 });
    expect(Object.keys(THRESHOLDS)).not.toContain('min_served');
  });
});

describe('summarise reports the served share', () => {
  it('served_ratio is served / requests, and null when nothing was sent', () => {
    const s = summarise([{ ms: 1, ok: true, status: 200 }, { ms: 1, ok: false, status: 429 }, { ms: 1, ok: false, status: 429 }, { ms: 1, ok: false, status: 404 }]);
    expect(`served=${s.served} limited=${s.rate_limited} rejected=${s.rejected} ratio=${s.served_ratio}`).toBe('served=1 limited=2 rejected=1 ratio=0.25');
    expect(summarise([]).served_ratio).toBeNull();
  });
});

describe('target safety', () => {
  it('refuses write load against production', () => {
    for (const host of PRODUCTION_HOSTS) {
      const r = checkTarget(`https://${host}`, { sandbox: true, readOnly: false, profile: 'ramp' });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('refusing_write_load_against_production');
    }
  });

  it('refuses a full ramp against production even when read-only', () => {
    const r = checkTarget('https://schoolbuslampang.com', { readOnly: true, profile: 'ramp' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('production_allows_smoke_profile_only');
  });

  it('permits only a read-only smoke against production', () => {
    const r = checkTarget('https://schoolbuslampang.com', { readOnly: true, profile: 'smoke' });
    expect(r.ok).toBe(true);
    expect(r.productionSmoke).toBe(true);
  });

  it('requires an explicit sandbox or read-only flag for any other target', () => {
    expect(checkTarget('http://127.0.0.1:3000', {}).ok).toBe(false);
    expect(checkTarget('http://127.0.0.1:3000', { sandbox: true }).ok).toBe(true);
    expect(checkTarget('http://127.0.0.1:3000', { readOnly: true }).ok).toBe(true);
  });

  it('rejects a missing or malformed target rather than defaulting to one', () => {
    expect(checkTarget(undefined, { sandbox: true }).reason).toMatch(/no_target/);
    expect(checkTarget('not a url', { sandbox: true }).reason).toBe('invalid_target_url');
  });

  it('is not fooled by casing', () => {
    const r = checkTarget('https://SchoolBusLampang.com', { sandbox: true });
    expect(r.ok).toBe(false);
  });
});

describe('scenario selection', () => {
  it('drops every write scenario in read-only mode', () => {
    const list = selectScenarios({ readOnly: true, profile: 'ramp' });
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((s) => !s.writes)).toBe(true);
  });

  it('keeps a smoke profile small and read-only', () => {
    const list = selectScenarios({ readOnly: false, profile: 'smoke' });
    expect(list.length).toBeLessThanOrEqual(4);
    expect(list.every((s) => !s.writes)).toBe(true);
  });
});

describe('workload definition', () => {
  it('covers the paths the plan names', () => {
    const keys = SCENARIOS.map((s) => s.key);
    for (const required of ['login', 'reports_daily', 'driver_gps', 'parent_status', 'participation_event']) {
      expect(keys).toContain(required);
    }
    expect(keys.some((k) => k.includes('checkin'))).toBe(true);
    expect(keys.some((k) => k.includes('dashboard'))).toBe(true);
  });

  it('weights sum to one so the mix is a real distribution', () => {
    const sum = SCENARIOS.reduce((acc, s) => acc + s.weight, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it('leans on school traffic, matching the production audit mix', () => {
    // 8,814 of 9,844 audited actions over 90 days were school actions; an even
    // spread would be testing a system nobody uses.
    const school = SCENARIOS.filter((s) => s.key.startsWith('school_'))
      .reduce((acc, s) => acc + s.weight, 0);
    expect(school).toBeGreaterThanOrEqual(0.4);
  });

  it('declares write intent on every scenario', () => {
    for (const s of SCENARIOS) {
      expect(typeof s.writes).toBe('boolean');
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(s.method);
      if (s.method === 'GET') expect(s.writes).toBe(false);
    }
  });
});
