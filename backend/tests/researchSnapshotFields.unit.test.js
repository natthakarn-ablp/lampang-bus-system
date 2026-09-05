'use strict';

/**
 * The research export's snapshot-derived numbers, and the two things the
 * 2026-09-05 closure handoff found wrong with them (§2 items 2 and 4).
 *
 * ITEM 2 — calcDelta reported 0 for a side whose denominator was 0. So a
 * baseline with no students and a current snapshot at 85% came out as "+85
 * percentage points": a number that reads as improvement and means "there is
 * no baseline". The registry's own missing-data rules for the metrics involved
 * say null (researchMetrics.js: "total_students = 0 ให้รายงาน null ห้ามรายงาน
 * 0%", "ตัวส่วน 0 ให้รายงาน null"). The percentages already obeyed them; the
 * deltas did not. metric-dictionary.md §7 recorded this as a known deviation.
 *
 * ITEM 4 — four of the eight percentages (parent_coverage_pct,
 * insurance_coverage_pct, inspection_coverage_pct, inspection_pass_pct)
 * matched no metric in the registry, so they were exported with no formula,
 * denominator or missing-data rule attached, in a dataset whose data
 * dictionary claims to define what it exports.
 *
 * Both are now answered by one registry, utils/researchSnapshotFields.js. This
 * file checks the arithmetic, the registry's shape, and — at source level —
 * that admin.routes.js actually uses it rather than keeping a private copy.
 * The live export is exercised in researchExportFormats.test.js.
 */

const fs = require('fs');
const path = require('path');

const {
  SNAPSHOT_DERIVED_FIELDS,
  DESCRIPTIVE_STATISTIC,
  pctOf,
  deltaOf,
  calcDelta,
  snapshotPercentages,
  snapshotDeltas,
  derivedFieldDictionary,
} = require('../src/utils/researchSnapshotFields');
const { getMetric, METRICS } = require('../src/config/researchMetrics');

const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js'), 'utf8');

const DELTA_KEYS = [
  'data_completeness', 'parent_coverage', 'insurance_coverage',
  'inspection_coverage', 'morning_completion', 'evening_completion',
];

describe('pctOf follows the missing-data rule', () => {
  it('is null, not 0, on a zero denominator', () => {
    expect(pctOf(0, 0)).toBeNull();
    expect(pctOf(5, 0)).toBeNull();
    expect(pctOf(5, -1)).toBeNull();
  });

  it('is null on a missing or non-numeric side', () => {
    expect(pctOf(null, 10)).toBeNull();
    expect(pctOf(10, undefined)).toBeNull();
    expect(pctOf('x', 10)).toBeNull();
  });

  it('rounds to two decimals otherwise, and 0 is a real zero', () => {
    expect(pctOf(1, 3)).toBe(33.33);
    expect(pctOf('80', '100')).toBe(80);
    expect(pctOf(0, 10)).toBe(0);
  });
});

describe('calcDelta — the audit finding', () => {
  const latest = { students_with_vehicle: 85, total_students: 100 };

  it('is null when the baseline denominator is zero (used to report +85 pp)', () => {
    const baseline = { students_with_vehicle: 0, total_students: 0 };
    expect(calcDelta(baseline, latest, 'students_with_vehicle', 'total_students')).toBeNull();
  });

  it('is null when the latest denominator is zero', () => {
    const baseline = { students_with_vehicle: 50, total_students: 100 };
    const empty = { students_with_vehicle: 0, total_students: 0 };
    expect(calcDelta(baseline, empty, 'students_with_vehicle', 'total_students')).toBeNull();
  });

  it('is the percentage-point difference when both sides are computable', () => {
    const baseline = { students_with_vehicle: 55, total_students: 100 };
    expect(calcDelta(baseline, latest, 'students_with_vehicle', 'total_students')).toBe(30);
  });

  it('is 0 only for a real no-change, never as a stand-in for missing', () => {
    const same = { students_with_vehicle: 85, total_students: 100 };
    expect(calcDelta(same, latest, 'students_with_vehicle', 'total_students')).toBe(0);
    expect(deltaOf(null, 85)).toBeNull();
    expect(deltaOf(85, null)).toBeNull();
  });

  it('is null without a pair of snapshots', () => {
    expect(calcDelta(null, latest, 'students_with_vehicle', 'total_students')).toBeNull();
    expect(calcDelta(latest, undefined, 'students_with_vehicle', 'total_students')).toBeNull();
  });
});

