-- 033_vehicle_requests.sql — Phase 10.13B-7
-- Additive: a guarded vehicle restore / shared-fleet-use request queue.
-- Creating a request changes NO vehicle/student/driver data; the only mutation
-- (restoring a soft-deleted vehicle) happens on explicit admin approval.

CREATE TABLE IF NOT EXISTS vehicle_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_type VARCHAR(50) NOT NULL,                 -- RESTORE_SOFT_DELETED_VEHICLE | USE_EXISTING_SHARED_VEHICLE | ADD_MISSING_VEHICLE | REVIEW_VEHICLE_CONFLICT
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',     -- PENDING|APPROVED|REJECTED|CANCELLED|APPLIED|FAILED
  requested_by INT NULL,
  approved_by INT NULL,
  rejected_by INT NULL,
  school_id VARCHAR(20) NULL,
  vehicle_id VARCHAR(20) NULL,
  plate_prefix VARCHAR(20) NULL,
  plate_number VARCHAR(20) NULL,
  province VARCHAR(60) NULL,
  input_plate VARCHAR(120) NULL,
  canonical_plate VARCHAR(120) NULL,
  existing_vehicle_snapshot_json JSON NULL,          -- plate/type only (no owner phone)
  request_context_json JSON NULL,
  import_batch_id INT NULL,
  import_row_id BIGINT NULL,
  reason VARCHAR(500) NULL,
  admin_note VARCHAR(500) NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_at TIMESTAMP NULL,
  rejected_at TIMESTAMP NULL,
  applied_at TIMESTAMP NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_vr_school (school_id),
  INDEX idx_vr_vehicle (vehicle_id),
  INDEX idx_vr_canonical (canonical_plate),
  INDEX idx_vr_status (status),
  INDEX idx_vr_type (request_type),
  INDEX idx_vr_created (created_at),
  INDEX idx_vr_batch (import_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
