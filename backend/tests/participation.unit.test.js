'use strict';

/**
 * Participatory-administration cases.
 *
 * The property under test is the one the 2026-09-04 audit said was missing: a
 * case counts as participation only when the loop CLOSES — raised,
 * acknowledged, decided with a stated reason, worked, and reported back to
 * whoever raised it. Every shortcut that would let the system claim
 * participation without doing that is blocked here.
 */

const svc = require('../src/services/participation.service');
const { _test: routeInternals } = require('../src/routes/participation.routes');

const VALID_CASE = {
  case_type: 'SAFETY_CONCERN',
  subject: 'จุดรับส่งหน้าโรงเรียนไม่ปลอดภัยช่วงเย็น',
  body: 'รถจอดซ้อนคันทำให้เด็กต้องเดินออกไปกลางถนน',
  scope_type: 'SCHOOL',
  scope_id: 'SCH0001',
  initiated_role: 'school',
};

describe('case validation', () => {
  it('accepts a well-formed case', () => {
    const r = svc.validateCaseInput(VALID_CASE);
    expect(r.error).toBeUndefined();
    expect(r.value.caseType).toBe('SAFETY_CONCERN');
    expect(r.value.scopeId).toBe('SCH0001');
  });

  it('keeps case_type closed so the dashboard can aggregate it', () => {
    expect(svc.validateCaseInput({ ...VALID_CASE, case_type: 'ANYTHING' }).error).toMatch(/case_type/);
    for (const t of svc.CASE_TYPES) {
      expect(svc.validateCaseInput({ ...VALID_CASE, case_type: t }).error).toBeUndefined();
    }
  });

  it('requires a subject and caps the free-text fields', () => {
    expect(svc.validateCaseInput({ ...VALID_CASE, subject: '   ' }).error).toMatch(/subject/);
    expect(svc.validateCaseInput({ ...VALID_CASE, subject: 'ก'.repeat(svc.SUBJECT_MAX + 1) }).error)
      .toMatch(String(svc.SUBJECT_MAX));
    expect(svc.validateCaseInput({ ...VALID_CASE, body: 'ก'.repeat(svc.BODY_MAX + 1) }).error)
      .toMatch(String(svc.BODY_MAX));
  });

  it('requires a scope id for every scope narrower than the province', () => {
    expect(svc.validateCaseInput({ ...VALID_CASE, scope_id: null }).error).toMatch(/scope_id/);
    expect(svc.validateCaseInput({ ...VALID_CASE, scope_type: 'AFFILIATION', scope_id: '' }).error).toMatch(/scope_id/);
    // PROVINCE is the whole province, so it has no narrower id.
    expect(svc.validateCaseInput({
      ...VALID_CASE, scope_type: 'PROVINCE', scope_id: null, initiated_role: 'province',
    }).error).toBeUndefined();
  });

  it('rejects a half-specified link to an operational record', () => {
    expect(svc.validateCaseInput({ ...VALID_CASE, linked_entity_type: 'vehicle_request' }).error)
      .toMatch(/linked_entity/);
    expect(svc.validateCaseInput({ ...VALID_CASE, linked_entity_id: '42' }).error).toMatch(/linked_entity/);
    expect(svc.validateCaseInput({
      ...VALID_CASE, linked_entity_type: 'vehicle_request', linked_entity_id: '42',
    }).error).toBeUndefined();
  });

  it('produces a quotable reference carrying no personal data', () => {
    const caseNo = svc.makeCaseNo(new Date('2026-09-03T23:30:00.000Z'));
    // Bangkok date, not the UTC one — 23:30Z is already the 4th in Bangkok.
    expect(caseNo).toMatch(/^PC-20260904-[0-9A-F]{6}$/);
  });
});

