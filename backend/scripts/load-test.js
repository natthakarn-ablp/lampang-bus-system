'use strict';

/**
 * Capacity workload for the closure plan's Phase 9.
 *
 * The plan requires proof before the system may claim it supports 1,000
 * concurrent users, and forbids write load against production. Until now there
 * was no suite at all, so the claim rested on nothing. This is that suite.
 *
 * Two rules are enforced in code rather than left to discipline:
 *
 *   1. It refuses to run against production. The target must be given
 *      explicitly and must not resolve to the production host, unless
 *      --read-only is set AND the profile is a smoke profile.
 *   2. Every scenario declares whether it writes. A write scenario cannot run
 *      against a target that was not explicitly marked as a sandbox.
 *
 * Percentiles are computed with the nearest-rank method over the full sample,
 * not over a reservoir or a per-window average: averaging percentiles across
 * windows understates the tail, which is the number that decides whether a
 * capacity claim is true.
 *
 * Usage:
 *   node scripts/load-test.js --target https://staging.example --sandbox \
 *     --profile ramp --users 50,200,500,1000 --duration 60
 *   node scripts/load-test.js --target http://127.0.0.1:3000 --read-only --profile smoke
 *   node scripts/load-test.js --dry-run     # validate scenarios + metrics only
 */

const fs = require('fs');
const path = require('path');
const { performance, monitorEventLoopDelay } = require('perf_hooks');

/** Hosts that must never receive generated load. */
const PRODUCTION_HOSTS = Object.freeze([
  'schoolbuslampang.com',
  'www.schoolbuslampang.com',
  'schoolbus.lp-pao.go.th',
]);

/**
 * Workload definitions.
 *
 * `weight` is the share of virtual users assigned to the scenario, chosen to
 * approximate the production audit mix (school-dominated: 8,814 of 9,844
 * actions over 90 days) rather than an even spread, because an even spread
 * would test a system nobody uses.
 */
const SCENARIOS = Object.freeze([
  {
    key: 'login',
    weight: 0.10,
    writes: true,
    method: 'POST',
    path: '/api/auth/login',
    body: (vu) => ({ username: vu.username, password: vu.password }),
    note: 'bcrypt cost 12 makes this the most CPU-expensive request in the system',
  },
  {
    key: 'school_dashboard',
    weight: 0.20,
    writes: false,
    method: 'GET',
    // status-today, not daily-status. school.routes.js:243 is the only
    // definition, every other role uses the same name, and so does the
    // frontend. CLAUDE.md 5.3 still says daily-status; the code is what runs.
    // Probed against local staging with a school token: daily-status 404,
    // status-today 200.
    path: '/api/school/status-today',
  },
  {
    key: 'school_students',
    weight: 0.15,
    writes: false,
    method: 'GET',
    path: '/api/school/students?page=1&per_page=20',
  },
  {
    key: 'school_checkin_override',
    weight: 0.15,
    writes: true,
    method: 'POST',
    path: '/api/school/checkin-override',
    body: (vu) => ({ student_id: vu.studentId, session: 'morning', reason: 'load test' }),
    note: 'Phase 1 rollout has schools confirming attendance, so this is the hot write path',
  },
  {
    key: 'reports_daily',
    weight: 0.10,
    writes: false,
    method: 'GET',
    path: (vu) => `/api/reports/daily?date=${vu.date}`,
    note: 'builds a full dataset in memory; has its own tighter limiter',
  },
  {
    key: 'driver_roster',
    weight: 0.10,
    writes: false,
    method: 'GET',
    path: '/api/driver/roster',
  },
  {
    key: 'driver_gps',
    weight: 0.10,
    writes: true,
    method: 'POST',
    path: '/api/driver/vehicle-location',
    body: (vu) => ({ lat: 18.29 + vu.jitter, lng: 99.49 + vu.jitter, accuracy_meters: 12 }),
    note: 'one upsert per ping, every ~15s per active vehicle',
  },
  {
    key: 'participation_event',
    weight: 0.05,
    writes: true,
    method: 'POST',
    path: (vu) => `/api/participation/cases/${vu.caseId}/events`,
    body: () => ({ event_type: 'COMMENTED', note: 'load test comment' }),
    note: 'append-only insert plus a projection update inside one transaction',
  },
  {
    key: 'parent_status',
    weight: 0.05,
    writes: false,
    method: 'GET',
    path: (vu) => `/api/parent/children/${vu.studentId}/status`,
    note: 'LIFF traffic; unauthenticated by JWT, verified by LINE id_token',
  },
]);

