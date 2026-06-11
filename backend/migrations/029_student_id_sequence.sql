-- 029_student_id_sequence.sql — Phase 10.13B-2
-- Additive: an atomic id allocator so concurrent student inserts cannot race on
-- the old SELECT MAX(id)+1 fallback. Does NOT rewrite any student id, change FKs,
-- or alter students.id type. Idempotent / safe to re-run (GREATEST never lowers
-- next_value below the live MAX(id)+1).

CREATE TABLE IF NOT EXISTS id_sequences (
  name VARCHAR(50) NOT NULL PRIMARY KEY,
  next_value BIGINT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed (or raise) the students sequence to MAX(students.id)+1. On re-run, keep
-- the higher of the stored value and the live MAX+1 — never allocate below it.
INSERT INTO id_sequences (name, next_value)
SELECT 'students', COALESCE(MAX(id), 0) + 1 FROM students
ON DUPLICATE KEY UPDATE next_value = GREATEST(next_value, VALUES(next_value));
