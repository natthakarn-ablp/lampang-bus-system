'use strict';

/**
 * The closed feedback loop, driven end to end.
 *
 * WHY THIS EXISTS
 * ---------------
 * The whole feature rests on one claim: a case counts as participation only
 * once the loop CLOSES — raised, acknowledged, decided with a stated reason,
 * assigned, completed, and reported back to whoever raised it. The 2026-09-04
 * audit (Major 4) found the system could show approvals but not that anyone's
 * voice had been considered and answered, and this is the mechanism that was
 * built to answer it.
 *
 * participation.unit.test.js tests `validateEventInput` — the gatekeeper — one
 * call at a time, with a hand-written `{ status }` object standing in for the
 * case. That checks the rules in isolation. It cannot show that a case ACTUALLY
 * WALKS the loop, because nothing there ever advances a case: every call starts
 * from a status the test asserted itself. So the projection is untested — the
 * columns the summary reads (`decision_rationale`, `completed_at`,
 * `feedback_sent_at`) are written by `appendEvent` AFTER validation passes, and
 * a case that validates perfectly at every step can still end up reporting as
 * open because one of those columns was never set.
 *
 * This file drives the real `createCase` and `appendEvent` through all six
 * steps against an in-memory executor, then asks `summariseParticipation` what
 * it made of the result. Refusals are checked at the same place: at every
 * stage, every event the table does not allow is attempted and must be refused
 * with 409, and a case that stops at COMPLETED must NOT report as closed.
 *
 * WHY THE SERVICE AND NOT HTTP
 * ----------------------------
 * The HTTP layer — auth, role guard, scope, transaction, audit — is driven for
 * real in participationCrossScope.unit.test.js. Repeating it here would test
 * the router twice and the loop once. What is specific to this file is the
 * walk itself and the row it leaves behind, and both live in the service.
 *
 * The executor below is a stub, not a database: it holds rows in arrays and
 * understands only the four statements these two functions issue. It has no
 * locking, so `FOR UPDATE` is honoured in name only and nothing here says
 * anything about concurrent appends to the same case.
 */

require('./loadTestEnv');

const svc = require('../src/services/participation.service');

// Every NOW() the executor resolves returns this, so a column that was set can
// be told apart from one that was merely non-null by luck.
const NOW = '2026-09-08 09:00:00';

const db = { cases: [], events: [], nextCaseId: 700, nextEventId: 7000 };

/** Column list and VALUES list, straight out of the statement. */
function insert(table, sql, params) {
  const parts = sql.match(/^INSERT INTO \w+ \(([^)]+)\) VALUES \(([^)]+)\)$/i);
  if (!parts) throw new Error(`executor cannot parse INSERT: ${sql}`);
  const columns = parts[1].split(',').map((c) => c.trim());
  let index = 0;
  const values = parts[2].split(',').map((raw) => {
    const token = raw.trim();
    return token === '?' ? params[index++] : token.replace(/^'|'$/g, '');
  });
  const row = {};
  columns.forEach((column, i) => { row[column] = values[i]; });
  if (table === 'cases') {
    Object.assign(row, {
      id: (db.nextCaseId += 1),
      decision: null, decision_rationale: null, decided_by: null, decided_at: null,
      assigned_to: null, due_at: null, completed_at: null, feedback_sent_at: null,
      ...row,
    });
  } else {
    row.id = (db.nextEventId += 1);
    row.occurred_at = NOW;
  }
  db[table].push(row);
  return [{ insertId: row.id, affectedRows: 1 }];
}

const executor = {
  async query(rawSql, rawParams) {
    const sql = String(rawSql).replace(/\s+/g, ' ').trim();
    const params = rawParams || [];

    if (/^INSERT INTO participation_cases /i.test(sql)) return insert('cases', sql, params);
    if (/^INSERT INTO participation_case_events /i.test(sql)) return insert('events', sql, params);

    if (/^SELECT \* FROM participation_cases WHERE id = \? FOR UPDATE$/i.test(sql)) {
      return [db.cases.filter((c) => c.id === params[0])];
    }

    const update = sql.match(/^UPDATE participation_cases SET (.+) WHERE id = \?$/i);
    if (update) {
      let index = 0;
      const patch = {};
      for (const assignment of update[1].split(',').map((a) => a.trim())) {
        const [column, value] = assignment.split('=').map((s) => s.trim());
        patch[column] = value === '?' ? params[index++] : NOW; // the only function used is NOW()
      }
      const row = db.cases.find((c) => c.id === params[index]);
      if (!row) throw new Error(`executor: UPDATE hit no row (id ${params[index]})`);
      Object.assign(row, patch);
      return [{ affectedRows: 1 }];
    }

    // Fatal on purpose: a statement this stub does not know is one this file
    // is not testing, and answering [] would hide the change that introduced it.
    throw new Error(`executor has no rule for: ${sql}`);
  },
};

