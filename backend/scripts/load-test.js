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
 *   node scripts/load-test.js --target https://staging.example --sandbox \
 *     --profile peak --users 1000 --baseline-users 50 --duration 60 --peak-duration 120
 *   node scripts/load-test.js --target https://staging.example --sandbox \
 *     --profile soak --users 200 --duration 3600
 *   node scripts/load-test.js --target http://127.0.0.1:3000 --read-only --profile smoke
 *   node scripts/load-test.js --dry-run     # validate scenarios + metrics only
 *
 * Profiles (closure plan Phase 9: "รัน ramp 50/200/500/1,000, peak และ soak
 * อย่างน้อย 60 นาที"):
 *   ramp   one stage per --users entry, each --duration seconds
 *   peak   baseline → burst at max(--users) → back to baseline, and a
 *          recovery verdict: did p95 come back down after the burst?
 *   soak   one stage at --users for --duration, which must be >= 3600 s;
 *          --allow-short-soak permits a rehearsal that is marked as NOT a soak
 *   smoke  four read-only scenarios; the only profile allowed at production
 *
 * Role-token mix: every scenario declares the role it runs as. Pass
 *   --token-file <json>   {"school": "<jwt>", "driver": "<jwt>", "admin": "<jwt>", …}
 * and each scenario uses its own role's token; a scenario whose role has no
 * token is reported NOT MEASURED with the reason, never run with the wrong
 * one. --token <jwt> alone is the old single-token mode (school scenarios
 * measured, the rest 403/404 and NOT MEASURED — docs/performance/
 * load-test-local-2026-09-05.md §3). With a school token the harness reads
 * that school's own student ids once before the run so school_checkin_override
 * targets students the token may touch.
 *
 * Stop conditions and resource limits (plan Phase 9: "resource limits และ
 * stop conditions"): --abort-error-rate 0.2 --abort-p95-ms 5000
 * --abort-rss-mb 900 (server RSS via capacity-sample) --abort-consecutive 2
 * --watch-interval 10 end a stage early when the last window breaches a
 * limit that many times in a row. An abort cancels the requests still in
 * flight (counted in `cancelled_in_flight`, not sampled), the stage is
 * reported aborted with the reason, and the REMAINING STAGES ARE SKIPPED —
 * a larger stage after a safety abort is not a measurement, it is what the
 * abort was for. --abort-rss-mb needs an admin token (the RSS comes from
 * capacity-sample); without one the run is refused, and a stage whose latest
 * sample is missing or stale breaches rather than silently passing.
 * --request-timeout-ms 30000 bounds every request; a timeout is a failed
 * request (status 0) and is counted in `request_timeouts`. --max-users N
 * refuses a plan that exceeds N virtual users. These stop a runaway test;
 * they do not make a passing one.
 *
 * Measurement eligibility (MEASUREMENT_RULES): a scenario's p95 is reported
 * only over served requests, and a scenario with fewer than 30 served, or
 * with under half of its requests served (the rest rate-limited/rejected),
 * is UNDER-MEASURED — a threshold failure. These are heuristics about
 * whether the number means anything, not capacity criteria; the served,
 * rate_limited, rejected and failed populations are always reported apart.
 *
 * Claim scope: `supports_1000_user_claim` covers the JWT-authenticated
 * scenarios this harness can run. The LIFF parent scenario needs a LINE
 * id_token and is outside it by design, so the report also carries
 * `supports_full_system_1000_user_claim`, which stays false until every
 * scenario in the mix is measured.
 *
 * Server-side metrics (the same plan line: "DB pool/slow query, CPU/RAM/swap
 * … และ LINE queue"): pass --admin-token <admin JWT> and every stage polls
 * GET /api/admin/operations/capacity-sample every --sample-interval seconds
 * (default 5). Without it the report says so in `server_note` rather than
 * leaving the section out.
 *
 * One run is one profile. `phase9_evidence.missing_for_phase9` in the report
 * lists what the plan still needs beyond this run.
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
    role: null, // unauthenticated by design
    weight: 0.10,
    writes: true,
    method: 'POST',
    path: '/api/auth/login',
    body: (vu) => ({ username: vu.username, password: vu.password }),
    note: 'bcrypt cost 12 makes this the most CPU-expensive request in the system',
  },
  {
    key: 'school_dashboard',
    role: 'school',
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
    role: 'school',
    weight: 0.15,
    writes: false,
    method: 'GET',
    path: '/api/school/students?page=1&per_page=20',
  },
  {
    key: 'school_checkin_override',
    role: 'school',
    weight: 0.15,
    writes: true,
    method: 'POST',
    path: '/api/school/checkin-override',
    body: (vu) => ({ student_id: vu.studentId, session: 'morning', reason: 'load test' }),
    note: 'Phase 1 rollout has schools confirming attendance, so this is the hot write path',
  },
  {
    key: 'reports_daily',
    role: 'school',
    weight: 0.10,
    writes: false,
    method: 'GET',
    path: (vu) => `/api/reports/daily?date=${vu.date}`,
    note: 'builds a full dataset in memory; has its own tighter limiter',
  },
  {
    key: 'driver_roster',
    role: 'driver',
    weight: 0.10,
    writes: false,
    method: 'GET',
    path: '/api/driver/roster',
  },
  {
    key: 'driver_gps',
    role: 'driver',
    weight: 0.10,
    writes: true,
    method: 'POST',
    path: '/api/driver/vehicle-location',
    // driver.routes.js reads latitude/longitude; lat/lng was rejected with 400
    // on every request in the 2026-09-05 rehearsal.
    body: (vu) => ({ latitude: 18.29 + vu.jitter, longitude: 99.49 + vu.jitter, accuracy_meters: 12 }),
    note: 'one upsert per ping, every ~15s per active vehicle',
  },
  {
    key: 'participation_event',
    role: 'school',
    weight: 0.05,
    writes: true,
    method: 'POST',
    path: (vu) => `/api/participation/cases/${vu.caseId}/events`,
    body: () => ({ event_type: 'COMMENTED', note: 'load test comment' }),
    note: 'append-only insert plus a projection update inside one transaction',
  },
  {
    key: 'parent_status',
    role: 'parent', // LINE id_token, not a JWT — no token file entry can satisfy it
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

/**
 * When a scenario's numbers are allowed to mean anything. Separate from
 * THRESHOLDS (the plan's acceptance numbers): these decide whether a p95 was
 * measured at all, not whether it is good enough. A scenario served 20 times
 * and rate-limited 3,565 times has a p95 of the 20, which says nothing about
 * the scenario under load. Heuristics, not capacity criteria.
 */
const MEASUREMENT_RULES = Object.freeze({
  min_served: 30,          // fewer served requests than this: no p95 is claimed
  served_ratio_min: 0.5,   // under half served: the p95 covers a minority
});

/** Phase 9 asks for a soak of at least this long; a shorter run is not a soak. */
const SOAK_MIN_SEC = 60 * 60;

/**
 * Stage plan per profile. `ramp` and `smoke` are what existed; `peak` and
 * `soak` are the two the plan names that had no implementation. Pure, so the
 * plan a report was built from can be tested without a target.
 *
 * @returns {Array<{label:string, users:number, durationSec:number}>}
 */
function buildStages({
  profile = 'ramp', users, durationSec = 60, peakDurationSec, baselineUsers = 50, allowShortSoak = false,
} = {}) {
  const list = (Array.isArray(users) ? users : String(users || '').split(','))
    .map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n > 0);

  if (profile === 'peak') {
    const peakUsers = list.length ? Math.max(...list) : 1000;
    return [
      { label: 'baseline', users: baselineUsers, durationSec },
      { label: 'peak', users: peakUsers, durationSec: peakDurationSec || durationSec },
      { label: 'recovery', users: baselineUsers, durationSec },
    ];
  }
  if (profile === 'soak') {
    const soakUsers = list.length ? list[0] : 200;
    const sec = durationSec || SOAK_MIN_SEC;
    if (sec < SOAK_MIN_SEC && !allowShortSoak) {
      throw new Error(
        `soak requires --duration >= ${SOAK_MIN_SEC} (60 minutes); got ${sec}. `
        + 'Pass --allow-short-soak for a rehearsal — the report will say it is not a soak.'
      );
    }
    return [{ label: 'soak', users: soakUsers, durationSec: sec, short_soak: sec < SOAK_MIN_SEC }];
  }
  const stageUsers = list.length ? list : [50, 200, 500, 1000];
  return stageUsers.map((u) => ({ label: `${profile}-${u}`, users: u, durationSec }));
}

/**
 * Refuse a plan that exceeds the resource limit. Separate from buildStages so
 * the plan itself is still testable; the limit is a run-time decision.
 */
function checkUserLimit(plan, maxUsers) {
  if (!maxUsers) return { ok: true };
  const over = plan.filter((x) => x.users > maxUsers).map((x) => `${x.label}:${x.users}`);
  return over.length ? { ok: false, reason: `--max-users ${maxUsers} refuses stage(s) ${over.join(', ')}` } : { ok: true };
}

/**
 * Role → JWT. The file is read here and never echoed: the report records
 * which roles had a token, not the tokens.
 */
function readTokenFile(file) {
  const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const out = {};
  for (const [role, token] of Object.entries(raw)) {
    if (typeof token === 'string' && token.length > 0) out[role] = token;
  }
  return out;
}

/** The token a scenario runs with, or null (→ NOT MEASURED, reason reported). */
function tokenForScenario(scenario, tokens, fallback) {
  if (scenario.role === null) return null;          // unauthenticated scenario
  if (scenario.role === 'parent') return null;       // LIFF id_token, never a JWT
  if (tokens && tokens[scenario.role]) return tokens[scenario.role];
  return fallback || null;
}

/**
 * Which scenarios can run with the tokens at hand. Those without a usable
 * token are listed with the reason so the report says why, up front.
 */
function partitionByToken(scenarios, tokens, fallback) {
  const runnable = [];
  const unmeasurable = [];
  for (const sc of scenarios) {
    if (sc.role === null) { runnable.push(sc); continue; }
    // `blocking`: whether this gap stops the JWT-scoped claim. A missing role
    // token is a gap the operator can close; the LIFF parent scenario cannot
    // be run by this harness at all, so it is a caveat on the JWT-scoped
    // claim and a blocker on the full-system one.
    if (sc.role === 'parent') { unmeasurable.push({ key: sc.key, reason: 'parent_status needs a LINE id_token (LIFF), not a JWT', blocking: false }); continue; }
    if (tokenForScenario(sc, tokens, fallback)) runnable.push(sc);
    else unmeasurable.push({ key: sc.key, reason: `no token for role '${sc.role}' (pass --token-file)`, blocking: true });
  }
  return { runnable, unmeasurable };
}

/**
 * Stop-condition check over one watch window. Pure. `window` is a
 * summarise() of the samples taken during the window; `server` is the last
 * capacity sample (or null). Returns the breached conditions.
 */
function evaluateStopConditions(window, server, cfg) {
  const breaches = [];
  if (!cfg) return breaches;
  if (cfg.abortErrorRate != null && window && window.requests > 0 && window.error_rate > cfg.abortErrorRate) {
    breaches.push(`error rate ${(window.error_rate * 100).toFixed(1)}% > ${(cfg.abortErrorRate * 100).toFixed(0)}%`);
  }
  if (cfg.abortP95Ms != null && window && window.p95_ms != null && window.p95_ms > cfg.abortP95Ms) {
    breaches.push(`p95 ${window.p95_ms}ms > ${cfg.abortP95Ms}ms`);
  }
  const rss = server && server.process && typeof server.process.rss_mb === 'number' ? server.process.rss_mb : null;
  if (cfg.abortRssMb != null) {
    // A limit that cannot be checked has not been passed. Without a sample
    // (no admin token, capacity-sample failing, or the last one stale) the
    // RSS limit used to be silently inert; now it breaches.
    if (rss == null) breaches.push(`server rss unknown (no capacity sample) while --abort-rss-mb ${cfg.abortRssMb} is set`);
    else if (rss > cfg.abortRssMb) breaches.push(`server rss ${rss}MB > ${cfg.abortRssMb}MB`);
  }
  return breaches;
}

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
    // Share of requests the server actually served; the rest were
    // rate-limited, rejected or failed. Null, not 0, when nothing was sent.
    served_ratio: total > 0 ? Math.round((counts.served / total) * 10000) / 10000 : null,
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

function evaluateThresholds(summaryByScenario, stage = null) {
  const failures = [];
  if (stage && stage.aborted) failures.push(`stage aborted by stop condition at ${stage.aborted.at_sec}s: ${stage.aborted.reason}`);
  // A scenario that was in the mix but sent nothing (the stage was too short
  // or was cut off before its first slot) is absent, not passed.
  for (const key of (stage && stage.scenarios_absent) || []) {
    failures.push(`${key}: ABSENT — in the mix but sent 0 requests in this stage`);
  }
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
    // Served, but too few or too small a share for the p95 to describe the
    // scenario. A hand-built summary without `served` counts as 0 served.
    const served = typeof s.served === 'number' ? s.served : 0;
    const ratio = typeof s.served_ratio === 'number' ? s.served_ratio : (s.requests > 0 ? served / s.requests : null);
    if (served < MEASUREMENT_RULES.min_served) {
      failures.push(`${key}: UNDER-MEASURED — ${served} served of ${s.requests} (need >= ${MEASUREMENT_RULES.min_served} served for a p95 to mean anything)`);
      continue;
    }
    if (ratio != null && ratio < MEASUREMENT_RULES.served_ratio_min) {
      failures.push(`${key}: UNDER-MEASURED — ${(ratio * 100).toFixed(1)}% served (rate_limited ${s.rate_limited || 0}, rejected ${s.rejected || 0} of ${s.requests}); the p95 covers the served minority only`);
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

// ─── Server-side samples ────────────────────────────────────────────────────

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const present = (vals) => vals.filter((v) => v != null);
const maxOf = (vals) => (present(vals).length ? Math.max(...present(vals)) : null);
const minOf = (vals) => (present(vals).length ? Math.min(...present(vals)) : null);
const p95Of = (vals) => percentile(present(vals).sort((a, b) => a - b), 95);
const delta = (a, b) => (num(a) != null && num(b) != null ? b - a : null);

/**
 * Collapse the capacity samples taken during one stage into the numbers the
 * report carries. Cumulative counters (slow_queries, cpu_*_ms) become deltas
 * first-to-last; gauges become max / p95 / min. Pure, for the same reason as
 * summarise(): the report's numbers must be testable without a server.
 */
function aggregateServerSamples(samples) {
  const ok = (samples || []).filter((x) => x && x.sample);
  if (!ok.length) return null;
  const first = ok[0].sample;
  const last = ok[ok.length - 1].sample;
  const pool = ok.map((x) => x.sample.db_pool || {});
  const db = ok.map((x) => x.sample.db_server || {});
  const proc = ok.map((x) => x.sample.process || {});
  const host = ok.map((x) => x.sample.host || {});
  const lq = ok.map((x) => x.sample.line_queue || {});

  const cpuMs = (sm) => (num(sm.process && sm.process.cpu_user_ms) || 0) + (num(sm.process && sm.process.cpu_system_ms) || 0);
  const cpuDeltaMs = cpuMs(last) - cpuMs(first);
  const cores = num(last.host && last.host.cpu_count) || 1;
  const spanMs = ok.length > 1 ? Date.parse(last.sampled_at) - Date.parse(first.sampled_at) : 0;
  const queuedMax = maxOf(pool.map((x) => num(x.queued)));

  return {
    samples: ok.length,
    failed_samples: (samples || []).length - ok.length,
    span_sec: Math.round(spanMs / 100) / 10,
    db_pool: {
      limit: num(last.db_pool && last.db_pool.limit),
      utilisation_max: maxOf(pool.map((x) => num(x.utilisation))),
      utilisation_p95: p95Of(pool.map((x) => num(x.utilisation))),
      in_use_max: maxOf(pool.map((x) => num(x.in_use))),
      queued_max: queuedMax,
      // The plan's question in one flag: did requests wait for a connection?
      saturated: (queuedMax || 0) > 0,
    },
    db_server: {
      threads_connected_max: maxOf(db.map((x) => num(x.threads_connected))),
      threads_running_max: maxOf(db.map((x) => num(x.threads_running))),
      slow_queries_delta: delta(first.db_server && first.db_server.slow_queries, last.db_server && last.db_server.slow_queries),
      slow_query_log: (last.db_server && last.db_server.slow_query_log) || null,
      long_query_time_sec: num(last.db_server && last.db_server.long_query_time_sec),
      max_used_connections: num(last.db_server && last.db_server.max_used_connections),
      max_connections: num(last.db_server && last.db_server.max_connections),
    },
    process: {
      rss_mb_max: maxOf(proc.map((x) => num(x.rss_mb))),
      heap_used_mb_max: maxOf(proc.map((x) => num(x.heap_used_mb))),
      // CPU time the backend process used across the sampled span, as a share
      // of one core. It can exceed 100: GC and libuv threads run alongside the
      // event loop, so the process is more than one thread.
      cpu_pct_of_one_core: spanMs > 0 ? Math.round((cpuDeltaMs / spanMs) * 1000) / 10 : null,
      cpu_pct_of_host: spanMs > 0 ? Math.round((cpuDeltaMs / (spanMs * cores)) * 1000) / 10 : null,
    },
    host: {
      cpu_count: cores,
      load_avg_1m_max: maxOf(host.map((x) => num(x.load_avg_1m))),
      mem_free_mb_min: minOf(host.map((x) => num(x.mem_free_mb))),
      mem_available_mb_min: minOf(host.map((x) => num(x.mem_available_mb))),
      swap_used_mb_max: maxOf(host.map((x) => num(x.swap_used_mb))),
      swap_note: (last.host && last.host.swap_note) || null,
    },
    line_queue: {
      pending_max: maxOf(lq.map((x) => num(x.pending))),
      pending_delta: delta(first.line_queue && first.line_queue.pending, last.line_queue && last.line_queue.pending),
      exhausted_max: maxOf(lq.map((x) => num(x.exhausted))),
      oldest_pending_age_sec_max: maxOf(lq.map((x) => num(x.oldest_pending_age_sec))),
    },
  };
}

async function fetchSample(target, adminToken) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    const res = await fetch(`${target}/api/admin/operations/capacity-sample`, {
      headers: { authorization: `Bearer ${adminToken}` },
      signal: ctl.signal,
    });
    if (res.status !== 200) { await res.arrayBuffer(); return { status: res.status, sample: null }; }
    const body = await res.json();
    return { status: 200, sample: body.data || null };
  } catch (err) {
    return { status: 0, sample: null, error: err.name };
  } finally {
    clearTimeout(timer);
  }
}

/** Polls capacity-sample until stop() is called; stop() resolves to the samples. */
function startSampler({ target, adminToken, intervalSec }) {
  const samples = [];
  let stopped = false;
  // A sample older than this is not "the latest": a stop condition reading
  // it would judge the server as it was, not as it is. Three intervals, and
  // never under 30 s.
  const staleAfterMs = Math.max(3 * intervalSec, 30) * 1000;
  const loop = (async () => {
    while (!stopped) {
      samples.push({ ...(await fetchSample(target, adminToken)), at: Date.now() });
      const t0 = Date.now();
      while (!stopped && Date.now() - t0 < intervalSec * 1000) await new Promise((r) => setTimeout(r, 100));
    }
  })();
  return {
    /** The most recent successful sample, or null when there is none or it is stale. */
    latest: (now = Date.now()) => {
      for (let i = samples.length - 1; i >= 0; i -= 1) {
        if (!samples[i].sample) continue;
        return now - samples[i].at <= staleAfterMs ? samples[i].sample : null;
      }
      return null;
    },
    stale_after_ms: staleAfterMs,
    stop: async () => {
      stopped = true;
      await loop;
      // One last sample so the deltas cover the end of the stage.
      samples.push({ ...(await fetchSample(target, adminToken)), at: Date.now() });
      return samples;
    },
  };
}

/**
 * "ฟื้นหลัง peak ได้" (plan Phase 9 acceptance line). After the burst, the
 * recovery stage — same load as the baseline stage that preceded the burst —
 * must be within thresholds AND not materially slower than that baseline. A
 * system that stays slow after the burst has a queue that never drained, or a
 * leak; either way it has not recovered, whatever the peak numbers were.
 */
function evaluateRecovery(stages) {
  const baseline = (stages || []).find((x) => x.label === 'baseline');
  const peak = (stages || []).find((x) => x.label === 'peak');
  const recovery = (stages || []).find((x) => x.label === 'recovery');
  if (!baseline || !peak || !recovery) return null;
  const b = num(baseline.overall && baseline.overall.p95_ms);
  const r = num(recovery.overall && recovery.overall.p95_ms);
  const ratio = b != null && b > 0 && r != null ? Math.round((r / b) * 100) / 100 : null;
  const withinThresholds = recovery.threshold_result ? Boolean(recovery.threshold_result.passed) : false;
  return {
    baseline_p95_ms: b,
    peak_p95_ms: num(peak.overall && peak.overall.p95_ms),
    recovery_p95_ms: r,
    recovery_to_baseline_ratio: ratio,
    recovery_error_rate: num(recovery.overall && recovery.overall.error_rate),
    recovery_within_thresholds: withinThresholds,
    // Why a recovery stage failed thresholds, so "not recovered" can be told
    // apart from "not measured": a scenario that only ever got 403 fails the
    // stage without saying anything about how the system recovered.
    recovery_threshold_failures: recovery.threshold_result ? recovery.threshold_result.failures : [],
    // The 1.5× is a starting rule, not a measured one; say so in the report.
    recovered: withinThresholds && ratio != null && ratio <= 1.5,
    rule: 'recovery stage within thresholds AND recovery p95 <= 1.5 × baseline p95',
  };
}

/**
 * What this run contributes to Phase 9, and what the plan still needs. One
 * run is one profile, so `missing_for_phase9` is never empty for a single
 * report — it tells the person assembling the evidence which runs to add.
 */
function phase9Evidence({ profile, stages, recovery, serverMetricsCollected }) {
  const maxUsers = stages.length ? Math.max(...stages.map((x) => x.users)) : 0;
  const soak = stages.find((x) => x.label === 'soak');
  const soakMinutes = soak ? Math.round(soak.duration_sec / 60) : 0;
  const ev = {
    ramp_reached_1000: profile === 'ramp' && maxUsers >= 1000,
    peak_run: profile === 'peak',
    peak_recovered: recovery ? recovery.recovered : null,
    soak_minutes: soakMinutes,
    soak_60min: soakMinutes >= SOAK_MIN_SEC / 60,
    server_metrics_collected: Boolean(serverMetricsCollected),
  };
  const missing = [];
  if (!ev.ramp_reached_1000) missing.push('ramp to 1,000 users (--profile ramp --users 50,200,500,1000)');
  if (!ev.peak_run) missing.push('peak profile (--profile peak)');
  else if (!ev.peak_recovered) missing.push('recovery after peak (this peak run did not recover)');
  if (!ev.soak_60min) missing.push('soak >= 60 minutes (--profile soak --duration 3600)');
  if (!ev.server_metrics_collected) missing.push('server-side metrics (--admin-token so capacity-sample is polled)');
  return {
    ...ev,
    missing_for_phase9: missing,
    note: 'Phase 9 needs ramp, peak and soak, each with server metrics. One run provides one profile; combine reports.',
  };
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

/**
 * Largest-remainder apportionment of the runnable scenarios' weights into
 * `size` slots. Weights are re-normalised over the subset (a read-only run
 * drops the writers; a token-less role drops its scenarios), every scenario
 * with weight > 0 gets at least one slot, and the slots are interleaved so a
 * short stage still reaches every scenario early. Virtual user i takes slot
 * (i + n) for its n-th request, so the declared mix holds across users and
 * across time. The runner used to pick `scenarios[i % length]`, which ignored
 * the weights entirely and gave every scenario the same share.
 *
 * @returns {number[]} scenario indices, length `size` (or the number of
 *   positive-weight scenarios when that is larger)
 */
function buildSchedule(scenarios, size = 100) {
  const positive = (scenarios || [])
    .map((s, i) => ({ i, w: Number(s.weight) > 0 ? Number(s.weight) : 0 }))
    .filter((x) => x.w > 0);
  if (!positive.length || !(size > 0)) return [];
  const total = positive.reduce((a, x) => a + x.w, 0);
  const n = Math.max(Math.floor(size), positive.length);
  const quotas = positive.map((x) => ({ i: x.i, exact: (x.w / total) * n }));
  const counts = quotas.map((q) => Math.max(1, Math.floor(q.exact)));
  let assigned = counts.reduce((a, c) => a + c, 0);
  const byRemainder = quotas
    .map((q, k) => ({ k, frac: q.exact - Math.floor(q.exact) }))
    .sort((a, b) => b.frac - a.frac || a.k - b.k);
  for (let idx = 0; assigned < n; idx += 1) { counts[byRemainder[idx % byRemainder.length].k] += 1; assigned += 1; }
  // Many tiny weights can overshoot through the guaranteed slot; take the
  // excess back from the largest, never below one.
  while (assigned > n) {
    const k = counts.indexOf(Math.max(...counts));
    if (counts[k] <= 1) break;
    counts[k] -= 1; assigned -= 1;
  }
  const schedule = [];
  const cursors = counts.map(() => 0);
  for (let slot = 0; slot < assigned; slot += 1) {
    let best = -1;
    let bestProgress = Infinity;
    for (let k = 0; k < counts.length; k += 1) {
      if (cursors[k] >= counts[k]) continue;
      const progress = cursors[k] / counts[k];
      if (progress < bestProgress) { bestProgress = progress; best = k; }
    }
    schedule.push(quotas[best].i);
    cursors[best] += 1;
  }
  return schedule;
}

/** Slots per scenario key in a schedule, for the dry run and the report. */
function scheduleCounts(scenarios, schedule) {
  const counts = {};
  for (const idx of schedule) counts[scenarios[idx].key] = (counts[scenarios[idx].key] || 0) + 1;
  return counts;
}

async function runStage({
  target, scenarios, users, durationSec, headers = {}, adminToken = null, sampleIntervalSec = 5,
  tokens = null, fallbackToken = null, studentIds = null, caseIds = null, stop = null,
  requestTimeoutMs = 30000, scheduleSize = 100, log = null,
}) {
  const say = log || ((line) => process.stdout.write(`${line}\n`));
  const samples = [];
  const sampler = adminToken ? startSampler({ target, adminToken, intervalSec: sampleIntervalSec }) : null;
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();
  const startedAt = performance.now();
  let deadline = startedAt + durationSec * 1000;
  let aborted = null;
  let cancelledInFlight = 0;
  let requestTimeouts = 0;
  const schedule = buildSchedule(scenarios, scheduleSize);
  // One controller for the stage. An abort cancels every request in flight
  // and the workers check it before starting another; the old watchdog only
  // moved the deadline, so a request that had already been sent ran on.
  const stageCtl = new AbortController();

  let watchdog = null;
  if (stop && (stop.abortErrorRate != null || stop.abortP95Ms != null || stop.abortRssMb != null)) {
    let consecutive = 0;
    let windowStart = 0;
    const need = stop.abortConsecutive || 2;
    watchdog = setInterval(() => {
      const windowSamples = samples.slice(windowStart);
      windowStart = samples.length;
      const breaches = evaluateStopConditions(summarise(windowSamples), sampler ? sampler.latest() : null, stop);
      consecutive = breaches.length ? consecutive + 1 : 0;
      if (breaches.length) say(`[load]   watchdog: ${breaches.join('; ')} (${consecutive}/${need})`);
      if (consecutive >= need && !aborted) {
        aborted = { at_sec: Math.round((performance.now() - startedAt) / 100) / 10, reason: breaches.join('; ') };
        deadline = performance.now();
        stageCtl.abort();
        say(`[load]   ABORTING stage: ${aborted.reason} — cancelling requests in flight`);
      }
    }, (stop.watchIntervalSec || 10) * 1000);
  }

  // One async worker per virtual user, each looping until the deadline or
  // the stage abort.
  const workers = Array.from({ length: users }, (_, i) => (async () => {
    const vu = {
      index: i,
      username: `loadtest_user_${i}`,
      password: 'loadtest-only',
      // Ids come from discovery against the target's own scope. No fallback:
      // a scenario that needs an id the run could not discover is dropped by
      // main() before the stage, never pointed at an invented one.
      studentId: studentIds && studentIds.length ? studentIds[i % studentIds.length] : null,
      caseId: caseIds && caseIds.length ? caseIds[i % caseIds.length] : null,
      date: new Date().toISOString().slice(0, 10),
      jitter: (i % 100) / 10000,
    };
    let n = 0;
    while (schedule.length && performance.now() < deadline && !stageCtl.signal.aborted) {
      const scenario = scenarios[schedule[(i + n) % schedule.length]];
      n += 1;
      const url = target + (typeof scenario.path === 'function' ? scenario.path(vu) : scenario.path);
      const bearer = tokenForScenario(scenario, tokens, fallbackToken);
      const init = {
        method: scenario.method,
        headers: { 'content-type': 'application/json', ...headers, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      };
      if (scenario.body) init.body = JSON.stringify(scenario.body(vu));

      // Per request: its own controller, aborted by the request deadline OR
      // by the stage signal. Which one fired decides how it is counted.
      const ctl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, requestTimeoutMs);
      const onStageAbort = () => ctl.abort();
      stageCtl.signal.addEventListener('abort', onStageAbort, { once: true });
      init.signal = ctl.signal;

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
      } finally {
        clearTimeout(timer);
        stageCtl.signal.removeEventListener('abort', onStageAbort);
      }
      if (status === 0 && !timedOut && stageCtl.signal.aborted) {
        // Cut off by the stage abort: not a server failure, not a sample.
        cancelledInFlight += 1;
        break;
      }
      if (status === 0 && timedOut) requestTimeouts += 1;
      samples.push({ scenario: scenario.key, ms: Math.round(performance.now() - t0), ok, status });
    }
  })());

  await Promise.all(workers);
  loopDelay.disable();
  if (watchdog) clearInterval(watchdog);
  const serverSamples = sampler ? await sampler.stop() : null;

  const wallSec = (performance.now() - startedAt) / 1000;
  const byScenario = {};
  for (const s of scenarios) {
    byScenario[s.key] = summarise(samples.filter((x) => x.scenario === s.key));
  }
  const all = summarise(samples);

  return {
    users,
    aborted,
    duration_sec: Math.round(wallSec * 100) / 100,
    throughput_rps: wallSec > 0 ? Math.round((samples.length / wallSec) * 100) / 100 : 0,
    rate_limited: samples.filter((s) => s.status === 429).length,
    // Requests cut off by a stage abort (not sampled) and requests that hit
    // --request-timeout-ms (sampled as status 0, i.e. failed).
    cancelled_in_flight: cancelledInFlight,
    request_timeouts: requestTimeouts,
    request_timeout_ms: requestTimeoutMs,
    schedule_counts: scheduleCounts(scenarios, schedule),
    // Named here so a reader of the report does not have to open every
    // scenario to find out which parts of the mix never ran or never served.
    scenarios_not_measured: scenarios
      .map((sc) => sc.key)
      .filter((k) => byScenario[k].requests > 0 && !byScenario[k].measured),
    scenarios_absent: scenarios.map((sc) => sc.key).filter((k) => byScenario[k].requests === 0),
    overall: all,
    by_scenario: byScenario,
    event_loop_delay_ms: {
      p50: Math.round(loopDelay.percentile(50) / 1e6 * 100) / 100,
      p95: Math.round(loopDelay.percentile(95) / 1e6 * 100) / 100,
      p99: Math.round(loopDelay.percentile(99) / 1e6 * 100) / 100,
      max: Math.round(loopDelay.max / 1e6 * 100) / 100,
    },
    // Server-side numbers from capacity-sample, or an explicit statement that
    // they were not collected — never a silently absent section.
    server: serverSamples ? aggregateServerSamples(serverSamples) : null,
    server_note: serverSamples
      ? (serverSamples.some((x) => x.sample) ? null : `capacity-sample never answered 200 (statuses: ${[...new Set(serverSamples.map((x) => x.status))].join('/')}); is --admin-token an admin JWT?`)
      : 'no --admin-token; server-side metrics (DB pool, slow queries, CPU/RAM/swap, LINE queue) not collected',
  };
}

/**
 * Runs the stages in order and STOPS after a stage the stop conditions
 * aborted: the stages after it are skipped and named in `stopped`. The old
 * loop went on to the next, larger stage after a safety abort. `runStageFn`
 * receives the plan entry and returns a runStage() result; it is a
 * parameter so the progression can be tested without a target.
 *
 * @returns {{results: object[], stopped: null|{after_stage: string, reason: string, skipped_stages: string[]}}}
 */
async function runPlan(plan, runStageFn, log = null) {
  const say = log || ((line) => process.stdout.write(`${line}\n`));
  const results = [];
  let stopped = null;
  for (let i = 0; i < plan.length; i += 1) {
    const st = plan[i];
    say(`[load] stage ${st.label} users=${st.users} duration=${st.durationSec}s`);
    const stage = await runStageFn(st, i);
    const verdict = evaluateThresholds(stage.by_scenario || {}, stage);
    results.push({ label: st.label, ...stage, threshold_result: verdict });
    say(`[load]   ${verdict.passed ? 'within thresholds' : `THRESHOLD FAILURES: ${verdict.failures.join('; ')}`}`);
    if (stage.aborted) {
      const skipped = plan.slice(i + 1).map((x) => x.label);
      stopped = { after_stage: st.label, reason: stage.aborted.reason, skipped_stages: skipped };
      say(`[load] stage ${st.label} was aborted (${stage.aborted.reason}); skipping ${skipped.length ? skipped.join(', ') : 'nothing — it was the last stage'}`);
      break;
    }
  }
  return { results, stopped };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args['dry-run']) {
    // Validates the definitions and the metric maths without a server, so the
    // harness itself can be checked in CI where no target exists. A dry run
    // sends nothing and proves nothing about capacity.
    const weight = SCENARIOS.reduce((sum, s) => sum + s.weight, 0);
    const counts = scheduleCounts(SCENARIOS, buildSchedule(SCENARIOS, 100));
    process.stdout.write(`[load] dry run: ${SCENARIOS.length} scenarios, weight sum=${weight.toFixed(2)} — no requests sent; a dry run is not a load test\n`);
    process.stdout.write(`[load] schedule (slots per 100 requests, full mix): ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}\n`);
    process.stdout.write(`[load] writes: ${SCENARIOS.filter((s) => s.writes).map((s) => s.key).join(', ')}\n`);
    process.stdout.write(`[load] thresholds: ${JSON.stringify(THRESHOLDS)} measurement: ${JSON.stringify(MEASUREMENT_RULES)}\n`);
    process.stdout.write(`[load] profiles: ramp, peak, soak (>= ${SOAK_MIN_SEC}s), smoke\n`);
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

  let plan;
  try {
    plan = buildStages({
      profile,
      users: args.users,
      durationSec: parseInt(args.duration, 10) || (profile === 'soak' ? SOAK_MIN_SEC : 60),
      peakDurationSec: parseInt(args['peak-duration'], 10) || undefined,
      baselineUsers: parseInt(args['baseline-users'], 10) || 50,
      allowShortSoak: Boolean(args['allow-short-soak']),
    });
  } catch (err) {
    process.stderr.write(`[load] refusing to run: ${err.message}\n`);
    process.exitCode = 2;
    return;
  }
  const limit = checkUserLimit(plan, parseInt(args['max-users'], 10) || 0);
  if (!limit.ok) {
    process.stderr.write(`[load] refusing to run: ${limit.reason}\n`);
    process.exitCode = 2;
    return;
  }
  const tokens = args['token-file'] ? readTokenFile(args['token-file']) : null;
  const fallbackToken = args.token || null;
  const selected = selectScenarios({ readOnly, profile });
  const { runnable: scenarios, unmeasurable } = partitionByToken(selected, tokens, fallbackToken);
  const headers = {};
  const adminToken = args['admin-token'] || (tokens && tokens.admin) || null;
  const sampleIntervalSec = parseInt(args['sample-interval'], 10) || 5;
  const requestTimeoutMs = parseInt(args['request-timeout-ms'], 10) || 30000;
  const stop = {
    abortErrorRate: args['abort-error-rate'] != null ? parseFloat(args['abort-error-rate']) : null,
    abortP95Ms: args['abort-p95-ms'] != null ? parseInt(args['abort-p95-ms'], 10) : null,
    abortRssMb: args['abort-rss-mb'] != null ? parseInt(args['abort-rss-mb'], 10) : null,
    abortConsecutive: parseInt(args['abort-consecutive'], 10) || 2,
    watchIntervalSec: parseInt(args['watch-interval'], 10) || 10,
  };
  if (stop.abortRssMb != null && !adminToken) {
    // The RSS comes from capacity-sample, which needs an admin JWT. Without
    // it the limit could never fire, and a limit that cannot fire is not a
    // limit — refuse rather than pretend.
    process.stderr.write('[load] refusing to run: --abort-rss-mb needs the server RSS from capacity-sample, which needs an admin token (--admin-token or "admin" in --token-file); without one the limit could never fire\n');
    process.exitCode = 2;
    return;
  }
  for (const u of unmeasurable) process.stdout.write(`[load] not measurable this run: ${u.key} — ${u.reason}${u.blocking ? '' : ' (outside this harness by design)'}\n`);
  if (!scenarios.length) {
    process.stderr.write('[load] refusing to run: no scenario has a usable token\n');
    process.exitCode = 2;
    return;
  }

  // A scenario whose ids could not be discovered in the token's own scope is
  // dropped and reported, never pointed at ids made up by the harness: an
  // invented id is another school's student or a case that does not exist,
  // and both measure a rejection, not the feature.
  const dropScenario = (key, reason) => {
    const k = scenarios.findIndex((sc) => sc.key === key);
    if (k === -1) return;
    scenarios.splice(k, 1);
    unmeasurable.push({ key, reason, blocking: true });
    process.stdout.write(`[load] not measurable this run: ${key} — ${reason}\n`);
  };
  const discover = async (url, token, pick) => {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(requestTimeoutMs) });
    if (res.status !== 200) { await res.arrayBuffer(); return { status: res.status, ids: [] }; }
    const body = await res.json();
    const rows = (body && body.data && (body.data.items || body.data.cases || body.data.students || body.data)) || [];
    return { status: res.status, ids: Array.isArray(rows) ? pick(rows) : [] };
  };
  const schoolToken = tokens && tokens.school ? tokens.school : (fallbackToken || null);

  // Open participation cases the school token may append to, read once.
  let caseIds = null;
  if (scenarios.some((sc) => sc.key === 'participation_event')) {
    if (!schoolToken) dropScenario('participation_event', 'no school token to discover open case ids with');
    else {
      try {
        const found = await discover(`${args.target}/api/participation/cases?per_page=50`, schoolToken,
          (rows) => rows.filter((r) => !['CLOSED', 'WITHDRAWN'].includes(r.status)).map((r) => r.id).filter((id) => Number.isFinite(Number(id))));
        if (found.status !== 200) dropScenario('participation_event', `case list answered HTTP ${found.status} — no case ids to target`);
        else if (!found.ids.length) dropScenario('participation_event', 'the school token can see no open participation case — nothing to append to');
        else { caseIds = found.ids; process.stdout.write(`[load] participation cases for event scenario: ${caseIds.length} open case ids (HTTP ${found.status})\n`); }
      } catch (err) {
        dropScenario('participation_event', `could not list participation cases (${err.message})`);
      }
    }
  }

  // School-scoped student ids for the override scenario, read once.
  let studentIds = null;
  if (scenarios.some((sc) => sc.key === 'school_checkin_override')) {
    if (!schoolToken) dropScenario('school_checkin_override', 'no school token to discover student ids with');
    else {
      try {
        const found = await discover(`${args.target}/api/school/students?per_page=100`, schoolToken,
          (rows) => rows.map((r) => r.id).filter((id) => Number.isFinite(Number(id))));
        if (found.status !== 200) dropScenario('school_checkin_override', `school roster answered HTTP ${found.status} — no student ids to target`);
        else if (!found.ids.length) dropScenario('school_checkin_override', 'the school token can see no student — nothing to confirm');
        else { studentIds = found.ids; process.stdout.write(`[load] school roster for override scenario: ${studentIds.length} student ids (HTTP ${found.status})\n`); }
      } catch (err) {
        dropScenario('school_checkin_override', `could not read the school roster (${err.message})`);
      }
    }
  }
  if (!scenarios.length) {
    process.stderr.write('[load] refusing to run: every scenario was dropped (see the reasons above)\n');
    process.exitCode = 2;
    return;
  }

  process.stdout.write(
    `[load] target=${check.host} profile=${profile} read_only=${readOnly} scenarios=${scenarios.length} `
    + `mix=${Object.entries(scheduleCounts(scenarios, buildSchedule(scenarios, 100))).map(([k, v]) => `${k}:${v}%`).join(',')} `
    + `stages=${plan.map((x) => `${x.label}:${x.users}x${x.durationSec}s`).join(',')} `
    + `request_timeout=${requestTimeoutMs}ms `
    + `server_metrics=${adminToken ? `every ${sampleIntervalSec}s` : 'off (no --admin-token)'} `
    + `tokens=${tokens ? Object.keys(tokens).sort().join('+') : (fallbackToken ? 'single' : 'none')} `
    + `stop=${stop.abortErrorRate != null || stop.abortP95Ms != null || stop.abortRssMb != null ? JSON.stringify({ err: stop.abortErrorRate, p95: stop.abortP95Ms, rss: stop.abortRssMb, n: stop.abortConsecutive, every: stop.watchIntervalSec }) : 'off'}\n`
  );

  const { results, stopped } = await runPlan(plan, async (st) => {
    const stage = await runStage({
      target: args.target, scenarios, users: st.users, durationSec: st.durationSec, headers, adminToken, sampleIntervalSec,
      tokens, fallbackToken, studentIds, caseIds, stop, requestTimeoutMs,
    });
    const srv = stage.server;
    process.stdout.write(
      `[load]   rps=${stage.throughput_rps} errors=${stage.overall.errors}/${stage.overall.requests} served=${stage.overall.served} rate_limited=${stage.overall.rate_limited} rejected=${stage.overall.rejected} `
      + `timeouts=${stage.request_timeouts} cancelled=${stage.cancelled_in_flight} `
      + `p95=${stage.overall.p95_ms}ms p99=${stage.overall.p99_ms}ms loop_p99=${stage.event_loop_delay_ms.p99}ms `
      + (srv
        ? `pool_util_max=${srv.db_pool.utilisation_max} pool_queued_max=${srv.db_pool.queued_max} slow_q=${srv.db_server.slow_queries_delta} `
          + `cpu%=${srv.process.cpu_pct_of_one_core} rss_max=${srv.process.rss_mb_max}MB swap_used_max=${srv.host.swap_used_mb_max} line_pending_max=${srv.line_queue.pending_max}`
        : '')
      + '\n'
    );
    if (stage.server_note) process.stdout.write(`[load]   note: ${stage.server_note}\n`);
    return stage;
  });

  const recovery = profile === 'peak' ? evaluateRecovery(results) : null;
  if (recovery) {
    process.stdout.write(
      `[load] recovery: baseline p95=${recovery.baseline_p95_ms}ms peak p95=${recovery.peak_p95_ms}ms `
      + `recovery p95=${recovery.recovery_p95_ms}ms ratio=${recovery.recovery_to_baseline_ratio} → ${recovery.recovered ? 'RECOVERED' : 'NOT RECOVERED'}\n`
    );
    if (!recovery.recovered && recovery.recovery_threshold_failures.length) {
      process.stdout.write(`[load]   recovery stage threshold failures: ${recovery.recovery_threshold_failures.join('; ')}\n`);
    }
  }
  const serverMetricsCollected = results.length > 0 && results.every((r) => r.server && r.server.samples > 0);
  const evidence = phase9Evidence({ profile, stages: results, recovery, serverMetricsCollected });
  const stageUsers = plan.map((x) => x.users);

  // The verdict, and every reason it is what it is. `supports_1000_user_claim`
  // is scoped to the scenarios this harness can run with JWTs; the
  // full-system claim additionally needs every scenario in the mix measured,
  // which the LIFF parent scenario makes impossible here by design.
  const blockingGaps = unmeasurable.filter((u) => u.blocking);
  const caveats = unmeasurable.filter((u) => !u.blocking);
  const claimBlockers = [];
  if (!stageUsers.includes(1000)) claimBlockers.push(`no 1,000-user stage in the plan (max ${Math.max(...stageUsers)})`);
  if (stopped) claimBlockers.push(`stopped by stop condition after ${stopped.after_stage}: ${stopped.reason}; skipped ${stopped.skipped_stages.join(', ') || 'none'}`);
  if (results.length !== plan.length) claimBlockers.push(`${results.length} of ${plan.length} stages ran`);
  for (const r of results) {
    if (!r.threshold_result.passed) claimBlockers.push(`${r.label}: ${r.threshold_result.failures.join('; ')}`);
    if (r.scenarios_not_measured.length) claimBlockers.push(`${r.label}: not measured: ${r.scenarios_not_measured.join(', ')}`);
    if (r.scenarios_absent && r.scenarios_absent.length) claimBlockers.push(`${r.label}: absent: ${r.scenarios_absent.join(', ')}`);
  }
  for (const u of blockingGaps) claimBlockers.push(`${u.key}: ${u.reason}`);
  if (recovery && !recovery.recovered) claimBlockers.push('peak run did not recover');
  const jwtClaim = claimBlockers.length === 0;

  const report = {
    schema_version: '1.2',
    generated_at: new Date().toISOString(),
    target_host: check.host,
    profile,
    stage_plan: plan,
    read_only: readOnly,
    production_smoke: Boolean(check.productionSmoke),
    thresholds: THRESHOLDS,
    measurement_rules: MEASUREMENT_RULES,
    request_timeout_ms: requestTimeoutMs,
    // Which roles ran with their own token, and what could not be measured
    // before a single request was sent. Tokens themselves are never written.
    token_roles: tokens ? Object.keys(tokens).sort() : (fallbackToken ? ['(single --token)'] : []),
    not_measurable: unmeasurable,
    stop_conditions: stop,
    stopped_by_stop_condition: stopped,
    max_users_limit: parseInt(args['max-users'], 10) || null,
    stages: results,
    recovery,
    // What this run adds to Phase 9 and what the plan still needs beyond it.
    phase9_evidence: evidence,
    max_users_reached: results.length ? Math.max(...results.map((r) => r.users)) : 0,
    // Stated rather than inferred, and scoped: this is the per-run verdict
    // over the JWT scenarios only. The plan's full claim also needs the peak
    // and soak runs in phase9_evidence.missing_for_phase9, and full-system
    // capacity stays unsupported until every scenario is measured.
    claim_scope: 'jwt_roles_only',
    supports_1000_user_claim: jwtClaim,
    claim_blockers: claimBlockers,
    claim_caveats: caveats,
    supports_full_system_1000_user_claim: jwtClaim && unmeasurable.length === 0,
    full_system_claim_blockers: unmeasurable.map((u) => `${u.key}: ${u.reason}`),
  };
  if (evidence.missing_for_phase9.length) {
    process.stdout.write(`[load] still needed for Phase 9: ${evidence.missing_for_phase9.join(' | ')}\n`);
  }
  process.stdout.write(`[load] verdict (JWT scenarios only): supports_1000_user_claim=${jwtClaim}${claimBlockers.length ? ` — ${claimBlockers.join(' | ')}` : ''}\n`);
  process.stdout.write(`[load] full-system claim: ${report.supports_full_system_1000_user_claim}${report.full_system_claim_blockers.length ? ` — ${report.full_system_claim_blockers.join(' | ')}` : ''}\n`);

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
  MEASUREMENT_RULES,
  PRODUCTION_HOSTS,
  SOAK_MIN_SEC,
  percentile,
  classify,
  summarise,
  evaluateThresholds,
  checkTarget,
  selectScenarios,
  buildStages,
  checkUserLimit,
  tokenForScenario,
  partitionByToken,
  evaluateStopConditions,
  aggregateServerSamples,
  evaluateRecovery,
  phase9Evidence,
  buildSchedule,
  scheduleCounts,
  runStage,
  runPlan,
  startSampler,
};
