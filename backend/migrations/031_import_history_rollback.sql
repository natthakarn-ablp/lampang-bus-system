-- 031_import_history_rollback.sql — Phase 10.13B-5
-- Additive: rollback tracking for the import history / correction center.
-- No student/vehicle/driver data changed; reversible (drop the new columns).

ALTER TABLE import_batch_rows
  ADD COLUMN rollback_status VARCHAR(30) NULL AFTER status,
  ADD COLUMN rolled_back_at TIMESTAMP NULL AFTER applied_at,
  ADD COLUMN rollback_error TEXT NULL AFTER rolled_back_at;

ALTER TABLE import_batches
  ADD COLUMN rollback_status VARCHAR(30) NULL AFTER status,
  ADD COLUMN rolled_back_at TIMESTAMP NULL AFTER applied_at;

CREATE INDEX idx_import_batch_rows_rollback ON import_batch_rows (rollback_status);
