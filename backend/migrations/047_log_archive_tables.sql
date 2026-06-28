-- 047_log_archive_tables.sql
-- Append-only archive tables for automated log retention (cleanup-old-logs.js).
-- ADDITIVE — two new tables, no existing column changed. `CREATE TABLE ... LIKE`
-- copies columns + PK + indexes exactly (NOT foreign keys, which is intended: an
-- archived row may reference a since-deleted user/vehicle). Idempotent.
--
-- audit_logs + checkin_logs rows older than the retention window are copied here
-- before being deleted from the hot table; daily_status is ephemeral and hard-
-- deleted (no archive).

CREATE TABLE IF NOT EXISTS audit_logs_archive  LIKE audit_logs;
CREATE TABLE IF NOT EXISTS checkin_logs_archive LIKE checkin_logs;
