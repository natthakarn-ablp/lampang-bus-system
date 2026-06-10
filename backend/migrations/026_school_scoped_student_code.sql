-- 026_school_scoped_student_code.sql
-- Phase 10.13A-24B — school-scoped student identity (fixes cross-school student
-- code collision that blocked imports, e.g. code 3307 used by both แม่ถอดวิทยา
-- and บ้านบอม).
--
-- Strategy (Approach B — safe ADDITIVE compatibility migration):
--   * students.id stays the INT internal PK. Existing ids are NOT changed and
--     the 5 referencing FKs (checkin_logs, parent_student, roster_change_requests,
--     student_leaves, student_pickup_points) are untouched.
--   * NEW column students.student_code holds the VISIBLE school-local code.
--   * Uniqueness moves from the global id to (school_id, student_code).
--
-- NOTE: `id` is NOT made AUTO_INCREMENT — InnoDB rejects MODIFY ... AUTO_INCREMENT
-- on a column referenced by a foreign key (ERROR 1833), verified on this server.
-- New student ids are therefore generated in application code as MAX(id)+1 inside
-- the import transaction (see school.routes.js). This migration is purely additive
-- and reversible (drop the unique key + the column).

-- 1. Add the visible code column. Kept NULLABLE so the currently-running backend
--    (which inserts students without student_code) is not broken in the brief
--    window between this migration and the code deploy. A follow-up may tighten
--    to NOT NULL once every insert path is confirmed to set it.
ALTER TABLE students ADD COLUMN student_code VARCHAR(50) NULL AFTER id;

-- 2. Backfill: the existing visible code equals the current id.
UPDATE students SET student_code = CAST(id AS CHAR) WHERE student_code IS NULL OR student_code = '';

-- 3. Enforce school-scoped uniqueness of the visible code. (Multiple NULLs are
--    allowed by MySQL, so window-inserts with a NULL code don't block; the new
--    importer always sets student_code. The importer reactivates a soft-deleted
--    (school_id, student_code) match instead of inserting.)
ALTER TABLE students ADD UNIQUE KEY uk_school_student_code (school_id, student_code);
