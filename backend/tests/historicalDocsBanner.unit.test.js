'use strict';

/**
 * Guards the labels that item 8 of the 2026-09-05 closure handoff put on the
 * documents current-status-2026-09-04.md §5 found overclaiming.
 *
 * WHY A TEST FOR DOCUMENTATION
 * ----------------------------
 * The handoff's first lesson is that this project's documents overclaim as a
 * system: an earlier review pass reversed 20 of 24 conclusions, the latest
 * revised 7 of 15 phase verdicts. `docs/production-launch-checklist.md`
 * saying "สถานะ: Go-Live Ready" and `docs/READINESS_SCORECARD_2026-08.md`
 * saying "Overall 80%" were still being read as current in September for
 * want of a label. A label that can be silently dropped in a later edit
 * would put us back there, so this asserts each one is still in place and
 * still points at the current-status documents.
 *
 * It reads only tracked files under docs/, never outputs/ (handoff §4
 * lesson 4: outputs/ is gitignored and differs per machine).
 */

const fs = require('fs');
const path = require('path');

const DOCS = path.resolve(__dirname, '..', '..', 'docs');
const read = (rel) => fs.readFileSync(path.join(DOCS, rel), 'utf8');
const head = (rel, n) => read(rel).split(/\r?\n/).slice(0, n).join('\n');

const STAMP = 'Historical snapshot (ติดป้าย 5 ก.ย. 2569)';
const HANDOFF = 'docs/project-closure/handoff-2026-09-05.md';
const REASONS = 'docs/project-closure/current-status-2026-09-04.md';

/** The 13 snapshots, with the §5 row(s) each banner cites. */
const HISTORICAL = [
  ['READINESS_SCORECARD_2026-08.md', '#1–#3'],
  ['audit/SYSTEM_AUDIT_REPORT.md', '#4–#7'],
  ['audit/AUDIT_COVERAGE.md', '#8'],
  ['audit/LOGIC_CONFIRMATION_REGISTER.md', '#8–#9'],
  ['production-readiness.md', '#17–#19'],
  ['phase-9-closeout.md', '#21'],
  ['production-launch-checklist.md', '#22–#23'],
  ['STATUS-2026-06-23.md', '#24'],
  ['UPDATE-2026-06-22.md', '#25'],
  ['MVP-CUT-2026-08.md', '#26–#28'],
  ['manual-audit/phase-10-3c-screenshot-capture-status.md', '#29'],
  ['UPDATE-2026-06-24-fulltest.md', '#30'],
];

describe('historical snapshots carry the label under their title', () => {
  it.each(HISTORICAL)('%s', (rel, ref) => {
    const top = head(rel, 6);
    expect(`${rel} labelled: ${top.includes(STAMP)}`).toBe(`${rel} labelled: true`);
    expect(top).toContain(HANDOFF);
    expect(top).toContain(`${REASONS}\` §5 (${ref})`);
  });

  it('is exactly the 12 files that get the generic banner (go-live-handoff has its own)', () => {
    expect(HISTORICAL).toHaveLength(12);
  });

  it('puts the label before the claim it qualifies, not after it', () => {
    const checklist = read('production-launch-checklist.md');
    expect(checklist.indexOf(STAMP)).toBeGreaterThan(-1);
    expect(checklist.indexOf(STAMP)).toBeLessThan(checklist.indexOf('Go-Live Ready'));
    const scorecard = read('READINESS_SCORECARD_2026-08.md');
    expect(scorecard.indexOf(STAMP)).toBeLessThan(scorecard.indexOf('| Overall | 80% |'));
  });
});

describe('banners that already existed now point at the current documents', () => {
  it('go-live-handoff.md (#20): keeps its 2026-06 banner and adds the September pointer', () => {
    const top = head('go-live-handoff.md', 12);
    expect(top).toContain('Historical snapshot');
    expect(top).toContain(HANDOFF);
    expect(top).toContain('§5 (#20)');
    // The production-commit row says which commit is current now.
    expect(read('go-live-handoff.md')).toMatch(/cdc0ec0[^\n]*208e883/);
  });

  it('deploy-readiness-report.md (#31): no longer sends the reader to two documents that are themselves historical', () => {
    const top = head('deploy-readiness-report.md', 10);
    expect(top).toContain('project-closure/handoff-2026-09-05.md');
    expect(top).toContain('project-closure/current-status-2026-09-04.md');
    expect(`still points at production-readiness.md as current: ${/สถานะจริงปัจจุบันอยู่ใน[\s\S]{0,80}production-readiness\.md/.test(top)}`)
      .toBe('still points at production-readiness.md as current: false');
  });
});

describe('documents still in use had the specific line corrected in place', () => {
  it('role-menu audit (#10, #11)', () => {
    const s = read('role-menu-participatory-research-audit-2026-09-04.md');
    expect(s).toMatch(/Production commit \| `0060c3e` ณ วันที่ตรวจ[^\n]*208e883/);
    expect(s).toMatch(/43 suites \/ 445 tests ผ่าน ณ วันที่ตรวจ[^\n]*144 suites \/ 1,695 tests/);
  });

  it('notes.md (#12, #13)', () => {
    const s = read('project-closure/notes.md');
    expect(s).toMatch(/43 suites \/ 445 tests \*\(ตัวเลข ณ 3 ก\.ย\. 2569/);
    expect(s).toMatch(/dbc19a5[^\n]*รอ D0-5[^\n]*รอ D0-7/);
  });

  it('master plan (#14): migration count, test count, participation status', () => {
    const s = read('project-closure/master-project-closure-plan.md');
    expect(s).toMatch(/\| Database migration \| 43 files ณ 3 ก\.ย\. 2569; ที่ HEAD 5 ก\.ย\. 2569 = 45 files \|[^\n]*050 ยังไม่ลง production/);
    expect(s).toMatch(/\| Unit tests \| 43 suites \/ 445 tests ผ่าน ณ `1cccee8`; 144 suites \/ 1,695 tests/);
    expect(s).toMatch(/\| Participatory evidence \|[^\n]*c077f03[^\n]*migration 050 ยังไม่ลง production/);
  });

  it('password-recovery roadmap (#15, #16)', () => {
    const s = read('password-recovery-all-roles-roadmap.md');
    expect(s).toMatch(/01da4cb[^\n]*ancestor ของ `0060c3e`[^\n]*208e883/);
    expect(s).toMatch(/public gate ที่รันล่าสุด `pass=5 warn=0 fail=0` เป็นของ HEAD `4b80b4b`/);
  });

  it('current-status §5 records that the labelling is done, instead of still calling it pending', () => {
    const s = read('project-closure/current-status-2026-09-04.md');
    expect(s).toContain('**อัปเดต 5 ก.ย. 2569:** ทำครบทั้ง 31 รายการแล้ว');
    expect(s).toContain('historicalDocsBanner.unit.test.js');
  });
});

describe('the label is not used where it does not belong', () => {
  it('the current-status and handoff documents are not labelled historical', () => {
    for (const rel of ['project-closure/current-status-2026-09-04.md', 'project-closure/handoff-2026-09-05.md']) {
      expect(`${rel} labelled: ${head(rel, 6).includes(STAMP)}`).toBe(`${rel} labelled: false`);
    }
  });
});
