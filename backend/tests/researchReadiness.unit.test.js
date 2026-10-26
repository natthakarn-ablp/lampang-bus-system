'use strict';

/**
 * The readiness service is what stands between "the system is busy" and "the
 * metric can be evaluated". These tests pin the boundary in both directions:
 * evidence that exists must be recognised, and evidence that does not must
 * never be inferred from usage volume.
 */

const svc = require('../src/services/researchReadiness.service');
const {
  METRICS,
  EVIDENCE_STATUS,
  SNAPSHOT_FRESHNESS_MAX_AGE_DAYS,
  MIN_BASELINE_POST_GAP_DAYS,
  getMetric,
} = require('../src/config/researchMetrics');
const { RESEARCH_PROTOCOL, EXTERNAL_EVIDENCE_REGISTRY } = require('../src/config/researchProtocol');

const REF = new Date('2026-09-04T00:00:00Z');

function daysBefore(n) {
  return new Date(REF.getTime() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Every audit event any metric can ask for, all present. */
const ALL_EVENTS = [...new Set(METRICS.flatMap((m) => m.required_events || []))]
  .reduce((acc, e) => { acc[e] = 5; return acc; }, {});

const FROZEN_PROTOCOL = {
  frozen: true,
  version: '1.0',
  baseline_start: '2026-01-01',
  post_end: '2026-12-31',
  population_defined: true,
  research_lead_signed_off: true,
};

describe('snapshot freshness', () => {
  it('reports no snapshot when none exists', () => {
    const f = svc.evaluateSnapshotFreshness(null, REF);
    expect(f.has_snapshot).toBe(false);
    expect(f.fresh).toBe(false);
    expect(f.reason).toBe('no_snapshot');
  });

  it('accepts a snapshot inside the freshness window', () => {
    const f = svc.evaluateSnapshotFreshness(daysBefore(SNAPSHOT_FRESHNESS_MAX_AGE_DAYS - 1), REF);
    expect(f.fresh).toBe(true);
    expect(f.reason).toBeNull();
  });

  it('accepts a snapshot exactly at the boundary', () => {
    const f = svc.evaluateSnapshotFreshness(daysBefore(SNAPSHOT_FRESHNESS_MAX_AGE_DAYS), REF);
    expect(f.age_days).toBe(SNAPSHOT_FRESHNESS_MAX_AGE_DAYS);
    expect(f.fresh).toBe(true);
  });

  it('rejects a stale snapshot but still reports its age', () => {
    const f = svc.evaluateSnapshotFreshness(daysBefore(SNAPSHOT_FRESHNESS_MAX_AGE_DAYS + 1), REF);
    expect(f.fresh).toBe(false);
    expect(f.reason).toBe('snapshot_stale');
    expect(f.age_days).toBe(SNAPSHOT_FRESHNESS_MAX_AGE_DAYS + 1);
  });

  it('flags the real production gap: snapshots stopped 2026-06-20', () => {
    const f = svc.evaluateSnapshotFreshness('2026-06-20', REF);
    expect(f.has_snapshot).toBe(true);
    expect(f.fresh).toBe(false);
    expect(f.age_days).toBeGreaterThan(SNAPSHOT_FRESHNESS_MAX_AGE_DAYS);
  });
});

describe('baseline/post pairing', () => {
  const base = { protocol: FROZEN_PROTOCOL };

  it('needs both a baseline and a post snapshot', () => {
    expect(svc.evaluateBaselinePair({ ...base, baselineSnapshotDate: null, latestSnapshotDate: '2026-09-01' }).reason)
      .toBe('no_baseline_snapshot');
    expect(svc.evaluateBaselinePair({ ...base, baselineSnapshotDate: '2026-01-01', latestSnapshotDate: null }).reason)
      .toBe('no_post_snapshot');
  });

  it('rejects an observation period shorter than the minimum', () => {
    const r = svc.evaluateBaselinePair({
      ...base,
      baselineSnapshotDate: '2026-06-01',
      latestSnapshotDate: '2026-06-10',
    });
    expect(r.usable).toBe(false);
    expect(r.reason).toBe('observation_period_too_short');
    expect(r.gap_days).toBe(9);
    expect(r.min_gap_days).toBe(MIN_BASELINE_POST_GAP_DAYS);
  });

  it('refuses to pair at all while the protocol is not frozen', () => {
    const r = svc.evaluateBaselinePair({
      protocol: { frozen: false },
      baselineSnapshotDate: '2026-01-01',
      latestSnapshotDate: '2026-06-01',
    });
    expect(r.usable).toBe(false);
    expect(r.reason).toBe('research_protocol_not_frozen');
  });

  it('rejects snapshots that fall outside the protocol window', () => {
    expect(svc.evaluateBaselinePair({
      ...base, baselineSnapshotDate: '2025-06-01', latestSnapshotDate: '2026-06-01',
    }).reason).toBe('baseline_outside_protocol_window');
    expect(svc.evaluateBaselinePair({
      ...base, baselineSnapshotDate: '2026-01-05', latestSnapshotDate: '2027-06-01',
    }).reason).toBe('post_outside_protocol_window');
  });

  it('accepts a pair that satisfies every condition', () => {
    const r = svc.evaluateBaselinePair({
      ...base, baselineSnapshotDate: '2026-02-01', latestSnapshotDate: '2026-06-01',
    });
    expect(r.usable).toBe(true);
    expect(r.reason).toBeNull();
  });
});

describe('per-metric evidence', () => {
  const freshCtx = {
    snapshotFreshness: svc.evaluateSnapshotFreshness(daysBefore(1), REF),
    baselinePair: { usable: true, reason: null, gap_days: 120 },
    auditEventCounts: ALL_EVENTS,
    auditEventLatestDate: {},
    externalEvidence: {},
    protocol: FROZEN_PROTOCOL,
  };

  it('marks a snapshot-only metric as having system evidence when fresh', () => {
    const m = getMetric('school.data_completeness_rate');
    const r = svc.evaluateMetric(m, freshCtx);
    expect(r.status).toBe(EVIDENCE_STATUS.SYSTEM_EVIDENCE);
    expect(r.status_label_th).toBe('มีหลักฐานระบบเบื้องต้น');
    expect(r.blocking_reasons).toEqual([]);
  });

  it('never labels any metric "พร้อมประเมิน"', () => {
    for (const m of METRICS) {
      const r = svc.evaluateMetric(m, freshCtx);
      expect(r.status_label_th).not.toBe('พร้อมประเมิน');
      // Full system evidence is still not permission to publish a finding.
      expect(r.research_claim_allowed).toBe(false);
    }
  });

  it('degrades a snapshot-backed metric when the snapshot is stale', () => {
    const staleCtx = {
      ...freshCtx,
      snapshotFreshness: svc.evaluateSnapshotFreshness('2026-06-20', REF),
    };
    const r = svc.evaluateMetric(getMetric('school.data_completeness_rate'), staleCtx);
    expect(r.status).toBe(EVIDENCE_STATUS.MISSING);
    expect(r.blocking_reasons).toContain('snapshot_stale');
  });

  it('names the audit events a metric is still missing', () => {
    const noEvents = { ...freshCtx, auditEventCounts: {} };
    const r = svc.evaluateMetric(getMetric('province.dashboard_usage_before_decision'), noEvents);
    expect(r.status).toBe(EVIDENCE_STATUS.MISSING);
    expect(r.blocking_reasons.join()).toContain('missing_audit_events:');
    expect(r.blocking_reasons.join()).toContain('decision_log');
  });

  it('reports partial evidence when some but not all requirements are met', () => {
    // Requires system_snapshot AND audit_event; give it only the snapshot.
    const partialCtx = { ...freshCtx, auditEventCounts: {} };
    const r = svc.evaluateMetric(getMetric('admin.data_health_score'), partialCtx);
    expect(r.status).toBe(EVIDENCE_STATUS.PARTIAL);
  });

  it('will not count external evidence that has no instrument version', () => {
    const m = getMetric('driver.ux_satisfaction_elderly');
    const unversioned = {
      ...freshCtx,
      externalEvidence: { [m.key]: { collected: true, collected_at: '2026-08-01' } },
    };
    expect(svc.evaluateMetric(m, unversioned).blocking_reasons).toContain('external_evidence_unversioned');

    const versioned = {
      ...freshCtx,
      externalEvidence: { [m.key]: { collected: true, instrument_version: 'DME-6 v1.0', collected_at: '2026-08-01' } },
    };
    const ok = svc.evaluateMetric(m, versioned);
    expect(ok.status).toBe(EVIDENCE_STATUS.SYSTEM_EVIDENCE);
    expect(ok.latest_evidence_date).toBe('2026-08-01');
  });
});

describe('role coverage', () => {
  it('does not use action volume to decide status', () => {
    const noEvidence = {
      latestSnapshotDate: null,
      baselineSnapshotDate: null,
      auditEventCounts: {},
      externalEvidence: {},
      protocol: { frozen: false },
      // The exact shape that used to award "พร้อมประเมิน": huge action counts.
      roleActionTotals: { school: 8814, admin: 325, province: 101 },
      referenceDate: REF,
    };
    const out = svc.buildEvidenceReadiness(noEvidence);
    for (const role of Object.values(out.roles)) {
      expect(role.status).toBe(EVIDENCE_STATUS.MISSING);
      expect(role.coverage_pct).toBe(0);
    }
    expect(out.roles.school.action_total).toBe(8814);
  });

  it('reports coverage as a share of that role metrics with full evidence', () => {
    const ctx = {
      latestSnapshotDate: daysBefore(1),
      baselineSnapshotDate: '2026-02-01',
      auditEventCounts: {},
      externalEvidence: {},
      protocol: { frozen: false },
      roleActionTotals: {},
      referenceDate: REF,
    };
    const out = svc.buildEvidenceReadiness(ctx);
    // school: 3 snapshot-only metrics have evidence, work_burden_reduction does not.
    expect(out.roles.school.system_evidence).toBe(3);
    expect(out.roles.school.metric_total).toBe(4);
    expect(out.roles.school.coverage_pct).toBe(75);
    expect(out.roles.school.status).toBe(EVIDENCE_STATUS.PARTIAL);
  });
});

describe('overall evidence readiness', () => {
  const emptyCtx = {
    latestSnapshotDate: null,
    baselineSnapshotDate: null,
    auditEventCounts: {},
    externalEvidence: {},
    protocol: { frozen: false },
    roleActionTotals: {},
    referenceDate: REF,
  };

  it('returns a structure, not a single boolean', () => {
    const out = svc.buildEvidenceReadiness(emptyCtx);
    expect(out).toHaveProperty('metrics');
    expect(out).toHaveProperty('summary');
    expect(out).toHaveProperty('roles');
    expect(out.metrics).toHaveLength(24);
    expect(out).not.toHaveProperty('dme_mie_ready');
  });

  it('refuses research claims and says why', () => {
    const out = svc.buildEvidenceReadiness(emptyCtx);
    expect(out.research_claims_allowed).toBe(false);
    expect(out.blocking_reasons).toContain('research_protocol_not_frozen');
    expect(out.blocking_reasons).toContain('research_lead_signoff_missing');
    expect(out.blocking_reasons).toContain('metrics_without_evidence');
  });

  it('still refuses research claims when every metric has system evidence but the protocol is unfrozen', () => {
    const out = svc.buildEvidenceReadiness({
      latestSnapshotDate: daysBefore(1),
      baselineSnapshotDate: '2026-02-01',
      auditEventCounts: ALL_EVENTS,
      externalEvidence: Object.fromEntries(
        METRICS.map((m) => [m.key, { collected: true, instrument_version: 'v1', collected_at: '2026-08-01' }])
      ),
      protocol: { frozen: false },
      roleActionTotals: {},
      referenceDate: REF,
    });
    expect(out.research_claims_allowed).toBe(false);
    expect(out.blocking_reasons).toContain('research_protocol_not_frozen');
  });

  it('summarises by status and by category without mixing them', () => {
    const out = svc.buildEvidenceReadiness(emptyCtx);
    const total = Object.values(out.summary.by_status).reduce((a, b) => a + b, 0);
    expect(total).toBe(24);
    const catTotal = Object.values(out.summary.by_category).reduce((a, c) => a + c.total, 0);
    expect(catTotal).toBe(24);
    expect(Object.keys(out.summary.by_category).sort()).toEqual(
      ['external_evidence', 'operational_kpi', 'participation_kpi', 'research_outcome']
    );
  });
});

describe('shipped research protocol defaults', () => {
  it('does not claim a frozen protocol or a Research lead signature', () => {
    // Flipping either of these without a signed document is the failure mode
    // this test exists to prevent.
    expect(RESEARCH_PROTOCOL.frozen).toBe(false);
    expect(RESEARCH_PROTOCOL.research_lead_signed_off).toBe(false);
    expect(RESEARCH_PROTOCOL.population_defined).toBe(false);
  });

  it('ships an empty external evidence registry', () => {
    expect(Object.keys(EXTERNAL_EVIDENCE_REGISTRY)).toHaveLength(0);
  });
});
