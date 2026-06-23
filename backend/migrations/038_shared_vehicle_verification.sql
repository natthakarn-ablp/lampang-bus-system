-- 038_shared_vehicle_verification.sql
-- Shared PAO / school / Lampang DLT vehicle-verification workflow.
-- Additive only: the legacy vehicle_inspections table remains the compact
-- compatibility summary used by existing dashboards and QR views.

CREATE TABLE IF NOT EXISTS inspection_checklist_templates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  template_code VARCHAR(60) NOT NULL,
  template_name VARCHAR(200) NOT NULL,
  version_no INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_checklist_template_version (template_code, version_no),
  INDEX idx_checklist_template_active (is_active),
  CONSTRAINT fk_checklist_template_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inspection_checklist_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  template_id BIGINT NOT NULL,
  item_code VARCHAR(80) NOT NULL,
  category VARCHAR(120) NOT NULL,
  label_th VARCHAR(255) NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  allows_na BOOLEAN NOT NULL DEFAULT FALSE,
  fail_severity ENUM('MINOR','MAJOR','CRITICAL') NOT NULL DEFAULT 'MAJOR',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_checklist_item_code (template_id, item_code),
  INDEX idx_checklist_item_order (template_id, sort_order),
  CONSTRAINT fk_checklist_item_template FOREIGN KEY (template_id) REFERENCES inspection_checklist_templates(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_inspection_applications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  request_no VARCHAR(40) NOT NULL UNIQUE,
  vehicle_id VARCHAR(20) NOT NULL,
  issuing_school_id VARCHAR(20) NOT NULL,
  requested_by INT NOT NULL,
  current_term VARCHAR(20) NOT NULL,
  status ENUM(
    'DRAFT','READY_TO_PRINT','SUBMITTED','INSPECTION_PENDING',
    'NEEDS_FIX','PASSED','FAILED','EXPIRED','SUPERSEDED','CANCELLED'
  ) NOT NULL DEFAULT 'DRAFT',
  version_no INT NOT NULL DEFAULT 1,
  provider_type ENUM('DLT_OFFICER','PAO_INSPECTOR','PRIVATE_INSPECTION_CENTER','SIGNED_BATCH_FILE','DLT_CENTRAL_API') NOT NULL DEFAULT 'DLT_OFFICER',
  qr_token VARCHAR(64) NOT NULL UNIQUE,
  active_request_key VARCHAR(100) NULL UNIQUE,
  vehicle_snapshot_json JSON NOT NULL,
  rider_summary_json JSON NOT NULL,
  route_summary_json JSON NULL,
  ready_at TIMESTAMP NULL,
  submitted_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  superseded_by_id BIGINT NULL,
  cancelled_by INT NULL,
  cancel_reason VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_verification_app_vehicle (vehicle_id, created_at),
  INDEX idx_verification_app_school (issuing_school_id, created_at),
  INDEX idx_verification_app_status (status, created_at),
  CONSTRAINT fk_verification_app_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_verification_app_school FOREIGN KEY (issuing_school_id) REFERENCES schools(id),
  CONSTRAINT fk_verification_app_requester FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_verification_app_cancel_user FOREIGN KEY (cancelled_by) REFERENCES users(id),
  CONSTRAINT fk_verification_app_superseded FOREIGN KEY (superseded_by_id) REFERENCES vehicle_inspection_applications(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Counts only. No student id, name, CID hash, guardian, or phone is stored.
CREATE TABLE IF NOT EXISTS inspection_application_schools (
  application_id BIGINT NOT NULL,
  school_id VARCHAR(20) NOT NULL,
  morning_rider_count INT NOT NULL DEFAULT 0,
  evening_rider_count INT NOT NULL DEFAULT 0,
  peak_rider_count INT NOT NULL DEFAULT 0,
  pickup_area_summary JSON NULL,
  source_updated_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (application_id, school_id),
  INDEX idx_application_school_lookup (school_id, application_id),
  CONSTRAINT fk_application_school_app FOREIGN KEY (application_id) REFERENCES vehicle_inspection_applications(id),
  CONSTRAINT fk_application_school_school FOREIGN KEY (school_id) REFERENCES schools(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inspection_attempts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  application_id BIGINT NOT NULL,
  checklist_template_id BIGINT NOT NULL,
  inspected_by INT NOT NULL,
  provider_type ENUM('DLT_OFFICER','PAO_INSPECTOR','PRIVATE_INSPECTION_CENTER','SIGNED_BATCH_FILE','DLT_CENTRAL_API') NOT NULL DEFAULT 'DLT_OFFICER',
  provider_reference VARCHAR(120) NULL,
  result ENUM('IN_PROGRESS','PASSED','FAILED','NEEDS_FIX','PENDING') NOT NULL DEFAULT 'IN_PROGRESS',
  inspection_date DATE NOT NULL,
  expiry_date DATE NULL,
  notes TEXT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalized_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_inspection_attempt_app (application_id, created_at),
  INDEX idx_inspection_attempt_result (result, inspection_date),
  CONSTRAINT fk_inspection_attempt_app FOREIGN KEY (application_id) REFERENCES vehicle_inspection_applications(id),
  CONSTRAINT fk_inspection_attempt_template FOREIGN KEY (checklist_template_id) REFERENCES inspection_checklist_templates(id),
  CONSTRAINT fk_inspection_attempt_user FOREIGN KEY (inspected_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inspection_checklist_results (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  attempt_id BIGINT NOT NULL,
  checklist_item_id BIGINT NOT NULL,
  result ENUM('PASS','FAIL','NOT_APPLICABLE') NOT NULL,
  severity ENUM('MINOR','MAJOR','CRITICAL') NULL,
  notes VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_attempt_checklist_item (attempt_id, checklist_item_id),
  INDEX idx_checklist_result_fail (attempt_id, result, severity),
  CONSTRAINT fk_checklist_result_attempt FOREIGN KEY (attempt_id) REFERENCES inspection_attempts(id),
  CONSTRAINT fk_checklist_result_item FOREIGN KEY (checklist_item_id) REFERENCES inspection_checklist_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inspection_evidence (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  attempt_id BIGINT NOT NULL,
  checklist_item_id BIGINT NULL,
  evidence_type ENUM('PHOTO','DOCUMENT','REFERENCE') NOT NULL,
  storage_key VARCHAR(500) NULL,
  original_name VARCHAR(255) NULL,
  mime_type VARCHAR(120) NULL,
  sha256 CHAR(64) NULL,
  provider_reference VARCHAR(255) NULL,
  uploaded_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_inspection_evidence_attempt (attempt_id),
  CONSTRAINT fk_inspection_evidence_attempt FOREIGN KEY (attempt_id) REFERENCES inspection_attempts(id),
  CONSTRAINT fk_inspection_evidence_item FOREIGN KEY (checklist_item_id) REFERENCES inspection_checklist_items(id),
  CONSTRAINT fk_inspection_evidence_user FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE vehicles
  ADD COLUMN certified_capacity INT NULL,
  ADD COLUMN verification_status ENUM('UNVERIFIED','ELIGIBLE','EXPIRING','INELIGIBLE','SUSPENDED') NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN verification_reasons_json JSON NULL,
  ADD COLUMN verification_updated_at TIMESTAMP NULL;

INSERT INTO inspection_checklist_templates (template_code, template_name, version_no, is_active)
VALUES ('LAMPANG_SCHOOLBUS', 'แบบตรวจรถรับส่งนักเรียนจังหวัดลำปาง', 1, TRUE)
ON DUPLICATE KEY UPDATE template_name = VALUES(template_name);

INSERT INTO inspection_checklist_items
  (template_id, item_code, category, label_th, is_required, allows_na, fail_severity, sort_order)
SELECT t.id, seed.item_code, seed.category, seed.label_th, TRUE, FALSE, seed.severity, seed.sort_order
FROM inspection_checklist_templates t
JOIN (
  SELECT 'IDENTITY_MATCH' item_code, 'ตัวรถและเอกสาร' category, 'ทะเบียนและเลขตัวถังตรงกับตัวรถ' label_th, 'CRITICAL' severity, 10 sort_order
  UNION ALL SELECT 'CAPACITY', 'ตัวรถและเอกสาร', 'ประเภทและความจุรถถูกต้อง', 'CRITICAL', 20
  UNION ALL SELECT 'BRAKES', 'ความปลอดภัย', 'ระบบเบรกอยู่ในสภาพพร้อมใช้งาน', 'CRITICAL', 30
  UNION ALL SELECT 'TIRES', 'ความปลอดภัย', 'ยางและล้ออยู่ในสภาพปลอดภัย', 'CRITICAL', 40
  UNION ALL SELECT 'LIGHTS', 'ความปลอดภัย', 'ไฟส่องสว่างและไฟสัญญาณใช้งานได้', 'MAJOR', 50
  UNION ALL SELECT 'DOORS_EXIT', 'ห้องโดยสาร', 'ประตูและทางออกฉุกเฉินใช้งานได้', 'CRITICAL', 60
  UNION ALL SELECT 'SEATS_BELTS', 'ห้องโดยสาร', 'ที่นั่งและเข็มขัดนิรภัยอยู่ในสภาพพร้อมใช้', 'CRITICAL', 70
  UNION ALL SELECT 'FIRE_EXTINGUISHER', 'อุปกรณ์ฉุกเฉิน', 'ถังดับเพลิงและอุปกรณ์ฉุกเฉินพร้อมใช้', 'MAJOR', 80
  UNION ALL SELECT 'MANDATORY_DOCS', 'ตัวรถและเอกสาร', 'ภาษี พ.ร.บ. และประกันยังมีผล', 'CRITICAL', 90
) seed
WHERE t.template_code = 'LAMPANG_SCHOOLBUS' AND t.version_no = 1
ON DUPLICATE KEY UPDATE label_th = VALUES(label_th), fail_severity = VALUES(fail_severity), sort_order = VALUES(sort_order);
