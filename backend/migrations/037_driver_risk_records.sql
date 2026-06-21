-- 037_driver_risk_records.sql — Phase QR-1 (Level-3 sensitive, schema-only)
-- PDPA ม.26 SENSITIVE data (driver violation / risk-behavior history). Ships
-- EMPTY: no bulk data-entry UI in this phase. The Level-3 viewer is gated behind
-- FEATURE_QR_LEVEL3 (default off, pending DPO sign-off) and every read is written
-- to audit_logs (action='VIEW'). Entry tooling is a deliberate later phase.
--
-- Rollback: DROP TABLE driver_risk_records;   (new table, empty)

CREATE TABLE IF NOT EXISTS driver_risk_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  driver_id INT NOT NULL,
  record_type VARCHAR(40) NULL,                       -- e.g. traffic_violation | complaint | incident
  severity VARCHAR(20) NULL,                          -- e.g. low | medium | high
  description TEXT NULL,
  occurred_on DATE NULL,
  recorded_by INT NULL,                               -- users.id of the recorder
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (driver_id) REFERENCES drivers(id),
  INDEX idx_drr_driver (driver_id),
  INDEX idx_drr_occurred (occurred_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
