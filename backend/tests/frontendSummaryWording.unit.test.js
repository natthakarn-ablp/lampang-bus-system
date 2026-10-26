'use strict';

/**
 * The executive summary pages must not turn "no data" into "no change" or
 * "no risk", and must not turn "nothing improved" into "nothing changed".
 *
 * Review of 2026-09-06 (ExecutiveSummary.jsx:179,186; ExecutivePrint.jsx:
 * 147,260,270): when every metric had a zero denominator on one side, the
 * pages still printed "ยังไม่มีการเปลี่ยนแปลงจาก baseline" and "ไม่มีจุดเสี่ยง
 * จากข้อมูลปัจจุบัน"; a snapshot where every comparable metric declined still
 * said "no change" because only improvements were counted; and the risk
 * heading said "no risk" while the box below listed low-coverage metrics.
 *
 * The wording now lives in frontend/src/utils/summaryWording.js, a file
 * with no React in it, so this suite can run it (there is no frontend test
 * runner in this repository — handoff §5) the way frontendSnapshotPct
 * Contract.unit.test.js runs utils/kpi.js. Part 1 runs the helper on a table
 * of situations; part 2 checks at source level that both pages compute
 * `comparableCount`, pass it to the helper, and no longer carry the literal
 * sentences that were wrong.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function loadWording() {
  const src = read('frontend/src/utils/summaryWording.js').replace(/^export /gm, '');
  const sandbox = { __out: null };
  vm.runInNewContext(`${src}\n__out = { improvementSummary, riskHeading, riskEmptyLine };`, sandbox);
  return sandbox.__out;
}

const w = loadWording();

describe('improvementSummary', () => {
  it('with nothing comparable says the data is not enough, not "no change"', () => {
    expect(w.improvementSummary({ improvements: 0, risks: 0, comparable: 0 }))
      .toBe('ยังไม่มีข้อมูลพอเทียบกับ baseline (ตัวส่วนเป็น 0 หรือไม่มี snapshot) — ยังสรุปไม่ได้ว่าดีขึ้นหรือไม่');
  });

  it('with comparable metrics and no movement says "no change in N comparable metrics"', () => {
    expect(w.improvementSummary({ improvements: 0, risks: 0, comparable: 5 }))
      .toBe('ยังไม่มีการเปลี่ยนแปลงจาก baseline ใน 5 ตัวชี้วัดที่เทียบได้');
  });

  it('decline-only is a change: says nothing improved and how many declined', () => {
    expect(w.improvementSummary({ improvements: 0, risks: 3, comparable: 6 }))
      .toBe('ไม่มีตัวชี้วัดที่ดีขึ้น และมี 3 ตัวชี้วัดที่ลดลงจาก baseline');
    expect(w.improvementSummary({ improvements: 0, risks: 3, comparable: 6 })).not.toMatch(/ยังไม่มีการเปลี่ยนแปลง/);
  });

  it('with improvements names them, and names the declines alongside when there are any', () => {
    expect(w.improvementSummary({ improvements: 2, risks: 0, comparable: 6 })).toBe('มี 2 ตัวชี้วัดที่ดีขึ้นจาก baseline');
    expect(w.improvementSummary({ improvements: 2, risks: 1, comparable: 6 })).toBe('มี 2 ตัวชี้วัดที่ดีขึ้น และ 1 ตัวชี้วัดที่ลดลงจาก baseline');
  });
});

describe('riskHeading and riskEmptyLine', () => {
  it('with nothing comparable and nothing low says the risk cannot be assessed', () => {
    expect(w.riskHeading({ risks: 0, lowCoverage: 0, comparable: 0 })).toBe('ยังประเมินจุดเสี่ยงไม่ได้ (ข้อมูลไม่พอ)');
    expect(w.riskEmptyLine({ comparable: 0 })).toMatch(/ยังไม่มีข้อมูลพอประเมิน/);
  });

  it('says "no risk" only when there was something to compare and nothing declined or ran low', () => {
    expect(w.riskHeading({ risks: 0, lowCoverage: 0, comparable: 4 })).toBe('ไม่มีจุดเสี่ยงจากข้อมูลปัจจุบัน');
    expect(w.riskEmptyLine({ comparable: 4 })).toBe('ไม่พบ metric ที่ลดลงหรือต่ำกว่า 50%');
  });

  it('low coverage alone is a risk finding: the heading must not say "no risk" above a list of them', () => {
    expect(w.riskHeading({ risks: 0, lowCoverage: 2, comparable: 0 })).toBe('จุดเสี่ยง / ต้องติดตาม');
    expect(w.riskHeading({ risks: 1, lowCoverage: 0, comparable: 3 })).toBe('จุดเสี่ยง / ต้องติดตาม');
  });
});

describe('both pages use the helper with the comparable count', () => {
  const pages = ['frontend/src/pages/admin/ExecutiveSummary.jsx', 'frontend/src/pages/admin/ExecutivePrint.jsx'];

  it.each(pages)('%s computes comparableCount from metricChanges and passes it as `comparable`', (rel) => {
    const src = read(rel);
    expect(src).toContain('const comparableCount = metricChanges.filter(m => m.comparable).length;');
    expect(src).toMatch(/comparable: comparableCount/);
    expect(src).toMatch(/import \{[^}]*improvementSummary[^}]*riskHeading[^}]*\} from '\.\.\/\.\.\/utils\/summaryWording'/);
    expect(src).toMatch(/improvementSummary\(wording\)/);
    expect(src).toMatch(/riskHeading\(wording\)/);
  });

  it.each(pages)('%s no longer carries the sentences that equated missing data with no change or no risk', (rel) => {
    const src = read(rel);
    expect(`says "ยังไม่มีการเปลี่ยนแปลงจาก baseline" itself: ${src.includes('ยังไม่มีการเปลี่ยนแปลงจาก baseline')}`)
      .toBe('says "ยังไม่มีการเปลี่ยนแปลงจาก baseline" itself: false');
    expect(`says "ไม่มีจุดเสี่ยงจากข้อมูลปัจจุบัน" itself: ${src.includes('ไม่มีจุดเสี่ยงจากข้อมูลปัจจุบัน')}`)
      .toBe('says "ไม่มีจุดเสี่ยงจากข้อมูลปัจจุบัน" itself: false');
    expect(`says "ไม่พบจุดเสี่ยงจากข้อมูลปัจจุบัน" itself: ${src.includes('ไม่พบจุดเสี่ยงจากข้อมูลปัจจุบัน')}`)
      .toBe('says "ไม่พบจุดเสี่ยงจากข้อมูลปัจจุบัน" itself: false');
  });

  it('the screen page counts low coverage in the risk heading colour, matching the box it sits on', () => {
    const src = read('frontend/src/pages/admin/ExecutiveSummary.jsx');
    expect(src).toMatch(/risks\.length > 0 \|\| lowCoverage\.length > 0 \? 'text-red-800'/);
  });

  it('the helper itself carries the "not enough data" wording', () => {
    const src = read('frontend/src/utils/summaryWording.js');
    expect(src).toContain('ข้อมูลไม่พอ');
    expect(src).toContain('ยังสรุปไม่ได้ว่าดีขึ้นหรือไม่');
  });
});
