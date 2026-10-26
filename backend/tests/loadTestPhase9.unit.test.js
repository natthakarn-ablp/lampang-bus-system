'use strict';

/**
 * The parts of backend/scripts/load-test.js added for Phase 9 items 6 and 7
 * of the closure handoff (2026-09-05): the peak and soak profiles, the
 * server-side sample aggregation, the recovery verdict, and the report's
 * statement of what Phase 9 still needs. All pure, all testable without a
 * target — the same rule the rest of the harness follows.
 */

const {
  SOAK_MIN_SEC,
  THRESHOLDS,
  buildStages,
  aggregateServerSamples,
  evaluateRecovery,
  phase9Evidence,
} = require('../scripts/load-test');

describe('buildStages', () => {
  it('ramp: one stage per --users entry, in order, each --duration long', () => {
    expect(buildStages({ profile: 'ramp', users: '50,200,500,1000', durationSec: 60 })).toEqual([
      { label: 'ramp-50', users: 50, durationSec: 60 },
      { label: 'ramp-200', users: 200, durationSec: 60 },
      { label: 'ramp-500', users: 500, durationSec: 60 },
      { label: 'ramp-1000', users: 1000, durationSec: 60 },
    ]);
  });

  it('ramp: defaults to the plan\'s 50/200/500/1000', () => {
    expect(buildStages({ profile: 'ramp' }).map((s) => s.users)).toEqual([50, 200, 500, 1000]);
  });

  it('peak: baseline, burst at the largest --users value, then baseline again', () => {
    const plan = buildStages({ profile: 'peak', users: '200,1000', durationSec: 30, peakDurationSec: 90, baselineUsers: 40 });
    expect(plan).toEqual([
      { label: 'baseline', users: 40, durationSec: 30 },
      { label: 'peak', users: 1000, durationSec: 90 },
      { label: 'recovery', users: 40, durationSec: 30 },
    ]);
  });

  it('peak: the burst lasts --duration when --peak-duration is not given', () => {
    const plan = buildStages({ profile: 'peak', users: '500', durationSec: 45 });
    expect(plan[1]).toEqual({ label: 'peak', users: 500, durationSec: 45 });
  });

  it('soak: one stage, and refuses anything under 60 minutes', () => {
    expect(SOAK_MIN_SEC).toBe(3600);
    expect(buildStages({ profile: 'soak', users: '200', durationSec: 3600 })).toEqual([
      { label: 'soak', users: 200, durationSec: 3600, short_soak: false },
    ]);
    expect(() => buildStages({ profile: 'soak', users: '200', durationSec: 600 }))
      .toThrow(/soak requires --duration >= 3600/);
  });

  it('soak: a rehearsal is allowed only when asked for, and is marked as not a soak', () => {
    expect(buildStages({ profile: 'soak', users: '20', durationSec: 10, allowShortSoak: true })).toEqual([
      { label: 'soak', users: 20, durationSec: 10, short_soak: true },
    ]);
  });

  it('ignores junk in --users rather than producing a 0-user stage', () => {
    expect(buildStages({ profile: 'ramp', users: 'abc,0,-5,10' }).map((s) => s.users)).toEqual([10]);
  });
});

// One capacity-sample response, as the endpoint returns it.
function sample(t, over = {}) {
  return {
    status: 200,
    sample: {
      sampled_at: new Date(Date.UTC(2026, 8, 5, 0, 0, t)).toISOString(),
      db_pool: { limit: 10, in_use: 2, free: 8, queued: 0, utilisation: 0.2, ...(over.db_pool || {}) },
      db_server: { threads_connected: 5, threads_running: 2, slow_queries: 100, slow_query_log: 'ON', long_query_time_sec: 1, max_used_connections: 12, max_connections: 151, ...(over.db_server || {}) },
      process: { rss_mb: 120, heap_used_mb: 40, cpu_user_ms: 1000, cpu_system_ms: 200, ...(over.process || {}) },
      host: { cpu_count: 4, load_avg_1m: 0.5, mem_free_mb: 2000, mem_available_mb: 3000, swap_used_mb: 0, swap_note: null, ...(over.host || {}) },
      line_queue: { pending: 3, exhausted: 0, oldest_pending_age_sec: 12, ...(over.line_queue || {}) },
    },
  };
}

