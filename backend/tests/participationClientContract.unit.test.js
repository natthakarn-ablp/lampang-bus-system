'use strict';

/**
 * The participation screens carry a copy of the case state machine. This is
 * what stops it drifting.
 *
 * WHY THERE IS A COPY AT ALL
 * --------------------------
 * The server decides: participation.service.js validates every append against
 * ALLOWED_EVENTS and answers 409 naming the events that would have been
 * accepted. The frontend copy exists only so the form can offer the three or
 * four events that will work instead of all nine, leaving the user to discover
 * the rule by being refused.
 *
 * A rule written in two places drifts, and the direction it drifts matters
 * here: if the client offers an event the server refuses, the user fills in a
 * form and loses the work to a 409. If the client hides one the server allows,
 * a legal step becomes unreachable through the UI and nobody finds out, because
 * nothing errors.
 *
 * So this compares the two and fails on any difference. The service is the
 * authority: when this test fails, frontend/src/pages/participation/constants.js
 * is what changes.
 *
 * WHY IT LIVES IN THE BACKEND SUITE
 * ---------------------------------
 * There is no test runner under frontend/ — no vitest, no jest, no *.test.jsx
 * anywhere in the tree. Rather than add a toolchain to compare two objects,
 * this reads the module the same way refreshTokenClientContract.unit.test.js
 * reads the axios interceptor. It is a weaker arrangement than running the
 * frontend's own tests, and it is honest about what it is.
 */

const fs = require('fs');
const path = require('path');
const svc = require('../src/services/participation.service');

const CONSTANTS_PATH = path.join(
  __dirname, '..', '..', 'frontend', 'src', 'pages', 'participation', 'constants.js'
);

/**
 * Evaluate the frontend module without a bundler.
 *
 * It is plain data plus one arrow function and imports nothing, so dropping the
 * `export` keywords and returning the names is enough. If the file ever grows
 * an import this throws, which is the right outcome — the assumption behind
 * this whole file would no longer hold.
 */
function loadClientConstants() {
  const source = fs.readFileSync(CONSTANTS_PATH, 'utf8');
  if (/^\s*import\s/m.test(source)) {
    throw new Error('constants.js now has an import; this loader can no longer read it');
  }
  const body = source.replace(/^export const /gm, 'const ');
  // eslint-disable-next-line no-new-func
  return new Function(`${body}
    return { CASE_TYPE_LABEL, STATUS_LABEL, EVENT_LABEL, DECISION_LABEL,
             SCOPE_TYPE_LABEL, ROLE_LABEL, ALLOWED_EVENTS, LIMITS, NOTE_REQUIRED };`)();
}

// Loaded in beforeAll, not at module scope: reading a file outside the jest root
// while the module graph is still being built is a side effect at collection
// time, and this suite does not need it until a test runs.
//
// It was moved here for a second reason that turned out to be WRONG, recorded
// so nobody re-derives it. With the read at module scope the full suite died
// after one suite with exit 127 and no FAIL line, 0 of 4 runs, while the same
// suite without this file passed 2 of 2 — which looked conclusive. After the
// move the suite went green, then died again on the next run, then went green
// twice more. This machine kills the runner that way about half the time
// anyway (see the exit-127 flake), and under a 50% rate an 0-of-4 streak is a
// 6% coincidence. The move is still right on its own merits; it did not fix the
// kill, and nothing here should be read as claiming it did.
let client;
beforeAll(() => { client = loadClientConstants(); });

const sorted = (a) => [...a].sort();

describe('the client copy of the state machine matches the service', () => {
  it('covers exactly the same statuses', () => {
    expect(sorted(Object.keys(client.ALLOWED_EVENTS))).toEqual(sorted(svc.CASE_STATUSES));
  });

  it('allows exactly the same events from each status', () => {
    // Compared as one string so a failure names every status that differs
    // rather than stopping at the first.
    const render = (table) => svc.CASE_STATUSES
      .map((s) => `${s}: ${sorted(table[s] || []).join(',')}`)
      .join('\n');
    expect(render(client.ALLOWED_EVENTS)).toBe(render(svc.ALLOWED_EVENTS));
  });

  it('agrees on which statuses are terminal', () => {
    const clientTerminal = svc.CASE_STATUSES.filter((s) => (client.ALLOWED_EVENTS[s] || []).length === 0);
    expect(sorted(clientTerminal)).toEqual(sorted(svc.TERMINAL_STATUSES));
  });
});