describe('snapshotPercentages / snapshotDeltas', () => {
  const baseline = {
    total_students: 0, students_with_vehicle: 0, students_with_parent: 0,
    total_vehicles: 10, vehicles_with_insurance: 5, vehicles_inspected: 4, vehicles_passed: 2,
    morning_total: 0, morning_done: 0, evening_total: 20, evening_done: 10,
    active_users: 5, total_users: 10,
  };
  const latest = {
    total_students: 100, students_with_vehicle: 80, students_with_parent: 60,
    total_vehicles: 10, vehicles_with_insurance: 8, vehicles_inspected: 9, vehicles_passed: 7,
    morning_total: 50, morning_done: 40, evening_total: 20, evening_done: 15,
    active_users: 6, total_users: 10,
  };

  it('publishes one percentage per registry field, all null without a snapshot', () => {
    const keys = SNAPSHOT_DERIVED_FIELDS.map((f) => f.key);
    expect(Object.keys(snapshotPercentages(latest))).toEqual(keys);
    expect(Object.values(snapshotPercentages(null)).every((v) => v === null)).toBe(true);
  });

  it('covers exactly the six delta fields the export publishes', () => {
    expect(Object.keys(snapshotDeltas(baseline, latest))).toEqual(DELTA_KEYS);
  });

  it('is null without both snapshots', () => {
    expect(snapshotDeltas(null, latest)).toBeNull();
    expect(snapshotDeltas(baseline, null)).toBeNull();
  });

  it('mixes null and numbers per field rather than dropping the block', () => {
    expect(snapshotDeltas(baseline, latest)).toEqual({
      data_completeness: null,     // baseline total_students = 0
      parent_coverage: null,       // same denominator
      insurance_coverage: 30,      // 50 → 80
      inspection_coverage: 50,     // 40 → 90
      morning_completion: null,    // baseline morning_total = 0
      evening_completion: 25,      // 50 → 75
    });
  });
});

describe('the derived-field registry', () => {
  it('names every field with a _pct suffix, both sides of the fraction and a missing-data rule', () => {
    for (const f of SNAPSHOT_DERIVED_FIELDS) {
      expect(f.key).toMatch(/_pct$/);
      expect(typeof f.numerator).toBe('string');
      expect(typeof f.denominator).toBe('string');
      expect(f.missing_data_rule).toMatch(/null/);
      expect(f.missing_data_rule).toContain(f.denominator);
    }
  });

  it('points registered fields at a metric that exists, and labels the rest descriptive', () => {
    for (const f of SNAPSHOT_DERIVED_FIELDS) {
      if (f.registry_metric) {
        expect(`${f.key} → ${f.registry_metric} found: ${getMetric(f.registry_metric) !== null}`)
          .toBe(`${f.key} → ${f.registry_metric} found: true`);
      } else {
        expect(`${f.key} explains its status: ${/ไม่มี metric ใน registry/.test(f.note || '')}`)
          .toBe(`${f.key} explains its status: true`);
      }
    }
  });

  it('names the four fields the dictionary audit found unregistered — no more, no fewer', () => {
    const unregistered = SNAPSHOT_DERIVED_FIELDS.filter((f) => !f.registry_metric).map((f) => f.key).sort();
    expect(unregistered).toEqual([
      'inspection_coverage_pct', 'inspection_pass_pct', 'insurance_coverage_pct', 'parent_coverage_pct',
    ]);
  });

  it('does not grow the frozen 24-metric registry to do it', () => {
    expect(METRICS).toHaveLength(24);
  });

  it('dictionary rows carry the metric category when registered and descriptive_statistic otherwise', () => {
    const rows = derivedFieldDictionary();
    expect(rows).toHaveLength(SNAPSHOT_DERIVED_FIELDS.length);
    for (const r of rows) {
      expect(r.formula).toContain('daily_snapshots.');
      expect(typeof r.delta_rule).toBe('string');
      if (r.registry_metric) {
        expect(r.category).toBe(getMetric(r.registry_metric).category);
        expect(r.registry_title_th).toBe(getMetric(r.registry_metric).title_th);
      } else {
        expect(r.category).toBe(DESCRIPTIVE_STATISTIC);
        expect(r.registry_title_th).toBeNull();
      }
    }
    // The delta rule says the thing the audit was about.
    const withDelta = rows.filter((r) => r.delta_key);
    expect(withDelta.map((r) => r.delta_key)).toEqual(DELTA_KEYS);
    for (const r of withDelta) expect(r.delta_rule).toMatch(/null/);
  });
});