describe('aggregateServerSamples', () => {
  it('is null with no successful samples, so a missing section cannot read as "all fine"', () => {
    expect(aggregateServerSamples([])).toBeNull();
    expect(aggregateServerSamples([{ status: 401, sample: null }, { status: 0, sample: null }])).toBeNull();
  });

  it('turns cumulative counters into deltas and gauges into max / p95 / min', () => {
    const samples = [
      sample(0),
      sample(5, { db_pool: { in_use: 10, free: 0, queued: 7, utilisation: 1 }, db_server: { slow_queries: 103, threads_connected: 40 }, process: { rss_mb: 180, cpu_user_ms: 3000, cpu_system_ms: 600 }, host: { load_avg_1m: 3.2, mem_free_mb: 900, swap_used_mb: 64 }, line_queue: { pending: 25, exhausted: 2, oldest_pending_age_sec: 90 } }),
      sample(10, { db_pool: { in_use: 4, free: 6, queued: 0, utilisation: 0.4 }, db_server: { slow_queries: 104 }, process: { rss_mb: 150, cpu_user_ms: 4000, cpu_system_ms: 800 }, host: { mem_free_mb: 1500 }, line_queue: { pending: 8 } }),
      { status: 0, sample: null, error: 'AbortError' },
    ];
    const agg = aggregateServerSamples(samples);
    expect(agg.samples).toBe(3);
    expect(agg.failed_samples).toBe(1);
    expect(agg.span_sec).toBe(10);

    expect(agg.db_pool).toEqual({ limit: 10, utilisation_max: 1, utilisation_p95: 1, in_use_max: 10, queued_max: 7, saturated: true });
    expect(agg.db_server.slow_queries_delta).toBe(4);
    expect(agg.db_server.threads_connected_max).toBe(40);
    expect(agg.db_server.max_connections).toBe(151);

    // 4000+800 - (1000+200) = 3600 ms of CPU over a 10 000 ms span → 36% of one core, 9% of a 4-core host.
    expect(agg.process.cpu_pct_of_one_core).toBe(36);
    expect(agg.process.cpu_pct_of_host).toBe(9);
    expect(agg.process.rss_mb_max).toBe(180);

    expect(agg.host).toEqual({ cpu_count: 4, load_avg_1m_max: 3.2, mem_free_mb_min: 900, mem_available_mb_min: 3000, swap_used_mb_max: 64, swap_note: null });
    expect(agg.line_queue).toEqual({ pending_max: 25, pending_delta: 5, exhausted_max: 2, oldest_pending_age_sec_max: 90 });
  });

  it('reports "not saturated" only when nothing ever queued', () => {
    const agg = aggregateServerSamples([sample(0), sample(5)]);
    expect(agg.db_pool.saturated).toBe(false);
    expect(agg.db_pool.queued_max).toBe(0);
  });

  it('keeps nulls as nulls (a Windows host has no load average or swap figure)', () => {
    const agg = aggregateServerSamples([
      sample(0, { host: { load_avg_1m: null, swap_used_mb: null, mem_available_mb: null, swap_note: 'needs /proc/meminfo' } }),
      sample(5, { host: { load_avg_1m: null, swap_used_mb: null, mem_available_mb: null, swap_note: 'needs /proc/meminfo' } }),
    ]);
    expect(agg.host.load_avg_1m_max).toBeNull();
    expect(agg.host.swap_used_mb_max).toBeNull();
    expect(agg.host.mem_available_mb_min).toBeNull();
    expect(agg.host.swap_note).toBe('needs /proc/meminfo');
  });

  it('cannot compute a CPU rate from a single sample, and says null rather than 0', () => {
    const agg = aggregateServerSamples([sample(0)]);
    expect(agg.process.cpu_pct_of_one_core).toBeNull();
    expect(agg.db_server.slow_queries_delta).toBe(0);
  });
});

function stage(label, users, p95, { passed = true, errorRate = 0 } = {}) {
  return { label, users, duration_sec: 60, overall: { p95_ms: p95, error_rate: errorRate }, threshold_result: { passed, failures: passed ? [] : ['x'] }, scenarios_not_measured: [] };
}

describe('evaluateRecovery', () => {
  it('is null unless the run has baseline, peak and recovery stages', () => {
    expect(evaluateRecovery([stage('ramp-50', 50, 100)])).toBeNull();
    expect(evaluateRecovery([stage('baseline', 50, 100), stage('peak', 1000, 900)])).toBeNull();
  });

  it('recovers when the post-peak stage is within thresholds and near the pre-peak p95', () => {
    const r = evaluateRecovery([stage('baseline', 50, 100), stage('peak', 1000, 1800), stage('recovery', 50, 130)]);
    expect(r.recovered).toBe(true);
    expect(r.recovery_to_baseline_ratio).toBe(1.3);
    expect(r.peak_p95_ms).toBe(1800);
  });

  it('does not recover when the post-peak p95 stays high, even inside the thresholds', () => {
    // 100 → 400 ms is inside the 1 000 ms read limit and still 4× slower than
    // before the burst: a queue that did not drain, or a leak.
    const r = evaluateRecovery([stage('baseline', 50, 100), stage('peak', 1000, 1800), stage('recovery', 50, 400)]);
    expect(r.recovered).toBe(false);
    expect(r.recovery_to_baseline_ratio).toBe(4);
  });

  it('does not recover when the recovery stage fails a threshold, however close the ratio', () => {
    const r = evaluateRecovery([stage('baseline', 50, 100), stage('peak', 1000, 1800), stage('recovery', 50, 110, { passed: false, errorRate: 0.05 })]);
    expect(r.recovered).toBe(false);
    expect(r.recovery_within_thresholds).toBe(false);
    // The report has to say WHY, so "not recovered" can be told apart from
    // "a scenario was never measured" — the local run hit exactly that.
    expect(r.recovery_threshold_failures).toEqual(['x']);
  });

  it('carries an empty failure list when the recovery stage passed thresholds', () => {
    const r = evaluateRecovery([stage('baseline', 50, 100), stage('peak', 1000, 1800), stage('recovery', 50, 130)]);
    expect(r.recovery_threshold_failures).toEqual([]);
  });

  it('states its rule in the report', () => {
    const r = evaluateRecovery([stage('baseline', 50, 100), stage('peak', 1000, 1800), stage('recovery', 50, 130)]);
    expect(r.rule).toMatch(/1\.5/);
  });
});

