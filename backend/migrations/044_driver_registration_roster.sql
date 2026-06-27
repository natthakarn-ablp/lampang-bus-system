-- 044_driver_registration_roster.sql — Phase 10.14
-- Driver-initiated vehicle registration roster + per-school approval, layered on
-- the existing shared-verification tables (038). ADDITIVE ONLY:
--   * new nullable / defaulted columns on inspection_application_schools
--   * one new table (registration_roster_students)
--   * the 3 missing student fields (health_note / guardian_phone_alt / home_address)
-- No existing column is renamed, no ENUM is altered, nothing is dropped. Runtime
-- behaviour is gated behind FEATURE_DRIVER_REGISTRATION (dark by default), so
-- applying this migration alone changes no current data or behaviour.

-- 1) Per-school approval ON THE EXISTING vehicle↔school link (038). Existing rows
--    default to PENDING_SCHOOL_REVIEW; rider counts are untouched.
ALTER TABLE inspection_application_schools
  ADD COLUMN approval_status ENUM('PENDING_SCHOOL_REVIEW','APPROVED','NEEDS_REVISION','REJECTED')
    NOT NULL DEFAULT 'PENDING_SCHOOL_REVIEW',
  ADD COLUMN submitted_by_driver INT NULL,
  ADD COLUMN reviewed_by INT NULL,
  ADD COLUMN reviewed_at TIMESTAMP NULL,
  ADD COLUMN school_note VARCHAR(500) NULL,
  ADD CONSTRAINT fk_ias_submitted_by FOREIGN KEY (submitted_by_driver) REFERENCES users(id),
  ADD CONSTRAINT fk_ias_reviewed_by  FOREIGN KEY (reviewed_by) REFERENCES users(id);

-- 2) Driver-entered roster (raw) → school reconciles to the real student id.
--    raw_* fields are PII (driver-typed); redaction handled in exportSecurity.js.
CREATE TABLE IF NOT EXISTS registration_roster_students (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  application_id BIGINT NOT NULL,
  school_id VARCHAR(10) NOT NULL,
  raw_student_name VARCHAR(200) NOT NULL,
  raw_grade VARCHAR(20) NULL,
  raw_student_code VARCHAR(50) NULL,
  matched_student_id INT NULL,                 -- NULL = ยังไม่ match
  match_status ENUM('UNMATCHED','MATCHED','NOT_FOUND') NOT NULL DEFAULT 'UNMATCHED',
  pickup_type ENUM('MORNING','EVENING','BOTH') NULL,
  submitted_by INT NULL,                       -- users.id (role='driver') ที่เพิ่ม
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rrs_app_school (application_id, school_id),
  INDEX idx_rrs_matched (matched_student_id),
  CONSTRAINT fk_rrs_app    FOREIGN KEY (application_id) REFERENCES vehicle_inspection_applications(id),
  CONSTRAINT fk_rrs_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_rrs_match  FOREIGN KEY (matched_student_id) REFERENCES students(id),
  CONSTRAINT fk_rrs_user   FOREIGN KEY (submitted_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Missing student fields (replaces the Google Form survey columns).
--    home_address is named to avoid clashing with the existing dropoff_address.
ALTER TABLE students
  ADD COLUMN health_note VARCHAR(500) NULL,
  ADD COLUMN guardian_phone_alt VARCHAR(20) NULL,
  ADD COLUMN home_address VARCHAR(300) NULL;
