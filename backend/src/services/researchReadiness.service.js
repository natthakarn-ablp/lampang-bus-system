'use strict';

/**
 * Derives evidence readiness per research metric from data that actually
 * exists, replacing two claims the system could not back up:
 *
 *   1. `dme_mie_ready: true` — a constant in the research export.
 *   2. "พร้อมประเมิน" — awarded to a role at 20 raw audit actions.
 *
 * Everything here is a pure function over a context object so it can be unit
 * tested without a database. The route builds the context from queries; this
 * module decides what the context is allowed to claim.
 */

const {
  METRICS,
  METRIC_CATEGORIES,
  EVIDENCE_REQUIREMENTS,
  EVIDENCE_STATUS,
  EVIDENCE_STATUS_LABEL_TH,
  SNAPSHOT_FRESHNESS_MAX_AGE_DAYS,
  MIN_BASELINE_POST_GAP_DAYS,
} = require('../config/researchMetrics');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(a, b) {
  const da = toDate(a);
  const db = toDate(b);
  if (!da || !db) return null;
  return Math.floor((db.getTime() - da.getTime()) / MS_PER_DAY);
}

/**
 * Snapshot freshness. A snapshot that predates the reference date by more than
 * SNAPSHOT_FRESHNESS_MAX_AGE_DAYS still exists — it just cannot be presented as
 * describing the current period, so callers get `fresh: false` plus the age.
 */
function evaluateSnapshotFreshness(latestSnapshotDate, referenceDate = new Date()) {
  const snap = toDate(latestSnapshotDate);
  if (!snap) {
    return {
      has_snapshot: false,
      fresh: false,
      latest_snapshot_date: null,
      age_days: null,
      max_age_days: SNAPSHOT_FRESHNESS_MAX_AGE_DAYS,
      reason: 'no_snapshot',
    };
  }
  const age = daysBetween(snap, referenceDate);
  const fresh = age !== null && age <= SNAPSHOT_FRESHNESS_MAX_AGE_DAYS;
  return {
    has_snapshot: true,
    fresh,
    latest_snapshot_date: snap.toISOString().slice(0, 10),
    age_days: age,
    max_age_days: SNAPSHOT_FRESHNESS_MAX_AGE_DAYS,
    reason: fresh ? null : 'snapshot_stale',
  };
}

/**
 * A baseline/post pair is only usable when both snapshots exist, the post
 * snapshot is at least MIN_BASELINE_POST_GAP_DAYS after the baseline, and both
 * fall inside the frozen protocol window. Without a frozen protocol there is no
 * window to check against, so the pair is reported as unusable for research —
 * the numbers may still be shown as operational description.
 */
function evaluateBaselinePair(ctx) {
  const baseline = toDate(ctx.baselineSnapshotDate);
  const post = toDate(ctx.latestSnapshotDate);
  const protocol = ctx.protocol || {};

  if (!baseline || !post) {
    return { usable: false, reason: !baseline ? 'no_baseline_snapshot' : 'no_post_snapshot', gap_days: null };
  }
  const gap = daysBetween(baseline, post);
  if (gap === null || gap < MIN_BASELINE_POST_GAP_DAYS) {
    return { usable: false, reason: 'observation_period_too_short', gap_days: gap, min_gap_days: MIN_BASELINE_POST_GAP_DAYS };
  }
  if (!protocol.frozen) {
    return { usable: false, reason: 'research_protocol_not_frozen', gap_days: gap };
  }
  const start = toDate(protocol.baseline_start);
  const end = toDate(protocol.post_end);
  if (start && baseline < start) {
    return { usable: false, reason: 'baseline_outside_protocol_window', gap_days: gap };
  }
  if (end && post > end) {
    return { usable: false, reason: 'post_outside_protocol_window', gap_days: gap };
  }
  return { usable: true, reason: null, gap_days: gap };
}

/**
 * Requirement checks. Each returns { met, reason, evidence_date } so a metric
 * can explain itself rather than collapsing to a bare boolean.
 */
