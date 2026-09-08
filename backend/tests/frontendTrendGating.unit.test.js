'use strict';

/**
 * The three admin pages may not call a change an improvement or a decline
 * unless the server says the two ends may be compared at all.
 *
 * The backend already decides this (researchReadiness.service.js):
 * `baseline_pair.usable` is false until the gap reaches the minimum, the
 * research protocol is frozen and both ends fall inside the protocol window,
 * and `snapshot_freshness.fresh` is false once the latest snapshot is older
 * than the freshness limit. ResearchMetrics, ExecutiveSummary and
 * ExecutivePrint used to ignore both flags and render a directional badge from
 * the delta alone, so an unusable pair still printed "ดีขึ้น +12%" — a research
 * claim the project's own rules forbid.
 *
 * There is no frontend test runner in this repository (handoff §5), so this
 * suite guards the contract the way frontendSnapshotPctContract.unit.test.js
 * does — by running the real backend functions and by reading the frontend
 * source:
 *   1. every reason code the two evaluators can emit has a Thai translation in
 *      frontend/src/utils/evidenceStatus.js, because the pages must show the
 *      server's reason and must never show a raw English code;
 *   2. each page derives the same gate from both flags, quotes the server's
 *      reason, and renders no directional claim outside that gate;
 *   3. the existing null-delta-on-zero-denominator rule is untouched.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const readiness = require('../src/services/researchReadiness.service');

const PAGES = [
  'frontend/src/pages/admin/ResearchMetrics.jsx',
  'frontend/src/pages/admin/ExecutiveSummary.jsx',
  'frontend/src/pages/admin/ExecutivePrint.jsx',
  // Added 8 Sep 2026. This page was left out of the first pass and was the worst
  // of the four: its own pct() returned 0 on a zero denominator, and it labelled
  // ดีขึ้น / ลดลง with no gate at all, on the same numbers the other three had
  // just been taught to withhold. Two admin pages showing opposite conclusions
  // from one dataset is worse than either being wrong alone.
  'frontend/src/pages/admin/EvaluationDashboard.jsx',
];
const EXECUTIVE_PAGES = PAGES.filter(
  (p) => !p.endsWith('ResearchMetrics.jsx') && !p.endsWith('EvaluationDashboard.jsx')
);

/** Evaluate evidenceStatus.js as a script: `export const/function` → plain. */
function loadEvidenceStatus() {
  const src = read('frontend/src/utils/evidenceStatus.js').replace(/^export /gm, '');
  const sandbox = { __out: null };
  vm.runInNewContext(`${src}\n__out = { describeBlockingReason, BLOCKING_REASON_TH };`, sandbox);
  return sandbox.__out;
}

const ui = loadEvidenceStatus();

/**
 * Blanks comments while keeping every newline, so a rule can be explained in a
 * comment without that comment standing in as the gate the rule looks for.
 */
function blankComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

// What renders a direction: the two arrow glyphs, the trend metadata object of
// ResearchMetrics, and the per-metric improved/declined flags of the executive
// pages. `improvements` / `risks` count as gates because both lists are proven
// empty-when-gated at their definition by the assertions below.
const DIRECTIONAL_RENDER = /[▲▼]|r\.trend\.|m\.improved|m\.declined|r\.t\.Icon|r\.t\.label/;
const GATE_ANCHOR = /comparisonUsable|improvements\.map|risks\.map/;

function ungatedDirectionalLines(rel) {
  const lines = blankComments(read(rel)).split('\n');
  const offenders = [];
  lines.forEach((line, i) => {
    if (!DIRECTIONAL_RENDER.test(line)) return;
    const window = lines.slice(Math.max(0, i - 8), i + 1).join('\n');
    if (!GATE_ANCHOR.test(window)) offenders.push(`${rel}:${i + 1} ${line.trim()}`);
  });
  return offenders;
}

