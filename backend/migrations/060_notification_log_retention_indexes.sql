-- 060_notification_log_retention_indexes.sql
-- PERF-002 (architecture audit 2026-11-08): retention for the LINE tables.
-- 059 already added the dispatch-queue index notifications(sent, retry_count,
-- created_at); this adds only what the retention queries need:
--   line_message_logs(created_at)   range delete by age (only PK + line_user_id today)
--   notifications(created_at, id)   range delete by age in id order
-- Evidence: EXPLAIN in tests/notificationRetention.test.js (CI log).
--
-- ADDITIVE ONLY (two secondary indexes). No retention period is decided here;
-- scripts/cleanup-notification-logs.js deletes nothing unless the owner passes
-- explicit day counts with --apply.
-- Depends on 059. Rollback: rollback/060_notification_log_retention_indexes_rollback.sql.
-- Apply under the production release lock after a backup; never implicitly.
ALTER TABLE line_message_logs ADD INDEX idx_lml_created (created_at);
ALTER TABLE notifications ADD INDEX idx_notif_created (created_at, id);
