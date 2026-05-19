-- 025 — add is_deleted / deleted_at to emergency_logs (Phase 10.7G)
-- Provides admin-side soft-delete for misfired or test emergency reports.
-- Read-path filters in province/affiliation/school/report services and the
-- admin daily snapshot are added in the same phase (no unfiltered window).
-- student_leaves is intentionally NOT touched — see Phase 10.7F audit §4.2.

ALTER TABLE emergency_logs
  ADD COLUMN is_deleted BOOLEAN   NOT NULL DEFAULT FALSE AFTER result,
  ADD COLUMN deleted_at TIMESTAMP NULL     DEFAULT NULL  AFTER is_deleted,
  ADD KEY    idx_emergency_logs_is_deleted (is_deleted);
