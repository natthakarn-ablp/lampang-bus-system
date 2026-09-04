'use strict';

/**
 * Participatory-administration cases.
 *
 * The audit (2026-09-04, Major 4) found the system could show that requests
 * were approved, but not that anyone's voice was considered, acted on and
 * reported back. Approval volume is not participation, and neither is action
 * count — that inference is exactly what the research-integrity work removed.
 *
 * A case is only evidence of participation once the loop closes: someone
 * raised it, someone acknowledged it, a decision was made with a stated
 * reason, work was assigned and completed, and the outcome went BACK to the
 * person who raised it. `FEEDBACK_SENT` is the event that makes the difference
 * between "we did some work" and "we closed the loop with them".
 *
 * The event log is append-only. The case row is a projection of the events,
 * never the other way round: an editable participation trail would prove
 * nothing about who influenced a decision.
 *
 * Pure state-machine and validation logic lives here so it is unit-testable
 * without a database; the persistence functions take an executor (pool or
 * transaction connection) so callers control the transaction boundary.
 */

const crypto = require('crypto');
const { bangkokDateStamp } = require('../utils/thaiTime');

const CASE_TYPES = Object.freeze([
  'POLICY_PROPOSAL', 'SERVICE_ISSUE', 'SAFETY_CONCERN',
  'DATA_QUALITY', 'RESOURCE_REQUEST', 'OTHER',
]);

const SCOPE_TYPES = Object.freeze(['SCHOOL', 'AFFILIATION', 'PROVINCE', 'TRANSPORT']);

const ROLES = Object.freeze([
  'driver', 'school', 'affiliation', 'province', 'transport', 'admin', 'parent',
]);

const CASE_STATUSES = Object.freeze([
  'SUBMITTED', 'ACKNOWLEDGED', 'IN_CONSULTATION', 'DECIDED',
  'ASSIGNED', 'COMPLETED', 'CLOSED', 'WITHDRAWN',
]);

const EVENT_TYPES = Object.freeze([
  'SUBMITTED', 'ACKNOWLEDGED', 'COMMENTED', 'CONSULTED',
  'DECIDED', 'ASSIGNED', 'COMPLETED', 'FEEDBACK_SENT', 'WITHDRAWN',
]);

const DECISIONS = Object.freeze(['APPROVED', 'REJECTED', 'DEFERRED', 'NO_ACTION_NEEDED']);

const SUBJECT_MAX = 200;
const BODY_MAX = 5000;
const NOTE_MAX = 2000;
const EVIDENCE_REF_MAX = 200;

/** Terminal states: no further events may be appended. */
const TERMINAL_STATUSES = Object.freeze(['CLOSED', 'WITHDRAWN']);

/**
 * Which events may follow a given status.
 *
 * COMMENTED and CONSULTED are allowed from most live states because
 * consultation is not a phase you pass through once — a case can go back out
 * for comment after a decision is questioned. What is NOT allowed is skipping
 * the loop: FEEDBACK_SENT only from COMPLETED, so "we closed it" cannot be
 * recorded before the work exists.
 */
const ALLOWED_EVENTS = Object.freeze({
  SUBMITTED:       ['ACKNOWLEDGED', 'COMMENTED', 'CONSULTED', 'DECIDED', 'WITHDRAWN'],
  ACKNOWLEDGED:    ['COMMENTED', 'CONSULTED', 'DECIDED', 'ASSIGNED', 'WITHDRAWN'],
  IN_CONSULTATION: ['COMMENTED', 'CONSULTED', 'DECIDED', 'WITHDRAWN'],
  DECIDED:         ['COMMENTED', 'CONSULTED', 'ASSIGNED', 'COMPLETED', 'WITHDRAWN'],
  ASSIGNED:        ['COMMENTED', 'CONSULTED', 'COMPLETED', 'WITHDRAWN'],
  COMPLETED:       ['COMMENTED', 'FEEDBACK_SENT'],
  CLOSED:          [],
  WITHDRAWN:       [],
});

