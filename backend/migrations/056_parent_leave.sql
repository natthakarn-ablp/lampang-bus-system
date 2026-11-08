-- 056_parent_leave.sql
-- Parents report a leave for their own child through LINE (LIFF). The leave is
-- written to the SAME student_leaves table drivers and schools already use, so
-- the driver roster and the school leave list pick it up with no change.
--
-- ADDITIVE ONLY. Existing rows are untouched:
--   * reported_by becomes NULLable (a parent has no users.id); every existing
--     row keeps its value.
--   * reported_role gains 'parent'; existing values are unchanged.
--   * reported_line_user_id (new, NULL for existing rows) records the verified
--     LINE account that reported, so that account alone may cancel it.
-- Nothing writes these until FEATURE_PARENT_LEAVE=true.
-- Rollback: rollback/056_parent_leave_rollback.sql (deletes parent rows first).
-- Apply under the production release lock after a backup; never implicitly.
ALTER TABLE student_leaves
  MODIFY reported_by INT NULL,
  MODIFY reported_role ENUM('driver','school','parent') NOT NULL,
  ADD COLUMN reported_line_user_id VARCHAR(50) NULL AFTER reported_role,
  ADD INDEX idx_sl_line_user (reported_line_user_id, leave_date);