// One user id per role, so the row's `decided_by` can be checked against the
// person who actually decided rather than against whoever happened to call.
const ACTORS = { school: 11, affiliation: 21, province: 31, transport: 41, admin: 61 };
const RAISED_BY = ACTORS.school;  // the school that raised it — the one owed an answer
const ASSIGNEE = ACTORS.transport; // whoever the work is assigned TO

const DRAFT = {
  case_type: 'SAFETY_CONCERN',
  subject: 'จุดรับส่งหน้าโรงเรียนไม่ปลอดภัยช่วงเย็น',
  body: 'รถจอดซ้อนคันทำให้เด็กต้องเดินออกไปกลางถนน',
  scope_type: 'SCHOOL',
  scope_id: 'SCH0001',
  initiated_role: 'school',
};

/**
 * The loop, in order. Each step names the event, what it must carry, and the
 * status the case must hold once it is recorded.
 */
const LOOP = [
  {
    event: 'ACKNOWLEDGED', actor: 'affiliation', status: 'ACKNOWLEDGED',
    input: { note: 'รับเรื่องแล้ว กำลังตรวจสอบจุดจอด' },
  },
  {
    event: 'DECIDED', actor: 'province', status: 'DECIDED',
    input: { decision: 'APPROVED', note: 'เห็นชอบให้ย้ายจุดจอดตามมติที่ประชุม 5 ก.ย. 2569' },
  },
  {
    event: 'ASSIGNED', actor: 'admin', status: 'ASSIGNED',
    input: { assigned_to: ASSIGNEE, note: 'มอบหมายให้ขนส่งดำเนินการ' },
  },
  {
    event: 'COMPLETED', actor: 'transport', status: 'COMPLETED',
    input: { note: 'ย้ายจุดจอดและตีเส้นใหม่เรียบร้อย' },
  },
  {
    event: 'FEEDBACK_SENT', actor: 'admin', status: 'CLOSED',
    input: { note: 'แจ้งผลกลับโรงเรียนทางหนังสือ ลงวันที่ 8 ก.ย. 2569' },
  },
];

async function raiseCase() {
  const created = await svc.createCase(executor, { input: DRAFT, userId: RAISED_BY });
  return created.id;
}

async function append(caseId, step) {
  return svc.appendEvent(executor, {
    caseId,
    input: { event_type: step.event, actor_role: step.actor, ...step.input },
    userId: ACTORS[step.actor],
  });
}

/** Raise a case and walk it to the start of LOOP[index]. */
async function caseAtStep(index) {
  const caseId = await raiseCase();
  for (const step of LOOP.slice(0, index)) await append(caseId, step);
  return caseId;
}

const caseRow = (caseId) => db.cases.find((c) => c.id === caseId);
const eventsOf = (caseId) => db.events.filter((e) => e.case_id === caseId);

/** The error appendEvent rejects with, or null if it did not reject. */
async function refusal(caseId, input) {
  try {
    await svc.appendEvent(executor, { caseId, input, userId: ACTORS.admin });
    return null;
  } catch (err) {
    return err;
  }
}

beforeEach(() => {
  db.cases = [];
  db.events = [];
});