/** Initial pass/fail thresholds from the closure plan, Phase 9. */
const THRESHOLDS = Object.freeze({
  error_rate_max: 0.01,      // < 1%
  read_p95_ms_max: 1000,     // read p95 <= 1s
  write_p95_ms_max: 2000,    // write p95 <= 2s
  duplicate_or_lost_writes: 0,
});

// ─── Metrics ────────────────────────────────────────────────────────────────

/**
 * Nearest-rank percentile over the full sample.
 *
 * Deliberately not an approximation: a capacity claim turns on p95 and p99,
 * and the usual shortcuts (per-window averages, reservoir sampling) understate
 * exactly the tail being claimed. The sample is bounded by run length, which
 * is small enough to keep whole.
 */
function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  if (p <= 0) return sortedAsc[0];
  if (p >= 100) return sortedAsc[sortedAsc.length - 1];
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(rank, sortedAsc.length) - 1];
}

/**
 * Classify one response.
 *
 * The distinction that matters is not 2xx-vs-not. It is "the server did the
 * work this scenario is meant to measure" versus "the server answered without
 * doing it". A 404 is fast and cheap and would drag a p95 down while proving
 * nothing — which is exactly what happened while school_dashboard pointed at a
 * path that does not exist.
 *
 * @param {number} status  HTTP status, or 0 for a transport-level failure
 * @returns {'served'|'rate_limited'|'rejected'|'failed'}
 */
function classify(status) {
  if (status >= 200 && status < 400) return 'served';
  if (status === 429) return 'rate_limited';          // the limiter working
  if (status >= 400 && status < 500) return 'rejected'; // auth/scope/not-found
  return 'failed';                                     // 5xx, or never answered
}

function summarise(samples) {
  const served = samples.filter((s) => classify(s.status) === 'served');
  // Latency is reported over the requests that actually did the work. Mixing
  // in 401s and 404s reports the speed of the rejection, not of the feature.
  const durations = served.map((s) => s.ms).sort((a, b) => a - b);
  const total = samples.length;
  const counts = { served: 0, rate_limited: 0, rejected: 0, failed: 0 };
  for (const s of samples) counts[classify(s.status)] += 1;
  const statuses = {};
  for (const s of samples) statuses[s.status] = (statuses[s.status] || 0) + 1;
  return {
    requests: total,
    served: counts.served,
    rejected: counts.rejected,
    rate_limited: counts.rate_limited,
    errors: counts.failed,
    // Rejections are not server errors, so they stay out of the error budget —
    // but they are also not successes, so they cannot silence it either. A
    // scenario that was only ever rejected reports measured=false below.
    error_rate: total > 0 ? Math.round((counts.failed / total) * 100000) / 100000 : null,
    // The flag every threshold and every claim has to consult first.
    measured: counts.served > 0,
    status_counts: statuses,
    p50_ms: percentile(durations, 50),
    p95_ms: percentile(durations, 95),
    p99_ms: percentile(durations, 99),
    max_ms: durations.length ? durations[durations.length - 1] : null,
    // Throughput needs a wall-clock window, supplied by the caller.
  };
}

function evaluateThresholds(summaryByScenario) {
  const failures = [];
  for (const [key, s] of Object.entries(summaryByScenario)) {
    const scenario = SCENARIOS.find((x) => x.key === key);
    if (!scenario || s.requests === 0) continue;
    // Requests were sent and none of them was served. Whatever the p95 says,
    // this scenario was not measured, and silence here would read as a pass.
    if (!s.measured) {
      const seen = Object.keys(s.status_counts || {}).join('/') || 'unknown';
      failures.push(`${key}: NOT MEASURED — ${s.requests} requests, none served (status ${seen})`);
      continue;
    }
    if (s.error_rate > THRESHOLDS.error_rate_max) {
      failures.push(`${key}: error rate ${(s.error_rate * 100).toFixed(2)}% exceeds ${(THRESHOLDS.error_rate_max * 100).toFixed(0)}%`);
    }
    const limit = scenario.writes ? THRESHOLDS.write_p95_ms_max : THRESHOLDS.read_p95_ms_max;
    if (s.p95_ms != null && s.p95_ms > limit) {
      failures.push(`${key}: p95 ${s.p95_ms}ms exceeds ${limit}ms (${scenario.writes ? 'write' : 'read'})`);
    }
  }
  return { passed: failures.length === 0, failures };
}

