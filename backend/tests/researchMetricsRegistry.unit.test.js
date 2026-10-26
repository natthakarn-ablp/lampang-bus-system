'use strict';

/**
 * Guards the metric registry itself. A readiness figure computed from a broken
 * registry is worse than no figure: it looks authoritative.
 */

const {
  METRICS,
  METRIC_CATEGORIES,
  EVIDENCE_REQUIREMENTS,
  ROLES_WITH_METRICS,
  metricsForRole,
  metricsByCategory,
  getMetric,
} = require('../src/config/researchMetrics');

const VALID_CATEGORIES = new Set(Object.values(METRIC_CATEGORIES));
const VALID_REQUIREMENTS = new Set(Object.values(EVIDENCE_REQUIREMENTS));

describe('research metric registry', () => {
  it('covers the 24 metrics named in the 2026-09-04 audit', () => {
    expect(METRICS).toHaveLength(24);
  });

  it('covers all six login roles with four metrics each', () => {
    expect([...ROLES_WITH_METRICS].sort()).toEqual(
      ['admin', 'affiliation', 'driver', 'province', 'school', 'transport']
    );
    for (const role of ROLES_WITH_METRICS) {
      expect(metricsForRole(role)).toHaveLength(4);
    }
  });

  it('uses unique keys', () => {
    const keys = METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('separates operational, participation, research-outcome and external claims', () => {
    for (const category of VALID_CATEGORIES) {
      expect(metricsByCategory(category).length).toBeGreaterThan(0);
    }
    const counts = {};
    for (const m of METRICS) counts[m.category] = (counts[m.category] || 0) + 1;
    expect(Object.keys(counts).sort()).toEqual([...VALID_CATEGORIES].sort());
  });

  it('gives every metric a category, formula, denominator and missing-data rule', () => {
    for (const m of METRICS) {
      expect(VALID_CATEGORIES.has(m.category)).toBe(true);
      expect(typeof m.formula).toBe('string');
      expect(m.formula.length).toBeGreaterThan(0);
      expect(typeof m.numerator).toBe('string');
      expect(m.numerator.length).toBeGreaterThan(0);
      expect(typeof m.denominator).toBe('string');
      expect(m.denominator.length).toBeGreaterThan(0);
      // A missing-data rule is what stops "no data" silently becoming zero.
      expect(typeof m.missing_data_rule).toBe('string');
      expect(m.missing_data_rule.length).toBeGreaterThan(0);
      expect(Array.isArray(m.sources)).toBe(true);
      expect(m.sources.length).toBeGreaterThan(0);
    }
  });

  it('declares at least one recognised evidence requirement per metric', () => {
    for (const m of METRICS) {
      expect(Array.isArray(m.requires)).toBe(true);
      expect(m.requires.length).toBeGreaterThan(0);
      for (const r of m.requires) expect(VALID_REQUIREMENTS.has(r)).toBe(true);
    }
  });

  it('only names required_events when it declares the audit_event requirement', () => {
    for (const m of METRICS) {
      const declaresAuditEvent = m.requires.includes(EVIDENCE_REQUIREMENTS.AUDIT_EVENT);
      const namesEvents = (m.required_events || []).length > 0;
      expect(namesEvents).toBe(declaresAuditEvent);
    }
  });

  it('requires an external instrument for every external_evidence metric', () => {
    for (const m of metricsByCategory(METRIC_CATEGORIES.EXTERNAL_EVIDENCE)) {
      expect(m.requires).toContain(EVIDENCE_REQUIREMENTS.EXTERNAL_INSTRUMENT);
    }
  });

  it('never lets a metric qualify on audit volume alone', () => {
    // There is no "action_count" requirement, and adding one would be the
    // exact regression the audit flagged.
    expect([...VALID_REQUIREMENTS]).not.toContain('action_count');
    for (const m of METRICS) {
      expect(JSON.stringify(m.requires)).not.toMatch(/action_count|total_actions/);
    }
  });

  it('resolves metrics by key and returns null for unknown keys', () => {
    expect(getMetric('school.data_completeness_rate')).not.toBeNull();
    expect(getMetric('nope.not_a_metric')).toBeNull();
  });
});
