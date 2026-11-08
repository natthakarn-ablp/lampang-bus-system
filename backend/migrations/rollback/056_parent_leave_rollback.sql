-- Rollback for 056: parent-reported leaves cannot exist without the 'parent'
-- role or a reporter id, so they are removed before the columns are narrowed.
DELETE FROM student_leaves WHERE reported_role = 'parent';
ALTER TABLE student_leaves
  DROP INDEX idx_sl_line_user,
  DROP COLUMN reported_line_user_id,
  MODIFY reported_role ENUM('driver','school') NOT NULL,
  MODIFY reported_by INT NOT NULL;
