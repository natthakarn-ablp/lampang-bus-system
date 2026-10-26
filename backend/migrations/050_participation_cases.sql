-- 050_participation_cases.sql
-- Participatory-administration case + append-only event log (Phase 4 of
-- docs/project-closure/master-project-closure-plan.md).
--
-- WHY THIS EXISTS
-- The system already records requests and approvals, but nothing proves that a
-- voice from a school, driver, transport officer or parent was CONSIDERED,
-- ACTED ON and REPORTED BACK. The 2026-09-04 audit named this Major 4: no
-- closed feedback loop, so participation could only be inferred from action
-- volume — which is exactly the inference the research-integrity work removed.
--
-- ADDITIVE ONLY. Two new tables and nothing else: no existing table is
-- altered, no row is written, and no runtime path reads these tables until
-- FEATURE_PARTICIPATION_CASES is turned on. Rolling back is dropping two empty
-- tables (see 050_participation_cases_rollback.sql).
--
-- DATA MINIMISATION. A case stores a subject line and a body written by staff,
-- the scope it belongs to, and who acted. It deliberately has no student
-- reference, no CID, no phone number and no LINE user id: linking a case to a
-- child would turn a governance record into a child-data record, which changes
-- its lawful basis and its retention rule. Where a case concerns a specific
-- request, it points at that request by type and id, and the existing row
-- keeps the personal data under its own controls.

CREATE TABLE IF NOT EXISTS participation_cases (
  id                BIGINT       NOT NULL AUTO_INCREMENT,

  -- Human-facing reference, e.g. 'PC-20260904-A1B2C3'. Safe to quote in a
  -- meeting or an email without exposing an internal id.
  case_no           VARCHAR(32)  NOT NULL,

  -- What kind of matter this is. Kept as an ENUM so the participation
  -- dashboard can aggregate without a free-text taxonomy nobody maintains.
  case_type         ENUM('POLICY_PROPOSAL','SERVICE_ISSUE','SAFETY_CONCERN',
                         'DATA_QUALITY','RESOURCE_REQUEST','OTHER') NOT NULL,

  subject           VARCHAR(200) NOT NULL,
  body              TEXT         NULL,

  -- Scope the case belongs to, mirroring users.scope_type/scope_id so the
  -- existing RBAC scope rules apply unchanged.
  scope_type        ENUM('SCHOOL','AFFILIATION','PROVINCE','TRANSPORT') NOT NULL,
  scope_id          VARCHAR(20)  NULL,

  -- Who raised it. Role is stored alongside the user id because a user's role
  -- can change later, and the record must keep the role held at the time.
  initiated_by      INT          NULL,
  initiated_role    ENUM('driver','school','affiliation','province','transport','admin','parent') NOT NULL,

  -- Optional link to the operational record this case is about, so a case can
  -- be attached to an existing workflow instead of duplicating it.
  linked_entity_type VARCHAR(50) NULL,
  linked_entity_id   VARCHAR(64) NULL,

  -- Lifecycle. CLOSED means the loop closed: a decision was made, work was
  -- done, and the outcome was reported back to whoever raised it.
  status            ENUM('SUBMITTED','ACKNOWLEDGED','IN_CONSULTATION','DECIDED',
                         'ASSIGNED','COMPLETED','CLOSED','WITHDRAWN')
                    NOT NULL DEFAULT 'SUBMITTED',

  -- Decision record. `decision_rationale` is what makes a decision auditable
  -- rather than merely recorded.
  decision            ENUM('APPROVED','REJECTED','DEFERRED','NO_ACTION_NEEDED') NULL,
  decision_rationale  TEXT NULL,
  decided_by          INT  NULL,
  decided_at          TIMESTAMP NULL,

  -- Assignment and service level.
  assigned_to       INT       NULL,
  due_at            TIMESTAMP NULL,
  completed_at      TIMESTAMP NULL,

  -- The closing step. A case is only evidence of participation once the
  -- outcome has gone back to the person who raised it.
  feedback_sent_at  TIMESTAMP NULL,

  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_participation_case_no (case_no),
  INDEX idx_participation_case_scope   (scope_type, scope_id, status),
  INDEX idx_participation_case_status  (status, created_at),
  INDEX idx_participation_case_assigned (assigned_to, status),
  INDEX idx_participation_case_linked  (linked_entity_type, linked_entity_id),
  CONSTRAINT fk_participation_case_initiator FOREIGN KEY (initiated_by) REFERENCES users (id),
  CONSTRAINT fk_participation_case_decider   FOREIGN KEY (decided_by)   REFERENCES users (id),
  CONSTRAINT fk_participation_case_assignee  FOREIGN KEY (assigned_to)  REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only event log. The case row above is a projection of these events;
-- these are the evidence. Nothing in the application updates or deletes a row
-- here, and a test asserts that: an editable participation trail would prove
-- nothing about who influenced a decision.
CREATE TABLE IF NOT EXISTS participation_case_events (
  id            BIGINT NOT NULL AUTO_INCREMENT,
  case_id       BIGINT NOT NULL,

  -- The minimum vocabulary from the master plan. FEEDBACK_SENT is the event
  -- that closes the loop; without it a case is work done, not participation.
  event_type    ENUM('SUBMITTED','ACKNOWLEDGED','COMMENTED','CONSULTED',
                     'DECIDED','ASSIGNED','COMPLETED','FEEDBACK_SENT','WITHDRAWN')
                NOT NULL,

  actor_user_id INT NULL,
  actor_role    ENUM('driver','school','affiliation','province','transport','admin','parent') NOT NULL,

  -- Free-text note from the actor, e.g. the comment, the rationale, or what
  -- was reported back. Capped by the application, not just by TEXT.
  note          TEXT NULL,

  -- Where the supporting evidence lives (a report id, a meeting minute
  -- reference). A pointer, never a copy of personal data.
  evidence_ref  VARCHAR(200) NULL,

  occurred_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_participation_event_case (case_id, occurred_at),
  INDEX idx_participation_event_type (event_type, occurred_at),
  INDEX idx_participation_event_actor (actor_user_id, occurred_at),
  CONSTRAINT fk_participation_event_case  FOREIGN KEY (case_id)       REFERENCES participation_cases (id),
  CONSTRAINT fk_participation_event_actor FOREIGN KEY (actor_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
