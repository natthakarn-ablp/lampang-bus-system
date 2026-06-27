-- 045_driver_documents.sql — Phase 10.14 (supporting evidence)
-- Supporting-evidence document uploads (PDF/image) for the driver-initiated
-- vehicle registration flow: per-vehicle documents (registration book /
-- compulsory insurance พ.ร.บ. / tax / insurance) and per-driver documents
-- (driving licence). ADDITIVE ONLY — two new tables, no existing column changed.
--
-- review_status is set by a HUMAN reviewer (issuing school / transport / admin);
-- it is advisory metadata only and NEVER auto-touches vehicles.verification_status
-- or registration eligibility. Runtime behaviour is gated behind
-- FEATURE_DRIVER_REGISTRATION (dark by default), so applying this migration alone
-- changes no current data or behaviour. Soft-delete + audited at the app layer.
--
-- FK targets (verified against 001_initial_schema.sql):
--   vehicles.id VARCHAR(20)   drivers.id INT   users.id INT

CREATE TABLE IF NOT EXISTS vehicle_documents (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id    VARCHAR(20) NOT NULL,
  doc_type      ENUM('VEHICLE_REGISTRATION','COMPULSORY_INSURANCE','TAX','INSURANCE','OTHER') NOT NULL,
  storage_key   VARCHAR(255) NOT NULL,          -- on-disk basename under uploads/documents/
  original_name VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(120) NULL,
  sha256        CHAR(64) NOT NULL,              -- hex digest of stored bytes
  file_size     INT NOT NULL,
  expiry_date   DATE NULL,
  uploaded_by   INT NOT NULL,                   -- users.id
  review_status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  reviewed_by   INT NULL,                       -- users.id (school/transport/admin)
  reviewed_at   TIMESTAMP NULL,
  review_note   VARCHAR(500) NULL,
  is_deleted    BOOLEAN DEFAULT FALSE,
  deleted_at    TIMESTAMP NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_vehdoc_vehicle (vehicle_id, is_deleted),
  INDEX idx_vehdoc_review (review_status),
  INDEX idx_vehdoc_uploaded_by (uploaded_by),
  CONSTRAINT fk_vehdoc_vehicle     FOREIGN KEY (vehicle_id)  REFERENCES vehicles(id),
  CONSTRAINT fk_vehdoc_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id),
  CONSTRAINT fk_vehdoc_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS driver_documents (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  driver_id     INT NOT NULL,
  doc_type      ENUM('DRIVER_LICENCE','OTHER') NOT NULL,
  storage_key   VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(120) NULL,
  sha256        CHAR(64) NOT NULL,
  file_size     INT NOT NULL,
  expiry_date   DATE NULL,
  uploaded_by   INT NOT NULL,
  review_status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  reviewed_by   INT NULL,
  reviewed_at   TIMESTAMP NULL,
  review_note   VARCHAR(500) NULL,
  is_deleted    BOOLEAN DEFAULT FALSE,
  deleted_at    TIMESTAMP NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_drvdoc_driver (driver_id, is_deleted),
  INDEX idx_drvdoc_review (review_status),
  INDEX idx_drvdoc_uploaded_by (uploaded_by),
  CONSTRAINT fk_drvdoc_driver      FOREIGN KEY (driver_id)   REFERENCES drivers(id),
  CONSTRAINT fk_drvdoc_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id),
  CONSTRAINT fk_drvdoc_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
