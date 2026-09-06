'use strict';

/**
 * Role-token mix, stop conditions and resource limits in
 * backend/scripts/load-test.js (2026-09-05, lead-engineer instruction F).
 *
 * The local rehearsal in docs/performance/load-test-local-2026-09-05.md could
 * measure 3 of 9 scenarios because every request carried one school token:
 * driver scenarios were 403, the override scenario hit other schools' students
 * and got 404. Each scenario now declares the role it runs as, a token file
 * supplies one JWT per role, and anything without a usable token is listed as
 * not measurable before the first request. Stop conditions end a runaway
 * stage; --max-users refuses a plan beyond the agreed limit. All pure.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  SCENARIOS,
  buildStages,
  checkUserLimit,
  tokenForScenario,
  partitionByToken,
  evaluateStopConditions,
  summarise,
} = require('../scripts/load-test');

describe('every scenario declares its role', () => {
  it('has a role field (null for the unauthenticated login scenario)', () => {
    for (const sc of SCENARIOS) expect(Object.prototype.hasOwnProperty.call(sc, 'role')).toBe(true);
    expect(SCENARIOS.find((s) => s.key === 'login').role).toBeNull();
    expect(SCENARIOS.find((s) => s.key === 'parent_status').role).toBe('parent');
    expect(SCENARIOS.filter((s) => s.role === 'school').map((s) => s.key)).toEqual(
      ['school_dashboard', 'school_students', 'school_checkin_override', 'reports_daily', 'participation_event']
    );
    expect(SCENARIOS.filter((s) => s.role === 'driver').map((s) => s.key)).toEqual(['driver_roster', 'driver_gps']);
  });
});

describe('tokenForScenario', () => {
  const school = SCENARIOS.find((s) => s.key === 'school_dashboard');
  const driver = SCENARIOS.find((s) => s.key === 'driver_roster');
  const login = SCENARIOS.find((s) => s.key === 'login');
  const parent = SCENARIOS.find((s) => s.key === 'parent_status');

  it('uses the role token when the file has one', () => {
    expect(tokenForScenario(school, { school: 'S', driver: 'D' }, null)).toBe('S');
    expect(tokenForScenario(driver, { school: 'S', driver: 'D' }, null)).toBe('D');
  });

  it('falls back to the single --token only when the role has none', () => {
    expect(tokenForScenario(driver, { school: 'S' }, 'FALLBACK')).toBe('FALLBACK');
    expect(tokenForScenario(driver, { school: 'S' }, null)).toBeNull();
  });

  it('never attaches a token to the login scenario or the LIFF parent scenario', () => {
    expect(tokenForScenario(login, { school: 'S' }, 'FALLBACK')).toBeNull();
    expect(tokenForScenario(parent, { parent: 'P', school: 'S' }, 'FALLBACK')).toBeNull();
  });
});

describe('partitionByToken says up front what cannot be measured', () => {
  it('single --token mode: school scenarios run, driver scenarios also run (with the wrong token, as before), parent never', () => {
    // The old behaviour is preserved for --token alone: the fallback applies
    // to every JWT role, so driver scenarios still run and still get 403 —
    // which summarise() reports as NOT MEASURED. Only parent is excluded.
    const { runnable, unmeasurable } = partitionByToken(SCENARIOS, null, 'S');
    expect(runnable.map((s) => s.key)).not.toContain('parent_status');
    expect(unmeasurable).toEqual([{ key: 'parent_status', reason: expect.stringMatching(/LINE id_token/), blocking: false }]);
  });

  it('marks a missing role token as blocking and the LIFF parent scenario as a non-blocking caveat', () => {
    // A missing driver token is a gap the operator can close before claiming
    // anything; the parent scenario can never run here, so it caveats the
    // JWT-scoped claim and blocks only the full-system one.
    const { unmeasurable } = partitionByToken(SCENARIOS, { school: 'S' }, null);
    const byKey = Object.fromEntries(unmeasurable.map((u) => [u.key, u.blocking]));
    expect(byKey).toEqual({ driver_roster: true, driver_gps: true, parent_status: false });
    expect(unmeasurable.every((u) => typeof u.blocking === 'boolean')).toBe(true);
  });

  it('token file with school only: driver scenarios are unmeasurable with the reason', () => {
    const { runnable, unmeasurable } = partitionByToken(SCENARIOS, { school: 'S' }, null);
    expect(runnable.map((s) => s.key).sort()).toEqual(
      ['login', 'participation_event', 'reports_daily', 'school_checkin_override', 'school_dashboard', 'school_students']
    );
    expect(unmeasurable.map((u) => u.key).sort()).toEqual(['driver_gps', 'driver_roster', 'parent_status']);
    expect(unmeasurable.find((u) => u.key === 'driver_gps').reason).toMatch(/no token for role 'driver'/);
  });

  it('token file with school and driver: only parent is left out', () => {
    const { runnable, unmeasurable } = partitionByToken(SCENARIOS, { school: 'S', driver: 'D' }, null);
    expect(runnable).toHaveLength(8);
    expect(unmeasurable.map((u) => u.key)).toEqual(['parent_status']);
  });
});

describe('evaluateStopConditions', () => {
  const windowOf = (statuses, ms = 50) => summarise(statuses.map((status) => ({ status, ms, ok: status < 500 })));

  it('is empty without a config or without breaches', () => {
    expect(evaluateStopConditions(windowOf([200, 200]), null, null)).toEqual([]);
    // With an RSS limit set, "no breach" needs a server sample to check
    // against; the case without one is the unknown-RSS breach below.
    expect(evaluateStopConditions(windowOf([200, 200]), { process: { rss_mb: 300 } }, { abortErrorRate: 0.2, abortP95Ms: 5000, abortRssMb: 900 })).toEqual([]);
    expect(evaluateStopConditions(windowOf([200, 200]), null, { abortErrorRate: 0.2, abortP95Ms: 5000 })).toEqual([]);
  });

  it('flags an error rate over the limit', () => {
    const w = windowOf([200, 500, 500, 500]); // 75% failed
    expect(evaluateStopConditions(w, null, { abortErrorRate: 0.2 })).toEqual(['error rate 75.0% > 20%']);
  });

  it('flags a p95 over the limit, measured over served requests', () => {
    const w = summarise([{ status: 200, ms: 6000 }, { status: 200, ms: 6000 }, { status: 200, ms: 100 }]);
    expect(evaluateStopConditions(w, null, { abortP95Ms: 5000 })).toEqual(['p95 6000ms > 5000ms']);
  });

  it('flags server RSS over the limit from the latest capacity sample', () => {
    const server = { process: { rss_mb: 950 } };
    expect(evaluateStopConditions(windowOf([200]), server, { abortRssMb: 900 })).toEqual(['server rss 950MB > 900MB']);
  });

  it('flags an RSS limit it cannot check: no sample is a breach, not a pass', () => {
    // This used to be "no sample → no claim → []". That made --abort-rss-mb
    // silently inert whenever capacity-sample was not being polled or its
    // last sample had gone stale — the limit the operator set never fired,
    // and the run looked as if it had stayed under it. A limit that cannot
    // be checked has not been passed.
    expect(evaluateStopConditions(windowOf([200]), null, { abortRssMb: 900 }))
      .toEqual(['server rss unknown (no capacity sample) while --abort-rss-mb 900 is set']);
    expect(evaluateStopConditions(windowOf([200]), { process: {} }, { abortRssMb: 900 }))
      .toEqual(['server rss unknown (no capacity sample) while --abort-rss-mb 900 is set']);
  });

  it('does not count an empty window as an error rate breach', () => {
    expect(evaluateStopConditions(summarise([]), null, { abortErrorRate: 0.01 })).toEqual([]);
  });
});

describe('checkUserLimit', () => {
  it('passes a plan within the limit and refuses one beyond it, naming the stage', () => {
    const plan = buildStages({ profile: 'ramp', users: '50,200,500,1000' });
    expect(checkUserLimit(plan, 1000)).toEqual({ ok: true });
    expect(checkUserLimit(plan, 0)).toEqual({ ok: true }); // 0 = no limit
    const refused = checkUserLimit(plan, 300);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/--max-users 300 refuses stage\(s\) ramp-500:500, ramp-1000:1000/);
  });
});

describe('the token file never reaches the report or stdout', () => {
  it('readTokenFile is not exported and the report records roles only (source level)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'load-test.js'), 'utf8');
    expect(src).toMatch(/token_roles: tokens \? Object\.keys\(tokens\)\.sort\(\)/);
    expect(src).not.toMatch(/JSON\.stringify\(tokens/);
    expect(src).not.toMatch(/readTokenFile,\n/);
  });

  it('a token file on disk can be read without printing it (smoke of the loader through main is out of scope here)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-test-tokens-'));
    const file = path.join(dir, 'tokens.json');
    fs.writeFileSync(file, JSON.stringify({ school: 'x', driver: '', admin: 'y' }));
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(Object.keys(raw)).toEqual(['school', 'driver', 'admin']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