describe('phase9Evidence', () => {
  it('a ramp to 1,000 with server metrics still needs peak and soak', () => {
    const ev = phase9Evidence({
      profile: 'ramp',
      stages: [stage('ramp-50', 50, 90), stage('ramp-1000', 1000, 800)],
      recovery: null,
      serverMetricsCollected: true,
    });
    expect(ev.ramp_reached_1000).toBe(true);
    expect(ev.server_metrics_collected).toBe(true);
    expect(ev.missing_for_phase9).toEqual([
      'peak profile (--profile peak)',
      'soak >= 60 minutes (--profile soak --duration 3600)',
    ]);
  });

  it('a ramp that stopped at 500 does not count as the 1,000 ramp', () => {
    const ev = phase9Evidence({ profile: 'ramp', stages: [stage('ramp-500', 500, 90)], recovery: null, serverMetricsCollected: false });
    expect(ev.ramp_reached_1000).toBe(false);
    expect(ev.missing_for_phase9[0]).toMatch(/ramp to 1,000/);
    expect(ev.missing_for_phase9).toContainEqual(expect.stringMatching(/server-side metrics/));
  });

  it('a peak run that did not recover says so instead of ticking the box', () => {
    const recovery = { recovered: false };
    const ev = phase9Evidence({ profile: 'peak', stages: [stage('baseline', 50, 100), stage('peak', 1000, 900), stage('recovery', 50, 500)], recovery, serverMetricsCollected: true });
    expect(ev.peak_run).toBe(true);
    expect(ev.peak_recovered).toBe(false);
    expect(ev.missing_for_phase9).toContainEqual(expect.stringMatching(/did not recover/));
  });

  it('a short soak rehearsal is not a soak', () => {
    const short = { ...stage('soak', 20, 50), duration_sec: 10 };
    const ev = phase9Evidence({ profile: 'soak', stages: [short], recovery: null, serverMetricsCollected: true });
    expect(ev.soak_minutes).toBe(0);
    expect(ev.soak_60min).toBe(false);
    expect(ev.missing_for_phase9).toContainEqual(expect.stringMatching(/soak >= 60/));
  });

  it('a real soak ticks the soak box and nothing else', () => {
    const soak = { ...stage('soak', 200, 50), duration_sec: 3600 };
    const ev = phase9Evidence({ profile: 'soak', stages: [soak], recovery: null, serverMetricsCollected: true });
    expect(ev.soak_60min).toBe(true);
    expect(ev.missing_for_phase9).toEqual([
      'ramp to 1,000 users (--profile ramp --users 50,200,500,1000)',
      'peak profile (--profile peak)',
    ]);
  });

  it('never returns an empty list for a single run — one run is one profile', () => {
    for (const profile of ['ramp', 'peak', 'soak']) {
      const stages = profile === 'peak'
        ? [stage('baseline', 50, 100), stage('peak', 1000, 900), stage('recovery', 50, 120)]
        : profile === 'soak' ? [{ ...stage('soak', 200, 50), duration_sec: 3600 }] : [stage('ramp-1000', 1000, 800)];
      const ev = phase9Evidence({ profile, stages, recovery: profile === 'peak' ? { recovered: true } : null, serverMetricsCollected: true });
      expect(ev.missing_for_phase9.length).toBeGreaterThan(0);
    }
  });
});

describe('the plan thresholds are untouched by the new profiles', () => {
  it('keeps error <1%, read p95 <=1s, write p95 <=2s', () => {
    expect(THRESHOLDS).toEqual({ error_rate_max: 0.01, read_p95_ms_max: 1000, write_p95_ms_max: 2000, duplicate_or_lost_writes: 0 });
  });
});
