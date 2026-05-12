-- Phase 7.11.2 — School Sub-Accounts / Grade-Level Access
--
-- Adds a `grade_scope` column to `users` so a school's sub-account
-- (a homeroom teacher) can be scoped to one Thai canonical grade.
-- Plumbing only — endpoint filtering arrives in Phase 7.11.3.
--
-- Hard rules respected here:
--   • column is NULLABLE — existing school main account stays null
--   • CHECK constraint binds grade_scope to role='school' AND one of
--     the 15 canonical Thai grades (no spelling drift possible)
--   • compound index supports the (school_id, grade) filter that
--     teacher viewers will run on every read in 7.11.3
--
-- MySQL 8.0.16+ enforces CHECK; this project runs 8.0.45 (verified
-- pre-migration). CLAUDE.md §12 mandates MySQL 8.0+.

ALTER TABLE users
  ADD COLUMN grade_scope VARCHAR(10) NULL
  AFTER scope_id;

ALTER TABLE users
  ADD CONSTRAINT chk_users_grade_scope
  CHECK (
    grade_scope IS NULL
    OR (
      role = 'school'
      AND grade_scope IN (
        'อ.1','อ.2','อ.3',
        'ป.1','ป.2','ป.3','ป.4','ป.5','ป.6',
        'ม.1','ม.2','ม.3','ม.4','ม.5','ม.6'
      )
    )
  );

CREATE INDEX idx_students_school_grade
  ON students (school_id, grade, is_deleted);
