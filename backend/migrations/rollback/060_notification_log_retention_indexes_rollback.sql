-- Rollback for 060: drop the two retention indexes (no data change).
ALTER TABLE notifications DROP INDEX idx_notif_created;
ALTER TABLE line_message_logs DROP INDEX idx_lml_created;