describe('a case walks the whole loop', () => {
  it('accepts every step in order and ends CLOSED', async () => {
    const caseId = await raiseCase();
    expect(caseRow(caseId).status).toBe('SUBMITTED');

    const walked = [];
    for (const step of LOOP) {
      const result = await append(caseId, step);
      walked.push(`${step.event} → ${result.status}`);
      // The status the call REPORTS and the status the row HOLDS are two
      // different things: one is computed, the other is projected by an UPDATE
      // that can be dropped without the caller noticing.
      expect(`${step.event} row: ${caseRow(caseId).status}`).toBe(`${step.event} row: ${step.status}`);
    }
    expect(walked).toEqual([
      'ACKNOWLEDGED → ACKNOWLEDGED',
      'DECIDED → DECIDED',
      'ASSIGNED → ASSIGNED',
      'COMPLETED → COMPLETED',
      'FEEDBACK_SENT → CLOSED',
    ]);
  });

  it('leaves the whole trail in the event log, in order, and nothing else', async () => {
    // The case row is a projection; these rows are the evidence. Six events for
    // six steps — the case's own SUBMITTED plus the five that follow.
    const caseId = await raiseCase();
    for (const step of LOOP) await append(caseId, step);

    expect(eventsOf(caseId).map((e) => e.event_type)).toEqual([
      'SUBMITTED', 'ACKNOWLEDGED', 'DECIDED', 'ASSIGNED', 'COMPLETED', 'FEEDBACK_SENT',
    ]);
    expect(eventsOf(caseId).map((e) => e.actor_role)).toEqual([
      'school', 'affiliation', 'province', 'admin', 'transport', 'admin',
    ]);
  });

  it('projects every column the participation summary later reads', async () => {
    // Each of these is written by a different branch of appendEvent. A branch
    // that silently stops firing does not fail any transition test — it fails
    // the metric, months later, by reporting an answered case as unanswered.
    const caseId = await raiseCase();
    for (const step of LOOP) await append(caseId, step);

    const row = caseRow(caseId);
    expect(row.decision).toBe('APPROVED');
    expect(row.decision_rationale).toMatch(/มติที่ประชุม/);
    expect(row.decided_by).toBe(ACTORS.province);
    expect(row.decided_at).toBe(NOW);
    expect(row.assigned_to).toBe(ASSIGNEE);
    expect(row.completed_at).toBe(NOW);
    expect(row.feedback_sent_at).toBe(NOW);
  });

  it('reports as closed — and reports the reason it can say so', async () => {
    const caseId = await raiseCase();
    for (const step of LOOP) await append(caseId, step);

    const summary = svc.summariseParticipation(db.cases);
    expect(summary.total).toBe(1);
    expect(summary.closed_feedback_loop).toBe(1);
    expect(summary.closed_feedback_loop_pct).toBe(100);
    expect(summary.decided_with_rationale).toBe(1);
    expect(summary.by_status.CLOSED).toBe(1);
  });
});

describe('work done is not a closed loop', () => {
  it('a case that stops at COMPLETED is not counted as closed', async () => {
    // This is the distinction the whole feature exists to make. Everything has
    // been done except telling the school — and until that happens the case is
    // work, not participation.
    const done = await caseAtStep(LOOP.length - 1); // everything but FEEDBACK_SENT
    expect(caseRow(done).status).toBe('COMPLETED');
    expect(caseRow(done).completed_at).toBe(NOW);
    expect(caseRow(done).feedback_sent_at).toBeNull();

    const summary = svc.summariseParticipation(db.cases);
    expect(summary.closed_feedback_loop).toBe(0);
    expect(summary.closed_feedback_loop_pct).toBe(0);
  });

  it('two cases, one answered and one only worked, read as 50%', async () => {
    const answered = await raiseCase();
    for (const step of LOOP) await append(answered, step);
    await caseAtStep(LOOP.length - 1);

    const summary = svc.summariseParticipation(db.cases);
    expect(summary.total).toBe(2);
    expect(summary.closed_feedback_loop).toBe(1);
    expect(summary.closed_feedback_loop_pct).toBe(50);
  });
});

