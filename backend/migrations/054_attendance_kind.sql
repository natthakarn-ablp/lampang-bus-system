-- Transportation exclusions are explicitly typed. Existing rows remain LEAVE.
-- Apply this migration alone under the production release lock after backup;
-- do not implicitly activate pending legal migrations 052/053.
ALTER TABLE student_leaves
  ADD COLUMN attendance_kind ENUM('LEAVE','SELF') NOT NULL DEFAULT 'LEAVE' AFTER session,
  ADD COLUMN morning_enabled_snapshot BOOLEAN NULL,
  ADD COLUMN evening_enabled_snapshot BOOLEAN NULL,
  ADD COLUMN active_session VARCHAR(7) GENERATED ALWAYS AS
    (CASE WHEN cancelled = FALSE THEN session ELSE NULL END) STORED,
  DROP INDEX uk_sl_date_student_session,
  ADD UNIQUE KEY uk_sl_active_date_student_session (leave_date, student_id, active_session);
