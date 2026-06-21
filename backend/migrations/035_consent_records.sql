-- 035_consent_records.sql — Phase QR-1 (PDPA consent ledger)
-- Append-only consent ledger (PDPA พ.ศ. 2562 ม.19/26). A grant inserts a
-- 'granted' row; a withdrawal inserts a NEW 'withdrawn' row (never UPDATE/DELETE)
-- — the effective status is the latest row per (user, consent_type). The exact
-- Thai consent text shown is snapshotted per row for evidentiary integrity.
--
-- Rollback: DROP TABLE consent_records;   (new table, empty)

CREATE TABLE IF NOT EXISTS consent_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,                                   -- users.id for driver/staff subjects; NULL for LINE parents / anonymous
  line_user_id VARCHAR(50) NULL,                      -- LINE-verified subject (parents have no users.id); redacted in exports
  user_role VARCHAR(30) NULL,
  consent_type VARCHAR(40) NOT NULL,                  -- qr_public_notice | qr_parent_optin | qr_driver_public | qr_driver_parent | qr_driver_sensitive
  consent_version VARCHAR(40) NOT NULL,
  consent_status ENUM('granted','withdrawn') NOT NULL,
  consent_text_snapshot TEXT NOT NULL,                -- exact text accepted/withdrawn-from at the time
  granted_at TIMESTAMP NULL,
  withdrawn_at TIMESTAMP NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cr_user_type (user_id, consent_type),
  INDEX idx_cr_line_type (line_user_id, consent_type),
  INDEX idx_cr_type_status (consent_type, consent_status),
  INDEX idx_cr_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