describe('a step cannot be skipped', () => {
  /** Every event the table does not allow from this status. */
  const illegalFrom = (status) =>
    svc.EVENT_TYPES.filter((e) => !(svc.ALLOWED_EVENTS[status] || []).includes(e));

  const inputFor = (eventType) => ({
    event_type: eventType,
    actor_role: 'admin',
    // Enough to satisfy every field rule, so a refusal can only ever be about
    // the transition and never about a missing decision or assignee.
    decision: 'APPROVED',
    assigned_to: ASSIGNEE,
    note: 'ทดสอบการข้ามขั้นตอน',
  });

  it('refuses every illegal event at every stage of the walk, with 409', async () => {
    const refusals = [];
    // Index 0 is the case as raised (SUBMITTED); each later index is the status
    // the walk holds once LOOP[index - 1] has been recorded.
    const stages = ['SUBMITTED', ...LOOP.map((s) => s.status)];

    for (let index = 0; index < LOOP.length; index += 1) {
      const caseId = await caseAtStep(index);
      const status = stages[index];
      expect(caseRow(caseId).status).toBe(status);

      for (const eventType of illegalFrom(status)) {
        const before = eventsOf(caseId).length;
        const err = await refusal(caseId, inputFor(eventType));
        if (!err) { refusals.push(`${status} + ${eventType}: accepted`); continue; }
        if (err.statusCode !== 409) {
          refusals.push(`${status} + ${eventType}: status ${err.statusCode}`);
        }
        // A refused step must leave the evidence log exactly as it was. An
        // append-only table that records attempts as well as facts is not
        // evidence of anything.
        if (eventsOf(caseId).length !== before) {
          refusals.push(`${status} + ${eventType}: wrote an event anyway`);
        }
      }
    }
    expect(refusals).toEqual([]);
  });

  it('says which events WOULD have been accepted, so the client can recover', async () => {
    // The frontend builds its event menu from this rule (see
    // participationClientContract.unit.test.js). A 409 that does not name the
    // legal set leaves the user guessing which step was missed.
    const caseId = await caseAtStep(0);
    const err = await refusal(caseId, inputFor('FEEDBACK_SENT'));
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('SUBMITTED');
    expect(err.message).toContain('ACKNOWLEDGED');
  });

  it('will not let the loop be closed before the work exists', async () => {
    // Named on its own because it is the shortcut that would let the system
    // claim participation without doing any: FEEDBACK_SENT is legal only from
    // COMPLETED, so "we reported back" cannot precede the work.
    for (let index = 0; index < LOOP.length - 1; index += 1) {
      const caseId = await caseAtStep(index);
      const err = await refusal(caseId, {
        event_type: 'FEEDBACK_SENT', actor_role: 'admin', note: 'แจ้งผลแล้ว',
      });
      expect(`from ${caseRow(caseId).status}: ${err && err.statusCode}`)
        .toBe(`from ${caseRow(caseId).status}: 409`);
      expect(caseRow(caseId).feedback_sent_at).toBeNull();
    }
  });

  it('accepts nothing at all once the loop has closed', async () => {
    const caseId = await raiseCase();
    for (const step of LOOP) await append(caseId, step);

    const err = await refusal(caseId, {
      event_type: 'COMMENTED', actor_role: 'school', note: 'ขอเพิ่มเติม',
    });
    expect(err.statusCode).toBe(409);
    expect(err.message).toMatch(/ปิดแล้ว/);
    expect(eventsOf(caseId)).toHaveLength(LOOP.length + 1);
  });
});

describe('a refusal carries the status that fits its reason', () => {
  it('400 for a step that is legal but incomplete, not 409', async () => {
    // A decision with no stated reason is the wrong SHAPE, not the wrong step:
    // 409 would tell the client to change step when it needs to fill a field.
    const caseId = await caseAtStep(1); // ACKNOWLEDGED — DECIDED is legal here
    const noRationale = await refusal(caseId, {
      event_type: 'DECIDED', actor_role: 'province', decision: 'APPROVED', note: '   ',
    });
    expect(noRationale.statusCode).toBe(400);
    expect(noRationale.message).toMatch(/เหตุผล/);

    const noAssignee = await refusal(caseId, {
      event_type: 'ASSIGNED', actor_role: 'admin', note: 'มอบหมาย',
    });
    expect(noAssignee.statusCode).toBe(400);
    expect(noAssignee.message).toMatch(/assigned_to/);

    // Neither attempt advanced the case or wrote evidence.
    expect(caseRow(caseId).status).toBe('ACKNOWLEDGED');
    expect(eventsOf(caseId)).toHaveLength(2);
  });

  it('404 for a case that does not exist, rather than a state error', async () => {
    const err = await refusal(999999, {
      event_type: 'ACKNOWLEDGED', actor_role: 'admin', note: 'รับเรื่อง',
    });
    expect(err.statusCode).toBe(404);
  });
});