function checkRequirement(requirement, metric, ctx) {
  switch (requirement) {
    case EVIDENCE_REQUIREMENTS.SYSTEM_SNAPSHOT: {
      const f = ctx.snapshotFreshness;
      if (!f || !f.has_snapshot) return { met: false, reason: 'no_snapshot', evidence_date: null };
      if (!f.fresh) return { met: false, reason: 'snapshot_stale', evidence_date: f.latest_snapshot_date };
      return { met: true, reason: null, evidence_date: f.latest_snapshot_date };
    }
    case EVIDENCE_REQUIREMENTS.BASELINE_PAIR: {
      const pair = ctx.baselinePair;
      if (!pair || !pair.usable) {
        return { met: false, reason: pair ? pair.reason : 'no_baseline_pair', evidence_date: null };
      }
      return { met: true, reason: null, evidence_date: ctx.snapshotFreshness?.latest_snapshot_date || null };
    }
    case EVIDENCE_REQUIREMENTS.AUDIT_EVENT: {
      const counts = ctx.auditEventCounts || {};
      const missing = (metric.required_events || []).filter((e) => !(Number(counts[e]) > 0));
      if (missing.length) {
        return { met: false, reason: `missing_audit_events:${missing.join('|')}`, evidence_date: null };
      }
      const dates = (metric.required_events || [])
        .map((e) => ctx.auditEventLatestDate?.[e])
        .filter(Boolean)
        .sort();
      return { met: true, reason: null, evidence_date: dates.length ? dates[dates.length - 1] : null };
    }
    case EVIDENCE_REQUIREMENTS.EXTERNAL_INSTRUMENT: {
      const registry = ctx.externalEvidence || {};
      const record = registry[metric.key];
      if (!record || !record.collected) {
        return { met: false, reason: 'missing_external_evidence', evidence_date: null };
      }
      if (!record.instrument_version) {
        return { met: false, reason: 'external_evidence_unversioned', evidence_date: record.collected_at || null };
      }
      return { met: true, reason: null, evidence_date: record.collected_at || null };
    }
    default:
      return { met: false, reason: `unknown_requirement:${requirement}`, evidence_date: null };
  }
}

/**
 * Per-metric readiness. The highest status any metric can reach here is
 * `system_evidence` — "there is preliminary system evidence" — never a claim
 * that the metric is ready to be reported as a research finding. That step
 * needs a frozen protocol plus a Research lead signature, which lives outside
 * this codebase by design.
 */
function evaluateMetric(metric, ctx) {
  const requirements = (metric.requires || []).map((r) => ({
    requirement: r,
    ...checkRequirement(r, metric, ctx),
  }));

  const metCount = requirements.filter((r) => r.met).length;
  const total = requirements.length;

  let status;
  if (total === 0) status = EVIDENCE_STATUS.MISSING;
  else if (metCount === total) status = EVIDENCE_STATUS.SYSTEM_EVIDENCE;
  else if (metCount > 0) status = EVIDENCE_STATUS.PARTIAL;
  else status = EVIDENCE_STATUS.MISSING;

  const evidenceDates = requirements.map((r) => r.evidence_date).filter(Boolean).sort();

  return {
    key: metric.key,
    role: metric.role,
    title: metric.title,
    title_th: metric.title_th,
    category: metric.category,
    formula: metric.formula,
    numerator: metric.numerator,
    denominator: metric.denominator,
    missing_data_rule: metric.missing_data_rule,
    sources: metric.sources,
    instrument: metric.instrument,
    requirements,
    status,
    status_label_th: EVIDENCE_STATUS_LABEL_TH[status],
    blocking_reasons: requirements.filter((r) => !r.met).map((r) => r.reason),
    latest_evidence_date: evidenceDates.length ? evidenceDates[evidenceDates.length - 1] : null,
    /**
     * Explicit and deliberately blunt: a metric with full system evidence is
     * still not a research result until the protocol is frozen and the
     * Research lead signs off.
     */
    research_claim_allowed: false,
  };
}

function summarise(metricResults) {
  const byStatus = { [EVIDENCE_STATUS.SYSTEM_EVIDENCE]: 0, [EVIDENCE_STATUS.PARTIAL]: 0, [EVIDENCE_STATUS.MISSING]: 0 };
  const byCategory = {};
  for (const m of metricResults) {
    byStatus[m.status] += 1;
    if (!byCategory[m.category]) {
      byCategory[m.category] = { total: 0, system_evidence: 0, partial_evidence: 0, evidence_missing: 0 };
    }
    byCategory[m.category].total += 1;
    byCategory[m.category][m.status] += 1;
  }
  return { total: metricResults.length, by_status: byStatus, by_category: byCategory };
}