describe('every reason the server can give is showable in Thai', () => {
  // usable:false cases, one per branch of evaluateBaselinePair.
  const pairCases = [
    ['no baseline snapshot', { baselineSnapshotDate: null, latestSnapshotDate: '2026-09-01' }],
    ['no post snapshot', { baselineSnapshotDate: '2026-01-01', latestSnapshotDate: null }],
    ['observation period shorter than the minimum', { baselineSnapshotDate: '2026-08-20', latestSnapshotDate: '2026-09-01' }],
    ['protocol not frozen', { baselineSnapshotDate: '2026-01-01', latestSnapshotDate: '2026-09-01', protocol: { frozen: false } }],
    ['baseline before the protocol window', {
      baselineSnapshotDate: '2026-01-01', latestSnapshotDate: '2026-09-01',
      protocol: { frozen: true, baseline_start: '2026-02-01' },
    }],
    ['post after the protocol window', {
      baselineSnapshotDate: '2026-01-01', latestSnapshotDate: '2026-09-01',
      protocol: { frozen: true, post_end: '2026-06-01' },
    }],
  ];

  it.each(pairCases)('baseline pair — %s', (_name, ctx) => {
    const pair = readiness.evaluateBaselinePair(ctx);
    expect(pair.usable).toBe(false);
    expect(typeof pair.reason).toBe('string');
    const th = ui.describeBlockingReason(pair.reason);
    // A raw code would reach the admin as English; the map has to know it.
    expect(ui.BLOCKING_REASON_TH[pair.reason]).toBeDefined();
    expect(th).not.toBe(pair.reason);
    expect(th).toMatch(/[ก-๙]/);
  });

  it('a usable pair carries no reason to show', () => {
    const pair = readiness.evaluateBaselinePair({
      baselineSnapshotDate: '2026-01-01',
      latestSnapshotDate: '2026-09-01',
      protocol: { frozen: true, baseline_start: '2025-12-01', post_end: '2026-12-31' },
    });
    expect(pair).toMatchObject({ usable: true, reason: null });
  });

  it.each([
    ['no snapshot at all', null, 'no_snapshot'],
    ['a snapshot past the freshness limit', '2026-01-01', 'snapshot_stale'],
  ])('snapshot freshness — %s', (_name, date, expectedReason) => {
    const f = readiness.evaluateSnapshotFreshness(date, new Date('2026-09-08T00:00:00Z'));
    expect(f.fresh).toBe(false);
    expect(f.reason).toBe(expectedReason);
    expect(ui.BLOCKING_REASON_TH[f.reason]).toBeDefined();
    expect(ui.describeBlockingReason(f.reason)).toMatch(/[ก-๙]/);
  });

  it('a fresh snapshot carries no reason to show', () => {
    const f = readiness.evaluateSnapshotFreshness('2026-09-05', new Date('2026-09-08T00:00:00Z'));
    expect(f).toMatchObject({ fresh: true, reason: null });
  });
});

describe('the backend still sends both flags to the pages', () => {
  const route = read('backend/src/routes/admin.routes.js');

  it('evaluation-summary carries snapshot_freshness and baseline_pair', () => {
    expect(route).toContain('snapshot_freshness: evidenceReadiness.snapshot_freshness');
    expect(route).toContain('baseline_pair: evidenceReadiness.baseline_pair');
  });
});

describe('all three pages consume the two gating flags', () => {
  it.each(PAGES)('%s reads baseline_pair and snapshot_freshness from the readiness block', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/readiness\?\.baseline_pair/);
    expect(src).toMatch(/readiness\?\.snapshot_freshness/);
  });

  it.each(PAGES)('%s derives one gate from both flags', (rel) => {
    const src = read(rel);
    expect(src).toContain('const comparisonUsable = baselinePair?.usable === true && freshness?.fresh === true;');
    // A page that assumed the flags would fall back to a permissive default
    // would be back where it started; `=== true` makes an absent answer a no.
    const stripped = blankComments(src);
    expect(stripped).not.toMatch(/usable:\s*true/);
    expect(stripped).not.toMatch(/fresh:\s*true/);
  });

  it.each(PAGES)('%s explains the block with the server reason, not one of its own', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/baselinePair\.reason/);
    expect(src).toMatch(/freshness\.reason/);
    expect(src).toMatch(/describeBlockingReason\(blockingCode\)/);
    expect(src).toMatch(/import \{[^}]*describeBlockingReason[^}]*\} from '\.\.\/\.\.\/utils\/evidenceStatus'/);
  });

  it('ResearchMetrics fetches the readiness it gates on', () => {
    // The page's own endpoint (/admin/snapshots) carries no readiness, so
    // without this request the gate would have nothing to read.
    expect(read('frontend/src/pages/admin/ResearchMetrics.jsx'))
      .toContain("api.get('/admin/evaluation-summary')");
  });
});