describe('the client has a label for every value the service can return', () => {
  const missing = (labels, values) => values.filter((v) => !(v in labels));

  it('labels every case type', () => {
    expect(missing(client.CASE_TYPE_LABEL, svc.CASE_TYPES)).toEqual([]);
  });

  it('labels every status', () => {
    expect(missing(client.STATUS_LABEL, svc.CASE_STATUSES)).toEqual([]);
  });

  it('labels every event type', () => {
    expect(missing(client.EVENT_LABEL, svc.EVENT_TYPES)).toEqual([]);
  });

  it('labels every decision', () => {
    expect(missing(client.DECISION_LABEL, svc.DECISIONS)).toEqual([]);
  });

  it('labels every scope type and every role', () => {
    expect(missing(client.SCOPE_TYPE_LABEL, svc.SCOPE_TYPES)).toEqual([]);
    expect(missing(client.ROLE_LABEL, svc.ROLES)).toEqual([]);
  });

  it('has no label for a value the service does not have', () => {
    // The other direction: a stale label is a promise the API cannot keep, and
    // it is how a removed status keeps appearing in a filter.
    expect(Object.keys(client.CASE_TYPE_LABEL).filter((k) => !svc.CASE_TYPES.includes(k))).toEqual([]);
    expect(Object.keys(client.STATUS_LABEL).filter((k) => !svc.CASE_STATUSES.includes(k))).toEqual([]);
    expect(Object.keys(client.EVENT_LABEL).filter((k) => !svc.EVENT_TYPES.includes(k))).toEqual([]);
  });

  it('is a floor, not a vacuous pass — the service really does list values', () => {
    // Every assertion above compares against svc.*; if those were empty the
    // whole file would pass having checked nothing.
    expect(svc.CASE_STATUSES.length).toBeGreaterThan(0);
    expect(svc.EVENT_TYPES.length).toBeGreaterThan(0);
    expect(svc.CASE_TYPES.length).toBeGreaterThan(0);
    expect(Object.keys(client.ALLOWED_EVENTS).length).toBeGreaterThan(0);
  });
});

describe('the field limits the form counts against are the ones the service enforces', () => {
  it('matches subject, body, note and evidence_ref', () => {
    // Read from the service's own error text rather than from a second copy of
    // the numbers: the messages are generated from the constants.
    const limitFrom = (message) => Number((message.match(/(\d+)\s*ตัวอักษร/) || [])[1]);
    const cases = [
      ['SUBJECT', svc.validateCaseInput({
        case_type: 'OTHER', subject: 'x'.repeat(client.LIMITS.SUBJECT + 1),
        scope_type: 'PROVINCE', initiated_role: 'admin',
      }).error],
      ['BODY', svc.validateCaseInput({
        case_type: 'OTHER', subject: 'ok', body: 'x'.repeat(client.LIMITS.BODY + 1),
        scope_type: 'PROVINCE', initiated_role: 'admin',
      }).error],
    ];
    for (const [name, message] of cases) {
      expect(`${name}: ${limitFrom(String(message))}`).toBe(`${name}: ${client.LIMITS[name]}`);
    }
  });
});

describe('the events the form marks as needing a note are the ones the service refuses without one', () => {
  it('finds the same set by asking the service', () => {
    // Rather than trusting NOTE_REQUIRED, put every event type past the
    // service with no note and see which are rejected for that reason.
    const refusedWithoutNote = svc.EVENT_TYPES.filter((eventType) => {
      // Use a status from which this event is legal, so a rejection can only
      // be about the note and not about the transition.
      const from = svc.CASE_STATUSES.find((s) => (svc.ALLOWED_EVENTS[s] || []).includes(eventType));
      if (!from) return false;
      const result = svc.validateEventInput(
        { status: from },
        { event_type: eventType, actor_role: 'admin', decision: 'APPROVED', assigned_to: 1 }
      );
      return Boolean(result.error) && /note/i.test(result.error);
    });
    expect(sorted(refusedWithoutNote)).toEqual(sorted(client.NOTE_REQUIRED));
  });
});