/** The status a case moves to when an event is appended. */
const EVENT_RESULT_STATUS = Object.freeze({
  SUBMITTED: 'SUBMITTED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  COMMENTED: null,          // a comment records participation without advancing
  CONSULTED: 'IN_CONSULTATION',
  DECIDED: 'DECIDED',
  ASSIGNED: 'ASSIGNED',
  COMPLETED: 'COMPLETED',
  FEEDBACK_SENT: 'CLOSED',
  WITHDRAWN: 'WITHDRAWN',
});

function appError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.errors = [{ code }];
  return error;
}

/** Human-quotable reference, e.g. PC-20260904-A1B2C3. Carries no personal data. */
function makeCaseNo(now = new Date()) {
  return `PC-${bangkokDateStamp(now)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function trimmed(value, max) {
  if (value == null) return '';
  return String(value).trim().slice(0, max);
}

/**
 * Validates a new case. Returns `{ value }` or `{ error }` rather than
 * throwing, so the route decides the status code and the tests stay simple.
 */
function validateCaseInput(input = {}) {
  const caseType = trimmed(input.case_type, 40);
  const subject = trimmed(input.subject, SUBJECT_MAX + 1);
  const body = input.body == null ? '' : String(input.body).trim();
  const scopeType = trimmed(input.scope_type, 20);
  const scopeId = input.scope_id == null ? null : trimmed(input.scope_id, 20);
  const initiatedRole = trimmed(input.initiated_role, 20);

  if (!CASE_TYPES.includes(caseType)) {
    return { error: `case_type ต้องเป็นค่าใดค่าหนึ่งใน ${CASE_TYPES.join(', ')}` };
  }
  if (!subject) return { error: 'subject จำเป็น' };
  if (subject.length > SUBJECT_MAX) return { error: `subject ต้องยาวไม่เกิน ${SUBJECT_MAX} ตัวอักษร` };
  if (body.length > BODY_MAX) return { error: `body ต้องยาวไม่เกิน ${BODY_MAX} ตัวอักษร` };
  if (!SCOPE_TYPES.includes(scopeType)) {
    return { error: `scope_type ต้องเป็นค่าใดค่าหนึ่งใน ${SCOPE_TYPES.join(', ')}` };
  }
  // PROVINCE is the whole province, so it has no narrower id; every other
  // scope must name the unit it belongs to or the case cannot be routed.
  if (scopeType !== 'PROVINCE' && !scopeId) {
    return { error: 'scope_id จำเป็นสำหรับ scope_type นี้' };
  }
  if (!ROLES.includes(initiatedRole)) {
    return { error: `initiated_role ต้องเป็นค่าใดค่าหนึ่งใน ${ROLES.join(', ')}` };
  }

  const linkedType = input.linked_entity_type == null ? null : trimmed(input.linked_entity_type, 50);
  const linkedId = input.linked_entity_id == null ? null : trimmed(input.linked_entity_id, 64);
  if ((linkedType && !linkedId) || (!linkedType && linkedId)) {
    return { error: 'linked_entity_type และ linked_entity_id ต้องระบุคู่กัน' };
  }

  return {
    value: {
      caseType,
      subject,
      body: body || null,
      scopeType,
      scopeId: scopeType === 'PROVINCE' ? (scopeId || null) : scopeId,
      initiatedRole,
      linkedEntityType: linkedType || null,
      linkedEntityId: linkedId || null,
    },
  };
}

/**
 * Validates an event against the case's current state.
 *
 * The rules that matter:
 *   - DECIDED must carry a decision AND a rationale. A decision without a
 *     stated reason is a record, not evidence.
 *   - FEEDBACK_SENT must carry a note: "we told them" with nothing said is
 *     the failure mode this whole table exists to prevent.
 *   - A terminal case accepts nothing further.
 */
function validateEventInput(currentCase, input = {}) {
  const eventType = trimmed(input.event_type, 30);
  const actorRole = trimmed(input.actor_role, 20);
  const note = input.note == null ? '' : String(input.note).trim();
  const evidenceRef = input.evidence_ref == null ? null : trimmed(input.evidence_ref, EVIDENCE_REF_MAX + 1);

  if (!currentCase) return { error: 'ไม่พบเรื่องที่ต้องการ', statusCode: 404 };
  if (!EVENT_TYPES.includes(eventType)) {
    return { error: `event_type ต้องเป็นค่าใดค่าหนึ่งใน ${EVENT_TYPES.join(', ')}` };
  }
  if (!ROLES.includes(actorRole)) {
    return { error: `actor_role ต้องเป็นค่าใดค่าหนึ่งใน ${ROLES.join(', ')}` };
  }
  if (note.length > NOTE_MAX) return { error: `note ต้องยาวไม่เกิน ${NOTE_MAX} ตัวอักษร` };
  if (evidenceRef && evidenceRef.length > EVIDENCE_REF_MAX) {
    return { error: `evidence_ref ต้องยาวไม่เกิน ${EVIDENCE_REF_MAX} ตัวอักษร` };
  }

  const status = currentCase.status;
  if (TERMINAL_STATUSES.includes(status)) {
    return { error: 'เรื่องนี้ปิดแล้ว ไม่สามารถเพิ่มเหตุการณ์ได้', statusCode: 409 };
  }
  const allowed = ALLOWED_EVENTS[status] || [];
  if (!allowed.includes(eventType)) {
    return {
      error: `สถานะ ${status} ไม่รองรับเหตุการณ์ ${eventType} (รองรับ: ${allowed.join(', ') || 'ไม่มี'})`,
      statusCode: 409,
    };
  }

  let decision = null;
  let rationale = null;
  if (eventType === 'DECIDED') {
    decision = trimmed(input.decision, 30);
    rationale = note;
    if (!DECISIONS.includes(decision)) {
      return { error: `decision ต้องเป็นค่าใดค่าหนึ่งใน ${DECISIONS.join(', ')}` };
    }
    if (!rationale) return { error: 'ต้องระบุเหตุผลของมติใน note' };
  }
  if (eventType === 'FEEDBACK_SENT' && !note) {
    return { error: 'ต้องระบุสิ่งที่แจ้งกลับผู้เสนอใน note' };
  }
  if (eventType === 'ASSIGNED' && !input.assigned_to) {
    return { error: 'ต้องระบุผู้รับผิดชอบใน assigned_to' };
  }

  return {
    value: {
      eventType,
      actorRole,
      note: note || null,
      evidenceRef: evidenceRef || null,
      decision,
      rationale,
      assignedTo: input.assigned_to ?? null,
      dueAt: input.due_at ?? null,
      nextStatus: EVENT_RESULT_STATUS[eventType],
    },
  };
}

/**
 * Aggregate participation metrics.
 *
 * Deliberately separate from the operational dashboard: mixing "how many buses
 * ran" with "how many voices were answered" is what made the previous metric
 * set unable to say anything about participation. Counts only — no case
 * bodies, no names.
 */
function summariseParticipation(cases = []) {
  const total = cases.length;
  const byStatus = Object.fromEntries(CASE_STATUSES.map((s) => [s, 0]));
  const byType = Object.fromEntries(CASE_TYPES.map((t) => [t, 0]));
  const byInitiatorRole = Object.fromEntries(ROLES.map((r) => [r, 0]));

  let closedLoop = 0;
  let decidedWithRationale = 0;
  let overdue = 0;
  const now = Date.now();

  for (const c of cases) {
    if (byStatus[c.status] !== undefined) byStatus[c.status] += 1;
    if (byType[c.case_type] !== undefined) byType[c.case_type] += 1;
    if (byInitiatorRole[c.initiated_role] !== undefined) byInitiatorRole[c.initiated_role] += 1;
    if (c.feedback_sent_at) closedLoop += 1;
    if (c.decision && c.decision_rationale) decidedWithRationale += 1;
    if (c.due_at && !c.completed_at && new Date(c.due_at).getTime() < now) overdue += 1;
  }

  return {
    total,
    by_status: byStatus,
    by_type: byType,
    by_initiator_role: byInitiatorRole,
    closed_feedback_loop: closedLoop,
    // Null rather than 0 when there is nothing to divide: a rate of 0% and
    // "no cases yet" mean opposite things to a reader.
    closed_feedback_loop_pct: total > 0 ? Math.round((closedLoop / total) * 10000) / 100 : null,
    decided_with_rationale: decidedWithRationale,
    overdue,
    note: 'ตัวชี้วัดการมีส่วนร่วม แยกจาก operational KPI และไม่ใช่ผลการวิจัย',
  };
}

// ─── Persistence ────────────────────────────────────────────────────────────

async function createCase(executor, { input, userId, now = new Date() }) {
  const parsed = validateCaseInput(input);
  if (parsed.error) throw appError(parsed.error, 400, 'PARTICIPATION_CASE_INVALID');
  const v = parsed.value;
  const caseNo = makeCaseNo(now);

  const [result] = await executor.query(
    `INSERT INTO participation_cases
       (case_no, case_type, subject, body, scope_type, scope_id,
        initiated_by, initiated_role, linked_entity_type, linked_entity_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED')`,
    [caseNo, v.caseType, v.subject, v.body, v.scopeType, v.scopeId,
      userId ?? null, v.initiatedRole, v.linkedEntityType, v.linkedEntityId]
  );
  const caseId = result.insertId;

  await executor.query(
    `INSERT INTO participation_case_events
       (case_id, event_type, actor_user_id, actor_role, note)
     VALUES (?, 'SUBMITTED', ?, ?, ?)`,
    [caseId, userId ?? null, v.initiatedRole, v.body]
  );

  return { id: caseId, case_no: caseNo, status: 'SUBMITTED' };
}