// ─── Target safety ──────────────────────────────────────────────────────────

/**
 * @returns {{ok: true, host: string}|{ok: false, reason: string}}
 */
function checkTarget(rawTarget, { sandbox = false, readOnly = false, profile = 'ramp' } = {}) {
  if (!rawTarget) return { ok: false, reason: 'no_target: --target is required' };
  let url;
  try {
    url = new URL(rawTarget);
  } catch {
    return { ok: false, reason: 'invalid_target_url' };
  }
  const host = url.hostname.toLowerCase();
  const isProduction = PRODUCTION_HOSTS.includes(host);

  if (isProduction) {
    // A read-only smoke against production is the one thing the closure plan
    // permits; anything else is refused here rather than in a runbook.
    if (!readOnly) return { ok: false, reason: 'refusing_write_load_against_production' };
    if (profile !== 'smoke') return { ok: false, reason: 'production_allows_smoke_profile_only' };
    return { ok: true, host, productionSmoke: true };
  }
  if (!sandbox && !readOnly) {
    return { ok: false, reason: 'non_production_target_requires_--sandbox_or_--read-only' };
  }
  return { ok: true, host, productionSmoke: false };
}

/** Scenarios permitted for a given run. */
function selectScenarios({ readOnly, profile }) {
  let list = SCENARIOS;
  if (readOnly) list = list.filter((s) => !s.writes);
  if (profile === 'smoke') list = list.filter((s) => !s.writes).slice(0, 4);
  return list;
}

// ─── Runner ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { args[key] = next; i += 1; } else { args[key] = true; }
  }
  return args;
}