/**
 * Per-role coverage, replacing `total >= 20 actions` as the readiness signal.
 * Coverage is the share of that role's metrics carrying full system evidence.
 * `action_total` is still returned so the UI can show usage volume — clearly
 * labelled as usage, not readiness.
 */
function roleCoverage(metricResults, roleActionTotals = {}) {
  const roles = {};
  for (const m of metricResults) {
    if (!roles[m.role]) {
      roles[m.role] = { role: m.role, metric_total: 0, system_evidence: 0, partial_evidence: 0, evidence_missing: 0 };
    }
    roles[m.role].metric_total += 1;
    roles[m.role][m.status] += 1;
  }
  for (const r of Object.values(roles)) {
    r.coverage_pct = r.metric_total > 0
      ? Math.round((r.system_evidence / r.metric_total) * 10000) / 100
      : null;
    // Status mirrors the metric vocabulary: a role is never "พร้อมประเมิน".
    if (r.system_evidence === r.metric_total && r.metric_total > 0) {
      r.status = EVIDENCE_STATUS.SYSTEM_EVIDENCE;
    } else if (r.system_evidence > 0 || r.partial_evidence > 0) {
      r.status = EVIDENCE_STATUS.PARTIAL;
    } else {
      r.status = EVIDENCE_STATUS.MISSING;
    }
    r.status_label_th = EVIDENCE_STATUS_LABEL_TH[r.status];
    r.action_total = Number(roleActionTotals[r.role] || 0);
    r.action_total_note = 'ปริมาณการใช้งาน ไม่ใช่เกณฑ์ความพร้อมประเมิน';
  }
  return roles;
}

/**
 * Whole-export readiness. Returns a structure, never a single boolean, and
 * always states why a research claim is or is not permitted.
 */
function buildEvidenceReadiness(ctx) {
  const snapshotFreshness = ctx.snapshotFreshness
    || evaluateSnapshotFreshness(ctx.latestSnapshotDate, ctx.referenceDate);
  const fullCtx = { ...ctx, snapshotFreshness };
  fullCtx.baselinePair = ctx.baselinePair || evaluateBaselinePair(fullCtx);

  const metrics = METRICS.map((m) => evaluateMetric(m, fullCtx));
  const summary = summarise(metrics);
  const roles = roleCoverage(metrics, ctx.roleActionTotals);
  const protocol = ctx.protocol || {};

  const blockers = [];
  if (!protocol.frozen) blockers.push('research_protocol_not_frozen');
  if (!snapshotFreshness.fresh) blockers.push(snapshotFreshness.reason || 'snapshot_stale');
  if (!fullCtx.baselinePair.usable) blockers.push(fullCtx.baselinePair.reason);
  if (summary.by_status[EVIDENCE_STATUS.MISSING] > 0) blockers.push('metrics_without_evidence');
  if (!protocol.research_lead_signed_off) blockers.push('research_lead_signoff_missing');

  return {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    snapshot_freshness: snapshotFreshness,
    baseline_pair: fullCtx.baselinePair,
    protocol: {
      frozen: Boolean(protocol.frozen),
      version: protocol.version || null,
      baseline_start: protocol.baseline_start || null,
      post_end: protocol.post_end || null,
      population_defined: Boolean(protocol.population_defined),
      research_lead_signed_off: Boolean(protocol.research_lead_signed_off),
    },
    metrics,
    summary,
    roles,
    /**
     * The replacement for `dme_mie_ready`. It is not a synonym: this says
     * whether findings may be presented as research, and it is false until a
     * human with authority freezes the protocol and signs.
     */
    research_claims_allowed: blockers.length === 0,
    blocking_reasons: [...new Set(blockers)],
    note: 'สถานะนี้อธิบายความพร้อมของหลักฐาน ไม่ใช่ผลการวิจัย และไม่ใช่การรับรองโดย Research lead',
  };
}

module.exports = {
  METRIC_CATEGORIES,
  EVIDENCE_STATUS,
  evaluateSnapshotFreshness,
  evaluateBaselinePair,
  evaluateMetric,
  roleCoverage,
  buildEvidenceReadiness,
  daysBetween,
};