describe('admin.routes.js uses the registry instead of its own arithmetic', () => {
  const start = ROUTES.indexOf("router.get('/research-export'");
  const end = ROUTES.indexOf("router.get('/research-export/preview'");
  const exportRoute = ROUTES.slice(start, end);

  it('found the export route', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('no longer defines its own calcDelta', () => {
    expect(`defines calcDelta: ${/function calcDelta/.test(ROUTES)}`).toBe('defines calcDelta: false');
  });

  it('computes the percentages and deltas from the registry', () => {
    expect(exportRoute).toMatch(/\.\.\.snapshotPercentages\(latestSnap\)/);
    expect(exportRoute).toMatch(/delta: snapshotDeltas\(baselineSnap, latestSnap\)/);
  });

  it('has no inline percentage arithmetic left in the export summary', () => {
    expect(`inline pct left: ${/latestSnap\.\w+ > 0 \? Math\.round/.test(exportRoute)}`).toBe('inline pct left: false');
  });

  it('ships the derived-field dictionary and the descriptive category', () => {
    expect(exportRoute).toMatch(/derived_fields: derivedFieldDictionary\(\)/);
    expect(exportRoute).toMatch(/\[DESCRIPTIVE_STATISTIC\]:/);
  });

  it('says in the delta note that null is not 0', () => {
    expect(exportRoute).toMatch(/null \(never 0\)/);
  });
});

describe('every export format carries readiness and the dictionary (source level)', () => {
  // metric-dictionary.md §7 and the handoff §2 item 3: JSON had both, CSV had
  // readiness only, Excel had neither. The live check is in
  // researchExportFormats.test.js; this catches a section being deleted.
  const csvStart = ROUTES.indexOf("if (format === 'csv')");
  const xlsxStart = ROUTES.indexOf("if (format === 'excel')");
  const jsonStart = ROUTES.indexOf('// ── JSON format (default)');
  const csv = ROUTES.slice(csvStart, xlsxStart);
  const xlsx = ROUTES.slice(xlsxStart, jsonStart);

  it('found both format branches', () => {
    expect(csvStart).toBeGreaterThan(-1);
    expect(xlsxStart).toBeGreaterThan(csvStart);
    expect(jsonStart).toBeGreaterThan(xlsxStart);
  });

  it('CSV: readiness, a delta section, and both dictionary tables', () => {
    expect(csv).toContain('=== Evidence Readiness ===');
    expect(csv).toContain('=== Delta From Baseline (percentage points) ===');
    expect(csv).toContain('=== Data Dictionary (metrics) ===');
    expect(csv).toContain('=== Data Dictionary (snapshot-derived fields in dme_mie) ===');
    expect(csv).toContain('missing_data_rule');
  });

  it('Excel: readiness sheets, a dictionary sheet, and delta rows that say null instead of 0', () => {
    expect(xlsx).toContain("addWorksheet('Evidence Readiness')");
    expect(xlsx).toContain("addWorksheet('Readiness by Metric')");
    expect(xlsx).toContain("addWorksheet('Data Dictionary')");
    expect(xlsx).toMatch(/label: `delta\.\$\{k\}`/);
    expect(xlsx).toMatch(/v != null \? v : 'null/);
  });
});
