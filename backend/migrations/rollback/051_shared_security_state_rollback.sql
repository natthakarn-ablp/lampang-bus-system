-- Rollback for 051_shared_security_state.sql
--
-- 051 is purely additive — it creates three tables and touches nothing else —
-- so dropping them returns the schema to its pre-051 state exactly.
--
-- BEFORE RUNNING, understand what the rows mean, because unlike 050 these
-- tables are NOT expected to be empty on a running system:
--
--   login_lockouts            in-force lockouts. Dropping this releases every
--                             account currently locked out for repeated failed
--                             logins. If an attack is in progress, that is the
--                             wrong moment. The per-IP loginLimiter
--                             (auth.routes.js:55) is unaffected and keeps
--                             working either way.
--   line_webhook_events_seen  the record of which LINE webhook events have
--                             already been handled. Dropping it means a
--                             redelivery of any recent event is processed a
--                             second time — a duplicate notification and a
--                             duplicate row, not a security failure.
--   line_bind_lockouts        in-force lockouts on the account-binding flow.
--                             Same consideration as login_lockouts.
--
-- None of the three holds anything that cannot be rebuilt by the system as it
-- runs; the cost of dropping them is a window in which two rate ceilings reset
-- and one de-duplication forgets. There is nothing to export first.
--
-- ORDER: no foreign keys between them and nothing references them, so the
-- order below is only for readability.
--
-- AFTER RUNNING, the application code must be rolled back too. The code reads
-- these tables as the source of truth; with the tables gone every login and
-- every webhook raises an error. Roll the code back first, then the schema.

DROP TABLE IF EXISTS line_bind_lockouts;
DROP TABLE IF EXISTS line_webhook_events_seen;
DROP TABLE IF EXISTS login_lockouts;
