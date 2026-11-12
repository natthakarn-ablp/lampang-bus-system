-- 061_homeroom_teachers.sql
-- Homeroom teachers per classroom (owner decision 2026-11-12): a school's main
-- account lists the homeroom teacher(s) of each grade + room — name and an
-- optional phone. Shown on the classroom check page, the student list / Excel,
-- the driver's student list and the parent's LINE "สถานะ" reply.
--
-- ADDITIVE ONLY. One new table; no existing table is altered and no row is
-- written. Nothing reads it until FEATURE_HOMEROOM_TEACHERS=true (index.js
-- refuses to boot with the flag on and this table missing).
-- Matching key: (school_id, grade, classroom) compared to students.grade /
-- students.classroom as stored; classroom '' = students with no room.
-- Rollback: rollback/061_homeroom_teachers_rollback.sql.
-- Apply under the production release lock after a backup; never implicitly.
CREATE TABLE IF NOT EXISTS homeroom_teachers (
  id            INT           NOT NULL AUTO_INCREMENT,
  school_id     VARCHAR(10)   NOT NULL,
  grade         VARCHAR(20)   NOT NULL,
  classroom     VARCHAR(20)   NOT NULL DEFAULT '',
  teacher_name  VARCHAR(150)  NOT NULL,
  phone         VARCHAR(20)   NULL,
  created_by    INT           NULL,
  updated_by    INT           NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_homeroom_room (school_id, grade, classroom),
  CONSTRAINT fk_homeroom_school FOREIGN KEY (school_id) REFERENCES schools (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