/**
 * Appends an event and projects the resulting status onto the case row.
 * The event insert comes first: if the projection fails, the evidence still
 * exists and can be replayed — the reverse would lose it.
 */
async function appendEvent(executor, { caseId, input, userId }) {
  const [[currentCase]] = await executor.query(
    'SELECT * FROM participation_cases WHERE id = ? FOR UPDATE',
    [caseId]
  );
  const parsed = validateEventInput(currentCase, input);
  if (parsed.error) {
    throw appError(parsed.error, parsed.statusCode || 400, 'PARTICIPATION_EVENT_INVALID');
  }
  const v = parsed.value;

  await executor.query(
    `INSERT INTO participation_case_events
       (case_id, event_type, actor_user_id, actor_role, note, evidence_ref)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [caseId, v.eventType, userId ?? null, v.actorRole, v.note, v.evidenceRef]
  );

  const sets = [];
  const params = [];
  if (v.nextStatus) { sets.push('status = ?'); params.push(v.nextStatus); }
  if (v.eventType === 'DECIDED') {
    sets.push('decision = ?', 'decision_rationale = ?', 'decided_by = ?', 'decided_at = NOW()');
    params.push(v.decision, v.rationale, userId ?? null);
  }
  if (v.eventType === 'ASSIGNED') {
    sets.push('assigned_to = ?');
    params.push(v.assignedTo);
    if (v.dueAt) { sets.push('due_at = ?'); params.push(v.dueAt); }
  }
  if (v.eventType === 'COMPLETED') sets.push('completed_at = NOW()');
  if (v.eventType === 'FEEDBACK_SENT') sets.push('feedback_sent_at = NOW()');

  if (sets.length) {
    params.push(caseId);
    await executor.query(`UPDATE participation_cases SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  return { id: caseId, status: v.nextStatus || currentCase.status, event: v.eventType };
}

module.exports = {
  CASE_TYPES,
  SCOPE_TYPES,
  ROLES,
  CASE_STATUSES,
  EVENT_TYPES,
  DECISIONS,
  TERMINAL_STATUSES,
  ALLOWED_EVENTS,
  EVENT_RESULT_STATUS,
  SUBJECT_MAX,
  BODY_MAX,
  NOTE_MAX,
  makeCaseNo,
  validateCaseInput,
  validateEventInput,
  summariseParticipation,
  createCase,
  appendEvent,
};
