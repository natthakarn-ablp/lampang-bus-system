'use strict';

/**
 * The participation summary screen, guarded at the source.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * GET /api/participation/summary shipped with the feature on 2026-09-07 and
 * nothing in the frontend called it — grepping frontend/src for the path
 * returned nothing for a month. ParticipationSummary.jsx is now its only
 * consumer, and the first test below is what stops it silently going quiet
 * again.
 *
 * The rest guards the two claims the page must not make. Both are numbers that
 * the schema can only ever produce as zero, and a zero on a summary screen
 * reads as a finding:
 *
 *   `overdue` — a due date is only written alongside an ASSIGNED event, and no
 *   form in the system collects one, so no case has a deadline it could miss.
 *   "เกินกำหนด 0" would say nothing is late; the truth is nothing can be.
 *
 *   `by_initiator_role.parent` — the router's requireRole list has no `parent`,
 *   so a parent cannot open a case. Listing the bucket would read as "no parent
 *   ever raised a concern" rather than "no parent may".
 *
 * WHY IT LIVES IN THE BACKEND SUITE
 * ---------------------------------
 * There is no test runner under frontend/. participationClientContract.unit.test.js
 * made the same trade for the same reason: reading the source with fs is weaker
 * than rendering the component, and it is honest about being weaker. What it
 * can still do is fail the moment the page and the API disagree.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PAGE = 'frontend/src/pages/participation/ParticipationSummary.jsx';
const pageSrc = read(PAGE);

/**
 * The page's comments discuss `overdue` and `parent` at length — that is the
 * point of them. Only the code may not mention them, so the comments come out
 * before anything is asserted about identifiers.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const pageCode = stripComments(pageSrc);

describe('the summary page consumes the endpoint that nothing used to call', () => {
  it('requests /participation/summary', () => {
    expect(pageCode).toMatch(/api\.get\(\s*['"]\/participation\/summary['"]\s*\)/);
  });

  it('reads the fields the aggregate actually returns', () => {
    for (const field of ['total', 'by_status', 'by_type', 'by_initiator_role',
      'closed_feedback_loop', 'closed_feedback_loop_pct', 'decided_with_rationale']) {
      expect(pageCode).toContain(field);
    }
  });

  it('is reachable — App.jsx routes it and Sidebar links it', () => {
    const app = read('frontend/src/App.jsx');
    expect(app).toMatch(/import\('\.\/pages\/participation\/ParticipationSummary'\)/);
    expect(app).toMatch(/path="\/participation\/summary"/);

    const sidebar = read('frontend/src/components/Sidebar.jsx');
    expect(sidebar).toMatch(/to: '\/participation\/summary'/);
  });
});

describe('the disclaimer survives', () => {
  // The sentence lives in summariseParticipation. The page renders the payload's
  // copy of it, so this only has to prove the service still sends one and that
  // the page's offline fallback still says the same thing.
  const serviceSrc = read('backend/src/services/participation.service.js');
  const noteMatch = serviceSrc.match(/note: '([^']+ไม่ใช่ผลการวิจัย)'/);

  it('the service still returns a not-a-research-result note', () => {
    expect(noteMatch).not.toBeNull();
  });

  it('the page renders the note the server sent, not a paraphrase', () => {
    expect(pageCode).toMatch(/data\.note\s*\|\|/);
  });

  it('the fallback the page shows offline is the same sentence', () => {
    expect(pageCode).toContain(noteMatch[1]);
  });
});

describe('a structural zero is never rendered as a measurement', () => {
  it('the page never reads the overdue count', () => {
    // Not `data.overdue`, not destructured, not by string key. If a due-date
    // input is ever added to the assign form this test is what must be deleted
    // — deliberately, and with the figure then meaning something.
    expect(pageCode).not.toMatch(/\boverdue\b/);
  });

  it('the page says why the figure is not measurable yet', () => {
    expect(pageSrc).toContain('ยังวัดไม่ได้');
  });

  it('breaks the initiator count down by exactly the roles the router admits', () => {
    const routesSrc = read('backend/src/routes/participation.routes.js');
    const guard = routesSrc.match(/requireRole\(([^)]*)\)/);
    expect(guard).not.toBeNull();
    const admitted = guard[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));

    const listed = pageCode
      .match(/const INITIATOR_ROLES = \[([^\]]*)\]/)[1]
      .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

    expect([...listed].sort()).toEqual([...admitted].sort());
    expect(listed).not.toContain('parent');
  });
});
