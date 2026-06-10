-- 027_import_preview.sql — Phase 10.13A-26A
-- Additive: batch + row-level import persistence so student imports are
-- previewable, reviewable, re-checkable, and auditable. Does NOT touch students,
-- vehicles, drivers or the existing importer. Reversible (drop the new table +
-- columns). import_batches is widened (it was unused / 0 rows).

-- 1. Widen import_batches for the preview/apply workflow + file retention.
ALTER TABLE import_batches
  ADD COLUMN stored_file_path VARCHAR(500) NULL AFTER filename,
  ADD COLUMN file_sha256 CHAR(64) NULL AFTER stored_file_path,
  ADD COLUMN mode VARCHAR(40) NULL AFTER status,
  ADD COLUMN insert_count INT NOT NULL DEFAULT 0 AFTER success_rows,
  ADD COLUMN update_count INT NOT NULL DEFAULT 0 AFTER insert_count,
  ADD COLUMN skip_count INT NOT NULL DEFAULT 0 AFTER update_count,
  ADD COLUMN applied_at TIMESTAMP NULL AFTER completed_at,
  ADD COLUMN expires_at TIMESTAMP NULL AFTER applied_at,
  ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

-- status was ENUM('PROCESSING','COMPLETED','FAILED'); widen to allow the new
-- workflow states (PREVIEWED / APPLIED / APPLIED_PARTIAL). Table is empty.
ALTER TABLE import_batches MODIFY COLUMN status VARCHAR(30) NOT NULL DEFAULT 'PROCESSING';

-- 2. Row-level import results.
CREATE TABLE IF NOT EXISTS import_batch_rows (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  row_no INT NOT NULL,                  -- 'row_number' is a reserved word in MySQL 8
  raw_json JSON NULL,
  normalized_json JSON NULL,
  classification VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL,
  message_th VARCHAR(300) NULL,
  student_code VARCHAR(50) NULL,
  existing_student_id INT NULL,
  new_student_id INT NULL,
  matched_vehicle_id VARCHAR(20) NULL,
  matched_display_plate VARCHAR(100) NULL,
  guardian_diff_json JSON NULL,
  can_apply BOOLEAN NOT NULL DEFAULT FALSE,
  applied_at TIMESTAMP NULL,
  error_detail TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_batch (batch_id),
  INDEX idx_batch_row (batch_id, row_no),
  INDEX idx_status (status),
  INDEX idx_classification (classification),
  CONSTRAINT fk_import_batch_rows_batch FOREIGN KEY (batch_id) REFERENCES import_batches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
