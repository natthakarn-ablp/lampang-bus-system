-- 032_student_transfer_requests.sql — Phase 10.13B-6
-- Additive: a guarded inter-school transfer / wrong-school correction request
-- queue. Creating a request changes NO student data; the move only happens on
-- explicit admin approval (Option B: soft-close source + create destination).

CREATE TABLE IF NOT EXISTS student_transfer_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_type VARCHAR(30) NOT NULL,                 -- TRANSFER_TO_SCHOOL | WRONG_SCHOOL_CORRECTION
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',     -- PENDING|APPROVED|REJECTED|CANCELLED|APPLIED|FAILED
  student_id INT NOT NULL,
  student_code VARCHAR(50) NULL,
  student_name_snapshot VARCHAR(200) NULL,           -- name only (no phone/PII)
  source_school_id VARCHAR(20) NULL,
  destination_school_id VARCHAR(20) NULL,
  requested_by INT NULL,
  approved_by INT NULL,
  rejected_by INT NULL,
  reason VARCHAR(500) NULL,
  admin_note VARCHAR(500) NULL,
  evidence_note VARCHAR(500) NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  applied_student_id INT NULL,                       -- destination student id after apply
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_at TIMESTAMP NULL,
  rejected_at TIMESTAMP NULL,
  applied_at TIMESTAMP NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_str_source (source_school_id),
  INDEX idx_str_dest (destination_school_id),
  INDEX idx_str_status (status),
  INDEX idx_str_student (student_id),
  INDEX idx_str_code (student_code),
  INDEX idx_str_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
