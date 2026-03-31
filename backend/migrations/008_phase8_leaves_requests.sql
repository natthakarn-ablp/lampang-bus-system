-- ============================================
-- Phase 8: Leaves, Roster Change Requests, Driver Photo
-- ============================================

-- 1. Student Leaves
CREATE TABLE IF NOT EXISTS student_leaves (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  student_id    INT          NOT NULL,
  vehicle_id    VARCHAR(20)  NOT NULL,
  leave_date    DATE         NOT NULL,
  session       ENUM('morning','evening','both') NOT NULL,
  reason        VARCHAR(255) NULL,
  reported_by   INT          NOT NULL,
  reported_role ENUM('driver','school') NOT NULL,
  cancelled     BOOLEAN      NOT NULL DEFAULT FALSE,
  cancelled_by  INT          NULL,
  cancelled_at  TIMESTAMP    NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_sl_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_sl_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  UNIQUE KEY uk_sl_date_student_session (leave_date, student_id, session),
  INDEX idx_sl_vehicle_date (vehicle_id, leave_date),
  INDEX idx_sl_date (leave_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Roster Change Requests
CREATE TABLE IF NOT EXISTS roster_change_requests (
  id             BIGINT       NOT NULL AUTO_INCREMENT,
  vehicle_id     VARCHAR(20)  NOT NULL,
  student_id     INT          NOT NULL,
  school_id      VARCHAR(10)  NOT NULL,
  request_type   ENUM('add','remove') NOT NULL,
  reason         VARCHAR(255) NULL,
  requested_by   INT          NOT NULL,
  status         ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by    INT          NULL,
  reviewed_at    TIMESTAMP    NULL,
  review_note    VARCHAR(255) NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_rcr_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_rcr_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_rcr_school  FOREIGN KEY (school_id)  REFERENCES schools(id),
  INDEX idx_rcr_school_status (school_id, status),
  INDEX idx_rcr_vehicle (vehicle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Driver photo column
ALTER TABLE drivers ADD COLUMN photo_url VARCHAR(500) NULL AFTER phone;