describe('event state machine', () => {
  const at = (status) => ({ status });

  it('will not let a case be closed before the work exists', () => {
    // "We reported back" recorded before anything was done is the exact
    // failure this table exists to prevent.
    for (const status of ['SUBMITTED', 'ACKNOWLEDGED', 'IN_CONSULTATION', 'DECIDED', 'ASSIGNED']) {
      const r = svc.validateEventInput(at(status), {
        event_type: 'FEEDBACK_SENT', actor_role: 'admin', note: 'แจ้งผลแล้ว',
      });
      expect(r.error).toMatch(/FEEDBACK_SENT/);
      expect(r.statusCode).toBe(409);
    }
    expect(svc.validateEventInput(at('COMPLETED'), {
      event_type: 'FEEDBACK_SENT', actor_role: 'admin', note: 'แจ้งผลให้โรงเรียนแล้ว',
    }).error).toBeUndefined();
  });

  it('requires a decision AND a stated reason', () => {
    // A decision without a reason is a record, not evidence.
    expect(svc.validateEventInput(at('ACKNOWLEDGED'), {
      event_type: 'DECIDED', actor_role: 'province', note: 'เหตุผล',
    }).error).toMatch(/decision/);
    expect(svc.validateEventInput(at('ACKNOWLEDGED'), {
      event_type: 'DECIDED', actor_role: 'province', decision: 'APPROVED',
    }).error).toMatch(/เหตุผล/);
    expect(svc.validateEventInput(at('ACKNOWLEDGED'), {
      event_type: 'DECIDED', actor_role: 'province', decision: 'APPROVED', note: 'ตามมติที่ประชุม',
    }).error).toBeUndefined();
  });

  it('requires something to have been said when reporting back', () => {
    expect(svc.validateEventInput(at('COMPLETED'), {
      event_type: 'FEEDBACK_SENT', actor_role: 'admin', note: '   ',
    }).error).toMatch(/note/);
  });

  it('requires an assignee when assigning', () => {
    expect(svc.validateEventInput(at('DECIDED'), {
      event_type: 'ASSIGNED', actor_role: 'admin',
    }).error).toMatch(/assigned_to/);
    expect(svc.validateEventInput(at('DECIDED'), {
      event_type: 'ASSIGNED', actor_role: 'admin', assigned_to: 12,
    }).error).toBeUndefined();
  });

  it('accepts nothing further once a case is terminal', () => {
    for (const status of svc.TERMINAL_STATUSES) {
      const r = svc.validateEventInput(at(status), {
        event_type: 'COMMENTED', actor_role: 'school', note: 'เพิ่มเติม',
      });
      expect(r.statusCode).toBe(409);
      expect(r.error).toMatch(/ปิดแล้ว/);
    }
  });

  it('lets a case go back out for comment or consultation after a decision', () => {
    // Consultation is not a phase you pass through once.
    expect(svc.validateEventInput(at('DECIDED'), {
      event_type: 'CONSULTED', actor_role: 'affiliation', note: 'ขอความเห็นเพิ่ม',
    }).error).toBeUndefined();
    expect(svc.validateEventInput(at('ASSIGNED'), {
      event_type: 'COMMENTED', actor_role: 'driver', note: 'ข้อสังเกตจากคนขับ',
    }).error).toBeUndefined();
  });

  it('does not advance the status on a comment', () => {
    // Commenting records participation without pretending progress was made.
    expect(svc.EVENT_RESULT_STATUS.COMMENTED).toBeNull();
    const r = svc.validateEventInput(at('ACKNOWLEDGED'), {
      event_type: 'COMMENTED', actor_role: 'school', note: 'เพิ่มข้อมูล',
    });
    expect(r.value.nextStatus).toBeNull();
  });

  it('rejects unknown events and roles', () => {
    expect(svc.validateEventInput(at('SUBMITTED'), { event_type: 'APPROVED_MAYBE', actor_role: 'admin' }).error)
      .toMatch(/event_type/);
    expect(svc.validateEventInput(at('SUBMITTED'), { event_type: 'ACKNOWLEDGED', actor_role: 'hacker' }).error)
      .toMatch(/actor_role/);
  });

  it('returns 404 rather than a state error for a case that does not exist', () => {
    const r = svc.validateEventInput(null, { event_type: 'ACKNOWLEDGED', actor_role: 'admin' });
    expect(r.statusCode).toBe(404);
  });

  it('caps the note so an append-only table cannot become free storage', () => {
    expect(svc.validateEventInput(at('SUBMITTED'), {
      event_type: 'COMMENTED', actor_role: 'school', note: 'ก'.repeat(svc.NOTE_MAX + 1),
    }).error).toMatch(String(svc.NOTE_MAX));
  });

  it('every non-terminal status declares what may follow it', () => {
    for (const status of svc.CASE_STATUSES) {
      expect(svc.ALLOWED_EVENTS[status]).toBeDefined();
      if (svc.TERMINAL_STATUSES.includes(status)) {
        expect(svc.ALLOWED_EVENTS[status]).toEqual([]);
      } else {
        expect(svc.ALLOWED_EVENTS[status].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('participation summary', () => {
  const closed = {
    status: 'CLOSED', case_type: 'SERVICE_ISSUE', initiated_role: 'school',
    decision: 'APPROVED', decision_rationale: 'ตามมติ', due_at: null,
    completed_at: '2026-09-01', feedback_sent_at: '2026-09-02',
  };
  const openOverdue = {
    status: 'ASSIGNED', case_type: 'SAFETY_CONCERN', initiated_role: 'driver',
    decision: null, decision_rationale: null,
    due_at: '2020-01-01', completed_at: null, feedback_sent_at: null,
  };

  it('counts a closed loop only when feedback was actually sent', () => {
    const s = svc.summariseParticipation([closed, openOverdue]);
    expect(s.total).toBe(2);
    expect(s.closed_feedback_loop).toBe(1);
    expect(s.closed_feedback_loop_pct).toBe(50);
    expect(s.decided_with_rationale).toBe(1);
    expect(s.overdue).toBe(1);
  });

  it('reports null, not zero, when there is nothing to divide', () => {
    // "0% of voices answered" and "no cases yet" mean opposite things.
    const s = svc.summariseParticipation([]);
    expect(s.total).toBe(0);
    expect(s.closed_feedback_loop_pct).toBeNull();
  });

  it('breaks down by initiator role so participation is not one blended number', () => {
    const s = svc.summariseParticipation([closed, openOverdue]);
    expect(s.by_initiator_role.school).toBe(1);
    expect(s.by_initiator_role.driver).toBe(1);
    expect(s.by_initiator_role.parent).toBe(0);
  });

  it('states that it is not a research result', () => {
    expect(svc.summariseParticipation([]).note).toMatch(/ไม่ใช่ผลการวิจัย/);
  });
});

describe('route scoping', () => {
  const { scopeClause, callerScope } = routeInternals;

  it('pins a school to its own scope id', () => {
    const c = scopeClause({ role: 'school', scopeId: 'SCH0001', id: 5 });
    expect(c.sql).toContain('c.scope_id = ?');
    expect(c.params).toEqual(['SCH0001']);
  });

  it('lets an affiliation see its own cases and its schools', () => {
    const c = scopeClause({ role: 'affiliation', scopeId: 'AFF001', id: 5 });
    expect(c.sql).toContain('AFFILIATION');
    expect(c.sql).toContain('affiliation_id = ?');
    expect(c.params).toEqual(['AFF001', 'AFF001']);
  });

  it('limits a driver to what they raised themselves', () => {
    const c = scopeClause({ role: 'driver', scopeId: null, id: 42 });
    expect(c.sql).toBe('c.initiated_by = ?');
    expect(c.params).toEqual([42]);
  });

  it('denies by default, so a role added later sees nothing rather than everything', () => {
    const c = scopeClause({ role: 'brand_new_role', scopeId: 'X', id: 1 });
    expect(c.sql).toBe('1=0');
  });

  it('takes the filing scope from the token, never from the request body', () => {
    expect(callerScope({ role: 'school', scopeId: 'SCH0001' })).toEqual({
      scope_type: 'SCHOOL', scope_id: 'SCH0001',
    });
    expect(callerScope({ role: 'affiliation', scopeId: 'AFF001' })).toEqual({
      scope_type: 'AFFILIATION', scope_id: 'AFF001',
    });
    // Admin and driver have no single implied scope, so they must state one and
    // it is validated against the allowlist.
    expect(callerScope({ role: 'admin' })).toBeNull();
    expect(callerScope({ role: 'driver' })).toBeNull();
  });
});

describe('append-only event log', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = path.join(__dirname, '..', 'src');

  function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
  }

  const SOURCES = walk(SRC).map((f) => ({
    file: path.relative(path.join(__dirname, '..'), f),
    code: fs.readFileSync(f, 'utf8'),
  }));

  it('never updates or deletes a recorded event', () => {
    // The case row is a projection of the events; the events are the evidence.
    // An editable participation trail would prove nothing about who influenced
    // a decision, so no source file may mutate one.
    const offenders = SOURCES.filter((f) =>
      /UPDATE\s+participation_case_events/i.test(f.code)
      || /DELETE\s+FROM\s+participation_case_events/i.test(f.code)
    );
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it('never deletes a case either', () => {
    const offenders = SOURCES.filter((f) => /DELETE\s+FROM\s+participation_cases/i.test(f.code));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });
});

describe('migration 050', () => {
  const fs = require('fs');
  const path = require('path');
  const MIGRATIONS = path.join(__dirname, '..', 'migrations');
  const up = fs.readFileSync(path.join(MIGRATIONS, '050_participation_cases.sql'), 'utf8');
  const down = fs.readFileSync(path.join(MIGRATIONS, 'rollback', '050_participation_cases_rollback.sql'), 'utf8');

  it('is additive: it creates tables and alters nothing', () => {
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS participation_cases/);
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS participation_case_events/);
    expect(up).not.toMatch(/ALTER TABLE/i);
    expect(up).not.toMatch(/DROP/i);
    // No seed rows: applying the migration must not create governance records.
    expect(up).not.toMatch(/INSERT INTO/i);
  });

  it('uses the project charset and engine', () => {
    const creates = up.match(/ENGINE=InnoDB[^;]*/g) || [];
    expect(creates).toHaveLength(2);
    for (const c of creates) {
      expect(c).toContain('utf8mb4');
      expect(c).toContain('utf8mb4_unicode_ci');
    }
  });

  it('stores no direct student or contact reference', () => {
    // Linking a case to a child would turn a governance record into a
    // child-data record, changing its lawful basis and its retention rule.
    // Comments are stripped first: the header explains the rule by naming the
    // columns it forbids, which is documentation, not a column.
    const schema = up.replace(/^\s*--.*$/gm, '');
    for (const forbidden of ['student_id', 'cid_hash', 'phone', 'line_user_id', 'parent_id']) {
      expect(schema).not.toContain(forbidden);
    }
  });

  it('has a rollback that drops the child table first', () => {
    const eventsAt = down.indexOf('DROP TABLE IF EXISTS participation_case_events');
    const casesAt = down.indexOf('DROP TABLE IF EXISTS participation_cases;');
    expect(eventsAt).toBeGreaterThan(-1);
    expect(casesAt).toBeGreaterThan(eventsAt);
    // The rollback must tell the operator to check the tables are empty first:
    // rows here are governance evidence, not disposable state.
    expect(down).toMatch(/SELECT COUNT\(\*\)/);
  });
});
