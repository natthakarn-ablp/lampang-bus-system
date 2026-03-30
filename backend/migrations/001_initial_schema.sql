-- ============================================================
-- Lampang Bus System — Initial Schema
-- Migration: 001_initial_schema.sql
-- MySQL 8.0 | InnoDB | utf8mb4_unicode_ci
--
-- Table creation order (respects FK dependencies):
--  1.  affiliations, terms
--  2.  schools          (→ affiliations)
--  3.  vehicles
--  4.  drivers
--  5.  driver_vehicle_assignments  (→ drivers, vehicles)
--  6.  vehicle_attendants          (→ vehicles)
--  7.  students         (→ schools, vehicles)  [import_batch_id FK deferred]
--  8.  parents
--  9.  parent_student   (→ parents, students)  [approved_by FK deferred]
-- 10.  users            (→ drivers)
-- 11.  checkin_logs     (→ vehicles, students)
-- 12.  daily_status
-- 13.  vehicle_inspections  (→ vehicles)       [inspected_by FK deferred]
-- 14.  emergency_logs   (→ vehicles)           [reported_by FK deferred]
-- 15.  line_users       (→ parents, drivers)
-- 16.  line_message_logs
-- 17.  notifications                           [target_line_user_id FK deferred]
-- 18.  import_batches   (→ schools)
-- 19.  audit_logs
-- 20.  system_params
-- 21.  ALTER TABLE ×5   (deferred FKs)
-- 22.  revoked_tokens   (supporting — refresh token blacklist)
-- 23.  MySQL Event      (daily cleanup of revoked_tokens)
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- 1. Reference Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS affiliations (
  id          VARCHAR(10)  NOT NULL,
  name        VARCHAR(200) NOT NULL,
  is_deleted  BOOLEAN      NOT NULL DEFAULT FALSE,
  deleted_at  TIMESTAMP    NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS terms (
  id          VARCHAR(10)  NOT NULL,
  name        VARCHAR(50)  NULL,
  start_date  DATE         NULL,
  end_date    DATE         NULL,
  is_current  BOOLEAN      NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 2. Schools
-- ============================================================

CREATE TABLE IF NOT EXISTS schools (
  id              VARCHAR(10)  NOT NULL,
  name            VARCHAR(200) NOT NULL,
  affiliation_id  VARCHAR(10)  NULL,
  is_deleted      BOOLEAN      NOT NULL DEFAULT FALSE,
  deleted_at      TIMESTAMP    NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_schools_affiliation FOREIGN KEY (affiliation_id) REFERENCES affiliations (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 3. Vehicles
-- ============================================================

CREATE TABLE IF NOT EXISTS vehicles (
  id                VARCHAR(20)  NOT NULL,          -- 'V-' + 12 hex chars
  plate_no          VARCHAR(50)  NOT NULL,
  vehicle_type      VARCHAR(50)  NULL,
  owner_name        VARCHAR(100) NULL,
  owner_phone       VARCHAR(20)  NULL,
  insurance_status  VARCHAR(50)  NULL,
  insurance_type    VARCHAR(50)  NULL,
  insurance_expiry  DATE         NULL,
  is_deleted        BOOLEAN      NOT NULL DEFAULT FALSE,
  deleted_at        TIMESTAMP    NULL,
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicles_plate_no (plate_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 4. Drivers
-- ============================================================

CREATE TABLE IF NOT EXISTS drivers (
  id            INT          NOT NULL AUTO_INCREMENT,
  name          VARCHAR(100) NOT NULL,
  phone         VARCHAR(20)  NULL,
  line_user_id  VARCHAR(50)  NULL,                  -- shortcut; source of truth: line_users
  is_deleted    BOOLEAN      NOT NULL DEFAULT FALSE,
  deleted_at    TIMESTAMP    NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 5. Driver ↔ Vehicle Assignments (many-to-many)
-- ============================================================

CREATE TABLE IF NOT EXISTS driver_vehicle_assignments (
  id          INT     NOT NULL AUTO_INCREMENT,
  driver_id   INT     NOT NULL,
  vehicle_id  VARCHAR(20) NOT NULL,
  term_id     VARCHAR(10) NULL,
  start_date  DATE    NOT NULL,
  end_date    DATE    NULL,                          -- NULL = still active
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_dva_driver  FOREIGN KEY (driver_id)  REFERENCES drivers  (id),
  CONSTRAINT fk_dva_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id),
  INDEX idx_dva_active          (is_active, driver_id),
  INDEX idx_dva_vehicle_active  (is_active, vehicle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 6. Vehicle Attendants
-- ============================================================

CREATE TABLE IF NOT EXISTS vehicle_attendants (
  id          INT          NOT NULL AUTO_INCREMENT,
  vehicle_id  VARCHAR(20)  NULL,
  name        VARCHAR(100) NULL,
  phone       VARCHAR(20)  NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_attendants_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 7. Students  (import_batch_id FK added via ALTER TABLE later)
-- ============================================================

CREATE TABLE IF NOT EXISTS students (
  id               INT          NOT NULL,            -- รหัสนักเรียน (เช่น 21199)
  cid_hash         VARCHAR(64)  NOT NULL,            -- SHA-256 of national ID
  prefix           VARCHAR(20)  NULL,                -- 'เด็กชาย', 'เด็กหญิง'
  first_name       VARCHAR(100) NOT NULL,
  last_name        VARCHAR(100) NOT NULL,
  grade            VARCHAR(20)  NULL,                -- 'ป.1', 'ม.3'
  classroom        VARCHAR(20)  NULL,                -- VARCHAR: '1', 'A', '1/1', 'อนุบาล3/2'
  school_id        VARCHAR(10)  NULL,
  vehicle_id       VARCHAR(20)  NULL,                -- current vehicle (shortcut)
  dropoff_address  TEXT         NULL,
  morning_enabled  BOOLEAN      NOT NULL DEFAULT TRUE,
  evening_enabled  BOOLEAN      NOT NULL DEFAULT TRUE,
  term_id          VARCHAR(10)  NULL,
  import_batch_id  INT          NULL,                -- FK added via ALTER TABLE
  is_deleted       BOOLEAN      NOT NULL DEFAULT FALSE,
  deleted_at       TIMESTAMP    NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_students_school   FOREIGN KEY (school_id)  REFERENCES schools  (id),
  CONSTRAINT fk_students_vehicle  FOREIGN KEY (vehicle_id) REFERENCES vehicles (id),
  INDEX idx_students_school      (school_id),
  INDEX idx_students_vehicle     (vehicle_id),
  INDEX idx_students_cid_hash    (cid_hash),
  INDEX idx_students_import_batch (import_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 8. Parents
-- ============================================================

CREATE TABLE IF NOT EXISTS parents (
  id            INT          NOT NULL AUTO_INCREMENT,
  name          VARCHAR(100) NULL,
  phone         VARCHAR(20)  NULL,
  line_user_id  VARCHAR(50)  NULL,                  -- shortcut; source of truth: line_users
  verified      BOOLEAN      NOT NULL DEFAULT FALSE,
  is_deleted    BOOLEAN      NOT NULL DEFAULT FALSE,
  deleted_at    TIMESTAMP    NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 9. Parent ↔ Student  (approved_by FK added via ALTER TABLE later)
-- ============================================================

CREATE TABLE IF NOT EXISTS parent_student (
  parent_id    INT         NOT NULL,
  student_id   INT         NOT NULL,
  relationship VARCHAR(20) NOT NULL DEFAULT 'parent',
  approved     BOOLEAN     NOT NULL DEFAULT FALSE,
  approved_by  INT         NULL,                    -- FK added via ALTER TABLE
  approved_at  TIMESTAMP   NULL,
  PRIMARY KEY (parent_id, student_id),
  CONSTRAINT fk_ps_parent  FOREIGN KEY (parent_id)  REFERENCES parents  (id),
  CONSTRAINT fk_ps_student FOREIGN KEY (student_id) REFERENCES students (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 10. Users (RBAC)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id             INT          NOT NULL AUTO_INCREMENT,
  username       VARCHAR(100) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  role           ENUM('driver','school','affiliation','province','transport','admin') NOT NULL,
  scope_type     ENUM('SCHOOL','AFFILIATION','PROVINCE') NULL,
  scope_id       VARCHAR(20)  NULL,
  display_name   VARCHAR(200) NULL,
  driver_id      INT          NULL,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  is_deleted     BOOLEAN      NOT NULL DEFAULT FALSE,
  deleted_at     TIMESTAMP    NULL,
  last_login     TIMESTAMP    NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  CONSTRAINT fk_users_driver FOREIGN KEY (driver_id) REFERENCES drivers (id),
  INDEX idx_users_role  (role),
  INDEX idx_users_scope (scope_type, scope_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 11. Checkin / Checkout Logs
-- ============================================================

CREATE TABLE IF NOT EXISTS checkin_logs (
  id            BIGINT      NOT NULL AUTO_INCREMENT,
  term_id       VARCHAR(10) NULL,
  vehicle_id    VARCHAR(20) NULL,
  plate_no      VARCHAR(50) NULL,
  student_id    INT         NULL,
  cid_hash      VARCHAR(64) NULL,
  student_name  VARCHAR(100) NULL,
  session       ENUM('morning','evening') NOT NULL,
  status        ENUM('CHECKED_IN','CHECKED_OUT','ABSENT','CANCELLED') NOT NULL,
  check_date    DATE        NOT NULL,
  checked_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_by    INT         NULL,                   -- users.id (no FK — intentional)
  source        ENUM('web','line','auto') NOT NULL DEFAULT 'web',
  PRIMARY KEY (id),
  CONSTRAINT fk_cl_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id),
  CONSTRAINT fk_cl_student FOREIGN KEY (student_id) REFERENCES students (id),
  INDEX idx_cl_date_vehicle  (check_date, vehicle_id),
  INDEX idx_cl_date_student  (check_date, student_id),
  INDEX idx_cl_term_date     (term_id, check_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 12. Daily Status (denormalized today's snapshot)
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_status (
  id            BIGINT      NOT NULL AUTO_INCREMENT,
  check_date    DATE        NOT NULL,
  vehicle_id    VARCHAR(20) NULL,                   -- no FK (denormalized)
  student_id    INT         NULL,                   -- no FK (denormalized)
  cid_hash      VARCHAR(64) NULL,
  student_name  VARCHAR(100) NULL,
  morning_done  BOOLEAN     NOT NULL DEFAULT FALSE,
  morning_ts    TIMESTAMP   NULL,
  evening_done  BOOLEAN     NOT NULL DEFAULT FALSE,
  evening_ts    TIMESTAMP   NULL,
  updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ds_date_student  (check_date, student_id),
  INDEX idx_ds_date_vehicle      (check_date, vehicle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 13. Vehicle Inspections  (inspected_by FK added via ALTER TABLE later)
-- ============================================================

CREATE TABLE IF NOT EXISTS vehicle_inspections (
  id               INT     NOT NULL AUTO_INCREMENT,
  vehicle_id       VARCHAR(20) NULL,
  inspected_by     INT     NULL,                    -- FK added via ALTER TABLE
  inspection_date  DATE    NOT NULL,
  expiry_date      DATE    NULL,
  result           ENUM('PASSED','FAILED','NEEDS_FIX','PENDING') NOT NULL,
  notes            TEXT    NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_vi_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id),
  INDEX idx_vi_vehicle_date (vehicle_id, inspection_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 14. Emergency Logs  (reported_by FK added via ALTER TABLE later)
-- ============================================================

CREATE TABLE IF NOT EXISTS emergency_logs (
  id           INT     NOT NULL AUTO_INCREMENT,
  reported_by  INT     NULL,                        -- FK added via ALTER TABLE
  channel      ENUM('web','line') NOT NULL DEFAULT 'web',
  vehicle_id   VARCHAR(20) NULL,
  plate_no     VARCHAR(50) NULL,
  detail       TEXT    NULL,
  note         TEXT    NULL,
  result       TEXT    NULL,
  reported_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_el_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 15. LINE Users  (explicit FKs — not polymorphic)
-- ============================================================

CREATE TABLE IF NOT EXISTS line_users (
  line_user_id  VARCHAR(50)  NOT NULL,
  user_type     ENUM('parent','driver') NOT NULL,
  parent_id     INT          NULL,
  driver_id     INT          NULL,
  display_name  VARCHAR(100) NULL,
  verified      BOOLEAN      NOT NULL DEFAULT FALSE,
  linked_at     TIMESTAMP    NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (line_user_id),
  CONSTRAINT fk_lu_parent FOREIGN KEY (parent_id) REFERENCES parents (id),
  CONSTRAINT fk_lu_driver FOREIGN KEY (driver_id) REFERENCES drivers (id),
  CONSTRAINT chk_lu_linked CHECK (
    (user_type = 'parent' AND parent_id IS NOT NULL AND driver_id IS NULL)
    OR (user_type = 'driver' AND driver_id IS NOT NULL AND parent_id IS NULL)
    OR (parent_id IS NULL AND driver_id IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 16. LINE Message Logs
-- ============================================================

CREATE TABLE IF NOT EXISTS line_message_logs (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  line_user_id  VARCHAR(50)  NULL,                  -- no FK intentionally (webhook may arrive before line_users insert)
  source_type   VARCHAR(20)  NULL,                  -- 'user', 'group', 'room'
  source_id     VARCHAR(50)  NULL,
  message_text  TEXT         NULL,
  result        TEXT         NULL,
  detail        TEXT         NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_lml_line_user (line_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 17. Notifications  (target_line_user_id FK added via ALTER TABLE later)
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id                    BIGINT       NOT NULL AUTO_INCREMENT,
  target_line_user_id   VARCHAR(50)  NULL,           -- FK added via ALTER TABLE
  notification_type     ENUM('checkin','checkout','emergency','system') NOT NULL,
  student_id            INT          NULL,
  message_json          JSON         NULL,
  sent                  BOOLEAN      NOT NULL DEFAULT FALSE,
  sent_at               TIMESTAMP    NULL,
  error_message         TEXT         NULL,
  retry_count           INT          NOT NULL DEFAULT 0,
  created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 18. Import Batches
-- ============================================================

CREATE TABLE IF NOT EXISTS import_batches (
  id             INT          NOT NULL AUTO_INCREMENT,
  school_id      VARCHAR(10)  NULL,
  imported_by    INT          NULL,                  -- users.id (no FK — intentional)
  filename       VARCHAR(255) NULL,
  total_rows     INT          NOT NULL DEFAULT 0,
  success_rows   INT          NOT NULL DEFAULT 0,
  error_rows     INT          NOT NULL DEFAULT 0,
  error_details  JSON         NULL,
  status         ENUM('PROCESSING','COMPLETED','FAILED') NOT NULL DEFAULT 'PROCESSING',
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at   TIMESTAMP    NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_ib_school FOREIGN KEY (school_id) REFERENCES schools (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 19. Audit Logs
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  user_id      INT         NULL,                    -- no FK (user may be deleted)
  action       ENUM('CREATE','UPDATE','DELETE','EXPORT','LOGIN','IMPORT','APPROVE') NOT NULL,
  entity_type  VARCHAR(50) NULL,
  entity_id    VARCHAR(50) NULL,
  old_value    JSON        NULL,
  new_value    JSON        NULL,
  ip_address   VARCHAR(45) NULL,
  user_agent   VARCHAR(255) NULL,
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_al_user_action (user_id, action),
  INDEX idx_al_entity      (entity_type, entity_id),
  INDEX idx_al_created     (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 20. System Parameters  (replaces PARAM sheet)
-- ============================================================

CREATE TABLE IF NOT EXISTS system_params (
  param_key    VARCHAR(100) NOT NULL,
  param_value  TEXT         NULL,
  description  VARCHAR(200) NULL,
  PRIMARY KEY (param_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO system_params (param_key, param_value, description) VALUES
  ('SYSTEM_NAME',              'ระบบรถรับส่งนักเรียนจังหวัดลำปาง', 'ชื่อระบบ'),
  ('TIMEZONE',                 'Asia/Bangkok',                       'Timezone'),
  ('CURRENT_TERM',             '2568-2',                             'ภาคเรียนปัจจุบัน'),
  ('LINE_CHANNEL_ACCESS_TOKEN','',                                   'LINE Messaging API Token'),
  ('LINE_CHANNEL_SECRET',      '',                                   'LINE Channel Secret'),
  ('EMERGENCY_GROUP_ID',       '',                                   'LINE Group ID สำหรับแจ้งเหตุฉุกเฉิน')
ON DUPLICATE KEY UPDATE param_value = VALUES(param_value);

-- ============================================================
-- 21. Deferred Foreign Keys (circular dependency resolution)
-- ============================================================

-- students.import_batch_id → import_batches.id
ALTER TABLE students
  ADD CONSTRAINT fk_students_import_batch
  FOREIGN KEY (import_batch_id) REFERENCES import_batches (id);

-- parent_student.approved_by → users.id
ALTER TABLE parent_student
  ADD CONSTRAINT fk_ps_approved_by
  FOREIGN KEY (approved_by) REFERENCES users (id);

-- vehicle_inspections.inspected_by → users.id
ALTER TABLE vehicle_inspections
  ADD CONSTRAINT fk_vi_inspected_by
  FOREIGN KEY (inspected_by) REFERENCES users (id);

-- emergency_logs.reported_by → users.id
ALTER TABLE emergency_logs
  ADD CONSTRAINT fk_el_reported_by
  FOREIGN KEY (reported_by) REFERENCES users (id);

-- notifications.target_line_user_id → line_users.line_user_id
ALTER TABLE notifications
  ADD CONSTRAINT fk_notif_target_line
  FOREIGN KEY (target_line_user_id) REFERENCES line_users (line_user_id);

-- ============================================================
-- 22. Revoked Tokens  (refresh token blacklist — supporting table)
-- ============================================================

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti         VARCHAR(64)  NOT NULL,
  user_id     INT          NOT NULL,
  revoked_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP    NOT NULL,
  PRIMARY KEY (jti),
  INDEX idx_rt_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 23. MySQL Event: daily cleanup of expired revoked_tokens
-- Requires MySQL Event Scheduler ON (--event-scheduler=ON in docker-compose).
-- ============================================================

DROP EVENT IF EXISTS cleanup_revoked_tokens;

CREATE EVENT cleanup_revoked_tokens
  ON SCHEDULE EVERY 1 DAY
    STARTS DATE_ADD(CURDATE(), INTERVAL 3 HOUR)
  COMMENT 'Remove expired refresh token blacklist entries'
  DO
    DELETE FROM revoked_tokens WHERE expires_at < NOW();

SET FOREIGN_KEY_CHECKS = 1;
