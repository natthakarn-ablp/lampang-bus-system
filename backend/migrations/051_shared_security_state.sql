-- 051_shared_security_state.sql
-- Move the security counters out of process memory (task A1-9).
--
-- WHY THIS EXISTS
-- Three pieces of state that decide whether a request is refused live in a
-- `Map` inside one Node process:
--
--   auth.routes.js:36        LOGIN_FAILS — failed logins per (username + IP),
--                            10 in 15 minutes locks the account
--   line.routes.js:50        SEEN_EVENTS — a 5,000-entry ring of LINE webhook
--                            event ids already processed
--   lineBindGuard.js:31      counters — guessing lockouts on the LINE account
--                            binding flow, keyed by phone/student/pair/sub
--
-- The comment at auth.routes.js:34 states the condition out loud: single
-- instance (pm2 fork), move to a shared store before running more than one.
-- Until then the two lockout ceilings are multiplied by the instance count —
-- an attacker who can reach N instances gets 10xN attempts — and the webhook
-- ring lets a redelivered event be processed twice, which means a duplicate
-- notification and a duplicate row.
--
-- The ring has a second failure mode that does not need a second instance at
-- all: an event older than the last 5,000 falls out, and LINE redelivers on
-- timeout, so a late redelivery is processed again on a single instance too.
--
-- Recorded as RR-08 in docs/security/residual-risk-register.md and specified in
-- docs/security/shared-state-ddl-proposal-2026-09-05.md.
--
-- WHAT THIS MIGRATION DELIBERATELY LEAVES OUT
-- The proposal has a fourth table, `line_link_sessions`, for the in-progress
-- LINE account-linking state (line.service.js:40). It is NOT created here. That
-- table stores a phone number in readable form — the next step of the flow has
-- to match against the value the user typed — and the proposal says a DPO has
-- to decide under D0-8 whether it may be stored unencrypted before it is
-- applied. That decision has not been made, so the state stays in memory.
--
-- The cost of leaving it is bounded and is not a security cost: on a
-- multi-instance deployment a user's next message can land on an instance that
-- does not hold their half-finished linking session, and they start the flow
-- again. The three tables here are the ones where the failure is a weakened
-- control or a duplicated record.
--
-- A fifth item that appeared in the original backlog is NOT a gap and gets no
-- table: geofence.service.js:31 `lastInside` is a cache with a durable source —
-- on a miss it reads geofence_events through getLastKnownInside().
--
-- ADDITIVE ONLY. Three new tables, no existing table altered, no row written.
-- Rolling back is dropping three tables (051_shared_security_state_rollback.sql).
--
-- DATA MINIMISATION. login_lockouts keys on SHA2(username|ip, 256) rather than
-- the pair itself: the check only ever needs equality, never the original
-- value, and username and IP are both personal data. line_bind_lockouts keys
-- are already hashed by the code that writes them. line_webhook_events_seen
-- holds an opaque LINE event id and a timestamp.

-- 1) Failed-login lockout per (username + IP).
--    key_hash = SHA2(CONCAT(LOWER(TRIM(username)), '|', ip), 256)
CREATE TABLE IF NOT EXISTS login_lockouts (
  key_hash      CHAR(64) NOT NULL,
  fail_count    INT NOT NULL DEFAULT 0,
  window_start  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (key_hash),
  INDEX idx_ll_window (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) LINE webhook de-duplication.
--    Written with INSERT IGNORE and read from affectedRows: 1 means this
--    instance claimed the event, 0 means someone already had it. That claim is
--    atomic across instances, which the Map could not be. Within a single
--    process the Map was already atomic — alreadyProcessed() is synchronous
--    with no await between the has and the set — so this is not a fix for a
--    same-process race, and the code comment says so.
CREATE TABLE IF NOT EXISTS line_webhook_events_seen (
  event_id   VARCHAR(64) NOT NULL,
  seen_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id),
  INDEX idx_lwes_seen (seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) LINE account-binding guess lockouts. The four key types match the
--    existing counters: phone, student, the pair of the two, and the LINE sub.
CREATE TABLE IF NOT EXISTS line_bind_lockouts (
  lock_type     ENUM('phone','student','pair','sub') NOT NULL,
  key_hash      CHAR(64) NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  window_start  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_until  TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (lock_type, key_hash),
  INDEX idx_lbl_window (window_start),
  INDEX idx_lbl_locked (locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CLEANUP
-- All three grow without bound if nothing prunes them. Same pattern as
-- revoked_tokens (CLAUDE.md §5.1): a MySQL Event, or an external cron.
-- The intervals are wider than the TTLs the code enforces (15 and 30 minutes)
-- so a clock skew between the app host and the database cannot delete a row
-- that is still in force.
--
--   DELETE FROM login_lockouts           WHERE window_start < NOW() - INTERVAL 1 HOUR;
--   DELETE FROM line_webhook_events_seen WHERE seen_at      < NOW() - INTERVAL 7 DAY;
--   DELETE FROM line_bind_lockouts       WHERE window_start < NOW() - INTERVAL 1 DAY
--                                          AND (locked_until IS NULL OR locked_until < NOW());
--
-- Not created as an Event here: whether the Event Scheduler is on, and whether
-- this deployment prefers events or cron, is an operator decision (C0-8 window,
-- B2-2 environment). backend/scripts/cleanup-shared-security-state.js runs the
-- same three statements and can be pointed at either.
