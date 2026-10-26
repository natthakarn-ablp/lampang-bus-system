'use strict';

/**
 * The case timeline must read the fields the API actually sends.
 *
 * WHAT WENT WRONG
 * ---------------
 * ParticipationCaseDetail.jsx rendered `fmtDateTime(ev.created_at)` for every
 * event. `participation_case_events` has no `created_at` column — migration 050
 * names it `occurred_at`, and the route selects `occurred_at`. So every entry in
 * the timeline showed an em dash where its time should be, from the day the
 * feature went live on 7 September 2026 until this was found on 8 September.
 *
 * That screen exists to prove WHEN each step of a case happened. Undefined
 * renders as a dash rather than as an error, so nothing failed loudly and no
 * test noticed: the page had tests, but they tested the labels and the state
 * machine, not whether the field names matched the query.
 *
 * The same block also rendered `ev.decision`, which the events table does not
 * have and the API never sent, so it could never appear.
 *
 * This test compares the three sources — the migration, the route's SELECT, and
 * the page — so a rename in any one of them fails here instead of silently
 * blanking a column on screen.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const MIGRATION = read('backend/migrations/050_participation_cases.sql');
const ROUTES = read('backend/src/routes/participation.routes.js');
const PAGE = read('frontend/src/pages/participation/ParticipationCaseDetail.jsx');

/** The columns the event SELECT projects, in the order it lists them. */
function selectedEventColumns() {
  const m = ROUTES.match(/SELECT ([^`]+?)\s*FROM participation_case_events/);
  if (!m) throw new Error('could not find the event SELECT in participation.routes.js');
  return m[1].split(',').map((c) => c.trim()).filter(Boolean);
}

/** `ev.<field>` reads in the page's timeline. */
function eventFieldsReadByPage() {
  return [...new Set([...PAGE.matchAll(/\bev\.([a-z_]+)/g)].map((m) => m[1]))];
}

describe('the event timeline reads fields that exist', () => {
  it('the events table has occurred_at and no created_at', () => {
    const table = MIGRATION.slice(MIGRATION.indexOf('participation_case_events'));
    expect(table).toContain('occurred_at');
    // A created_at added later would make the original bug invisible again, so
    // this asserts the shape the rest of the test reasons about.
    expect(/^\s*created_at\s+TIMESTAMP/m.test(table)).toBe(false);
  });

  it('every field the page reads off an event is one the API sends', () => {
    const sent = selectedEventColumns();
    const readByPage = eventFieldsReadByPage();
    expect(readByPage.length).toBeGreaterThan(0);
    const missing = readByPage.filter((f) => !sent.includes(f));
    expect(missing).toEqual([]);
  });

  it('the page uses occurred_at for the event time', () => {
    expect(PAGE).toContain('fmtDateTime(ev.occurred_at)');
    expect(PAGE).not.toContain('ev.created_at');
  });

  it('the page does not read a decision off an event', () => {
    // The decision lives on the case. Reading ev.decision rendered nothing and
    // implied the timeline showed decisions, which it never did.
    expect(PAGE).not.toContain('ev.decision');
  });
});