describe('no page renders a trend without checking the flags', () => {
  it.each(PAGES)('%s gates every directional render', (rel) => {
    expect(ungatedDirectionalLines(rel)).toEqual([]);
  });

  it.each(EXECUTIVE_PAGES)('%s empties the improvement and risk lists while gated', (rel) => {
    const src = read(rel);
    expect(src).toContain('const improvements = comparisonUsable ? metricChanges.filter(m => m.improved) : [];');
    expect(src).toContain('const risks = comparisonUsable ? metricChanges.filter(m => m.declined) : [];');
  });

  it('ResearchMetrics gates the trend badge and the trend delta at every render site', () => {
    const src = read('frontend/src/pages/admin/ResearchMetrics.jsx');
    expect(src).toMatch(/r\.trend && comparisonUsable/);
    expect(src).toMatch(/r\.trend && r\.delta !== null && comparisonUsable/);
  });
});

describe('the numbers stay on the page when the claim goes away', () => {
  it('ResearchMetrics still prints the difference, without arrow or colour', () => {
    const src = read('frontend/src/pages/admin/ResearchMetrics.jsx');
    expect(src).toContain('<span className="text-ink-muted tabular-nums">{fmtPctDelta(r.delta)}</span>');
    // Both ends keep their own columns regardless of the gate.
    expect(src).toContain("cell: r => (r.hasBaseline ? `${fmtSnapshotPct(r.bVal)} (${r.bNum}/${r.bDen})` : '-')");
  });

  it('ExecutiveSummary lists baseline → current for every metric while gated', () => {
    const src = read('frontend/src/pages/admin/ExecutiveSummary.jsx');
    expect(src).toMatch(/!comparisonUsable \?[\s\S]{0,600}metricChanges\.map[\s\S]{0,300}fmtSnapshotPct\(m\.baseline\)[\s\S]{0,120}fmtSnapshotPct\(m\.current\)/);
  });

  it('ExecutivePrint keeps both ends and the difference in the table, gating only the แนวโน้ม column', () => {
    const src = read('frontend/src/pages/admin/ExecutivePrint.jsx');
    expect(src).toContain('{fmtSnapshotPct(m.baseline)}');
    expect(src).toContain('{fmtSnapshotPct(m.current)}');
    expect(src).toContain('{fmtPctDelta(m.delta)}');
    expect(src).toContain('{m.comparable && comparisonUsable ? (');
  });

  it.each(PAGES)('%s states the reason it cannot compare, in Thai', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/comparisonBlockedReason/);
    expect(src).toMatch(/[ก-๙]/);
  });
});

describe('the zero-denominator rule is untouched', () => {
  it.each(PAGES)('%s still computes percentages and deltas with the shared helper', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/import \{[^}]*snapshotPct[^}]*pctDelta[^}]*\} from '\.\.\/\.\.\/utils\/kpi'/);
  });

  it('ResearchMetrics keeps the null delta out of trendMeta', () => {
    expect(read('frontend/src/pages/admin/ResearchMetrics.jsx'))
      .toContain('trend: delta !== null ? trendMeta(delta, m.higher) : null,');
  });

  it.each(EXECUTIVE_PAGES)('%s still derives comparability from the delta being non-null', (rel) => {
    expect(read(rel)).toContain('const comparable = d !== null;');
  });
});
