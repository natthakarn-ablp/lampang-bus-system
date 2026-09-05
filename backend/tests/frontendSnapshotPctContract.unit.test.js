'use strict';

/**
 * The frontend's snapshot percentage rule must be the backend's.
 *
 * c3989d4 fixed the research export so that a zero or missing denominator
 * yields null (never 0) and a delta against it is null (never a fake
 * improvement) — utils/researchSnapshotFields.js. The three admin pages
 * (ExecutiveSummary, ExecutivePrint, ResearchMetrics) kept their own
 * `d > 0 ? … : 0` copies, so the screen and the dataset could disagree about
 * the same snapshot. They now share one helper in frontend/src/utils/kpi.js.
 *
 * There is no frontend test runner in this repository (handoff §5), so this
 * suite does two things from the backend side:
 *   1. loads kpi.js's exported functions into a VM and runs them against the
 *      backend functions on a table of inputs — same answer, every case;
 *   2. checks at source level that the three pages import the helper and no
 *      longer carry a local `: 0` percentage, and that they render null as
 *      "ไม่มีข้อมูล" rather than as a trend.
 * Browser verification of the rendered pages is recorded in the commit.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const backend = require('../src/utils/researchSnapshotFields');

/** Evaluate kpi.js as a script: `export function` → `function`, collect the names we need. */
function loadKpi() {
  const src = read('frontend/src/utils/kpi.js').replace(/^export /gm, '');
  const sandbox = {};
  vm.runInNewContext(`${src}\n__out = { snapshotPct, pctDelta, fmtSnapshotPct, fmtPctDelta };`, Object.assign(sandbox, { __out: null }));
  return sandbox.__out;
}

const kpi = loadKpi();

describe('kpi.snapshotPct agrees with backend pctOf', () => {
  const cases = [
    [0, 0], [5, 0], [5, -1], [null, 10], [10, null], [undefined, 10], ['x', 10], [10, 'x'],
    [0, 10], [1, 3], ['80', '100'], [85, 100], [7, 9], [2, 3], [100, 100], [0.5, 2], [NaN, 5], [5, Infinity],
  ];
  it.each(cases)('pct(%p, %p)', (n, d) => {
    expect(kpi.snapshotPct(n, d)).toBe(backend.pctOf(n, d));
  });

  it('is null, not 0, on a zero denominator (the bug the pages had)', () => {
    expect(kpi.snapshotPct(0, 0)).toBeNull();
    expect(kpi.snapshotPct(85, 0)).toBeNull();
  });
});

describe('kpi.pctDelta agrees with backend deltaOf', () => {
  const cases = [[null, 85], [85, null], [null, null], [0, 85], [55, 85], [85, 85], [85, 55], [33.33, 66.67], [0, 0]];
  it.each(cases)('delta(%p → %p)', (b, c) => {
    expect(kpi.pctDelta(b, c)).toBe(backend.deltaOf(b, c));
  });

  it('a baseline with no students against 85% is null, not +85', () => {
    const baseline = { students_with_vehicle: 0, total_students: 0 };
    const latest = { students_with_vehicle: 85, total_students: 100 };
    const b = kpi.snapshotPct(baseline.students_with_vehicle, baseline.total_students);
    const c = kpi.snapshotPct(latest.students_with_vehicle, latest.total_students);
    expect(kpi.pctDelta(b, c)).toBeNull();
    expect(backend.calcDelta(baseline, latest, 'students_with_vehicle', 'total_students')).toBeNull();
  });
});

describe('formatting says "ไม่มีข้อมูล" for null and never invents a sign', () => {
  it('percentages', () => {
    expect(kpi.fmtSnapshotPct(null)).toBe('ไม่มีข้อมูล');
    expect(kpi.fmtSnapshotPct(0)).toBe('0%');
    expect(kpi.fmtSnapshotPct(33.33)).toBe('33.33%');
  });
  it('deltas', () => {
    expect(kpi.fmtPctDelta(null)).toBe('ไม่มีข้อมูล');
    expect(kpi.fmtPctDelta(0)).toBe('0%');
    expect(kpi.fmtPctDelta(12.5)).toBe('+12.5%');
    expect(kpi.fmtPctDelta(-3)).toBe('-3%');
  });
});

describe('the three pages use the shared helper', () => {
  const pages = [
    'frontend/src/pages/admin/ExecutiveSummary.jsx',
    'frontend/src/pages/admin/ExecutivePrint.jsx',
    'frontend/src/pages/admin/ResearchMetrics.jsx',
  ];

  it.each(pages)('%s imports snapshotPct/pctDelta from utils/kpi', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/import \{[^}]*snapshotPct[^}]*pctDelta[^}]*\} from '\.\.\/\.\.\/utils\/kpi'/);
  });

  it.each(pages)('%s has no local percentage that returns 0 on a zero denominator', (rel) => {
    const src = read(rel);
    expect(`local pct: ${/function (pct|calcPct)\(/.test(src)}`).toBe('local pct: false');
    expect(`: 0 fallback: ${/\* 10000\) \/ 100 : 0/.test(src)}`).toBe(': 0 fallback: false');
    expect(`local delta: ${/function calcDelta\(/.test(src)}`).toBe('local delta: false');
  });

  it.each(pages)('%s keeps null out of improved/declined and renders it as ไม่มีข้อมูล', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/ไม่มีข้อมูล|fmtSnapshotPct|fmtPctDelta/);
    if (rel.endsWith('ResearchMetrics.jsx')) {
      expect(src).toMatch(/notComparable/);
      expect(src).toMatch(/trend: delta !== null \? trendMeta/);
    } else {
      // improved / declined are gated on `comparable`; low coverage skips null.
      expect(src).toMatch(/comparable && \(?m\.higher \? d > 0 : d < 0\)?|improved: comparable && d > 0/);
      expect(src).toMatch(/m\.current !== null && m\.current < 50/);
      expect(src).toMatch(/notComparable/);
    }
  });
});