async function runStage({ target, scenarios, users, durationSec, headers }) {
  const samples = [];
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();
  const startedAt = performance.now();
  const deadline = startedAt + durationSec * 1000;

  // One async worker per virtual user, each looping until the deadline.
  const workers = Array.from({ length: users }, (_, i) => (async () => {
    const vu = {
      index: i,
      username: `loadtest_user_${i}`,
      password: 'loadtest-only',
      studentId: 1 + (i % 100),
      caseId: 1 + (i % 10),
      date: new Date().toISOString().slice(0, 10),
      jitter: (i % 100) / 10000,
    };
    while (performance.now() < deadline) {
      const scenario = scenarios[i % scenarios.length];
      const url = target + (typeof scenario.path === 'function' ? scenario.path(vu) : scenario.path);
      const init = {
        method: scenario.method,
        headers: { 'content-type': 'application/json', ...headers },
      };
      if (scenario.body) init.body = JSON.stringify(scenario.body(vu));

      const t0 = performance.now();
      let ok = false;
      let status = 0;
      try {
        const res = await fetch(url, init);
        status = res.status;
        // Kept for the raw sample only. Every aggregate goes through
        // classify(), which separates served / rejected / rate_limited /
        // failed rather than folding the middle two into "not an error".
        ok = res.status < 500 && res.status !== 429;
        await res.arrayBuffer();
      } catch {
        ok = false;
        status = 0;
      }
      samples.push({ scenario: scenario.key, ms: Math.round(performance.now() - t0), ok, status });
    }
  })());

  await Promise.all(workers);
  loopDelay.disable();

  const wallSec = (performance.now() - startedAt) / 1000;
  const byScenario = {};
  for (const s of scenarios) {
    byScenario[s.key] = summarise(samples.filter((x) => x.scenario === s.key));
  }
  const all = summarise(samples);

  return {
    users,
    duration_sec: Math.round(wallSec * 100) / 100,
    throughput_rps: Math.round((samples.length / wallSec) * 100) / 100,
    rate_limited: samples.filter((s) => s.status === 429).length,
    // Named here so a reader of the report does not have to open every
    // scenario to find out which parts of the mix never ran.
    scenarios_not_measured: scenarios
      .map((sc) => sc.key)
      .filter((k) => byScenario[k].requests > 0 && !byScenario[k].measured),
    overall: all,
    by_scenario: byScenario,
    event_loop_delay_ms: {
      p50: Math.round(loopDelay.percentile(50) / 1e6 * 100) / 100,
      p95: Math.round(loopDelay.percentile(95) / 1e6 * 100) / 100,
      p99: Math.round(loopDelay.percentile(99) / 1e6 * 100) / 100,
      max: Math.round(loopDelay.max / 1e6 * 100) / 100,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args['dry-run']) {
    // Validates the definitions and the metric maths without a server, so the
    // harness itself can be checked in CI where no target exists.
    const weight = SCENARIOS.reduce((sum, s) => sum + s.weight, 0);
    process.stdout.write(`[load] dry run: ${SCENARIOS.length} scenarios, weight sum=${weight.toFixed(2)}\n`);
    process.stdout.write(`[load] writes: ${SCENARIOS.filter((s) => s.writes).map((s) => s.key).join(', ')}\n`);
    process.stdout.write(`[load] thresholds: ${JSON.stringify(THRESHOLDS)}\n`);
    return;
  }

  const profile = args.profile || 'ramp';
  const readOnly = Boolean(args['read-only']);
  const sandbox = Boolean(args.sandbox);
  const check = checkTarget(args.target, { sandbox, readOnly, profile });
  if (!check.ok) {
    process.stderr.write(`[load] refusing to run: ${check.reason}\n`);
    process.exitCode = 2;
    return;
  }

  const stages = String(args.users || '50,200,500,1000').split(',').map((n) => parseInt(n, 10)).filter(Boolean);
  const durationSec = parseInt(args.duration, 10) || 60;
  const scenarios = selectScenarios({ readOnly, profile });
  const headers = args.token ? { authorization: `Bearer ${args.token}` } : {};

  process.stdout.write(`[load] target=${check.host} profile=${profile} read_only=${readOnly} scenarios=${scenarios.length}\n`);

  const results = [];
  for (const users of stages) {
    process.stdout.write(`[load] stage users=${users} duration=${durationSec}s\n`);
    const stage = await runStage({ target: args.target, scenarios, users, durationSec, headers });
    const verdict = evaluateThresholds(stage.by_scenario);
    results.push({ ...stage, threshold_result: verdict });
    process.stdout.write(
      `[load]   rps=${stage.throughput_rps} errors=${stage.overall.errors}/${stage.overall.requests} `
      + `p95=${stage.overall.p95_ms}ms p99=${stage.overall.p99_ms}ms loop_p99=${stage.event_loop_delay_ms.p99}ms `
      + `${verdict.passed ? 'within thresholds' : 'THRESHOLD FAILURES: ' + verdict.failures.join('; ')}\n`
    );
  }

  const report = {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    target_host: check.host,
    profile,
    read_only: readOnly,
    production_smoke: Boolean(check.productionSmoke),
    thresholds: THRESHOLDS,
    stages: results,
    // Stated rather than inferred: a run that never reached 1,000 users cannot
    // support a 1,000-user claim, however good its numbers look.
    max_users_reached: Math.max(...stages),
    supports_1000_user_claim: stages.includes(1000)
      && results.every((r) => r.threshold_result.passed)
      && results.every((r) => r.scenarios_not_measured.length === 0),
  };

  const outFile = args.out;
  if (outFile) {
    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    fs.writeFileSync(path.resolve(outFile), JSON.stringify(report, null, 2), 'utf8');
    process.stdout.write(`[load] wrote ${outFile}\n`);
  }
  if (!report.supports_1000_user_claim) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[load] failed: ${err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  SCENARIOS,
  THRESHOLDS,
  PRODUCTION_HOSTS,
  percentile,
  classify,
  summarise,
  evaluateThresholds,
  checkTarget,
  selectScenarios,
};
